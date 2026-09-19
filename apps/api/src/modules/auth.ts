import { Router } from "express";
import { z } from "zod";
import { hasDatabase, hasServiceRole } from "../config/env.js";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import {
  FinalizeCustomerSchema,
  PhoneSchema,
  SendOtpSchema,
  VerifySchema,
  checkTestAccountPhone,
  finalizeCustomerRegistration,
  sendOtp,
  verifyOtp,
} from "../lib/otp.js";
import { createAnonClient, getServiceRoleClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { ADMIN_ROLES } from "../middleware/admin.js";

export const authRouter = Router();

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

authRouter.post(
  "/admin-login",
  asyncHandler(async (req, res) => {
    if (!hasDatabase()) return fail(res, 503, "DATABASE_URL missing — DigitalOcean Postgres is required");
    const parsed = AdminLoginSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = createAnonClient();
    const { data, error } = await sb.auth.signInWithPassword(parsed.data);
    if (error || !data.session) {
      return fail(res, 401, error?.message || "Login failed");
    }
    return ok(res, {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at,
        token_type: data.session.token_type,
      },
      user: { id: data.user?.id, email: data.user?.email },
    });
  }),
);

authRouter.post(
  "/admin-signup",
  asyncHandler(async (req, res) => {
    if (!hasDatabase()) return fail(res, 503, "DATABASE_URL missing — DigitalOcean Postgres is required");
    const parsed = AdminLoginSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const admin = getServiceRoleClient();
    const created = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { requested_admin: true },
    });
    if (created.error || !created.data.user) {
      const msg = created.error?.message || "Signup failed";
      if (/already registered/i.test(msg)) {
        return fail(res, 409, "Is email pe account pehle se hai. Sign in kariye.");
      }
      return fail(res, 400, msg);
    }
    return ok(res, { user: { id: created.data.user.id, email: parsed.data.email } });
  }),
);

authRouter.post(
  "/forgot-password",
  asyncHandler(async (_req, res) => {
    return ok(res, {
      message:
        "Email delivery DigitalOcean par configured nahi hai. Login karke Profile se password change kariye, ya Super Admin se reset karwayein.",
    });
  }),
);

const AccountPatchSchema = z.object({
  current_password: z.string().min(6).max(200),
  password: z.string().min(6).max(200).optional(),
  email: z.string().email().optional(),
});

authRouter.patch(
  "/account",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!hasDatabase()) return fail(res, 503, "DATABASE_URL missing — DigitalOcean Postgres is required");
    const parsed = AccountPatchSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    if (!parsed.data.password && !parsed.data.email) {
      return fail(res, 400, "Email ya naya password daaliye.");
    }
    const email = String(req.authUser?.email ?? "");
    if (!email) return fail(res, 400, "Account email missing.");
    const admin = getServiceRoleClient();
    const { error: signErr } = await admin.auth.signInWithPassword({
      email,
      password: parsed.data.current_password,
    });
    if (signErr) return fail(res, 401, "Current password galat hai.");
    const { data, error } = await admin.auth.admin.updateUserById(req.userId!, {
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user) return fail(res, 400, error?.message || "Update failed");
    return ok(res, { user: { id: data.user.id, email: data.user.email ?? parsed.data.email ?? email } });
  }),
);

function needService(res: import("express").Response) {
  if (hasServiceRole()) return false;
  serviceUnavailable(res);
  return true;
}

authRouter.post(
  "/otp/check-test",
  asyncHandler(async (req, res) => {
    const parsed = PhoneSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await checkTestAccountPhone(parsed.data.phone));
  }),
);

authRouter.post(
  "/otp/send",
  asyncHandler(async (req, res) => {
    const parsed = SendOtpSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await sendOtp(parsed.data);
    const sendError = "error" in result ? String(result.error ?? "OTP send failed") : "OTP send failed";
    return result.ok ? ok(res, result) : fail(res, 400, sendError, result);
  }),
);

authRouter.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await verifyOtp(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? "OTP verify failed", result);
  }),
);

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    if (needService(res)) return;
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const composedName =
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name
        : `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim();
    const parsed = FinalizeCustomerSchema.safeParse({ ...raw, name: composedName });
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await finalizeCustomerRegistration(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? "Registration failed", result);
  }),
);

authRouter.get(
  "/activation-fee",
  asyncHandler(async (req, res) => {
    const referralCode = typeof req.query.referralCode === "string" ? req.query.referralCode : null;
    return ok(res, {
      amount: 49,
      currency: "INR",
      tier: "starter",
      promoter_code: referralCode,
    });
  }),
);

const DeviceRegisterSchema = z.object({
  fingerprint: z.string().min(8),
  phone: z.string().min(10),
  panel: z.enum(["customer", "vendor", "staff", "admin"]).optional().default("customer"),
  user_agent: z.string().max(500).optional(),
});

authRouter.post(
  "/device/register",
  asyncHandler(async (req, res) => {
    if (needService(res)) return;
    const parsed = DeviceRegisterSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const data = parsed.data;
    if (data.panel === "staff" || data.panel === "admin") {
      return ok(res, { conflict: false, bypassed: true });
    }
    const admin = getServiceRoleClient();
    const { data: existing } = await admin
      .from("device_fingerprints")
      .select("id, phone")
      .eq("fingerprint", data.fingerprint)
      .eq("panel", data.panel)
      .is("unlocked_at", null)
      .maybeSingle();

    if (existing && existing.phone !== data.phone) {
      return fail(res, 409, "Device already bound to another phone", {
        conflict: true,
        bypassed: false,
        locked_to: existing.phone,
      });
    }

    if (!existing) {
      const { error } = await admin.from("device_fingerprints").insert({
        fingerprint: data.fingerprint,
        phone: data.phone,
        panel: data.panel,
        user_agent: data.user_agent ?? null,
      });
      if (error) return fail(res, 400, error.message, { conflict: false, bypassed: false });
    } else {
      await admin
        .from("device_fingerprints")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return ok(res, { conflict: false, bypassed: false });
  }),
);

const UnlockSchema = z.object({
  phone: z.string().min(10),
  panel: z.string().optional(),
  reason: z.string().max(500).optional(),
});

authRouter.post(
  "/device/unlock",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (needService(res)) return;
    const parsed = UnlockSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const admin = getServiceRoleClient();
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", req.userId!);
    const isAdmin = (roles ?? []).some((r) => ADMIN_ROLES.has(String(r.role)) || ["admin", "super_admin"].includes(String(r.role)));
    if (!isAdmin) return fail(res, 403, "Forbidden: admin role required");

    let q = admin
      .from("device_fingerprints")
      .update({
        unlocked_at: new Date().toISOString(),
        unlocked_by: req.userId,
        unlock_reason: parsed.data.reason ?? null,
      })
      .eq("phone", parsed.data.phone)
      .is("unlocked_at", null);
    if (parsed.data.panel) q = q.eq("panel", parsed.data.panel);
    const { data: updated, error } = await q.select("id, fingerprint, panel");
    if (error) return fail(res, 400, error.message);

    await admin.from("device_unlock_audit").insert({
      phone: parsed.data.phone,
      panel: parsed.data.panel ?? null,
      fingerprint: updated?.[0]?.fingerprint ?? null,
      unlocked_by: req.userId,
      reason: parsed.data.reason ?? null,
      rows_affected: updated?.length ?? 0,
    });
    return ok(res, { unlocked: updated?.length ?? 0 });
  }),
);
