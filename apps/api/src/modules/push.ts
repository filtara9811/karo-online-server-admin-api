import { Router } from "express";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { z } from "zod";
import { hasServiceRole } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../lib/pg-client.js";
import { withTx } from "../lib/shop.js";
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
    const { token } = parsed.data;
    const platform = parsed.data.platform ?? "android";
    await withTx(async (c) => {
      await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [token]);
      await c.query(`delete from public.device_tokens where token = $1 and user_id <> $2`, [token, req.userId]);
      const { rows } = await c.query(`select id from public.device_tokens where token = $1 and user_id = $2 order by created_at`, [token, req.userId]);
      if (rows.length) {
        await c.query(`update public.device_tokens set is_active = true, platform = $2 where id = $1`, [rows[0].id, platform]);
        if (rows.length > 1) await c.query(`delete from public.device_tokens where id = any($1::uuid[])`, [rows.slice(1).map((r) => r.id)]);
      } else {
        await c.query(`insert into public.device_tokens (user_id, token, platform, is_active) values ($1, $2, $3, true)`, [req.userId, token, platform]);
      }
    });
    return ok(res, { registered: true });
  }),
);

pushRouter.post(
  "/unregister",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ token: z.string().min(8).max(4096) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    await getPool().query(`delete from public.device_tokens where token = $1 and user_id = $2`, [parsed.data.token, req.userId]);
    return ok(res, { unregistered: true });
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
