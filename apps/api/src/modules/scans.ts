import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { SaveScanSchema, deleteScanHistory, getScanInsights, listScanHistory, saveScanHistory } from "../lib/scans.js";

export const scansRouter = Router();
scansRouter.use(requireAuth);

scansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    return ok(res, { scans: await listScanHistory(req.userClient!) });
  }),
);

scansRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = SaveScanSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await saveScanHistory(req.userClient!, req.userId!, parsed.data));
  }),
);

scansRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse({ ...req.body, ...req.query });
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await deleteScanHistory(req.userClient!, parsed.data.id));
  }),
);

export const adminScanRouter = Router();
adminScanRouter.get(
  "/",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await getScanInsights(req.userClient!, req.userId!));
    } catch (e) {
      const msg = (e as Error).message;
      return fail(res, msg === "Forbidden" ? 403 : 400, msg);
    }
  }),
);
