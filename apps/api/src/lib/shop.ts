import type { PoolClient } from "pg";
import { getPool } from "./pg-client.js";
import { ensureVendorSchema } from "./apply-vendor-schema.js";
import { pushToUser } from "./push.js";

export const PUBLIC_SHOP_BASE = (process.env.PUBLIC_SHOP_BASE_URL || "https://karoonline.in").replace(/\/$/, "");

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shop"
  );
}

/** Every vendor gets one public shop code (`digital_shops.slug`); created from the business name on first use. */
export async function ensureShopSlug(vendorId: string): Promise<string> {
  await ensureVendorSchema();
  const existing = await q(`select slug from public.digital_shops where user_id = $1 and slug is not null order by created_at limit 1`, [vendorId]);
  if (existing.rows[0]?.slug) return existing.rows[0].slug as string;
  const v = await q(`select business_name, owner_name from public.vendors where user_id = $1`, [vendorId]);
  const name = (v.rows[0]?.business_name || v.rows[0]?.owner_name || "shop") as string;
  const base = slugify(name);
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { rows } = await q(
        `insert into public.digital_shops (user_id, name, slug) values ($1, $2, $3)
         on conflict do nothing returning slug`,
        [vendorId, name, slug],
      );
      if (rows[0]?.slug) return rows[0].slug as string;
      const mine = await q(`select slug from public.digital_shops where user_id = $1 and slug is not null limit 1`, [vendorId]);
      if (mine.rows[0]?.slug) return mine.rows[0].slug as string;
    } catch {
      /* slug taken; try another */
    }
  }
  return vendorId;
}

export const shopUrl = (slug: string) => `${PUBLIC_SHOP_BASE}/s/${encodeURIComponent(slug)}`;

/** Changes stock inside the caller's transaction and logs the movement. Products with no stock tracking are skipped. */
export async function moveStock(
  db: PoolClient,
  vendorId: string,
  productId: string,
  delta: number,
  reason: string,
  refId: string | null = null,
) {
  if (!delta) return null;
  const { rows } = await db.query(
    `update public.shop_products set stock = greatest(coalesce(stock, 0) + $3, 0), updated_at = now()
      where id = $1 and user_id = $2 returning stock`,
    [productId, vendorId, delta],
  );
  if (!rows[0]) return null;
  await db.query(
    `insert into public.shop_stock_log (vendor_id, product_id, delta, stock_after, reason, ref_id) values ($1, $2, $3, $4, $5, $6)`,
    [vendorId, productId, delta, rows[0].stock, reason, refId],
  );
  return Number(rows[0].stock);
}

/** INV-2026-0001 style numbers, per vendor per year. Call inside a transaction holding the vendor lock. */
export async function nextInvoiceNumber(db: PoolClient, vendorId: string) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const { rows } = await db.query(
    `select coalesce(max(nullif(regexp_replace(number, '^.*-', ''), '')::int), 0) as n
       from public.shop_invoices where vendor_id = $1 and number like $2`,
    [vendorId, `${prefix}%`],
  );
  return `${prefix}${String(Number(rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

export async function withTx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query("begin");
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => null);
    throw err;
  } finally {
    db.release();
  }
}

export const ORDER_STATUSES = ["new", "accepted", "ready", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  new: "Your order was placed",
  accepted: "Your order was accepted",
  ready: "Your order is ready",
  delivered: "Your order was delivered",
  cancelled: "Your order was cancelled",
};

export async function notifyNewOrder(order: Record<string, unknown>) {
  const items = (order.items as Array<{ name: string; qty?: number }>) ?? [];
  const summary = items
    .slice(0, 2)
    .map((i) => `${i.name}${i.qty && i.qty > 1 ? ` × ${i.qty}` : ""}`)
    .join(", ");
  await pushToUser({
    userId: order.vendor_id as string,
    title: `🛍️ New order · ₹${Number(order.total_inr ?? 0).toLocaleString("en-IN")}`,
    body: `${order.visitor_name || "A customer"} ordered ${summary}${items.length > 2 ? ` +${items.length - 2} more` : ""}`,
    actionUrl: "/vendor/shop?tab=orders",
    highPriority: true,
    extraData: { kind: "shop_order", order_id: String(order.id) },
  }).catch(() => null);
}

export async function notifyOrderStatus(order: Record<string, unknown>, shopName: string) {
  if (!order.customer_id) return;
  const status = order.status as OrderStatus;
  await pushToUser({
    userId: order.customer_id as string,
    title: `${shopName}`,
    body: ORDER_STATUS_TEXT[status] ?? `Order ${status}`,
    actionUrl: "/orders?tab=shop",
    extraData: { kind: "shop_order_status", order_id: String(order.id), status },
  }).catch(() => null);
}
