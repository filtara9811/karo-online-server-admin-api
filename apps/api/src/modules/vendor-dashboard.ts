import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok } from "../lib/respond.js";
import { getPool } from "../lib/pg-client.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import { distanceSql } from "../lib/vendor-leads.js";

export const vendorDashboardRouter = Router();
vendorDashboardRouter.use(requireAuth);

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);

async function vendorOrigin(userId: string) {
  await ensureVendorSchema();
  const { rows } = await q(
    `select coalesce(live_lat, lat) as lat, coalesce(live_lng, lng) as lng, coalesce(service_radius_km, 10) as radius
       from public.vendors where user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

const firstName = (s: unknown) => String(s ?? "").trim().split(/\s+/)[0] || null;
const coarse = (n: unknown) => (n == null ? null : Math.round(Number(n) * 1000) / 1000);

/** Customers near the vendor: people with the app open recently, plus people who asked for help nearby. */
vendorDashboardRouter.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    const v = await vendorOrigin(req.userId!);
    if (!v) return fail(res, 403, "Not a vendor");
    const own = Number(v.radius) > 0 ? Math.min(Number(v.radius), 100) : 100;
    const radius = z.coerce.number().min(1).max(100).catch(own).parse(req.query.radius_km ?? own);
    if (v.lat == null || v.lng == null) {
      return ok(res, { center: null, radius_km: radius, online: 0, offline: 0, customers: [], needs_location: true });
    }
    const dApp = distanceSql("$2::float8", "$3::float8", "c.last_lat", "c.last_lng");
    const dLead = distanceSql("$2::float8", "$3::float8", "l.lat", "l.lng");
    const { rows } = await q(
      `with app as (
         select c.user_id, coalesce(c.first_name, c.name) as name, c.avatar_url, c.last_lat as lat, c.last_lng as lng,
                c.last_seen_at, ${dApp} as km, 'app' as source
           from public.customers c
          where c.last_lat is not null and c.user_id <> $1 and c.last_seen_at > now() - interval '30 days'
            and ${dApp} <= $4
       ), lead as (
         select distinct on (l.customer_id) l.customer_id as user_id, l.customer_name as name, null::text as avatar_url,
                l.lat, l.lng, l.created_at as last_seen_at, ${dLead} as km, 'lead' as source
           from public.leads l
          where l.lat is not null and l.customer_id <> $1 and l.created_at > now() - interval '30 days'
            and ${dLead} <= $4
          order by l.customer_id, l.created_at desc
       )
       select * from app
       union all
       select * from lead where user_id not in (select user_id from app)
       order by last_seen_at desc
       limit 150`,
      [req.userId, v.lat, v.lng, radius],
    );
    const onlineCutoff = Date.now() - 5 * 60_000;
    const customers = rows.map((r) => ({
      name: firstName(r.name) ?? "Customer",
      avatar_url: r.avatar_url,
      distance_km: Math.round(Number(r.km) * 10) / 10,
      lat: coarse(r.lat),
      lng: coarse(r.lng),
      last_seen_at: r.last_seen_at,
      online: r.source === "app" && new Date(r.last_seen_at).getTime() > onlineCutoff,
      source: r.source,
    }));
    const online = customers.filter((c) => c.online).length;
    return ok(res, {
      center: { lat: Number(v.lat), lng: Number(v.lng) },
      radius_km: radius,
      online,
      offline: customers.length - online,
      customers,
    });
  }),
);

const RANGE_SQL: Record<string, string> = {
  day: "date_trunc('day', now())",
  week: "now() - interval '7 days'",
  month: "now() - interval '30 days'",
  year: "now() - interval '365 days'",
  all: "'epoch'::timestamptz",
};

vendorDashboardRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    await ensureVendorSchema();
    const range = z.enum(["day", "week", "month", "year", "all", "custom"]).catch("all").parse(req.query.range);
    const from = z.string().datetime({ offset: true }).optional().catch(undefined).parse(req.query.from);
    const to = z.string().datetime({ offset: true }).optional().catch(undefined).parse(req.query.to);
    const fromSql = range === "custom" && from ? "$2::timestamptz" : RANGE_SQL[range === "custom" ? "all" : range];
    const toSql = range === "custom" && to ? "$3::timestamptz" : "now()";
    const params = [req.userId, from ?? null, to ?? null];
    const where = `n.vendor_id = $1 and n.created_at >= ${fromSql} and n.created_at <= ${toSql}`;
    const [counts, trend, recent, bell] = await Promise.all([
      q(
        `select count(*)::int as total,
                count(*) filter (where n.status = 'pending')::int as pending,
                count(*) filter (where n.status in ('accepted', 'in_process'))::int as in_process,
                count(*) filter (where n.status = 'success')::int as success,
                count(*) filter (where n.status = 'rejected')::int as rejected,
                count(*) filter (where n.status = 'expired')::int as expired,
                count(*) filter (where coalesce(n.auto_matched, false))::int as auto
           from public.lead_notifications n where ${where} and ($2::text is null or true) and ($3::text is null or true)`,
        params,
      ),
      q(
        `select to_char(d, 'YYYY-MM-DD') as day,
                count(n.id)::int as total,
                count(n.id) filter (where n.status in ('accepted', 'in_process', 'success'))::int as won
           from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
           left join public.lead_notifications n on n.vendor_id = $1 and date_trunc('day', n.created_at) = d
          group by d order by d`,
        [req.userId],
      ),
      q(
        `select l.id as lead_id, split_part(coalesce(l.customer_name, 'Customer'), ' ', 1) as customer_name,
                to_jsonb(cu)->>'avatar_url' as avatar_url, l.sub_category_name, c.image_url as image
           from public.leads l
           left join public.customers cu on cu.user_id = l.customer_id
           left join public.categories c on c.id = l.sub_category_id
          where $1 = any(coalesce(l.accepted_vendor_ids, '{}'))
          order by l.updated_at desc nulls last limit 12`,
        [req.userId],
      ),
      q(
        `select (select count(*)::int from public.lead_notifications where vendor_id = $1 and seen_at is null
                   and created_at > now() - interval '7 days') as unseen,
                (select count(*)::int from public.lead_messages where recipient_id = $1 and read_at is null) as unread_messages`,
        [req.userId],
      ),
    ]);
    return ok(res, {
      range,
      counts: counts.rows[0],
      trend: trend.rows,
      recent_accepted: recent.rows,
      badges: bell.rows[0],
      server_time: new Date().toISOString(),
    });
  }),
);

/** Bell inbox: recent lead notifications with a short summary. */
vendorDashboardRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    await ensureVendorSchema();
    const { rows } = await q(
      `select n.id, n.lead_id, n.status, n.created_at, n.seen_at, n.auto_matched,
              l.sub_category_name, split_part(coalesce(l.customer_name, 'Customer'), ' ', 1) as customer_name,
              c.image_url as image,
              (select count(*)::int from public.lead_messages m
                where m.lead_id = n.lead_id and m.recipient_id = $1 and m.read_at is null) as unread
         from public.lead_notifications n
         join public.leads l on l.id = n.lead_id
         left join public.categories c on c.id = l.sub_category_id
        where n.vendor_id = $1
        order by n.created_at desc limit 60`,
      [req.userId],
    );
    return ok(res, { notifications: rows });
  }),
);

vendorDashboardRouter.post(
  "/notifications/seen",
  asyncHandler(async (req, res) => {
    await ensureVendorSchema();
    const r = await q(`update public.lead_notifications set seen_at = now() where vendor_id = $1 and seen_at is null`, [req.userId]);
    return ok(res, { seen: r.rowCount ?? 0 });
  }),
);

/** Leads the vendor accepted recently, for the floating "accepted" pill. */
vendorDashboardRouter.get(
  "/accepted",
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `select l.id, l.sub_category_name, l.status, l.updated_at, l.customer_name,
              (select count(*)::int from public.lead_messages m where m.lead_id = l.id and m.recipient_id = $1 and m.read_at is null) as unread
         from public.leads l
        where $1 = any(coalesce(l.accepted_vendor_ids, '{}')) and l.updated_at > now() - interval '7 days'
        order by l.updated_at desc limit 30`,
      [req.userId],
    );
    return ok(res, { leads: rows });
  }),
);

/** Profile Finder: people who asked for the vendor's mapped categories nearby. */
vendorDashboardRouter.get(
  "/profile-finder",
  asyncHandler(async (req, res) => {
    const v = await vendorOrigin(req.userId!);
    if (!v) return fail(res, 403, "Not a vendor");
    const dist = distanceSql("$2::float8", "$3::float8", "l.lat", "l.lng");
    const { rows } = await q(
      `with cats as (
         select distinct ci.category_id as id from public.vendor_item_mappings m
           join public.catalog_items ci on ci.id = m.item_id
          where m.vendor_id = $1 and coalesce(m.is_active, true) and ci.category_id is not null
       )
       select c.id, c.name, c.image_url, c.icon,
              (select count(distinct l.customer_id)::int from public.leads l
                where l.sub_category_id = c.id and l.customer_id <> $1 and l.created_at > now() - interval '60 days'
                  and ($2::float8 is null or l.lat is null or ${dist} <= 25)) as people
         from public.categories c join cats on cats.id = c.id
        order by people desc, c.name`,
      [req.userId, v.lat ?? null, v.lng ?? null],
    );
    return ok(res, { categories: rows });
  }),
);

vendorDashboardRouter.get(
  "/profile-finder/:categoryId",
  asyncHandler(async (req, res) => {
    const v = await vendorOrigin(req.userId!);
    if (!v) return fail(res, 403, "Not a vendor");
    const cat = z.string().uuid().safeParse(req.params.categoryId);
    if (!cat.success) return fail(res, 400, "Invalid category");
    const dist = distanceSql("$3::float8", "$4::float8", "l.lat", "l.lng");
    const { rows } = await q(
      `select distinct on (l.customer_id) l.customer_id, l.id as lead_id, l.customer_name, l.customer_phone, l.created_at,
              l.sub_category_name, l.item_names, to_jsonb(cu)->>'avatar_url' as avatar_url,
              ($1 = any(coalesce(l.accepted_vendor_ids, '{}'))) as mine,
              case when $3::float8 is null or l.lat is null then null else ${dist} end as km
         from public.leads l
         left join public.customers cu on cu.user_id = l.customer_id
        where l.sub_category_id = $2 and l.customer_id <> $1 and l.created_at > now() - interval '60 days'
          and ($3::float8 is null or l.lat is null or ${dist} <= 25)
        order by l.customer_id, l.created_at desc
        limit 100`,
      [req.userId, cat.data, v.lat ?? null, v.lng ?? null],
    );
    const people = rows
      .map((r) => {
        const d = String(r.customer_phone ?? "").replace(/\D/g, "");
        return {
          lead_id: r.lead_id,
          name: firstName(r.customer_name) ?? "Customer",
          avatar_url: r.avatar_url,
          phone: r.mine ? r.customer_phone : d.length >= 4 ? `••••••${d.slice(-4)}` : null,
          mine: r.mine,
          asked_at: r.created_at,
          items: r.item_names ?? [],
          distance_km: r.km == null ? null : Math.round(Number(r.km) * 10) / 10,
        };
      })
      .sort((a, b) => String(b.asked_at).localeCompare(String(a.asked_at)));
    return ok(res, { people });
  }),
);
