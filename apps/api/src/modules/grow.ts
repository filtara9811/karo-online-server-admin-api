import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { readBearer, requireAuth } from "../middleware/auth.js";
import { createUserClient } from "../lib/supabase.js";
import { getPool, hasDatabase } from "../lib/pg-client.js";
import { createOrder } from "../lib/payments.js";
import { env } from "../config/env.js";
import { listPublicShopFeed } from "../lib/shop-feed.js";
import { feedCache, feedKey, youtubeFeedFromSource } from "../lib/youtube-feed.js";

export const growRouter = Router();

const PROJECT_PRICE_INR = 599;
const SITE = env.publicSiteUrl.replace(/\/$/, "") || "https://karo-online-server-admin-api-api-git-main-ashu-e386.vercel.app";

type Row = Record<string, any>;

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params) as Promise<{ rows: Row[]; rowCount: number | null }>;

growRouter.use((_req, res, next) => {
  if (!hasDatabase()) return fail(res, 503, "DATABASE_URL missing — DigitalOcean Postgres is required");
  next();
});

function defaultLinkSettings(): Row {
  return {
    play_store_enabled: true,
    payment_enabled: false,
    payment_provider: "upi",
    payment_upi_id: "",
    payment_label: "",
    payment_amount_inr: "",
    digital_shop_enabled: false,
    digital_shop_url: "",
    extra_links: [],
    premium_unlocked: false,
    poster_media: [],
    poster_bg_urls: [],
    poster_bg_url: null,
    yt_source: "",
    yt_enabled: false,
    yt_products: {},
    ig_source: "",
    ig_enabled: false,
    ig_products: {},
    pin_source: "",
    pin_enabled: false,
    pin_products: {},
  };
}

function jsonValue(v: unknown, fallback: unknown) {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  return v ?? fallback;
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `qr-${Date.now().toString(36)}`
  );
}

/** A user's oldest project is the free one, including projects created before this rule was stored. */
const PROJECT_SELECT = `select p.*, not exists (select 1 from public.qr_projects o where o.user_id = p.user_id and o.created_at < p.created_at) as is_first
  from public.qr_projects p`;

function decorate(p: Row) {
  const code = p.share_code || p.slug;
  const { is_first, ...rest } = p;
  return {
    ...rest,
    shop_url: `${SITE}/s/${encodeURIComponent(code)}?p=${encodeURIComponent(p.slug)}`,
    qr_url: `${SITE}/q/${encodeURIComponent(p.slug)}`,
    price_inr: Number(p.price_inr ?? PROJECT_PRICE_INR),
    ad_budget_inr: Number(p.ad_budget_inr ?? 0),
    is_paid: !!p.is_paid || !!is_first,
  };
}

async function shareCode(userId: string, fallback: string) {
  const rc = await q(`select code from public.referral_codes where user_id = $1 limit 1`, [userId]);
  if (rc.rows[0]?.code) return String(rc.rows[0].code);
  const generated = `GROW-${fallback.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  await q(`insert into public.referral_codes (user_id, code) values ($1, $2)`, [userId, generated]).catch(() => undefined);
  const again = await q(`select code from public.referral_codes where user_id = $1 limit 1`, [userId]);
  return String(again.rows[0]?.code ?? generated);
}

async function ownProject(req: Request, res: Response): Promise<Row | null> {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    fail(res, 404, "Project not found");
    return null;
  }
  const { rows } = await q(`${PROJECT_SELECT} where p.id = $1 and p.user_id = $2`, [id, req.userId]);
  if (!rows[0]) {
    fail(res, 404, "Project not found");
    return null;
  }
  return { ...rows[0], is_paid: !!rows[0].is_paid || !!rows[0].is_first };
}

/** Visits tagged with this project, plus untagged scans of the owner's share code (older QR prints). */
const VISITS_WHERE = `(v.project_id = $1 or v.project_slug = $2 or (v.project_id is null and v.project_slug is null and v.code in ($2, $3)))`;

async function optionalUserId(req: Request) {
  const token = readBearer(req);
  if (!token) return undefined;
  try {
    const { data } = await createUserClient(token).auth.getUser(token);
    return data.user?.id ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Projects ────────────────────────────────────────────────────────────────

growRouter.get(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await q(`${PROJECT_SELECT} where p.user_id = $1 order by p.created_at desc`, [req.userId]);
    return ok(res, { projects: rows.map(decorate) });
  }),
);

growRouter.post(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        title: z.string().trim().min(2).max(120),
        business_name: z.string().trim().max(120).optional(),
        contact_phone: z.string().max(20).optional(),
        city: z.string().max(80).optional(),
        category: z.string().max(80).optional(),
        theme_key: z.string().max(40).optional(),
        accent_color: z.string().max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const d = parsed.data;
    const slug = slugify(`${d.business_name || d.title}-${Date.now().toString(36)}`);
    const code = await shareCode(req.userId!, slug);
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtext('qr_projects:' || $1))`, [req.userId]);
      const count = await client.query(`select count(*)::int n from public.qr_projects where user_id = $1`, [req.userId]);
      const first = count.rows[0].n === 0;
      const { rows } = await client.query(
        `insert into public.qr_projects
           (user_id, title, name, slug, business_name, contact_phone, city, category, theme_key, accent_color, is_paid, price_inr, share_code, created_at)
         values ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()) returning *`,
        [
          req.userId,
          d.title,
          slug,
          d.business_name || d.title,
          d.contact_phone ?? null,
          d.city ?? null,
          d.category ?? null,
          d.theme_key ?? "classic-amber",
          d.accent_color ?? "#d4af37",
          first,
          first ? 0 : PROJECT_PRICE_INR,
          code,
        ],
      );
      await client.query(
        `insert into public.digital_shops (user_id, name, slug, project_id)
         select $1, $2, $3, $4 where not exists (select 1 from public.digital_shops where user_id = $1)`,
        [req.userId, d.business_name || d.title, slug, rows[0].id],
      );
      await client.query("commit");
      return ok(res, { project: decorate(rows[0]) }, 201);
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }),
);

growRouter.get(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (project) return ok(res, { project: decorate(project) });
  }),
);

const ProjectPatch = z
  .object({
    title: z.string().trim().min(2).max(120),
    business_name: z.string().max(120),
    description: z.string().max(2000),
    contact_phone: z.string().max(20),
    theme_key: z.string().max(40),
    accent_color: z.string().max(20),
    city: z.string().max(80),
    category: z.string().max(80),
    ads_enabled: z.boolean(),
    ad_budget_inr: z.number().min(0).max(1_000_000),
    trade_type: z.string().max(80),
    avatar_url: z.string().max(2000),
    cover_image_url: z.string().max(2000),
  })
  .partial();

growRouter.patch(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = ProjectPatch.safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const project = await ownProject(req, res);
    if (!project) return;
    const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
    if (!entries.length) return ok(res, { project: decorate(project) });
    const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(", ");
    await q(`update public.qr_projects set ${sets} where id = $1 and user_id = $2`, [project.id, req.userId, ...entries.map(([, v]) => v)]);
    const { rows } = await q(`${PROJECT_SELECT} where p.id = $1`, [project.id]);
    return ok(res, { project: decorate(rows[0]) });
  }),
);

growRouter.delete(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    await q(`delete from public.shop_products where project_id = $1 and user_id = $2`, [project.id, req.userId]);
    await q(`delete from public.qr_campaigns where project_id = $1`, [project.id]);
    await q(`delete from public.merchant_link_settings where project_id = $1 and user_id = $2`, [project.id, req.userId]);
    await q(`update public.digital_shops set project_id = null where project_id = $1`, [project.id]);
    await q(`delete from public.qr_projects where id = $1 and user_id = $2`, [project.id, req.userId]);
    return ok(res, { deleted: true });
  }),
);

// ── Payment (2nd+ project) ──────────────────────────────────────────────────

growRouter.post(
  "/projects/:id/pay",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    if (project.is_paid) return ok(res, { paid: true, project: decorate(project) });
    const origin = (req.headers.origin as string) || SITE;
    const r = await createOrder(req.userId!, { purpose: "qr_project", project_id: project.id }, origin);
    if (!r.ok) return fail(res, 400, r.error, r);
    return ok(res, { ...r, paid: false, project_id: project.id });
  }),
);

// ── Visitors ────────────────────────────────────────────────────────────────

growRouter.get(
  "/projects/:id/visits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    const { rows } = await q(
      `select v.*, count(*) over (partition by nullif(right(regexp_replace(coalesce(v.visitor_phone, ''), '\\D', '', 'g'), 10), '')) as phone_visits
         from public.shop_visits v
        where ${VISITS_WHERE}
        order by v.created_at desc limit 300`,
      [project.id, project.slug, project.share_code ?? project.slug],
    );
    return ok(res, {
      visits: rows.map((r) => ({ ...r, visit_count: r.visitor_phone ? Number(r.phone_visits) : 1, phone_visits: undefined })),
    });
  }),
);

growRouter.post(
  "/projects/:id/visits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        visitor_name: z.string().trim().min(1).max(120),
        visitor_phone: z.string().max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const project = await ownProject(req, res);
    if (!project) return;
    const phone = parsed.data.visitor_phone?.replace(/\D/g, "").slice(-10) || null;
    const { rows } = await q(
      `insert into public.shop_visits (project_id, project_slug, code, kind, source, visitor_name, visitor_phone, created_at)
       values ($1, $2, $3, 'manual', 'grow-app', $4, $5, now()) returning *`,
      [project.id, project.slug, project.share_code || project.slug, parsed.data.visitor_name, phone],
    );
    return ok(res, { visit: rows[0] }, 201);
  }),
);

growRouter.get(
  "/projects/:id/analytics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 7));
    const { rows } = await q(
      `with d as (select generate_series(current_date - ($4::int - 1), current_date, interval '1 day')::date as day)
       select to_char(d.day, 'YYYY-MM-DD') as day,
              count(v.id)::int as visitors,
              count(distinct coalesce(nullif(right(regexp_replace(coalesce(v.visitor_phone, ''), '\\D', '', 'g'), 10), ''), v.id::text))::int as "unique",
              count(distinct nullif(right(regexp_replace(coalesce(v.visitor_phone, ''), '\\D', '', 'g'), 10), ''))::int as customers
         from d left join public.shop_visits v on v.created_at::date = d.day and ${VISITS_WHERE}
        group by d.day order by d.day`,
      [project.id, project.slug, project.share_code ?? project.slug, days],
    );
    const totals = rows.reduce(
      (t, r) => ({ visits: t.visits + r.visitors, unique: t.unique + r.unique, customers: t.customers + r.customers }),
      { visits: 0, unique: 0, customers: 0 },
    );
    return ok(res, { days: rows, totals });
  }),
);

// ── Products / orders ───────────────────────────────────────────────────────

growRouter.get(
  "/projects/:id/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    const { rows } = await q(
      `select * from public.shop_products where project_id = $1 and user_id = $2 order by is_active desc, created_at desc`,
      [project.id, req.userId],
    );
    return ok(res, { products: rows.map((p) => ({ ...p, price: Number(p.price ?? 0), stock: Number(p.stock ?? 0) })) });
  }),
);

const ProductBody = z.object({
  name: z.string().trim().min(1).max(160),
  price: z.number().min(0).max(1_000_000),
  category: z.string().trim().max(80).nullable(),
  stock: z.number().int().min(0).max(1_000_000),
  is_active: z.boolean(),
});

growRouter.post(
  "/projects/:id/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = ProductBody.partial({ price: true, category: true, stock: true, is_active: true }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const project = await ownProject(req, res);
    if (!project) return;
    const d = parsed.data;
    const { rows } = await q(
      `insert into public.shop_products (project_id, user_id, name, price, category, stock, is_active, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, now()) returning *`,
      [project.id, req.userId, d.name, d.price ?? 0, d.category || null, d.stock ?? 0, d.is_active ?? true],
    );
    return ok(res, { product: rows[0] }, 201);
  }),
);

growRouter.patch(
  "/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = ProductBody.partial().safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
    if (!entries.length) return fail(res, 400, "Nothing to update");
    const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(", ");
    const { rows } = await q(
      `update public.shop_products set ${sets}, updated_at = now() where id = $1 and user_id = $2 and project_id is not null returning *`,
      [String(req.params.id), req.userId, ...entries.map(([, v]) => v)],
    );
    if (!rows[0]) return fail(res, 404, "Product not found");
    return ok(res, { product: rows[0] });
  }),
);

growRouter.delete(
  "/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rowCount } = await q(`delete from public.shop_products where id = $1 and user_id = $2 and project_id is not null`, [
      String(req.params.id),
      req.userId,
    ]);
    if (!rowCount) return fail(res, 404, "Product not found");
    return ok(res, { deleted: true });
  }),
);

growRouter.get(
  "/projects/:id/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    const { rows } = await q(`select * from public.shop_orders where project_id = $1 order by created_at desc limit 300`, [project.id]);
    return ok(res, { orders: rows.map((o) => ({ ...o, total_inr: Number(o.total_inr ?? 0) })) });
  }),
);

export const GROW_ORDER_STATUSES = ["new", "confirmed", "ready", "delivered", "cancelled", "inquiry", "replied"] as const;

growRouter.patch(
  "/orders/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z.object({ status: z.enum(GROW_ORDER_STATUSES) }).safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const { rows } = await q(
      `update public.shop_orders o set status = $3, updated_at = now()
         from public.qr_projects p
        where o.id = $1 and p.id = o.project_id and p.user_id = $2
        returning o.*`,
      [String(req.params.id), req.userId, parsed.data.status],
    );
    if (!rows[0]) return fail(res, 404, "Order not found");
    return ok(res, { order: { ...rows[0], total_inr: Number(rows[0].total_inr ?? 0) } });
  }),
);

// ── Campaigns ───────────────────────────────────────────────────────────────

growRouter.get(
  "/projects/:id/campaigns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    const { rows } = await q(`select * from public.qr_campaigns where project_id = $1 order by created_at desc`, [project.id]);
    return ok(res, { campaigns: rows.map((c) => ({ ...c, budget_inr: Number(c.budget_inr ?? 0) })) });
  }),
);

growRouter.post(
  "/projects/:id/campaigns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z.object({ title: z.string().trim().min(2).max(120), budget_inr: z.number().min(0).max(1_000_000).optional() }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const project = await ownProject(req, res);
    if (!project) return;
    const { rows } = await q(
      `insert into public.qr_campaigns (project_id, user_id, title, budget_inr, clicks, status, created_at)
       values ($1, $2, $3, $4, 0, 'requested', now()) returning *`,
      [project.id, req.userId, parsed.data.title, parsed.data.budget_inr ?? 0],
    );
    return ok(res, { campaign: { ...rows[0], budget_inr: Number(rows[0].budget_inr ?? 0) } }, 201);
  }),
);

// ── Public catalog ──────────────────────────────────────────────────────────

growRouter.get(
  "/themes",
  asyncHandler(async (_req, res) => {
    const { rows } = await q(`select * from public.qr_landing_themes where is_active = true`).catch(() => ({ rows: [] as Row[] }));
    if (rows.length) return ok(res, { themes: rows });
    return ok(res, {
      themes: [
        { key: "classic", name: "Classic gold", accent_color: "#d4af37", bg_from: "#1a1208", bg_to: "#0a0804", is_premium: false },
        { key: "night", name: "Night", accent_color: "#f5d97a", bg_from: "#12100a", bg_to: "#000000", is_premium: true },
      ],
    });
  }),
);

growRouter.get(
  "/shop-feed",
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const rows = await listPublicShopFeed({
      q: str(req.query.q),
      city: str(req.query.city) || null,
      category: str(req.query.category) || null,
      trade: str(req.query.trade) || null,
      limit: Number(req.query.limit ?? 12),
      offset: Number(req.query.offset ?? 0),
      excludeUserId: await optionalUserId(req),
    });
    return ok(res, { rows });
  }),
);

// ── ALL Program ─────────────────────────────────────────────────────────────

growRouter.get(
  "/programs",
  asyncHandler(async (req, res) => {
    const userId = await optionalUserId(req);
    const { rows } = await q(
      `select p.*, (select count(distinct j.user_id)::int from public.vendor_program_joins j where j.program_id = p.id) as members,
              exists (select 1 from public.vendor_program_joins j where j.program_id = p.id and j.user_id = $1) as joined
         from public.vendor_programs p where p.is_active = true order by p.created_at`,
      [userId ?? null],
    );
    return ok(res, { programs: rows });
  }),
);

growRouter.post(
  "/programs/:id/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const program = await q(`select id from public.vendor_programs where id::text = $1 and is_active = true`, [id]);
    if (!program.rows[0]) return fail(res, 404, "Program not found");
    await q(
      `insert into public.vendor_program_joins (program_id, user_id, created_at)
       select $1, $2, now() where not exists (select 1 from public.vendor_program_joins where program_id = $1 and user_id = $2)`,
      [program.rows[0].id, req.userId],
    );
    return ok(res, { joined: true });
  }),
);

growRouter.delete(
  "/programs/:id/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    await q(`delete from public.vendor_program_joins where program_id::text = $1 and user_id = $2`, [String(req.params.id), req.userId]);
    return ok(res, { joined: false });
  }),
);

// ── Tutorials / links / YouTube ─────────────────────────────────────────────

growRouter.get(
  "/tutorial/:section",
  requireAuth,
  asyncHandler(async (req, res) => {
    const section = String(req.params.section || "").trim();
    const { rows } = await q(
      `select id, section, title, caption, youtube_url, video_url, is_active from public.oneqr_tutorial_videos
        where section = $1 and is_active = true order by updated_at desc nulls last limit 1`,
      [section],
    ).catch(() => ({ rows: [] as Row[] }));
    return ok(res, { video: rows[0] ?? null });
  }),
);

function linkSettingsOut(r: Row, project: Row, fallback: Row = {}) {
  return {
    ...defaultLinkSettings(),
    ...r,
    extra_links: jsonValue(r.extra_links, fallback.extra_links ?? []),
    poster_media: jsonValue(r.poster_media, fallback.poster_media ?? []),
    poster_bg_urls: jsonValue(r.poster_bg_urls, fallback.poster_bg_urls ?? []),
    yt_products: jsonValue(r.yt_products, fallback.yt_products ?? {}),
    ig_products: jsonValue(r.ig_products, fallback.ig_products ?? {}),
    pin_products: jsonValue(r.pin_products, fallback.pin_products ?? {}),
    payment_enabled: !!r.payment_enabled,
    premium_unlocked: !!r.premium_unlocked || !!project.is_paid,
  };
}

growRouter.get(
  "/projects/:id/links",
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await ownProject(req, res);
    if (!project) return;
    const own = await q(`select * from public.merchant_link_settings where user_id = $1 and project_id = $2 limit 1`, [req.userId, project.id]);
    const row =
      own.rows[0] ??
      (await q(`select * from public.merchant_link_settings where user_id = $1 order by updated_at desc nulls last limit 1`, [req.userId])).rows[0] ??
      {};
    const { id: _id, project_id: _pid, ...rest } = row;
    return ok(res, { settings: linkSettingsOut(own.rows[0] ? row : rest, project) });
  }),
);

const LinksBody = z.object({
  play_store_enabled: z.boolean().optional(),
  payment_enabled: z.boolean().optional(),
  payment_provider: z.string().max(40).optional(),
  payment_upi_id: z.string().max(200).optional(),
  payment_label: z.string().max(80).optional(),
  payment_amount_inr: z.union([z.string(), z.number()]).optional(),
  digital_shop_enabled: z.boolean().optional(),
  digital_shop_url: z.string().max(2000).optional(),
  extra_links: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        url: z.string(),
        enabled: z.boolean().optional(),
        category: z.string().optional(),
        price: z.union([z.string(), z.number()]).optional().nullable(),
        image: z.string().optional().nullable(),
      }),
    )
    .optional(),
  premium_unlocked: z.boolean().optional(),
  poster_media: z.array(z.record(z.unknown())).optional(),
  poster_bg_urls: z.array(z.string()).optional(),
  poster_bg_url: z.string().nullable().optional(),
  yt_source: z.string().max(400).optional().nullable(),
  yt_enabled: z.boolean().optional(),
  yt_products: z.record(z.unknown()).optional(),
  ig_source: z.string().max(400).optional().nullable(),
  ig_enabled: z.boolean().optional(),
  ig_products: z.record(z.unknown()).optional(),
  pin_source: z.string().max(400).optional().nullable(),
  pin_enabled: z.boolean().optional(),
  pin_products: z.record(z.unknown()).optional(),
});

growRouter.put(
  "/projects/:id/links",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = LinksBody.safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const project = await ownProject(req, res);
    if (!project) return;
    const d = parsed.data;
    const payload: Row = {};
    for (const key of [
      "play_store_enabled",
      "payment_enabled",
      "payment_provider",
      "payment_upi_id",
      "payment_label",
      "digital_shop_enabled",
      "digital_shop_url",
      "poster_bg_url",
      "yt_source",
      "yt_enabled",
      "ig_source",
      "ig_enabled",
      "pin_source",
      "pin_enabled",
    ] as const) {
      if (d[key] !== undefined) payload[key] = d[key];
    }
    if (d.payment_amount_inr !== undefined) {
      payload.payment_amount_inr = d.payment_amount_inr === "" ? null : Number(d.payment_amount_inr) || null;
    }
    if (d.extra_links !== undefined) payload.extra_links = JSON.stringify(d.extra_links);
    if (d.poster_media !== undefined) {
      payload.poster_media = JSON.stringify(
        d.poster_media.map((item) => {
          const src = typeof item.src === "string" ? item.src : "";
          return src.startsWith("data:") && src.length > 180_000 ? { ...item, src: "", poster: item.poster ?? null } : item;
        }),
      );
    }
    if (d.poster_bg_urls !== undefined) payload.poster_bg_urls = JSON.stringify(d.poster_bg_urls);
    for (const key of ["yt_products", "ig_products", "pin_products"] as const) {
      if (d[key] !== undefined) payload[key] = JSON.stringify(d[key]);
    }
    // Premium links come with a paid project; the client can't grant them.
    payload.premium_unlocked = !!project.is_paid;

    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtext('link_settings:' || $1))`, [project.id]);
      const existing = await client.query(`select id from public.merchant_link_settings where user_id = $1 and project_id = $2 limit 1`, [
        req.userId,
        project.id,
      ]);
      const keys = Object.keys(payload);
      const vals = keys.map((k) => payload[k]);
      const saved = existing.rows[0]
        ? await client.query(
            `update public.merchant_link_settings set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1 returning *`,
            [existing.rows[0].id, ...vals],
          )
        : await client.query(
            `insert into public.merchant_link_settings (user_id, project_id, ${keys.join(", ")}, updated_at)
             values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")}, now()) returning *`,
            [req.userId, project.id, ...vals],
          );
      await client.query("commit");
      return ok(res, { settings: linkSettingsOut(saved.rows[0], project, d) });
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }),
);

growRouter.get(
  "/youtube-feed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const source = String(req.query.source ?? "").trim();
    if (!source) return fail(res, 400, "Enter a YouTube channel ID, @handle or playlist link");
    try {
      const videos = await youtubeFeedFromSource(source);
      if (!videos.length) return fail(res, 404, "No videos found on YouTube. Check the @handle, channel ID (UC…) or playlist link.");
      return ok(res, { videos });
    } catch (err) {
      console.error("[youtube-feed]", err instanceof Error ? err.message : err);
      const stale = feedCache.get(feedKey(source));
      if (stale?.videos.length) return ok(res, { videos: stale.videos, stale: true });
      return fail(res, 502, "YouTube sync failed. Tap Sync to try again.");
    }
  }),
);
