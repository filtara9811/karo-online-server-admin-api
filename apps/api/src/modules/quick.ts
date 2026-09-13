import { Router } from "express";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import {
  NearbyOnlineSchema,
  QuickVendorsSchema,
  getNearbyOnlineVendors,
  getQuickCatalog,
  getQuickMapVendors,
} from "../lib/quick.js";

export const quickRouter = Router();

function mergeInput(req: import("express").Request) {
  const q = req.query as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const origin =
    (body.origin as { lat?: number; lng?: number } | undefined) ??
    (q.lat != null && q.lng != null
      ? { lat: Number(q.lat), lng: Number(q.lng) }
      : undefined);
  const itemIds = (body.itemIds as string[] | undefined) ??
    (typeof q.itemIds === "string" ? String(q.itemIds).split(",").filter(Boolean) : undefined);
  return {
    ...q,
    ...body,
    origin: origin ?? body.origin ?? null,
    itemIds,
    radiusKm: body.radiusKm ?? (q.radiusKm != null ? Number(q.radiusKm) : undefined),
    subCategoryId: body.subCategoryId ?? q.subCategoryId ?? null,
  };
}

async function mapVendors(req: import("express").Request, res: import("express").Response) {
  if (!hasServiceRole()) return serviceUnavailable(res);
  const parsed = QuickVendorsSchema.safeParse(mergeInput(req));
  if (!parsed.success) return zodFail(res, parsed.error);
  const result = await getQuickMapVendors(parsed.data);
  return result.ok ? ok(res, result) : fail(res, 400, result.error ?? "lookup failed", result);
}

async function nearby(req: import("express").Request, res: import("express").Response) {
  if (!hasServiceRole()) return serviceUnavailable(res);
  const parsed = NearbyOnlineSchema.safeParse(mergeInput(req));
  if (!parsed.success) return zodFail(res, parsed.error);
  const result = await getNearbyOnlineVendors(parsed.data);
  return result.ok ? ok(res, result) : fail(res, 400, result.error ?? "lookup failed", result);
}

quickRouter.get("/map-vendors", asyncHandler(mapVendors));
quickRouter.post("/map-vendors", asyncHandler(mapVendors));
quickRouter.get("/nearby", asyncHandler(nearby));
quickRouter.post("/nearby", asyncHandler(nearby));

quickRouter.get(
  "/catalog",
  asyncHandler(async (_req, res) => {
    const result = await getQuickCatalog();
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? "catalog failed");
  }),
);

quickRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const result = await getQuickCatalog();
    if (!result.ok) return fail(res, 400, result.error ?? "catalog failed");
    return ok(res, result.categories ?? []);
  }),
);
