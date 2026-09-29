import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { NearbyShopsSchema, fetchPublicLanding, getNearbyDigitalShops, resolveLandingProject } from "../lib/shops.js";
import { getPool } from "../lib/pg-client.js";
import { requireAuth } from "../middleware/auth.js";
import { tryServiceRole } from "../lib/supabase.js";
import { recordVendorVisit, vendorIdForCode } from "../lib/vendor-visits.js";

export const shopsRouter = Router();

shopsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z.object({ name: z.string().min(2).max(120), slug: z.string().max(80).optional() }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const slug =
      parsed.data.slug?.trim() ||
      parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
      "shop";
    const sb = tryServiceRole();
    if (sb) {
      const { data, error } = await sb
        .from("digital_shops")
        .upsert({ user_id: req.userId, name: parsed.data.name, slug }, { onConflict: "user_id" })
        .select("*")
        .maybeSingle();
      if (!error) return ok(res, { shop: data }, 201);
    }
    const { createMemShop } = await import("../lib/memory.js");
    const shop = createMemShop(req.userId!, parsed.data.name, slug);
    return ok(res, { shop, seeded: true }, 201);
  }),
);

shopsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sb = tryServiceRole();
    if (sb) {
      const { data, error } = await sb.from("digital_shops").select("*").eq("user_id", req.userId!).maybeSingle();
      if (!error) return ok(res, { shop: data });
    }
    const { getMemShopByUser } = await import("../lib/memory.js");
    return ok(res, { shop: getMemShopByUser(req.userId!), seeded: true });
  }),
);

shopsRouter.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = NearbyShopsSchema.safeParse({
      origin:
        req.query.lat != null && req.query.lng != null
          ? { lat: Number(req.query.lat), lng: Number(req.query.lng) }
          : (req.body as { origin?: unknown })?.origin ?? null,
      radiusKm: req.query.radiusKm != null ? Number(req.query.radiusKm) : (req.body as { radiusKm?: number })?.radiusKm,
    });
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await getNearbyDigitalShops(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error, result);
  }),
);

shopsRouter.get(
  "/:code/landing",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 64);
    if (!code) return fail(res, 400, "code required");
    const project = typeof req.query.p === "string" ? req.query.p : typeof req.query.project === "string" ? req.query.project : null;
    const kind = typeof req.query.kind === "string" ? req.query.kind : "q";
    return ok(res, await fetchPublicLanding(code, project, kind));
  }),
);

const cleanPhone = (p?: string | null) => {
  const d = p?.replace(/\D/g, "").slice(-10) ?? "";
  return d.length === 10 ? d : null;
};
const VisitorPhone = z
  .string()
  .max(15)
  .optional()
  .refine((p) => !p || /^\d{10}$/.test(p.replace(/\D/g, "").slice(-10)), "Enter a 10-digit mobile number");

shopsRouter.post(
  "/:code/visit",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 64);
    if (!code) return fail(res, 400, "code required");
    const parsed = z
      .object({
        kind: z.string().max(8).optional(),
        source: z.string().max(40).optional(),
        project: z.string().max(80).optional(),
        visit_id: z.string().uuid().optional(),
        visitor_name: z.string().trim().max(80).optional(),
        visitor_phone: z.string().max(20).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const d = parsed.data;
    const pool = getPool();
    const projectParam = typeof req.query.p === "string" ? req.query.p : d.project ?? null;
    const proj = await resolveLandingProject(code, projectParam);
    const name = d.visitor_name || null;
    const phone = cleanPhone(d.visitor_phone);

    let visit: Record<string, unknown> | undefined;
    if (d.visit_id && (name || phone)) {
      // The name/mobile gate completes the anonymous scan logged a moment earlier instead of counting a second visit.
      const { rows } = await pool.query(
        `update public.shop_visits set visitor_name = coalesce($2, visitor_name), visitor_phone = coalesce($3, visitor_phone)
          where id = $1 and code = $4 and visitor_phone is null and created_at > now() - interval '1 day' returning *`,
        [d.visit_id, name, phone, code],
      );
      visit = rows[0];
    }
    if (!visit) {
      const { rows } = await pool.query(
        `insert into public.shop_visits (code, kind, source, visitor_name, visitor_phone, project_id, project_slug, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now()) returning *`,
        [code, d.kind ?? null, d.source ?? null, name, phone, proj?.id ?? null, proj?.slug ?? null],
      );
      visit = rows[0];
    }
    if (name || phone || !d.visit_id) {
      const vendorId = proj?.user_id ?? (await vendorIdForCode(code).catch(() => null));
      if (vendorId) {
        await recordVendorVisit({ vendorId, name, phone, source: d.kind === "s" ? "shop" : d.kind === "q" ? "stand" : "qr", code }).catch((err) =>
          console.warn("[visit]", err instanceof Error ? err.message : err),
        );
      }
    }
    const count = phone
      ? await pool.query(
          `select count(*)::int n from public.shop_visits where right(regexp_replace(coalesce(visitor_phone, ''), '\\D', '', 'g'), 10) = $1
             and (project_id is not distinct from $2::uuid) and code = $3`,
          [phone, proj?.id ?? null, code],
        )
      : null;
    return ok(res, { visit, visit_count: Number(count?.rows[0]?.n ?? 1) });
  }),
);

shopsRouter.post(
  "/:code/orders",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 64);
    if (!code) return fail(res, 400, "code required");
    const parsed = z
      .object({
        project: z.string().max(80).optional(),
        visitor_name: z.string().trim().min(1, "Enter your name").max(80),
        visitor_phone: VisitorPhone.refine((p) => !!p, "Enter a 10-digit mobile number"),
        note: z.string().trim().max(500).optional(),
        items: z.array(z.object({ id: z.string().uuid(), qty: z.number().int().min(1).max(99).optional() })).min(1).max(30),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const d = parsed.data;
    const proj = await resolveLandingProject(code, d.project);
    if (!proj) return fail(res, 404, "This shop is not taking orders yet");
    const pool = getPool();
    const { rows: products } = await pool.query(
      `select id, name, price, stock from public.shop_products where project_id = $1 and id = any($2::uuid[]) and coalesce(is_active, true)`,
      [proj.id, d.items.map((i) => i.id)],
    );
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const items = d.items.flatMap((i) => {
      const p = byId.get(i.id);
      return p ? [{ id: p.id, name: p.name, price: Number(p.price ?? 0), qty: i.qty ?? 1 }] : [];
    });
    if (!items.length) return fail(res, 400, "These products are no longer available");
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const { rows } = await pool.query(
      `insert into public.shop_orders (code, project_id, user_id, visitor_name, visitor_phone, items, total_inr, note, status, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'new', now()) returning *`,
      [code, proj.id, proj.user_id, d.visitor_name, cleanPhone(d.visitor_phone), JSON.stringify(items), total, d.note || null],
    );
    return ok(res, { order: rows[0] }, 201);
  }),
);

shopsRouter.post(
  "/:code/inquiry",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 64);
    const parsed = z
      .object({
        project: z.string().max(80).optional(),
        visitor_name: z.string().trim().min(1, "Enter your name").max(80),
        visitor_phone: VisitorPhone.refine((p) => !!p, "Enter a 10-digit mobile number"),
        message: z.string().trim().min(2, "Write your question").max(1000),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const d = parsed.data;
    const proj = await resolveLandingProject(code, d.project);
    if (!proj) return fail(res, 404, "Shop not found");
    const { rows } = await getPool().query(
      `insert into public.shop_orders (code, project_id, user_id, visitor_name, visitor_phone, items, total_inr, note, status, created_at)
       values ($1, $2, $3, $4, $5, '[]'::jsonb, 0, $6, 'inquiry', now()) returning id, status, created_at`,
      [code, proj.id, proj.user_id, d.visitor_name, cleanPhone(d.visitor_phone), d.message],
    );
    return ok(res, { inquiry: rows[0] }, 201);
  }),
);
