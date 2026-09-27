import "dotenv/config";
import { getPool, signLocalJwt } from "../src/lib/pg-client.js";

// Walks /v1/vendor/shop and /v1/store on the seeded test vendor with a customer that has no device
// tokens (no real pushes), then deletes everything it created.
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";
const VENDOR = process.env.SMOKE_VENDOR ?? "44444444-4444-4444-8444-444444444441";

let failures = 0;
async function call(token: string | null, method: string, path: string, body?: unknown, expect = 200) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as any;
  const good = r.status === expect || (expect === 200 && r.status === 201);
  if (!good) failures++;
  console.log(good ? "ok " : "BAD", method, path.replace(/[0-9a-f-]{36}/g, ":id"), r.status, good ? "" : JSON.stringify(j).slice(0, 300));
  return j?.data ?? j;
}
function check(label: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(cond ? "ok " : "BAD", label, cond ? "" : JSON.stringify(detail)?.slice(0, 300));
}

const pool = getPool();
const { rows: cs } = await pool.query(
  `select id, email from public.local_users u
    where id not in (select user_id from vendors) and email is not null
      and not exists (select 1 from device_tokens d where d.user_id = u.id and d.is_active) limit 1`,
);
if (!cs[0]) throw new Error("need a customer without device tokens");
const CUSTOMER = cs[0].id as string;
const cTok = (await signLocalJwt({ id: CUSTOMER, email: cs[0].email })).token;
const vTok = (await signLocalJwt({ id: VENDOR, email: "smoke-vendor@karoonline.in" })).token;
const hadShop = (await pool.query(`select 1 from digital_shops where user_id = $1`, [VENDOR])).rowCount! > 0;
const started = new Date();
const S = "/v1/vendor/shop";

try {
  const home = await call(vTok, "GET", S);
  check("shop link", typeof home.shop?.url === "string" && !!home.shop?.slug, home.shop);
  const code = home.shop.slug as string;

  const cat = await call(vTok, "POST", `${S}/categories`, { name: "Smoke Cat" });
  await call(vTok, "POST", `${S}/categories`, { name: "smoke cat" }, 409);
  await call(vTok, "PATCH", `${S}/categories/${cat.category.id}`, { name: "Smoke Category" });

  const p = await call(vTok, "POST", `${S}/products`, {
    name: "Smoke Kurta",
    tagline: "Cotton",
    price: 500,
    mrp: 700,
    buying_price: 300,
    stock: 10,
    unit: "pc",
    category_id: cat.category.id,
    gst_percent: 5,
    gst_mode: "include",
    media: [{ type: "image", url: "https://karoonline.in/logo.png" }],
    variations: [{ label: "XL", price: 550 }],
    bulk_tiers: [{ min_qty: 5, price: 450 }],
    highlights: [{ k: "Fabric", v: "Cotton" }],
    faqs: [{ q: "Washable?", a: "Yes" }],
    cta: { preset: "cart", label: "Add to cart", color: "#D4A017" },
  });
  const pid = p.product.id as string;
  check("image_url from media", p.product.image_url === "https://karoonline.in/logo.png", p.product);
  check("jsonb variations", Array.isArray(p.product.variations) && p.product.variations[0]?.label === "XL", p.product.variations);

  await call(vTok, "POST", `${S}/products/${pid}/stock`, { delta: -3, reason: "Damaged" });
  await call(vTok, "POST", `${S}/products/${pid}/stock`, { delta: -50, reason: "Too many" }, 400);
  await call(vTok, "PATCH", `${S}/products/${pid}`, { stock: 12 });
  const log = await call(vTok, "GET", `${S}/products/${pid}/stock`);
  check("stock log 3 rows", log.log?.length === 3 && log.log[0].stock_after === 12, log.log);

  const ban = await call(vTok, "POST", `${S}/banners`, { image_url: "https://karoonline.in/logo.png", title: "Sale" });

  // Invoice: 2 × 500 with 10% discount, GST 5% added, ₹20 delivery = 900 + 45 + 20 = 965
  const inv = await call(vTok, "POST", `${S}/invoices`, {
    items: [{ product_id: pid, name: "Smoke Kurta", qty: 2, price: 500 }],
    customer_name: "Walk-in",
    customer_phone: "+91 98765 43210",
    discount_mode: "percent",
    discount_value: 10,
    gst_percent: 5,
    gst_mode: "add",
    delivery: 20,
    pay_mode: "upi",
    status: "paid",
  });
  check("invoice total", Number(inv.invoice?.total) === 965, inv.invoice);
  check("invoice number", /^INV-\d{4}-\d{4}$/.test(inv.invoice?.number ?? ""), inv.invoice?.number);
  let prod = (await pool.query(`select stock from shop_products where id = $1`, [pid])).rows[0];
  check("stock deducted to 10", Number(prod.stock) === 10, prod);

  const held = await call(vTok, "POST", `${S}/invoices`, { items: [{ product_id: pid, name: "Smoke Kurta", qty: 1, price: 500 }], status: "held" });
  check("held bill number", String(held.invoice?.number).startsWith("HOLD-"), held.invoice?.number);
  await call(vTok, "POST", `${S}/invoices/${held.invoice.id}/finalize`);
  prod = (await pool.query(`select stock from shop_products where id = $1`, [pid])).rows[0];
  check("finalize deducted to 9", Number(prod.stock) === 9, prod);
  await call(vTok, "POST", `${S}/invoices/${held.invoice.id}/cancel`);
  prod = (await pool.query(`select stock from shop_products where id = $1`, [pid])).rows[0];
  check("cancel restocked to 10", Number(prod.stock) === 10, prod);
  const list = await call(vTok, "GET", `${S}/invoices?range=today`);
  check("invoice list", list.invoices?.length >= 2, list.totals);

  // Public page
  const pub = await call(null, "GET", `/v1/store/${code}`);
  check("public shop products", pub.products?.some((x: any) => x.id === pid), pub.products?.length);
  check("public not owner", pub.shop?.is_owner === false, pub.shop?.is_owner);
  check("public hides buying price", pub.products?.every((x: any) => x.buying_price === undefined), null);
  const own = await call(vTok, "GET", `/v1/store/${code}`);
  check("owner flag", own.shop?.is_owner === true, own.shop?.is_owner);
  await call(null, "GET", `/v1/store/no-such-shop-xyz`, undefined, 404);

  // Order: 5 pcs → bulk tier 450 each
  await call(cTok, "POST", `/v1/store/${code}/orders`, { items: [{ product_id: pid, qty: 50 }], name: "Smoke", phone: "9876543210" }, 409);
  const ord = await call(cTok, "POST", `/v1/store/${code}/orders`, { items: [{ product_id: pid, qty: 5 }], name: "Smoke Buyer", phone: "9876543210", address: "Test" });
  check("bulk tier price", Number(ord.order?.total_inr) === 2250, ord.order);
  const ord2 = await call(cTok, "POST", `/v1/store/${code}/orders`, { items: [{ product_id: pid, qty: 1, variation: "XL" }], name: "Smoke Buyer", phone: "9876543210" });
  check("variation price", Number(ord2.order?.total_inr) === 550, ord2.order);
  await call(cTok, "POST", `/v1/store/orders/${ord2.order.id}/cancel`);
  const mine = await call(cTok, "GET", `/v1/store/orders/mine`);
  check("my orders", mine.orders?.some((o: any) => o.id === ord.order.id && o.shop_name), mine.orders?.length);

  const vo = await call(vTok, "GET", `${S}/orders?status=new`);
  check("vendor sees order", vo.orders?.some((o: any) => o.id === ord.order.id), vo.orders?.length);
  await call(vTok, "POST", `${S}/orders/${ord.order.id}/status`, { status: "delivered" }, 409);
  await call(vTok, "POST", `${S}/orders/${ord.order.id}/status`, { status: "accepted" });
  await call(cTok, "POST", `/v1/store/orders/${ord.order.id}/cancel`, undefined, 409);
  const oinv = await call(vTok, "POST", `${S}/invoices`, {
    items: [{ product_id: pid, name: "Smoke Kurta", qty: 5, price: 450 }],
    order_id: ord.order.id,
    status: "unpaid",
    pay_mode: "credit",
  });
  await call(vTok, "POST", `${S}/invoices/${oinv.invoice.id}/paid`);
  await call(vTok, "POST", `${S}/orders/${ord.order.id}/status`, { status: "ready" });
  await call(vTok, "POST", `${S}/orders/${ord.order.id}/status`, { status: "delivered" });
  const linked = (await pool.query(`select invoice_id, status from shop_orders where id = $1`, [ord.order.id])).rows[0];
  check("order linked + delivered", linked.invoice_id === oinv.invoice.id && linked.status === "delivered", linked);

  // Inquiry → chat
  const iq = await call(cTok, "POST", `/v1/store/${code}/inquiry`, { product_id: pid });
  check("inquiry lead", !!iq.lead_id && iq.peer_id === VENDOR, iq);
  const iq2 = await call(cTok, "POST", `/v1/store/${code}/inquiry`, { product_id: pid, message: "Colour options?" });
  check("inquiry reuses lead", iq2.lead_id === iq.lead_id, iq2);
  const chat = await call(vTok, "GET", `/v1/chat/${iq.lead_id}`);
  check("chat has product card", chat.messages?.some((m: any) => m.kind === "product"), chat.messages?.map((m: any) => m.kind));
  check("chat source shop", chat.lead?.source === "shop", chat.lead);

  await call(vTok, "DELETE", `${S}/banners/${ban.banner.id}`);
  const stats = await call(vTok, "GET", S);
  check("stats", typeof stats.stats?.sales_today === "number", stats.stats);
} finally {
  const leads = (await pool.query(`select id from leads where customer_id = $1 and source = 'shop' and created_at >= $2`, [CUSTOMER, started])).rows.map((r) => r.id);
  if (leads.length) {
    await pool.query(`delete from lead_messages where lead_id = any($1::uuid[])`, [leads]);
    await pool.query(`delete from lead_notifications where lead_id = any($1::uuid[])`, [leads]);
    await pool.query(`delete from leads where id = any($1::uuid[])`, [leads]);
  }
  await pool.query(`delete from shop_orders where vendor_id = $1 and created_at >= $2`, [VENDOR, started]);
  await pool.query(`delete from shop_invoices where vendor_id = $1 and created_at >= $2`, [VENDOR, started]);
  await pool.query(`delete from shop_stock_log where vendor_id = $1 and created_at >= $2`, [VENDOR, started]);
  await pool.query(`delete from shop_products where user_id = $1 and name like 'Smoke%'`, [VENDOR]);
  await pool.query(`delete from shop_categories where user_id = $1 and name ilike 'Smoke%'`, [VENDOR]);
  await pool.query(`delete from shop_banners where user_id = $1 and created_at >= $2`, [VENDOR, started]);
  if (!hadShop) await pool.query(`delete from digital_shops where user_id = $1`, [VENDOR]);
  await pool.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
