import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { getPool } from "../lib/pg-client.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import { acceptLeadForVendor, distanceSql, rejectLeadForVendor } from "../lib/vendor-leads.js";
import { pickProvider, quote } from "../lib/payments.js";
import { ChatError, chatContext, recordProgress } from "../lib/chat.js";
import { listKyc, submitKyc } from "../lib/kyc.js";

export const vendorRouter = Router();
vendorRouter.use(requireAuth);
vendorRouter.use((_req, _res, next) => {
  ensureVendorSchema().then(() => next(), next);
});

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);
const uuid = z.string().uuid();
const optStr = (max = 500) => z.string().trim().max(max).nullable().optional();
const optNum = z.number().finite().nullable().optional();

async function loadVendor(userId: string) {
  const { rows } = await q(`select * from public.vendors where user_id = $1`, [userId]);
  return rows[0] ?? null;
}

async function requireVendor(userId: string) {
  const v = await loadVendor(userId);
  if (!v) throw Object.assign(new Error("not_a_vendor"), { status: 403 });
  if (v.is_blocked) throw Object.assign(new Error("vendor_blocked"), { status: 403 });
  return v;
}

function guard(fn: (req: import("express").Request, res: import("express").Response) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status) return fail(res, status, (err as Error).message);
      throw err;
    }
  });
}

/** Builds `col = $n` pairs from a whitelisted, already-validated object. */
function setClause(body: Record<string, unknown>, start = 2) {
  const cols = Object.keys(body).filter((k) => body[k] !== undefined);
  return {
    sql: cols.map((c, i) => `"${c}" = $${i + start}`).join(", "),
    values: cols.map((c) => body[c]),
    empty: cols.length === 0,
  };
}

function maskPhone(phone: unknown) {
  const s = String(phone ?? "");
  if (s.length < 4) return null;
  return `${s.slice(0, 2)}${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-2)}`;
}

function shapeLead(row: Record<string, any>, vendorId: string, origin?: { lat?: number | null; lng?: number | null }) {
  const accepted = ((row.accepted_vendor_ids ?? []) as string[]).includes(vendorId);
  let distance_km: number | null = null;
  if (origin?.lat != null && origin?.lng != null && row.lat != null && row.lng != null) {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(row.lat - origin.lat);
    const dLng = toRad(row.lng - origin.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(origin.lat)) * Math.cos(toRad(row.lat)) * Math.sin(dLng / 2) ** 2;
    distance_km = Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
  }
  return {
    ...row,
    accepted_by_me: accepted,
    customer_phone: accepted ? row.customer_phone : maskPhone(row.customer_phone),
    address: accepted ? row.address : row.address ? String(row.address).split(",").slice(-2).join(",").trim() : null,
    lat: accepted || row.lat == null ? row.lat : Math.round(Number(row.lat) * 100) / 100,
    lng: accepted || row.lng == null ? row.lng : Math.round(Number(row.lng) * 100) / 100,
    distance_km,
  };
}

// ── Profile ──────────────────────────────────────────────────────────────────

vendorRouter.get(
  "/me",
  guard(async (req, res) => {
    const uid = req.userId!;
    const vendor = await loadVendor(uid);
    if (!vendor) return ok(res, { vendor: null, is_vendor: false });
    await q(`insert into public.vendor_wallets (vendor_id) values ($1) on conflict (vendor_id) do nothing`, [uid]);
    const [wallet, stats, mapped, kyc] = await Promise.all([
      q(`select * from public.vendor_wallets where vendor_id = $1`, [uid]),
      q(
        `select count(*)::int as total,
                count(*) filter (where status = 'pending')::int as pending,
                count(*) filter (where status in ('accepted', 'in_process'))::int as in_process,
                count(*) filter (where status = 'success')::int as success,
                count(*) filter (where status = 'rejected')::int as rejected
           from public.lead_notifications where vendor_id = $1`,
        [uid],
      ),
      q(`select count(*)::int as n from public.vendor_item_mappings where vendor_id = $1 and coalesce(is_active, true)`, [uid]),
      q(`select check_type, status from public.kyc_verifications where user_id = $1 and subject_type = 'vendor'`, [uid]),
    ]);
    return ok(res, {
      is_vendor: true,
      vendor,
      wallet: wallet.rows[0] ?? null,
      stats: stats.rows[0],
      mapped_count: mapped.rows[0]?.n ?? 0,
      kyc: kyc.rows,
    });
  }),
);

const BusinessSchema = z.object({
  business_name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().regex(/^\+?\d{10,13}$/, "Enter a valid WhatsApp number"),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{4,8}$/, "Enter a valid pincode"),
  address: z.string().trim().min(3).max(500),
  state: optStr(80),
  email: optStr(160),
  entity: optStr(40),
  trade: optStr(40),
  deals_in: optStr(40),
  role: optStr(60),
  gst: optStr(20),
  lat: optNum,
  lng: optNum,
  avatar_url: optStr(1000),
  profile_photo_url: optStr(1000),
  cover_image_url: optStr(1000),
  gallery_urls: z.array(z.string().max(1000)).max(12).optional(),
});

vendorRouter.post(
  "/join",
  guard(async (req, res) => {
    const parsed = BusinessSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const b = parsed.data;
    const uid = req.userId!;
    const cols = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    const values = cols.map((c) => (b as Record<string, unknown>)[c]);
    const { rows } = await q(
      `insert into public.vendors (id, user_id, ${cols.map((c) => `"${c}"`).join(", ")}, onboarding_step, updated_at)
       values ($1, $1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}, 2, now())
       on conflict (user_id) do update set
         ${cols.map((c) => `"${c}" = excluded."${c}"`).join(", ")},
         onboarding_step = greatest(coalesce(public.vendors.onboarding_step, 0), 2),
         updated_at = now()
       returning *`,
      [uid, ...values],
    );
    await q(`insert into public.vendor_wallets (vendor_id) values ($1) on conflict (vendor_id) do nothing`, [uid]);
    return ok(res, { vendor: rows[0] }, 201);
  }),
);

const ProfileSchema = BusinessSchema.partial().extend({
  shop_bio: optStr(1000),
  instagram: optStr(300),
  facebook: optStr(300),
  website: optStr(300),
  google_place_id: optStr(200),
  cover_video_url: optStr(1000),
  pan: optStr(20),
  is_online: z.boolean().optional(),
  auto_accept_leads: z.boolean().optional(),
  service_radius_km: z.number().int().min(0).max(100).optional(),
  operation_mode: z.enum(["fixed", "live"]).optional(),
  live_lat: optNum,
  live_lng: optNum,
  onboarding_step: z.number().int().min(0).max(10).optional(),
});

vendorRouter.patch(
  "/profile",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const body: Record<string, unknown> = { ...parsed.data };
    if (body.live_lat !== undefined || body.live_lng !== undefined) body.location_updated_at = new Date().toISOString();
    const set = setClause(body);
    if (set.empty) return ok(res, { vendor: await loadVendor(req.userId!) });
    const { rows } = await q(`update public.vendors set ${set.sql}, updated_at = now() where user_id = $1 returning *`, [req.userId, ...set.values]);
    return ok(res, { vendor: rows[0] });
  }),
);

vendorRouter.post(
  "/plan",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const parsed = z.object({ plan: z.enum(["trial", "premium"]), ref: optStr(80) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { plan, ref } = parsed.data;
    const { rows } = await q(
      `update public.vendors
          set plan = $2, plan_ref = $3, payment_completed = $4,
              onboarding_step = greatest(coalesce(onboarding_step, 0), 3), updated_at = now()
        where user_id = $1 returning *`,
      [req.userId, plan === "trial" ? "trial" : "premium_pending", ref ?? null, plan === "trial"],
    );
    return ok(res, { vendor: rows[0] });
  }),
);

// ── Services (category mapping) & listing ───────────────────────────────────

vendorRouter.get(
  "/catalog",
  guard(async (req, res) => {
    const [types, categories, groups, items, mappings] = await Promise.all([
      q(`select id, name, code, icon, sort_order from public.catalog_types where coalesce(is_active, true) order by sort_order, name`),
      q(`select id, name, slug, image_url, icon, parent_id, type_id, sort_order, group_tag from public.categories where coalesce(is_active, true) order by sort_order, name`),
      q(`select id, name, category_id, icon, image_url, sort_order from public.catalog_groups where coalesce(is_active, true) order by sort_order, name`),
      q(`select id, name, category_id, image_url, icon, group_tag, price_min, price_max, sort_order from public.catalog_items where coalesce(is_active, true) order by sort_order, name`),
      q(`select item_id, price_min, price_max, notes, variations, is_active from public.vendor_item_mappings where vendor_id = $1`, [req.userId]),
    ]);
    return ok(res, { types: types.rows, categories: categories.rows, groups: groups.rows, items: items.rows, mappings: mappings.rows });
  }),
);

const MappingSchema = z.object({
  price_min: optNum,
  price_max: optNum,
  notes: optStr(500),
  variations: z.array(z.string().max(120)).max(50).optional(),
  is_active: z.boolean().optional(),
});

vendorRouter.put(
  "/services/:itemId",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const itemId = uuid.safeParse(req.params.itemId);
    if (!itemId.success) return fail(res, 400, "Invalid item id");
    const parsed = MappingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const m = parsed.data;
    const { rows } = await q(
      `insert into public.vendor_item_mappings (vendor_id, item_id, price_min, price_max, notes, variations, is_active, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
       on conflict (vendor_id, item_id) do update set
         price_min = excluded.price_min, price_max = excluded.price_max, notes = excluded.notes,
         variations = excluded.variations, is_active = excluded.is_active, updated_at = now()
       returning *`,
      [req.userId, itemId.data, m.price_min ?? null, m.price_max ?? null, m.notes ?? null, JSON.stringify(m.variations ?? []), m.is_active ?? true],
    );
    return ok(res, { mapping: rows[0] });
  }),
);

vendorRouter.delete(
  "/services/:itemId",
  guard(async (req, res) => {
    const itemId = uuid.safeParse(req.params.itemId);
    if (!itemId.success) return fail(res, 400, "Invalid item id");
    await q(`delete from public.vendor_item_mappings where vendor_id = $1 and item_id = $2`, [req.userId, itemId.data]);
    return ok(res, { removed: true });
  }),
);

vendorRouter.get(
  "/listing",
  guard(async (req, res) => {
    const { rows } = await q(
      `select m.item_id, m.price_min, m.price_max, m.notes, m.variations, m.is_active,
              ci.name, ci.image_url, ci.icon, ci.price_min as catalog_price_min, ci.price_max as catalog_price_max,
              c.id as category_id, c.name as category_name
         from public.vendor_item_mappings m
         join public.catalog_items ci on ci.id = m.item_id
         left join public.categories c on c.id = ci.category_id
        where m.vendor_id = $1
        order by c.name, ci.name`,
      [req.userId],
    );
    return ok(res, { items: rows });
  }),
);

// ── Leads ───────────────────────────────────────────────────────────────────

const LEAD_FILTERS: Record<string, string> = {
  all: "",
  pending: "and n.status = 'pending'",
  in_process: "and n.status in ('accepted', 'in_process')",
  success: "and n.status = 'success'",
  rejected: "and n.status = 'rejected'",
};

vendorRouter.get(
  "/leads",
  guard(async (req, res) => {
    const v = await requireVendor(req.userId!);
    const filter = LEAD_FILTERS[String(req.query.filter ?? "all")] ?? "";
    const tab = String(req.query.tab ?? "my");
    const tabSql = tab === "auto" ? "and coalesce(n.auto_matched, false)" : "";
    const { rows } = await q(
      `select l.*, n.id as notification_id, n.status as my_status, n.created_at as notified_at,
              n.responded_at, n.auto_matched, n.rejection_reason, n.vendor_started_at,
              c.lead_cost_coins, c.image_url as category_image,
              (select count(*)::int from public.lead_messages m
                where m.lead_id = l.id and m.recipient_id = $1 and m.read_at is null) as unread,
              (select array_agg(distinct s.status_key) from public.vendor_status_updates s
                where s.lead_id = l.id and s.vendor_id = $1) as steps_done
         from public.lead_notifications n
         join public.leads l on l.id = n.lead_id
         left join public.categories c on c.id = l.sub_category_id
        where n.vendor_id = $1 ${filter} ${tabSql}
        order by n.created_at desc
        limit 200`,
      [req.userId],
    );
    const origin = { lat: v.live_lat ?? v.lat, lng: v.live_lng ?? v.lng };
    return ok(res, { leads: rows.map((r) => shapeLead(r, req.userId!, origin)) });
  }),
);

vendorRouter.get(
  "/alerts",
  guard(async (req, res) => {
    const v = await requireVendor(req.userId!);
    const { rows } = await q(
      `select n.id as notification_id, n.lead_id, n.created_at as notified_at,
              coalesce(n.auto_accept_at, n.created_at + interval '15 seconds') as expires_at,
              l.sub_category_name, l.item_names, l.note, l.images, l.address, l.customer_name, l.customer_phone,
              l.lat, l.lng, l.accepted_vendor_ids, c.image_url as category_image, c.lead_cost_coins,
              to_jsonb(cu)->>'avatar_url' as customer_avatar,
              coalesce(v.auto_accept_leads, false) as auto_accept
         from public.lead_notifications n
         join public.leads l on l.id = n.lead_id
         join public.vendors v on v.user_id = n.vendor_id
         left join public.categories c on c.id = l.sub_category_id
         left join public.customers cu on cu.user_id = l.customer_id
        where n.vendor_id = $1 and n.status = 'pending' and n.created_at > now() - interval '2 minutes'
        order by n.created_at desc
        limit 5`,
      [req.userId],
    );
    const origin = { lat: v.live_lat ?? v.lat, lng: v.live_lng ?? v.lng };
    const alerts = rows.map((r) => {
      const s = shapeLead(r, req.userId!, origin) as Record<string, unknown>;
      const { accepted_vendor_ids: _ids, lat: _lat, lng: _lng, ...rest } = s;
      return { ...rest, customer_name: String(r.customer_name ?? "").trim().split(/\s+/)[0] || null };
    });
    return ok(res, { alerts, server_time: new Date().toISOString() });
  }),
);

vendorRouter.get(
  "/leads/:id",
  guard(async (req, res) => {
    const v = await requireVendor(req.userId!);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const [lead, notif, progress] = await Promise.all([
      q(
        `select l.*, c.lead_cost_coins from public.leads l left join public.categories c on c.id = l.sub_category_id where l.id = $1`,
        [id.data],
      ),
      q(`select * from public.lead_notifications where lead_id = $1 and vendor_id = $2`, [id.data, req.userId]),
      q(
        `select status_key, status, created_at from public.vendor_status_updates where lead_id = $1 and vendor_id = $2 order by created_at`,
        [id.data, req.userId],
      ),
    ]);
    if (!lead.rows[0]) return fail(res, 404, "Lead not found");
    const origin = { lat: v.live_lat ?? v.lat, lng: v.live_lng ?? v.lng };
    return ok(res, {
      lead: shapeLead(lead.rows[0], req.userId!, origin),
      notification: notif.rows[0] ?? null,
      progress: progress.rows,
    });
  }),
);

const ACCEPT_MESSAGES: Record<string, string> = {
  not_found: "Lead not found",
  own_lead: "You cannot accept your own request",
  closed: "This lead is closed",
  full: "All vendor slots for this lead are taken",
  insufficient_coins: "LeadX coins low. Buy coins to accept this lead.",
  not_a_vendor: "Complete vendor registration first",
};

async function acceptHandler(req: import("express").Request, res: import("express").Response) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return fail(res, 400, "Invalid lead id");
  const result = await acceptLeadForVendor(id.data, req.userId!);
  if (!result.ok) return fail(res, result.reason === "insufficient_coins" ? 402 : 409, ACCEPT_MESSAGES[result.reason], result);
  return ok(res, result);
}

vendorRouter.post("/leads/:id/accept", guard(acceptHandler));
vendorRouter.post("/marketplace/:id/claim", guard(acceptHandler));

vendorRouter.post(
  "/leads/:id/reject",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const parsed = z.object({ reason: z.string().trim().min(1).max(160) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const notification = await rejectLeadForVendor(id.data, req.userId!, parsed.data.reason);
    return ok(res, { notification });
  }),
);

vendorRouter.post(
  "/leads/:id/status",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const parsed = z.object({ status: z.enum(["in_process", "success", "rejected"]) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { rows } = await q(
      `update public.lead_notifications set status = $3, responded_at = coalesce(responded_at, now())
        where lead_id = $1 and vendor_id = $2 and status <> 'pending' returning *`,
      [id.data, req.userId, parsed.data.status],
    );
    if (!rows[0]) return fail(res, 409, "Accept the lead first");
    return ok(res, { notification: rows[0] });
  }),
);

vendorRouter.post(
  "/leads/:id/progress",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const parsed = z.object({ status_key: z.enum(["on_the_way", "arrived", "working", "completed"]) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const key = parsed.data.status_key;
    let ctx;
    try {
      ctx = await chatContext(id.data, req.userId!);
    } catch (err) {
      if (err instanceof ChatError) return fail(res, err.status === 403 ? 409 : err.status, "Accept the lead first");
      throw err;
    }
    if (ctx.role !== "vendor") return fail(res, 409, "Accept the lead first");
    if (ctx.lead.customer_approved_vendor_id && ctx.lead.customer_approved_vendor_id !== req.userId) {
      return fail(res, 409, "The customer chose another vendor");
    }
    await recordProgress(ctx, key);
    return ok(res, { status_key: key });
  }),
);

vendorRouter.get(
  "/inbox",
  guard(async (req, res) => {
    const { rows } = await q(
      `select l.id, l.sub_category_name, l.customer_name, l.customer_id, l.status, l.created_at, n.status as my_status,
              m.body as last_body, m.created_at as last_at, m.sender_id as last_sender,
              (select count(*)::int from public.lead_messages u
                where u.lead_id = l.id and u.recipient_id = $1 and u.read_at is null) as unread
         from public.leads l
         join public.lead_notifications n on n.lead_id = l.id and n.vendor_id = $1
         left join lateral (
           select body, created_at, sender_id from public.lead_messages x where x.lead_id = l.id order by created_at desc limit 1
         ) m on true
        where $1 = any(coalesce(l.accepted_vendor_ids, '{}'))
        order by coalesce(m.created_at, l.created_at) desc
        limit 200`,
      [req.userId],
    );
    return ok(res, { threads: rows });
  }),
);

vendorRouter.post(
  "/leads/:id/read",
  guard(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    await q(`update public.lead_messages set read_at = now() where lead_id = $1 and recipient_id = $2 and read_at is null`, [id.data, req.userId]);
    return ok(res, { read: true });
  }),
);

vendorRouter.get(
  "/marketplace",
  guard(async (req, res) => {
    const v = await requireVendor(req.userId!);
    const olat = v.live_lat ?? v.lat;
    const olng = v.live_lng ?? v.lng;
    const dist = distanceSql("$2::float8", "$3::float8", "l.lat", "l.lng");
    const { rows } = await q(
      `select l.*, c.lead_cost_coins
         from public.leads l left join public.categories c on c.id = l.sub_category_id
        where l.status in ('placed', 'accepted')
          and coalesce(l.accepted_count, 0) < coalesce(c.max_vendors_per_lead, l.max_slots, 3)
          and l.created_at > now() - interval '7 days'
          and l.customer_id is distinct from $1
          and not exists (select 1 from public.lead_notifications n where n.lead_id = l.id and n.vendor_id = $1 and n.status <> 'pending')
          and ($2::float8 is null or l.lat is null or ${dist} <= 50)
        order by l.is_marketplace desc, l.created_at desc
        limit 100`,
      [req.userId, olat ?? null, olng ?? null],
    );
    return ok(res, { leads: rows.map((r) => shapeLead(r, req.userId!, { lat: olat, lng: olng })) });
  }),
);

// ── Wallet ──────────────────────────────────────────────────────────────────

vendorRouter.get(
  "/wallet",
  guard(async (req, res) => {
    const uid = req.userId!;
    await ensureVendorSchema();
    await q(`insert into public.vendor_wallets (vendor_id) values ($1) on conflict (vendor_id) do nothing`, [uid]);
    const [wallet, txns, packs, rechargePacks, rate, walletGw, coinGw] = await Promise.all([
      q(`select * from public.vendor_wallets where vendor_id = $1`, [uid]),
      q(`select * from public.wallet_transactions where vendor_id = $1 order by created_at desc limit 200`, [uid]),
      q(`select * from public.coin_packs where coalesce(is_active, true) order by coalesce(sort_order, 0), price_inr`),
      q(`select * from public.wallet_recharge_packs where coalesce(is_active, true) order by coalesce(sort_order, 0), amount_inr`),
      q(`select coin_rate_inr, min_purchase_coins, max_purchase_coins, gst_percent from public.coin_pricing_config order by updated_at desc nulls last limit 1`),
      pickProvider("wallet_recharge"),
      pickProvider("coin_purchase"),
    ]);
    const spent = await q(
      `select coalesce(sum(coins), 0)::int as coins_spent, count(*)::int as leads_bought
         from public.wallet_transactions where vendor_id = $1 and kind = 'debit' and status = 'success'`,
      [uid],
    );
    return ok(res, {
      wallet: { ...wallet.rows[0], ...spent.rows[0] },
      transactions: txns.rows,
      packs: packs.rows,
      recharge_packs: rechargePacks.rows,
      pricing: rate.rows[0] ?? { coin_rate_inr: 1 },
      gateways: { wallet_recharge: walletGw, coin_purchase: coinGw, upi: true },
    });
  }),
);

vendorRouter.post(
  "/wallet/recharge",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const parsed = z
      .object({
        kind: z.enum(["leadx", "service"]),
        amount_inr: z.number().positive().max(500000),
        coins: z.number().int().positive().optional(),
        pack_id: uuid.optional(),
        utr: z.string().trim().min(6).max(40),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const b = parsed.data;
    const priced = await quote(
      b.kind === "leadx"
        ? { purpose: "coin_purchase", pack_id: b.pack_id, coins: b.pack_id ? undefined : b.coins }
        : { purpose: "wallet_recharge", pack_id: b.pack_id, amount_inr: b.amount_inr },
    );
    if ("error" in priced) return fail(res, 400, priced.error);
    b.amount_inr = b.kind === "leadx" ? priced.amount_inr : priced.credit_inr;
    b.coins = priced.coins || undefined;
    const { rows } = await q(
      `insert into public.wallet_transactions (vendor_id, user_id, amount_inr, kind, purpose, provider, ref, direction, coins, description, wallet_kind, status, metadata)
       values ($1, $1, $2, 'credit', $3, 'upi', $4, 'credit', $5, $6, $7, 'pending', $8::jsonb)
       returning *`,
      [
        req.userId,
        b.amount_inr,
        b.kind === "leadx" ? "leadx_purchase" : "wallet_recharge",
        b.utr,
        b.coins ?? null,
        b.kind === "leadx" ? `Buy ${b.coins ?? ""} LeadX coins`.replace(/\s+/g, " ") : "Wallet recharge",
        b.kind,
        JSON.stringify({ pack_id: b.pack_id ?? null, quote: priced }),
      ],
    );
    return ok(res, { transaction: rows[0] }, 201);
  }),
);

// ── KYC ─────────────────────────────────────────────────────────────────────

vendorRouter.get(
  "/kyc",
  guard(async (req, res) => ok(res, { checks: await listKyc(req.userId!, "vendor") })),
);

vendorRouter.post(
  "/kyc",
  guard(async (req, res) => {
    await requireVendor(req.userId!);
    const r = await submitKyc(req.userId!, "vendor", req.body);
    if (!r.ok) return r.zod ? zodFail(res, r.zod) : fail(res, r.status, r.message, r.code ? { code: r.code } : undefined);
    return ok(res, { check: r.check }, 201);
  }),
);

// ── Visitors ────────────────────────────────────────────────────────────────

vendorRouter.get(
  "/visitors",
  guard(async (req, res) => {
    const loyal = req.query.sort === "loyal";
    const source = typeof req.query.source === "string" && req.query.source !== "all" ? req.query.source : null;
    const { rows } = await q(
      `select * from public.vendor_customer_visits
        where vendor_id = $1 and ($2::text is null or source_kind = $2)
        order by ${loyal ? "visit_count desc, last_visit_at desc" : "last_visit_at desc"}
        limit 300`,
      [req.userId, source],
    );
    return ok(res, { visitors: rows });
  }),
);

