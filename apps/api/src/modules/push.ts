import { Router } from "express";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { z } from "zod";
import { hasServiceRole } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { tryServiceRole } from "../lib/supabase.js";
import {
  LeadPushSchema,
  StatusPushSchema,
  TestPushSchema,
  sendLeadPushToVendor,
  sendStatusPushToCustomer,
  sendTestPush,
} from "../lib/push.js";

export const pushRouter = Router();
pushRouter.use(requireAuth);

pushRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ token: z.string().min(8).max(4096), platform: z.string().max(20).optional() }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = tryServiceRole();
    if (!sb) return ok(res, { registered: false, seeded: true });
    const { error } = await sb.from("device_tokens").insert({
      user_id: req.userId,
      token: parsed.data.token,
      platform: parsed.data.platform ?? "android",
      is_active: true,
    });
    if (error && !/duplicate|unique/i.test(error.message)) return fail(res, 400, error.message);
    return ok(res, { registered: true });
  }),
);

pushRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = TestPushSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await sendTestPush(req.userId!, req.userClient!, parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, (result as { reason?: string }).reason ?? "push failed", result);
  }),
);

pushRouter.post(
  "/lead",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = LeadPushSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await sendLeadPushToVendor(req.userId!, req.userClient!, parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, (result as { reason?: string }).reason ?? "push failed", result);
  }),
);

pushRouter.post(
  "/status",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = StatusPushSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await sendStatusPushToCustomer(req.userId!, parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, (result as { reason?: string }).reason ?? "push failed", result);
  }),
);
