import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { getPool } from "../lib/pg-client.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import {
  ORDER_STATUSES,
  ensureShopSlug,
  moveStock,
  nextInvoiceNumber,
  notifyOrderStatus,
  shopUrl,
  withTx,
} from "../lib/shop.js";

export const vendorShopRouter = Router();
vendorShopRouter.use(requireAuth);
vendorShopRouter.use((_req, _res, next) => {
  ensureVendorSchema().then(() => next(), next);
});

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);
const uuid = z.string().uuid();
const optStr = (max = 500) => z.string().trim().max(max).nullable().optional();
const optNum = z.number().finite().min(0).max(100_000_000).nullable().optional();
const money = (n: number) => Math.round(n * 100) / 100;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function guard(fn: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return fail(res, err.status, err.message);
      throw err;
    }
  });
}

async function requireVendor(userId: string) {
  const { rows } = await q(`select user_id, business_name, owner_name, is_blocked from public.vendors where user_id = $1`, [userId]);
  const v = rows[0];
  if (!v) throw new HttpError(403, "Finish joining as a vendor to use the shop");
  if (v.is_blocked) throw new HttpError(403, "Your vendor account is blocked");
  return v as { user_id: string; business_name: string | null; owner_name: string | null };
}

// ── Overview ────────────────────────────────────────────────────────────────

vendorShopRouter.get(
  "/",
  guard(async (req, res) => {
    const uid = req.userId!;
    await requireVendor(uid);
    const [slug, products, categories, banners, counts] = await Promise.all([
      ensureShopSlug(uid),
      q(`select * from public.shop_products where user_id = $1 order by sort_order, created_at desc`, [uid]),
      q(`select * from public.shop_categories where user_id = $1 order by sort_order, name`, [uid]),
      q(`select * from public.shop_banners where user_id = $1 order by sort_order, created_at desc`, [uid]),
      q(
        `select (select count(*)::int from public.shop_orders where vendor_id = $1 and status = 'new') as new_orders,
                (select count(*)::int from public.shop_invoices where vendor_id = $1 and status = 'held') as held_bills,
                (select coalesce(sum(total), 0)::float from public.shop_invoices
                  where vendor_id = $1 and status in ('paid', 'unpaid') and created_at >= date_trunc('day', now())) as sales_today,
                (select count(*)::int from public.shop_invoices
                  where vendor_id = $1 and status in ('paid', 'unpaid') and created_at >= date_trunc('day', now())) as bills_today`,
        [uid],
      ),
    ]);
    const low = products.rows.filter(
      (p) => p.is_active !== false && p.stock != null && Number(p.stock) <= Number(p.low_stock_alert ?? 5),
    ).length;
    return ok(res, {
      shop: { slug, url: shopUrl(slug) },
      products: products.rows,
      categories: categories.rows,
      banners: banners.rows,
      stats: { ...counts.rows[0], low_stock: low },
    });
  }),
);

// ── Products ────────────────────────────────────────────────────────────────

const MediaSchema = z.array(z.object({ type: z.enum(["image", "video"]).default("image"), url: z.string().min(1).max(1000) })).max(8);
const JSONB_COLS = new Set(["media", "variations", "bulk_tiers", "highlights", "faqs", "cta"]);

const ProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  tagline: optStr(160),
  description: optStr(4000),
  price: z.number().finite().min(0).max(100_000_000),
  mrp: optNum,
  buying_price: optNum,
  wholesale_price: optNum,
  gst_percent: z.number().min(0).max(40).optional(),
  gst_mode: z.enum(["include", "exclude"]).optional(),
  stock: z.number().min(0).max(10_000_000).nullable().optional(),
  low_stock_alert: z.number().min(0).max(1_000_000).optional(),
  unit: optStr(20),
  sku: optStr(60),
  badge: optStr(30),
  image_url: optStr(1000),
  media: MediaSchema.optional(),
  category_id: uuid.nullable().optional(),
  category: optStr(80),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  variations: z
    .array(z.object({ label: z.string().trim().min(1).max(60), price: z.number().min(0).max(100_000_000), image: optStr(1000) }))
    .max(30)
    .optional(),
  bulk_tiers: z.array(z.object({ min_qty: z.number().min(1).max(1_000_000), price: z.number().min(0).max(100_000_000) })).max(10).optional(),
  highlights: z.array(z.object({ k: z.string().trim().min(1).max(60), v: z.string().trim().max(200) })).max(20).optional(),
  faqs: z.array(z.object({ q: z.string().trim().min(1).max(200), a: z.string().trim().max(1000) })).max(20).optional(),
  terms: optStr(3000),
  policy: optStr(3000),
  cta: z
    .object({
      preset: z.enum(["cart", "inquiry", "book", "whatsapp"]).default("cart"),
      label: optStr(30),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    })
    .optional(),
});

function productRow(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = JSONB_COLS.has(k) && v !== null ? JSON.stringify(v) : v;
  }
  const media = data.media as Array<{ type: string; url: string }> | undefined;
  if (media) out.image_url = media.find((m) => m.type === "image")?.url ?? null;
  return out;
}

async function checkCategory(uid: string, categoryId: unknown) {
  if (!categoryId) return;
  const { rows } = await q(`select 1 from public.shop_categories where id = $1 and user_id = $2`, [categoryId, uid]);
  if (!rows[0]) throw new HttpError(400, "That category is not in your shop");
}

vendorShopRouter.post(
  "/products",
  guard(async (req, res) => {
    const uid = req.userId!;
    await requireVendor(uid);
    const parsed = ProductSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    await checkCategory(uid, parsed.data.category_id);
    const row = { ...productRow(parsed.data), user_id: uid };
    const cols = Object.keys(row);
    const product = await withTx(async (db) => {
      const { rows } = await db.query(
        `insert into public.shop_products (${cols.map((c) => `"${c}"`).join(", ")})
         values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        cols.map((c) => row[c]),
      );
      if (parsed.data.stock) {
        await db.query(
          `insert into public.shop_stock_log (vendor_id, product_id, delta, stock_after, reason) values ($1, $2, $3, $3, 'Opening stock')`,
          [uid, rows[0].id, parsed.data.stock],
        );
      }
      return rows[0];
    });
    return ok(res, { product }, 201);
  }),
);

vendorShopRouter.patch(
  "/products/:id",
  guard(async (req, res) => {
    const uid = req.userId!;
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid product id");
    const parsed = ProductSchema.partial().safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    await checkCategory(uid, parsed.data.category_id);
    const { stock, ...rest } = parsed.data;
    const row = productRow(rest);
    const product = await withTx(async (db) => {
      const cur = await db.query(`select stock from public.shop_products where id = $1 and user_id = $2 for update`, [id.data, uid]);
      if (!cur.rows[0]) throw new HttpError(404, "Product not found");
      if (stock !== undefined && stock !== null) {
        const delta = stock - Number(cur.rows[0].stock ?? 0);
        if (delta) await moveStock(db, uid, id.data, delta, "Edited in product editor");
      }
      const cols = Object.keys(row);
      if (cols.length) {
        await db.query(
          `update public.shop_products set ${cols.map((c, i) => `"${c}" = $${i + 3}`).join(", ")}, updated_at = now()
            where id = $1 and user_id = $2`,
          [id.data, uid, ...cols.map((c) => row[c])],
        );
      }
      return (await db.query(`select * from public.shop_products where id = $1`, [id.data])).rows[0];
    });
    return ok(res, { product });
  }),
);

vendorShopRouter.delete(
  "/products/:id",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid product id");
    await q(`delete from public.shop_products where id = $1 and user_id = $2`, [id.data, req.userId]);
    await q(`delete from public.shop_stock_log where product_id = $1 and vendor_id = $2`, [id.data, req.userId]);
    return ok(res, { removed: true });
  }),
);

vendorShopRouter.post(
  "/products/:id/stock",
  guard(async (req, res) => {
    const uid = req.userId!;
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid product id");
    const parsed = z
      .object({ delta: z.number().finite().refine((n) => n !== 0, "Enter a quantity"), reason: z.string().trim().min(2).max(120) })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const stock = await withTx(async (db) => {
      const cur = await db.query(`select stock from public.shop_products where id = $1 and user_id = $2 for update`, [id.data, uid]);
      if (!cur.rows[0]) throw new HttpError(404, "Product not found");
      if (Number(cur.rows[0].stock ?? 0) + parsed.data.delta < 0) throw new HttpError(400, "Stock cannot go below zero");
      return moveStock(db, uid, id.data, parsed.data.delta, parsed.data.reason);
    });
    return ok(res, { stock });
  }),
);

vendorShopRouter.get(
  "/products/:id/stock",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid product id");
    const { rows } = await q(
      `select id, product_id, delta::float as delta, stock_after::float as stock_after, reason, ref_id, created_at
         from public.shop_stock_log where product_id = $1 and vendor_id = $2 order by created_at desc limit 100`,
      [id.data, req.userId],
    );
    return ok(res, { log: rows });
  }),
);

// ── Categories & banners ────────────────────────────────────────────────────

vendorShopRouter.post(
  "/categories",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80), image_url: optStr(1000), icon: optStr(8) })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const dup = await q(`select 1 from public.shop_categories where user_id = $1 and lower(name) = lower($2)`, [req.userId, parsed.data.name]);
    if (dup.rows[0]) return fail(res, 409, "You already have a category with this name");
    const { rows } = await q(
      `insert into public.shop_categories (user_id, name, image_url, icon) values ($1, $2, $3, $4) returning *`,
      [req.userId, parsed.data.name, parsed.data.image_url ?? null, parsed.data.icon ?? null],
    );
    return ok(res, { category: rows[0] }, 201);
  }),
);

vendorShopRouter.patch(
  "/categories/:id",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid category id");
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80).optional(), image_url: optStr(1000), icon: optStr(8) })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { rows } = await q(
      `update public.shop_categories set name = coalesce($3, name), image_url = coalesce($4, image_url), icon = coalesce($5, icon)
        where id = $1 and user_id = $2 returning *`,
      [id.data, req.userId, parsed.data.name ?? null, parsed.data.image_url ?? null, parsed.data.icon ?? null],
    );
    if (!rows[0]) return fail(res, 404, "Category not found");
    return ok(res, { category: rows[0] });
  }),
);

vendorShopRouter.delete(
  "/categories/:id",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid category id");
    await q(`update public.shop_products set category_id = null where category_id = $1 and user_id = $2`, [id.data, req.userId]);
    await q(`delete from public.shop_categories where id = $1 and user_id = $2`, [id.data, req.userId]);
    return ok(res, { removed: true });
  }),
);

vendorShopRouter.post(
  "/banners",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const parsed = z
      .object({ image_url: z.string().min(1).max(1000), title: optStr(120), subtitle: optStr(200), link_url: optStr(500) })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const b = parsed.data;
    const { rows } = await q(
      `insert into public.shop_banners (user_id, image_url, title, subtitle, link_url) values ($1, $2, $3, $4, $5) returning *`,
      [req.userId, b.image_url, b.title ?? null, b.subtitle ?? null, b.link_url ?? null],
    );
    return ok(res, { banner: rows[0] }, 201);
  }),
);

vendorShopRouter.delete(
  "/banners/:id",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid banner id");
    await q(`delete from public.shop_banners where id = $1 and user_id = $2`, [id.data, req.userId]);
    return ok(res, { removed: true });
  }),
);

// ── Invoices (point of sale) ────────────────────────────────────────────────

const InvoiceSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: uuid.nullable().optional(),
        name: z.string().trim().min(1).max(160),
        variation: optStr(60),
        qty: z.number().positive().max(100_000),
        price: z.number().min(0).max(100_000_000),
        unit: optStr(20),
      }),
    )
    .min(1, "Add at least one item"),
  customer_name: optStr(120),
  customer_phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, "").slice(-10))
    .refine((s) => s === "" || s.length === 10, "Enter a 10-digit phone number")
    .nullable()
    .optional(),
  customer_gst: optStr(20),
  customer_address: optStr(500),
  discount_mode: z.enum(["percent", "flat"]).default("percent"),
  discount_value: z.number().min(0).max(100_000_000).default(0),
  gst_percent: z.number().min(0).max(40).default(0),
  gst_mode: z.enum(["add", "include"]).default("add"),
  delivery: z.number().min(0).max(1_000_000).default(0),
  pay_mode: z.enum(["cash", "upi", "card", "online", "credit"]).default("cash"),
  status: z.enum(["paid", "unpaid", "held"]).optional(),
  order_id: uuid.nullable().optional(),
  note: optStr(500),
});

type InvoiceInput = z.infer<typeof InvoiceSchema>;

/** Totals are always computed on the server so a shared invoice can be trusted. */
function computeTotals(inv: InvoiceInput) {
  const items = inv.items.map((i) => ({ ...i, amount: money(i.qty * i.price) }));
  const subtotal = money(items.reduce((s, i) => s + i.amount, 0));
  const discount =
    inv.discount_mode === "percent"
      ? money((subtotal * Math.min(inv.discount_value, 100)) / 100)
      : money(Math.min(inv.discount_value, subtotal));
  const afterDiscount = subtotal - discount;
  const tax =
    inv.gst_percent <= 0
      ? 0
      : inv.gst_mode === "add"
        ? money((afterDiscount * inv.gst_percent) / 100)
        : money(afterDiscount - afterDiscount / (1 + inv.gst_percent / 100));
  const total = money(afterDiscount + (inv.gst_mode === "add" ? tax : 0) + inv.delivery);
  return {
    items,
    subtotal,
    discount,
    discount_label: discount > 0 ? (inv.discount_mode === "percent" ? `${inv.discount_value}%` : "Flat") : null,
    tax,
    tax_label: tax > 0 ? `${inv.gst_percent}%${inv.gst_mode === "include" ? " included" : ""}` : null,
    total,
  };
}

async function applyInvoiceStock(db: import("pg").PoolClient, uid: string, items: Array<{ product_id?: string | null; qty: number }>, sign: 1 | -1, reason: string, ref: string) {
  for (const it of items) {
    if (!it.product_id) continue;
    await moveStock(db, uid, it.product_id, sign * it.qty, reason, ref);
  }
}

vendorShopRouter.get(
  "/invoices",
  guard(async (req, res) => {
    const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : null;
    const range = req.query.range === "today" ? "day" : req.query.range === "week" ? "week" : req.query.range === "month" ? "month" : null;
    const search = typeof req.query.q === "string" && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
    const { rows } = await q(
      `select * from public.shop_invoices
        where vendor_id = $1
          and ($2::text is null or status = $2)
          and ($3::text is null or created_at >= date_trunc($3, now()))
          and ($4::text is null or number ilike $4 or customer_name ilike $4 or customer_phone ilike $4)
        order by created_at desc limit 300`,
      [req.userId, status, range, search],
    );
    const totals = rows
      .filter((r) => r.status === "paid" || r.status === "unpaid")
      .reduce(
        (a, r) => ({ total: a.total + Number(r.total), unpaid: a.unpaid + (r.status === "unpaid" ? Number(r.total) : 0), count: a.count + 1 }),
        { total: 0, unpaid: 0, count: 0 },
      );
    return ok(res, { invoices: rows, totals });
  }),
);

vendorShopRouter.get(
  "/invoices/:id",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid invoice id");
    const { rows } = await q(`select * from public.shop_invoices where id = $1 and vendor_id = $2`, [id.data, req.userId]);
    if (!rows[0]) return fail(res, 404, "Invoice not found");
    return ok(res, { invoice: rows[0] });
  }),
);

vendorShopRouter.post(
  "/invoices",
  guard(async (req, res) => {
    const uid = req.userId!;
    await requireVendor(uid);
    const parsed = InvoiceSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const inv = parsed.data;
    const t = computeTotals(inv);
    const status = inv.status ?? (inv.pay_mode === "credit" ? "unpaid" : "paid");
    const invoice = await withTx(async (db) => {
      await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [`invoice:${uid}`]);
      const number = status === "held" ? `HOLD-${Date.now().toString(36).toUpperCase()}` : await nextInvoiceNumber(db, uid);
      const { rows } = await db.query(
        `insert into public.shop_invoices
           (vendor_id, number, customer_name, customer_phone, customer_gst, customer_address, items, subtotal, discount, discount_label,
            tax, tax_label, delivery, total, pay_mode, status, order_id, note)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
        [
          uid,
          number,
          inv.customer_name ?? null,
          inv.customer_phone || null,
          inv.customer_gst ?? null,
          inv.customer_address ?? null,
          JSON.stringify(t.items),
          t.subtotal,
          t.discount,
          t.discount_label,
          t.tax,
          t.tax_label,
          inv.delivery,
          t.total,
          inv.pay_mode,
          status,
          inv.order_id ?? null,
          inv.note ?? null,
        ],
      );
      const row = rows[0];
      if (status !== "held") await applyInvoiceStock(db, uid, t.items, -1, `Sold · ${number}`, row.id);
      if (inv.order_id) {
        await db.query(
          `update public.shop_orders set invoice_id = $3, status = case when status = 'new' then 'accepted' else status end, updated_at = now()
            where id = $1 and vendor_id = $2`,
          [inv.order_id, uid, row.id],
        );
      }
      return row;
    });
    return ok(res, { invoice }, 201);
  }),
);

/** Finalises a held bill, marks an unpaid bill paid, or cancels a bill (stock goes back). */
vendorShopRouter.post(
  "/invoices/:id/:action(finalize|paid|cancel)",
  guard(async (req, res) => {
    const uid = req.userId!;
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid invoice id");
    const action = req.params.action as "finalize" | "paid" | "cancel";
    const payMode = z.enum(["cash", "upi", "card", "online", "credit"]).optional().safeParse((req.body as { pay_mode?: string })?.pay_mode);
    const invoice = await withTx(async (db) => {
      await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [`invoice:${uid}`]);
      const cur = (await db.query(`select * from public.shop_invoices where id = $1 and vendor_id = $2 for update`, [id.data, uid])).rows[0];
      if (!cur) throw new HttpError(404, "Invoice not found");
      const items = (cur.items ?? []) as Array<{ product_id?: string | null; qty: number }>;
      if (action === "finalize") {
        if (cur.status !== "held") throw new HttpError(409, "Only a held bill can be finalised");
        const mode = payMode.success && payMode.data ? payMode.data : cur.pay_mode ?? "cash";
        const number = await nextInvoiceNumber(db, uid);
        await applyInvoiceStock(db, uid, items, -1, `Sold · ${number}`, cur.id);
        return (
          await db.query(
            `update public.shop_invoices set number = $2, status = $3, pay_mode = $4, created_at = now(), updated_at = now() where id = $1 returning *`,
            [cur.id, number, mode === "credit" ? "unpaid" : "paid", mode],
          )
        ).rows[0];
      }
      if (action === "paid") {
        if (cur.status !== "unpaid") throw new HttpError(409, "This bill is not unpaid");
        const mode = payMode.success && payMode.data && payMode.data !== "credit" ? payMode.data : "cash";
        return (await db.query(`update public.shop_invoices set status = 'paid', pay_mode = $2, updated_at = now() where id = $1 returning *`, [cur.id, mode])).rows[0];
      }
      if (cur.status === "cancelled") throw new HttpError(409, "This bill is already cancelled");
      if (cur.status !== "held") await applyInvoiceStock(db, uid, items, 1, `Cancelled · ${cur.number}`, cur.id);
      if (cur.status === "held") {
        await db.query(`delete from public.shop_invoices where id = $1`, [cur.id]);
        return { ...cur, status: "deleted" };
      }
      return (await db.query(`update public.shop_invoices set status = 'cancelled', updated_at = now() where id = $1 returning *`, [cur.id])).rows[0];
    });
    return ok(res, { invoice });
  }),
);

// ── Orders from the public shop ─────────────────────────────────────────────

vendorShopRouter.get(
  "/orders",
  guard(async (req, res) => {
    const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : null;
    const { rows } = await q(
      `select o.*, i.number as invoice_number from public.shop_orders o
         left join public.shop_invoices i on i.id = o.invoice_id
        where o.vendor_id = $1 and ($2::text is null or o.status = $2)
        order by o.created_at desc limit 300`,
      [req.userId, status],
    );
    return ok(res, { orders: rows });
  }),
);

const NEXT_STATUS: Record<string, string[]> = {
  new: ["accepted", "cancelled"],
  accepted: ["ready", "delivered", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

vendorShopRouter.post(
  "/orders/:id/status",
  guard(async (req, res) => {
    const uid = req.userId!;
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid order id");
    const parsed = z.object({ status: z.enum(ORDER_STATUSES) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const vendor = await requireVendor(uid);
    const cur = (await q(`select * from public.shop_orders where id = $1 and vendor_id = $2`, [id.data, uid])).rows[0];
    if (!cur) return fail(res, 404, "Order not found");
    if (!NEXT_STATUS[cur.status as string]?.includes(parsed.data.status)) {
      return fail(res, 409, `An order that is ${cur.status} cannot be marked ${parsed.data.status}`);
    }
    const { rows } = await q(`update public.shop_orders set status = $2, updated_at = now() where id = $1 returning *`, [id.data, parsed.data.status]);
    await notifyOrderStatus(rows[0], vendor.business_name || vendor.owner_name || "Shop");
    return ok(res, { order: rows[0] });
  }),
);
