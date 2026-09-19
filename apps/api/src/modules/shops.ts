import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { NearbyShopsSchema, fetchPublicLanding, getNearbyDigitalShops } from "../lib/shops.js";
import { requireAuth } from "../middleware/auth.js";
import { getServiceRoleClient, tryServiceRole } from "../lib/supabase.js";

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
    const payload = await fetchPublicLanding(code, project, kind);
    if (!payload.ok) return fail(res, 404, ("error" in payload ? payload.error : null) ?? "not found", payload);
    return ok(res, payload);
  }),
);

shopsRouter.post(
  "/:code/visit",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "").slice(0, 64);
    if (!code) return fail(res, 400, "code required");
    const parsed = z
      .object({
        kind: z.string().max(8).optional(),
        source: z.string().max(40).optional(),
        visitor_name: z.string().max(80).optional(),
        visitor_phone: z.string().max(15).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = tryServiceRole() ?? getServiceRoleClient();
    const project = typeof req.query.p === "string" ? req.query.p : typeof req.body?.project === "string" ? req.body.project : null;
    const { data, error } = await sb
      .from("shop_visits")
      .insert({ code, project_slug: project, ...parsed.data })
      .select("*")
      .maybeSingle();
    if (!error) {
      const { count } = await sb.from("shop_visits").select("id", { count: "exact", head: true }).eq("code", code);
      return ok(res, { visit: data, visit_count: count ?? 1 });
    }
    const { recordMemVisit } = await import("../lib/memory.js");
    const visit = recordMemVisit({ code, ...parsed.data });
    return ok(res, { visit, visit_count: 1 });
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
        visitor_name: z.string().max(80).optional(),
        visitor_phone: z.string().max(15).optional(),
        items: z
          .array(z.object({ id: z.string().optional(), name: z.string(), price: z.number().optional(), qty: z.number().optional() }))
          .min(1),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const total = parsed.data.items.reduce((s, i) => s + (i.price ?? 0) * (i.qty ?? 1), 0);
    const sb = tryServiceRole();
    let projectId: string | null = null;
    if (sb && parsed.data.project) {
      const bySlug = await sb.from("qr_projects").select("id").eq("slug", parsed.data.project).maybeSingle();
      projectId = bySlug.data?.id ?? null;
    }
    const row = {
      code,
      project_id: projectId,
      visitor_name: parsed.data.visitor_name ?? null,
      visitor_phone: parsed.data.visitor_phone ?? null,
      items: parsed.data.items,
      total_inr: total,
      status: "new",
    };
    if (sb) {
      const { data, error } = await sb.from("shop_orders").insert(row).select("*").maybeSingle();
      if (!error && data) return ok(res, { order: data }, 201);
    }
    const { growMem } = await import("./grow.js");
    const order = { id: randomUUID(), ...row, created_at: new Date().toISOString(), user_id: null };
    growMem.memOrders.unshift(order);
    return ok(res, { order, seeded: true }, 201);
  }),
);
