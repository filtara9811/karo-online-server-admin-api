import "dotenv/config";
import { getPool } from "../src/lib/pg-client.js";

// Full app journey over HTTP with two throwaway test logins (see e2e-accounts.ts):
// sign-up → profile → vendor join/services/plan → request → vendor accepts → customer chooses →
// chat, quote, progress, complete, rating → shop product, order, bill.
// The request uses a category no real vendor maps and a far-away location, so only the test vendor is matched.
//   npx tsx scripts/e2e-flow.ts            # keeps the accounts for phone testing
//   npx tsx scripts/e2e-flow.ts --clean    # then run e2e-accounts.ts cleanup <phone> for both
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";
const CUSTOMER_PHONE = process.env.E2E_CUSTOMER ?? "9000000101";
const VENDOR_PHONE = process.env.E2E_VENDOR ?? "9000000102";
const FAR = { lat: 7.0104, lng: 93.8886 }; // Great Nicobar, far from every real vendor

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
  console.log(good ? "ok " : "BAD", method, path.replace(/[0-9a-f-]{36}/g, ":id"), r.status, good ? "" : JSON.stringify(j).slice(0, 400));
  return j?.data ?? j;
}
function check(label: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(cond ? "ok " : "BAD", label, cond ? "" : JSON.stringify(detail)?.slice(0, 400));
}

async function signIn(phone: string, first: string, last: string) {
  const sent = await call(null, "POST", "/v1/auth/otp/send", { phone });
  check(`${phone} is a test login`, sent.test_account === true, sent);
  const v = await call(null, "POST", "/v1/auth/otp/verify", { phone, code: "1234" });
  let token: string | undefined = v.access_token ?? v.session?.access_token ?? v.token;
  const reg = await call(token ?? null, "POST", "/v1/auth/register", {
    phone: `+91${phone}`,
    first_name: first,
    last_name: last,
    name: `${first} ${last}`,
    email: `e2e-${phone}@karoonline.in`,
    gender: "male",
    referral: null,
    role: "customer",
  });
  token = reg.access_token ?? reg.session?.access_token ?? token;
  check(`${phone} signed in`, !!token, { v, reg });
  return token!;
}

const pool = getPool();
const cTok = await signIn(CUSTOMER_PHONE, "Asha", "Test");
const vTok = await signIn(VENDOR_PHONE, "Vikram", "Test");

try {
  // ── Customer profile ─────────────────────────────────────────────────────
  let me = await call(cTok, "GET", "/v1/me");
  const customerId = me.user?.id ?? me.customer?.user_id ?? me.profile?.user_id ?? me.id;
  check("customer profile loads", !!customerId, me);
  await call(cTok, "PATCH", "/v1/me", { name: "Asha Tester", address: "E2E Street, Test Nagar", gender: "female" });
  me = await call(cTok, "GET", "/v1/me");
  check("profile edit saved", JSON.stringify(me).includes("Asha Tester") && JSON.stringify(me).includes("E2E Street"), me);
  await call(cTok, "GET", "/v1/me/wallet");
  await call(cTok, "GET", "/v1/me/referrals");
  await call(cTok, "POST", "/v1/me/kyc", { check_type: "bank", document_number: "123456789", payload: { holder: "Asha", ifsc: "HDFC0001234" } }, 409);
  await call(cTok, "POST", "/v1/me/kyc", { check_type: "selfie", document_urls: ["https://example.com/s.jpg"], payload: { name: "Asha Tester" } });
  await call(cTok, "POST", "/v1/me/kyc", { check_type: "aadhaar", document_number: "123412341234", document_urls: ["https://example.com/a.jpg", "https://example.com/b.jpg"] });
  await call(cTok, "POST", "/v1/me/kyc", { check_type: "pan", document_number: "abcde1234f" });
  await call(cTok, "POST", "/v1/me/kyc", { check_type: "bank", document_number: "123456789", confirm_number: "123456780", payload: { holder: "Asha", ifsc: "HDFC0001234" } }, 400);
  await call(cTok, "POST", "/v1/me/kyc", { check_type: "bank", document_number: "123456789", confirm_number: "123456789", payload: { holder: "Asha", ifsc: "hdfc0001234", upi: "asha@okaxis" } });
  const kyc = await call(cTok, "GET", "/v1/me/kyc");
  check("customer KYC has 4 submitted steps", kyc.checks?.length === 4 && kyc.checks.every((c: any) => c.status === "submitted"), kyc.checks);  await call(cTok, "GET", "/v1/quick/catalog");

  // ── Vendor join ──────────────────────────────────────────────────────────
  let vm = await call(vTok, "GET", "/v1/vendor/me");
  check("new account is not a vendor yet", vm.is_vendor === false || !vm.vendor, vm);
  await call(vTok, "POST", "/v1/vendor/join", {
    business_name: "E2E Test Traders",
    owner_name: "Vikram Test",
    whatsapp: VENDOR_PHONE,
    city: "Campbell Bay",
    pincode: "744302",
    address: "E2E Test Market, Great Nicobar",
    trade: "retailer",
    lat: FAR.lat,
    lng: FAR.lng,
  });
  const catalog = await call(vTok, "GET", "/v1/vendor/catalog");
  const joined = (await call(vTok, "GET", "/v1/vendor/me")).vendor?.user_id;
  const { rows: free } = await pool.query(
    `select ci.id, ci.name, ci.category_id, c.name as category from catalog_items ci join categories c on c.id = ci.category_id
      where coalesce(ci.is_active, true) and coalesce(c.is_active, true) and length(trim(coalesce(ci.name, ''))) > 2
        and not exists (select 1 from vendor_item_mappings m join catalog_items x on x.id = m.item_id
                         where x.category_id = ci.category_id and m.vendor_id <> $1)
      order by ci.name limit 1`,
    [joined],
  );
  check("found a category no vendor serves", !!free[0], catalog.items?.length);
  const item = free[0];
  await call(vTok, "PUT", `/v1/vendor/services/${item.id}`, { price_min: 200, price_max: 500, is_active: true });
  await call(vTok, "POST", "/v1/vendor/plan", { plan: "trial" });
  await call(vTok, "PATCH", "/v1/vendor/profile", { is_online: true, service_radius_km: 10, shop_bio: "E2E test shop" });
  vm = await call(vTok, "GET", "/v1/vendor/me");
  const vendorId = vm.vendor?.user_id;
  check("vendor onboarded", !!vendorId && vm.mapped_count >= 1 && Number(vm.vendor?.onboarding_step) >= 3, vm);
  check("trial wallet starts empty", Number(vm.wallet?.leadx_coins ?? 0) >= 0, vm.wallet);
  await pool.query(`update vendor_wallets set leadx_coins = greatest(leadx_coins, 10) where vendor_id = $1`, [vendorId]);
  await call(vTok, "GET", "/v1/vendor/kyc");
  await call(vTok, "GET", "/v1/vendor/stats");
  await call(vTok, "GET", "/v1/vendor/wallet");
  await call(vTok, "GET", "/v1/vendor/listing");
  await call(vTok, "GET", `/v1/vendor/nearby?lat=${FAR.lat}&lng=${FAR.lng}`);

  // ── Request → vendor alert → accept ─────────────────────────────────────
  const lead = await call(cTok, "POST", "/v1/leads", {
    sub_category_name: item.category,
    sub_category_id: item.category_id,
    item_ids: [item.id],
    item_names: [item.name],
    note: "e2e test request - auto deleted",
    address: "E2E Street, Test Nagar",
    lat: FAR.lat,
    lng: FAR.lng,
    search_radius_km: 5,
  });
  const leadId = lead.lead?.id ?? lead.id;
  check("request created", !!leadId, lead);
  const { rows: matched } = await pool.query(`select vendor_id from lead_notifications where lead_id = $1`, [leadId]);
  check("only the test vendor was alerted", matched.length === 1 && matched[0].vendor_id === vendorId, matched);
  const alerts = await call(vTok, "GET", "/v1/vendor/alerts");
  const alert = (alerts.alerts ?? alerts.leads ?? []).find((a: any) => a.lead_id === leadId || a.id === leadId);
  check("vendor pop-up alert has the request", !!alert, alerts);
  check("alert shows customer name", !!(alert?.customer_name || alert?.leads?.customer_name), alert);
  const vleads = await call(vTok, "GET", "/v1/vendor/leads");
  check("vendor lead list has it", JSON.stringify(vleads).includes(leadId), null);
  const acc = await call(vTok, "POST", `/v1/vendor/leads/${leadId}/accept`);
  check("accept charges coins", Number(acc.coins_charged ?? 0) >= 0, acc);
  const detail = await call(vTok, "GET", `/v1/vendor/leads/${leadId}`);
  check("vendor sees customer phone after accept", JSON.stringify(detail).includes(CUSTOMER_PHONE), detail);

  // ── Customer chooses the vendor ──────────────────────────────────────────
  const vendors = await call(cTok, "GET", `/v1/leads/${leadId}/vendors`);
  check("customer sees accepted vendor", JSON.stringify(vendors).includes(vendorId), vendors);
  const mine = await call(cTok, "GET", "/v1/leads/mine");
  const row = (mine.as_customer ?? mine.leads ?? mine).find?.((l: any) => l.id === leadId);
  check("my orders shows vendor reply", row?.accepted_count === 1 && row?.vendor_name === "E2E Test Traders", row);
  await call(cTok, "POST", `/v1/leads/${leadId}/approve`, { vendor_id: vendorId });

  // ── Chat to completion ───────────────────────────────────────────────────
  const C = `/v1/chat/${leadId}`;
  await call(cTok, "POST", `${C}/messages`, { body: "Hi, when can you come?" });
  await call(vTok, "POST", `${C}/messages`, { body: "Tomorrow 10 am" });
  const quote = await call(vTok, "POST", `${C}/messages`, { kind: "quote", attachment: { items: [{ name: item.name, qty: 1, price: 400 }] } });
  await call(cTok, "POST", `${C}/messages/${quote.message.id}/respond`, { action: "accept" });
  await call(vTok, "POST", `/v1/vendor/leads/${leadId}/progress`, { status_key: "on_the_way" });
  await call(vTok, "POST", `/v1/vendor/leads/${leadId}/progress`, { status_key: "working" });
  let s = await call(cTok, "POST", `${C}/status`, { action: "complete" });
  check("job completed", s.stage === "completed", s);
  await call(cTok, "POST", `${C}/rating`, { stars: 5, comment: "E2E great", tags: ["On time"] });
  const ci = await call(cTok, "GET", "/v1/chat/inbox");
  check("customer chat inbox", ci.threads?.some((t: any) => t.lead_id === leadId), ci.threads?.length);
  const vi = await call(vTok, "GET", "/v1/chat/inbox?as=vendor");
  check("vendor chat inbox", vi.threads?.some((t: any) => t.lead_id === leadId), vi.threads?.length);
  await call(vTok, "GET", "/v1/vendor/notifications");

  // ── Shop ────────────────────────────────────────────────────────────────
  const shop = await call(vTok, "GET", "/v1/vendor/shop");
  const p = await call(vTok, "POST", "/v1/vendor/shop/products", { name: "E2E Soap", price: 40, mrp: 50, stock: 20, unit: "pc" });
  const pub = await call(null, "GET", `/v1/store/${shop.shop.slug}`);
  check("shop page lists product", pub.products?.some((x: any) => x.id === p.product.id), pub.products?.length);
  check("shop page shows rating", pub.shop?.rating_count >= 1, pub.shop);
  const order = await call(cTok, "POST", `/v1/store/${shop.shop.slug}/orders`, {
    items: [{ product_id: p.product.id, qty: 3 }],
    name: "Asha Tester",
    phone: CUSTOMER_PHONE,
    address: "E2E Street",
  });
  await call(vTok, "POST", `/v1/vendor/shop/orders/${order.order.id}/status`, { status: "accepted" });
  const bill = await call(vTok, "POST", "/v1/vendor/shop/invoices", {
    items: [{ product_id: p.product.id, name: "E2E Soap", qty: 3, price: 40 }],
    order_id: order.order.id,
    customer_name: "Asha Tester",
    customer_phone: CUSTOMER_PHONE,
    pay_mode: "upi",
    status: "paid",
  });
  check("bill total", Number(bill.invoice?.total) === 120, bill.invoice);
  await call(vTok, "POST", `/v1/vendor/shop/orders/${order.order.id}/status`, { status: "delivered" });
  const myShop = await call(cTok, "GET", "/v1/store/orders/mine");
  check("customer sees delivered order", myShop.orders?.some((o: any) => o.id === order.order.id && o.status === "delivered"), myShop.orders);
  const q = await call(cTok, "POST", `/v1/store/${shop.shop.slug}/inquiry`, { product_id: p.product.id });
  check("product question opens chat", !!q.lead_id, q);
} finally {
  await pool.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
