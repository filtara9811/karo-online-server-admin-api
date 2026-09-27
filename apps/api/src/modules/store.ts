import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { getPool } from "../lib/pg-client.js";
import { readBearer, requireAuth } from "../middleware/auth.js";
import { createUserClient } from "../lib/supabase.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import { ensureShopSlug, notifyNewOrder, shopUrl, withTx } from "../lib/shop.js";
import { vendorIdForCode } from "../lib/vendor-visits.js";
import { ChatError, chatContext, displayName, insertMessage } from "../lib/chat.js";

/** Public vendor shop page (`/s/:code`): profile, products, ordering, and product questions that open a chat. */
export const storeRouter = Router();
storeRouter.use((_req, _res, next) => {
  ensureVendorSchema().then(() => next(), next);
});

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);
const uuid = z.string().uuid();

async function viewerId(req: Request): Promise<string | null> {
  const token = readBearer(req);
  if (!token) return null;
  try {
    const { data } = await createUserClient(token).auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function guard(fn: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ChatError) return fail(res, err.status, err.message);
      throw err;
    }
  });
}

async function vendorFromCode(code: string) {
  const id = await vendorIdForCode(code);
  if (!id) return null;
  const { rows } = await q(`select * from public.vendors where user_id = $1 and coalesce(is_blocked, false) = false`, [id]);
  return rows[0] ?? null;
}

// ── Customer's own shop orders (registered before /:code) ───────────────────

storeRouter.get(
  "/orders/mine",
  requireAuth,
  guard(async (req, res) => {
    const { rows } = await q(
      `select o.*, coalesce(v.business_name, v.owner_name, 'Shop') as shop_name, v.avatar_url as shop_avatar,
              v.whatsapp as shop_phone, d.slug as shop_code
         from public.shop_orders o
         left join public.vendors v on v.user_id = o.vendor_id
         left join lateral (select slug from public.digital_shops where user_id = o.vendor_id and slug is not null limit 1) d on true
        where o.customer_id = $1
        order by o.created_at desc limit 200`,
      [req.userId],
    );
    return ok(res, { orders: rows });
  }),
);

storeRouter.post(
  "/orders/:id/cancel",
  requireAuth,
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid order id");
    const { rows } = await q(
      `update public.shop_orders set status = 'cancelled', updated_at = now()
        where id = $1 and customer_id = $2 and status = 'new' returning *`,
      [id.data, req.userId],
    );
    if (!rows[0]) return fail(res, 409, "This order can no longer be cancelled. Please contact the shop.");
    return ok(res, { order: rows[0] });
  }),
);

// ── Public shop ─────────────────────────────────────────────────────────────

storeRouter.get(
  "/:code",
  guard(async (req, res) => {
    const v = await vendorFromCode(String(req.params.code ?? "").slice(0, 80));
    if (!v) return fail(res, 404, "This shop is not available");
    const vid = v.user_id as string;
    const [slug, products, categories, banners, reviews, services, me, stats] = await Promise.all([
      ensureShopSlug(vid),
      q(
        `select id, name, tagline, description, price, mrp, stock, unit, badge, image_url, media, category_id, variations, bulk_tiers,
                highlights, faqs, terms, policy, cta, gst_percent, gst_mode, low_stock_alert
           from public.shop_products where user_id = $1 and coalesce(is_active, true)
          order by sort_order, created_at desc`,
        [vid],
      ),
      q(`select id, name, image_url, icon from public.shop_categories where user_id = $1 and coalesce(is_active, true) order by sort_order, name`, [vid]),
      q(`select id, image_url, title, subtitle, link_url from public.shop_banners where user_id = $1 and coalesce(is_active, true) order by sort_order, created_at desc`, [vid]),
      q(
        `select r.stars, r.comment, r.tags, r.created_at,
                coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.name, 'Customer') as customer_name
           from public.vendor_reviews r left join public.customers c on c.user_id = r.customer_id
          where r.vendor_id = $1 order by r.created_at desc limit 20`,
        [vid],
      ),
      q(
        `select i.id, i.name, i.image_url, i.icon, m.price_min, m.price_max
           from public.vendor_item_mappings m join public.catalog_items i on i.id = m.item_id
          where m.vendor_id = $1 and coalesce(m.is_active, true) order by i.name limit 60`,
        [vid],
      ).catch(() => ({ rows: [] })),
      viewerId(req),
      q(`select coalesce(round(avg(stars)::numeric, 2), 0)::float as avg, count(*)::int as n from public.vendor_reviews where vendor_id = $1`, [vid]),
    ]);
    return ok(res, {
      shop: {
        vendor_id: vid,
        code: slug,
        url: shopUrl(slug),
        name: v.business_name || v.owner_name || "Shop",
        owner_name: v.owner_name,
        avatar_url: v.avatar_url || v.profile_photo_url,
        cover_image_url: v.cover_image_url,
        bio: v.shop_bio,
        trade: v.trade,
        deals_in: v.deals_in,
        address: v.address,
        city: v.city,
        lat: v.lat,
        lng: v.lng,
        phone: v.whatsapp,
        verified: !!v.verified,
        online: !!v.is_online,
        rating_avg: Number(stats.rows[0]?.avg ?? 0),
        rating_count: Number(stats.rows[0]?.n ?? 0),
        gallery: v.gallery_urls ?? [],
        instagram: v.instagram,
        facebook: v.facebook,
        website: v.website,
        since: v.created_at,
        is_owner: me === vid,
      },
      products: products.rows,
      categories: categories.rows,
      banners: banners.rows,
      reviews: reviews.rows,
      services: services.rows,
    });
  }),
);

const OrderSchema = z.object({
  items: z
    .array(z.object({ product_id: uuid, qty: z.number().int().min(1).max(1000), variation: z.string().trim().max(60).nullable().optional() }))
    .min(1, "Your cart is empty")
    .max(50),
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, "").slice(-10))
    .refine((s) => s.length === 10, "Enter a 10-digit phone number"),
  address: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/** Line price: the chosen variation's price, else the best bulk tier for the quantity, else the product price. */
function linePrice(p: Record<string, any>, qty: number, variation?: string | null) {
  const vars = (p.variations ?? []) as Array<{ label: string; price: number }>;
  const v = variation ? vars.find((x) => x.label === variation) : undefined;
  if (v) return Number(v.price);
  const tiers = ((p.bulk_tiers ?? []) as Array<{ min_qty: number; price: number }>).filter((t) => qty >= t.min_qty);
  if (tiers.length) return Math.min(...tiers.map((t) => Number(t.price)));
  return Number(p.price ?? 0);
}

storeRouter.post(
  "/:code/orders",
  requireAuth,
  guard(async (req, res) => {
    const v = await vendorFromCode(String(req.params.code ?? "").slice(0, 80));
    if (!v) return fail(res, 404, "This shop is not available");
    if (v.user_id === req.userId) return fail(res, 400, "You cannot order from your own shop");
    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const o = parsed.data;
    const ids = [...new Set(o.items.map((i) => i.product_id))];
    const { rows: products } = await q(
      `select * from public.shop_products where user_id = $1 and id = any($2::uuid[]) and coalesce(is_active, true)`,
      [v.user_id, ids],
    );
    const byId = new Map(products.map((p) => [p.id as string, p]));
    const items: Array<Record<string, any> & { amount: number }> = [];
    for (const it of o.items) {
      const p = byId.get(it.product_id);
      if (!p) return fail(res, 409, "Some items are no longer available. Please refresh the shop.");
      if (p.stock != null && Number(p.stock) < it.qty) {
        return fail(res, 409, Number(p.stock) <= 0 ? `${p.name} is out of stock` : `Only ${Number(p.stock)} left of ${p.name}`);
      }
      const price = linePrice(p, it.qty, it.variation);
      items.push({
        id: p.id,
        product_id: p.id,
        name: p.name,
        variation: it.variation ?? null,
        qty: it.qty,
        price,
        amount: Math.round(price * it.qty * 100) / 100,
        image_url: p.image_url,
        unit: p.unit,
      });
    }
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const slug = await ensureShopSlug(v.user_id);
    const order = await withTx(async (db) => {
      const { rows } = await db.query(
        `insert into public.shop_orders (code, vendor_id, customer_id, visitor_name, visitor_phone, address, note, items, total_inr, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'new') returning *`,
        [slug, v.user_id, req.userId, o.name, o.phone, o.address ?? null, o.note ?? null, JSON.stringify(items), total],
      );
      return rows[0];
    });
    await notifyNewOrder(order);
    return ok(res, { order }, 201);
  }),
);

/** "Ask about this product": reuses or opens an inquiry lead with the shop so the customer can chat. */
storeRouter.post(
  "/:code/inquiry",
  requireAuth,
  guard(async (req, res) => {
    const v = await vendorFromCode(String(req.params.code ?? "").slice(0, 80));
    if (!v) return fail(res, 404, "This shop is not available");
    const me = req.userId!;
    if (v.user_id === me) return fail(res, 400, "This is your own shop");
    const parsed = z
      .object({ product_id: uuid.nullable().optional(), message: z.string().trim().max(1000).nullable().optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const vid = v.user_id as string;
    const product = parsed.data.product_id
      ? (await q(`select id, name, price, mrp, image_url, unit from public.shop_products where id = $1 and user_id = $2`, [parsed.data.product_id, vid])).rows[0]
      : null;
    if (parsed.data.product_id && !product) return fail(res, 404, "This product is no longer available");

    let leadId = (
      await q(
        `select id from public.leads
          where customer_id = $1 and source = 'shop' and $2 = any(coalesce(accepted_vendor_ids, '{}'))
            and coalesce(status, '') not in ('completed', 'cancelled') and created_at > now() - interval '30 days'
          order by created_at desc limit 1`,
        [me, vid],
      )
    ).rows[0]?.id as string | undefined;
    if (!leadId) {
      const cust = (
        await q(
          `select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), name) as name, phone
             from public.customers where user_id = $1`,
          [me],
        )
      ).rows[0];
      leadId = await withTx(async (db) => {
        const { rows } = await db.query(
          `insert into public.leads (customer_id, customer_name, customer_phone, sub_category_name, note, status, source, accepted_vendor_ids)
           values ($1, $2, $3, $4, $5, 'placed', 'shop', array[$6]::uuid[]) returning id`,
          [me, cust?.name ?? null, cust?.phone ?? null, `Shop · ${v.business_name || v.owner_name || "Vendor"}`, product ? `Asked about ${product.name}` : "Shop enquiry", vid],
        );
        await db.query(
          `insert into public.lead_notifications (lead_id, vendor_id, status, responded_at) values ($1, $2, 'accepted', now())`,
          [rows[0].id, vid],
        );
        return rows[0].id as string;
      });
    }
    const ctx = await chatContext(leadId, me, vid);
    if (product) {
      await insertMessage(
        ctx,
        {
          kind: "product",
          attachment: {
            product_id: product.id,
            name: product.name,
            price: product.price != null ? Number(product.price) : null,
            mrp: product.mrp != null ? Number(product.mrp) : null,
            image_url: product.image_url,
            unit: product.unit,
          },
        },
        { push: false },
      );
    }
    const text = parsed.data.message?.trim() || (product ? `Hi, is ${product.name} available?` : `Hi, I have a question about your shop.`);
    await insertMessage(ctx, { kind: "text", body: text });
    return ok(res, { lead_id: leadId, peer_id: vid, vendor_name: await displayName(vid, "vendor") }, 201);
  }),
);
