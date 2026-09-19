import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { readBearer, requireAuth } from "../middleware/auth.js";
import { createUserClient, getServiceRoleClient, tryServiceRole } from "../lib/supabase.js";
import { hasDatabase } from "../config/env.js";
import { pickService, createCashfreeOrder } from "../lib/cashfree.js";
import { env } from "../config/env.js";
import { listPublicShopFeed } from "../lib/shop-feed.js";

export const growRouter = Router();

const PROJECT_PRICE_INR = 599;
const SITE = env.publicSiteUrl || "https://karoonline.in";

type GrowProject = {
  id: string;
  user_id: string;
  title: string;
  name?: string | null;
  slug: string;
  business_name?: string | null;
  contact_phone?: string | null;
  category?: string | null;
  city?: string | null;
  trade_type?: string | null;
  theme_key?: string | null;
  accent_color?: string | null;
  description?: string | null;
  is_paid: boolean;
  price_inr: number;
  ads_enabled?: boolean;
  ad_budget_inr?: number;
  share_code?: string | null;
  shop_url?: string;
  qr_url?: string;
  created_at: string;
};

type ShopProduct = {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  price: number;
  category?: string | null;
  stock: number;
  is_active: boolean;
  created_at: string;
};

type ShopOrder = {
  id: string;
  project_id: string | null;
  user_id?: string | null;
  code: string;
  visitor_name?: string | null;
  visitor_phone?: string | null;
  items: unknown[];
  total_inr: number;
  status: string;
  created_at: string;
};

type Campaign = {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  budget_inr: number;
  clicks: number;
  status: string;
  created_at: string;
};

const memProjects: GrowProject[] = [];
const memProducts: ShopProduct[] = [];
const memOrders: ShopOrder[] = [];
const memCampaigns: Campaign[] = [];
const memJoins: { id: string; program_id: string; user_id: string }[] = [];

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `qr-${Date.now().toString(36)}`
  );
}

function decorate(p: GrowProject): GrowProject {
  const code = p.share_code || p.slug;
  return {
    ...p,
    shop_url: `${SITE}/s/${encodeURIComponent(code)}?p=${encodeURIComponent(p.slug)}`,
    qr_url: `${SITE}/q/${encodeURIComponent(p.slug)}`,
    price_inr: Number(p.price_inr ?? PROJECT_PRICE_INR),
    is_paid: !!p.is_paid,
  };
}

async function shareCode(sb: NonNullable<ReturnType<typeof tryServiceRole>>, userId: string, fallback: string) {
  const rc = await sb.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
  if (rc.data?.code) return String(rc.data.code);
  const generated = `GROW-${fallback.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || randomUUID().slice(0, 6)}`;
  await sb.from("referral_codes").insert({ user_id: userId, code: generated }).then(() => undefined).catch(() => undefined);
  return generated;
}

function client() {
  if (hasDatabase()) return getServiceRoleClient();
  return tryServiceRole();
}

growRouter.get(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_projects").select("*").eq("user_id", req.userId!).order("created_at", { ascending: false });
      if (!error) return ok(res, { projects: (data ?? []).map((p) => decorate(p as GrowProject)) });
    }
    return ok(res, { projects: memProjects.filter((p) => p.user_id === req.userId).map(decorate), seeded: true });
  }),
);

growRouter.post(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        title: z.string().min(2).max(120),
        business_name: z.string().max(120).optional(),
        contact_phone: z.string().max(20).optional(),
        city: z.string().max(80).optional(),
        category: z.string().max(80).optional(),
        theme_key: z.string().max(40).optional(),
        accent_color: z.string().max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const slug = slugify(`${parsed.data.business_name || parsed.data.title}-${Date.now().toString(36)}`);
    const sb = client();
    if (sb) {
      const code = await shareCode(sb, req.userId!, slug);
      const row = {
        user_id: req.userId,
        title: parsed.data.title,
        name: parsed.data.title,
        slug,
        business_name: parsed.data.business_name ?? parsed.data.title,
        contact_phone: parsed.data.contact_phone ?? null,
        city: parsed.data.city ?? null,
        category: parsed.data.category ?? null,
        theme_key: parsed.data.theme_key ?? "classic-amber",
        accent_color: parsed.data.accent_color ?? "#d4af37",
        is_paid: false,
        price_inr: PROJECT_PRICE_INR,
        share_code: code,
      };
      const { data, error } = await sb.from("qr_projects").insert(row).select("*").maybeSingle();
      if (error || !data) {
        console.error("[projects] insert failed:", error?.message ?? "no row");
        return fail(res, 500, "Project save nahi ho paya.");
      }
        await sb
          .from("digital_shops")
          .upsert({ user_id: req.userId, name: parsed.data.title, slug, project_id: data.id }, { onConflict: "user_id" })
          .then(() => undefined)
          .catch(() => undefined);
        return ok(res, { project: decorate(data as GrowProject) }, 201);
    }
    const project: GrowProject = {
      id: randomUUID(),
      user_id: req.userId!,
      title: parsed.data.title,
      slug,
      business_name: parsed.data.business_name ?? parsed.data.title,
      city: parsed.data.city ?? null,
      category: parsed.data.category ?? null,
      is_paid: false,
      price_inr: PROJECT_PRICE_INR,
      share_code: slug,
      created_at: new Date().toISOString(),
    };
    memProjects.unshift(project);
    return ok(res, { project: decorate(project), seeded: true }, 201);
  }),
);

growRouter.get(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_projects").select("*").eq("id", id).eq("user_id", req.userId!).maybeSingle();
      if (!error && data) return ok(res, { project: decorate(data as GrowProject) });
    }
    const project = memProjects.find((p) => p.id === id && p.user_id === req.userId);
    if (!project) return fail(res, 404, "project not found");
    return ok(res, { project: decorate(project), seeded: true });
  }),
);

growRouter.patch(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        title: z.string().min(2).max(120).optional(),
        business_name: z.string().max(120).optional(),
        description: z.string().max(2000).optional(),
        contact_phone: z.string().max(20).optional(),
        theme_key: z.string().max(40).optional(),
        accent_color: z.string().max(20).optional(),
        city: z.string().max(80).optional(),
        category: z.string().max(80).optional(),
        ads_enabled: z.boolean().optional(),
        ad_budget_inr: z.number().min(0).optional(),
        trade_type: z.string().max(80).optional(),
        avatar_url: z.string().max(2000).optional(),
        cover_image_url: z.string().max(2000).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    if (sb) {
      const { data, error } = await sb
        .from("qr_projects")
        .update(parsed.data)
        .eq("id", id)
        .eq("user_id", req.userId!)
        .select("*")
        .maybeSingle();
      if (!error && data) return ok(res, { project: decorate(data as GrowProject) });
    }
    const project = memProjects.find((p) => p.id === id && p.user_id === req.userId);
    if (!project) return fail(res, 404, "project not found");
    Object.assign(project, parsed.data);
    return ok(res, { project: decorate(project), seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/visits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data: project } = await sb.from("qr_projects").select("id, slug, share_code").eq("id", id).eq("user_id", req.userId!).maybeSingle();
      if (project) {
        const { data, error } = await sb
          .from("shop_visits")
          .select("*")
          .or(`project_id.eq.${id},project_slug.eq.${project.slug},code.eq.${project.share_code ?? project.slug}`)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) console.error("[visits] list failed:", error.message);
        return ok(res, { visits: data ?? [] });
      }
    }
    return ok(res, { visits: [], seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_products").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (!error) return ok(res, { products: data ?? [] });
    }
    return ok(res, { products: memProducts.filter((p) => p.project_id === id), seeded: true });
  }),
);

growRouter.post(
  "/projects/:id/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        name: z.string().min(1).max(160),
        price: z.number().min(0).max(1_000_000).optional(),
        category: z.string().max(80).optional(),
        stock: z.number().min(0).max(1_000_000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const row = {
      project_id: id,
      user_id: req.userId,
      name: parsed.data.name,
      price: parsed.data.price ?? 0,
      category: parsed.data.category ?? null,
      stock: parsed.data.stock ?? 0,
      is_active: true,
    };
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_products").insert(row).select("*").maybeSingle();
      if (!error && data) return ok(res, { product: data }, 201);
    }
    const product: ShopProduct = { id: randomUUID(), ...row, user_id: req.userId!, created_at: new Date().toISOString(), is_active: true, stock: row.stock ?? 0, price: row.price ?? 0 };
    memProducts.unshift(product);
    return ok(res, { product, seeded: true }, 201);
  }),
);

growRouter.patch(
  "/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        name: z.string().min(1).max(160).optional(),
        price: z.number().min(0).optional(),
        stock: z.number().min(0).optional(),
        category: z.string().max(80).optional(),
        is_active: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_products").update(parsed.data).eq("id", id).eq("user_id", req.userId!).select("*").maybeSingle();
      if (!error && data) return ok(res, { product: data });
    }
    const product = memProducts.find((p) => p.id === id && p.user_id === req.userId);
    if (!product) return fail(res, 404, "product not found");
    Object.assign(product, parsed.data);
    return ok(res, { product, seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_orders").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (!error) return ok(res, { orders: data ?? [] });
    }
    return ok(res, { orders: memOrders.filter((o) => o.project_id === id), seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/campaigns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_campaigns").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (!error) return ok(res, { campaigns: data ?? [] });
    }
    return ok(res, { campaigns: memCampaigns.filter((c) => c.project_id === id), seeded: true });
  }),
);

growRouter.post(
  "/projects/:id/campaigns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z.object({ title: z.string().min(2).max(120), budget_inr: z.number().min(0).optional() }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const row = {
      project_id: id,
      user_id: req.userId,
      title: parsed.data.title,
      budget_inr: parsed.data.budget_inr ?? 0,
      clicks: 0,
      status: "draft",
    };
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_campaigns").insert(row).select("*").maybeSingle();
      if (!error && data) return ok(res, { campaign: data }, 201);
    }
    const campaign: Campaign = { id: randomUUID(), ...row, user_id: req.userId!, created_at: new Date().toISOString() };
    memCampaigns.unshift(campaign);
    return ok(res, { campaign, seeded: true }, 201);
  }),
);

growRouter.get(
  "/themes",
  asyncHandler(async (_req, res) => {
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_landing_themes").select("*").eq("is_active", true);
      if (!error && data && data.length) return ok(res, { themes: data });
    }
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
    let excludeUserId: string | undefined;
    const token = readBearer(req);
    if (token) {
      try {
        const { data } = await createUserClient(token).auth.getUser(token);
        if (data.user?.id) excludeUserId = data.user.id;
      } catch {
        /* public feed */
      }
    }
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const city = typeof req.query.city === "string" ? req.query.city : "";
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const trade = typeof req.query.trade === "string" ? req.query.trade : "";
    const limit = Number(req.query.limit ?? 12);
    const offset = Number(req.query.offset ?? 0);
    const rows = await listPublicShopFeed({
      q,
      city: city || null,
      category: category || null,
      trade: trade || null,
      limit,
      offset,
      excludeUserId,
    });
    return ok(res, { rows });
  }),
);

growRouter.get(
  "/programs",
  asyncHandler(async (_req, res) => {
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("vendor_programs").select("*").eq("is_active", true).order("created_at", { ascending: false });
      if (!error && data && data.length) return ok(res, { programs: data });
    }
    return ok(res, {
      programs: [
        {
          id: "all-program",
          title: "ALL Program — City partners",
          city: "Pan India",
          trade: "Multi-trade",
          description: "Featured vendors who accept Assan Grow QR walk-ins and share leads.",
          is_active: true,
        },
        {
          id: "gold-shopfront",
          title: "Gold shopfront",
          city: "Delhi NCR",
          trade: "Retail",
          description: "Premium placement on the digital shop catalog.",
          is_active: true,
        },
      ],
    });
  }),
);

growRouter.post(
  "/programs/:id/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const programId = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb
        .from("vendor_program_joins")
        .insert({ program_id: programId, user_id: req.userId })
        .select("*")
        .maybeSingle();
      if (!error) return ok(res, { join: data }, 201);
    }
    const join = { id: randomUUID(), program_id: programId, user_id: req.userId! };
    memJoins.unshift(join);
    return ok(res, { join, seeded: true }, 201);
  }),
);

growRouter.post(
  "/projects/:id/pay",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    let svc: Awaited<ReturnType<typeof pickService>> = null;
    try {
      svc = await pickService("vendor_wallet_recharge");
    } catch {
      svc = null;
    }
    if (!svc?.app_id || !svc.secret_key) {
      return ok(res, {
        paid: false,
        needs_keys: true,
        price_inr: PROJECT_PRICE_INR,
        message: "Add Cashfree App ID & Secret in admin to charge ₹599. Project stays draft until keys exist.",
      });
    }
    const created = await createCashfreeOrder(
      req.userId!,
      { amount_inr: PROJECT_PRICE_INR, purpose: "vendor_wallet_recharge" },
      env.corsOrigin === "*" ? SITE : env.corsOrigin.split(",")[0] ?? SITE,
    );
    if (!created.ok) {
      return ok(res, { paid: false, needs_keys: true, price_inr: PROJECT_PRICE_INR, message: created.error });
    }
    return ok(res, { paid: false, needs_keys: false, price_inr: PROJECT_PRICE_INR, ...created, project_id: id });
  }),
);

growRouter.post(
  "/projects/:id/pay/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const orderId = typeof req.body?.order_id === "string" ? req.body.order_id : "";
    if (!orderId) return fail(res, 400, "order_id required");
    const sb = client();
    if (sb) {
      const { data } = await sb
        .from("qr_projects")
        .update({ is_paid: true })
        .eq("id", id)
        .eq("user_id", req.userId!)
        .select("*")
        .maybeSingle();
      if (data) return ok(res, { project: decorate(data as GrowProject), paid: true });
    }
    const project = memProjects.find((p) => p.id === id && p.user_id === req.userId);
    if (project) project.is_paid = true;
    return ok(res, { paid: true, project: project ? decorate(project) : null, order_id: orderId });
  }),
);

growRouter.delete(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { error } = await sb.from("qr_projects").delete().eq("id", id).eq("user_id", req.userId!);
      if (!error) return ok(res, { deleted: true });
    }
    const idx = memProjects.findIndex((p) => p.id === id && p.user_id === req.userId);
    if (idx >= 0) memProjects.splice(idx, 1);
    return ok(res, { deleted: true, seeded: true });
  }),
);

growRouter.post(
  "/projects/:id/visits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        visitor_name: z.string().min(1).max(120),
        visitor_phone: z.string().max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    if (sb) {
      const { data: project } = await sb
        .from("qr_projects")
        .select("id, slug, share_code")
        .eq("id", id)
        .eq("user_id", req.userId!)
        .maybeSingle();
      if (project) {
        const row = {
          project_id: id,
          project_slug: project.slug,
          code: project.share_code || project.slug,
          kind: "manual",
          source: "grow-app",
          visitor_name: parsed.data.visitor_name,
          visitor_phone: parsed.data.visitor_phone ?? null,
        };
        const { data, error } = await sb.from("shop_visits").insert(row).select("*").maybeSingle();
        if (error || !data) {
          console.error("[visits] insert failed:", error?.message ?? "no row");
          return fail(res, 500, "Visitor save nahi ho paya.");
        }
        return ok(res, { visit: data }, 201);
      }
    }
    return ok(res, {
      visit: {
        id: randomUUID(),
        project_id: id,
        visitor_name: parsed.data.visitor_name,
        visitor_phone: parsed.data.visitor_phone ?? null,
        created_at: new Date().toISOString(),
      },
      seeded: true,
    }, 201);
  }),
);

growRouter.get(
  "/projects/:id/analytics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 7));
    const sb = client();
    let visits: Array<{ created_at?: string; visitor_phone?: string | null }> = [];
    if (sb) {
      const { data: project } = await sb.from("qr_projects").select("id, slug, share_code").eq("id", id).eq("user_id", req.userId!).maybeSingle();
      if (project) {
        const { data } = await sb
          .from("shop_visits")
          .select("created_at, visitor_phone")
          .or(`project_id.eq.${id},project_slug.eq.${project.slug}`)
          .order("created_at", { ascending: false })
          .limit(500);
        visits = (data ?? []) as typeof visits;
      }
    }
    const out = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(base);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const inDay = visits.filter((v) => {
        const t = new Date(v.created_at ?? 0).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      out.push({
        day: start.toISOString().slice(0, 10),
        visitors: inDay.length,
        unique: inDay.length,
        customers: inDay.filter((r) => r.visitor_phone).length,
      });
    }
    return ok(res, {
      days: out,
      totals: {
        visits: visits.length,
        unique: visits.length,
        customers: visits.filter((v) => v.visitor_phone).length,
      },
    });
  }),
);

export const growMem = { memProducts, memOrders, memProjects };
