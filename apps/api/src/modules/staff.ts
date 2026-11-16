import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import { getPool } from "../lib/pg-client.js";
import { addDeskItem, addOnboardingKyc, createOnboarding, decideReview, last10, mapStaffQr, requestQrStock, resolveStaffTicket, setDuty, staffHome, taskWork, testStaffQr } from "../lib/staff-ops.js";
import { sendOtp, verifyOtp } from "../lib/otp.js";
import { getServiceRoleClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const staffRouter = Router();
staffRouter.use(requireAuth);
staffRouter.use((_req, _res, next) => {
  ensureVendorSchema().then(() => next(), next);
});

async function myStaffId(req: import("express").Request): Promise<string | null> {
  const { data } = await req.userClient!.from("staff_profiles").select("id").eq("user_id", req.userId!).maybeSingle();
  return data?.id ?? null;
}

staffRouter.get(
  "/home",
  asyncHandler(async (req, res) => {
    return ok(res, await staffHome(req.userId!));
  }),
);

staffRouter.post(
  "/duty",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const staff = await setDuty(req.userId!, parsed.data.on);
    if (!staff) return fail(res, 404, "Staff profile not found");
    return ok(res, { staff });
  }),
);

staffRouter.post(
  "/vendor-otp/send",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ phone: z.string().min(10).max(16) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const phone = last10(parsed.data.phone);
    if (phone.length !== 10) return fail(res, 400, "Enter a 10-digit mobile number");
    const sent = await sendOtp({ phone, channel: "sms" });
    if (!sent.ok) return fail(res, 400, "error" in sent ? String(sent.error) : "OTP send failed");
    const otpCode = "otp_code" in sent ? sent.otp_code : undefined;
    return ok(res, { sent: true, ...(otpCode ? { otp_code: otpCode } : {}) });
  }),
);

staffRouter.post(
  "/vendor-otp/check",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ phone: z.string().min(10).max(16), code: z.string().min(4).max(8) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const phone = last10(parsed.data.phone);
    const checked = await verifyOtp({ phone, code: parsed.data.code });
    if (!checked.ok) return fail(res, 400, checked.error ?? "Wrong OTP");
    return ok(res, { verified: true });
  }),
);

staffRouter.post(
  "/onboard",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        business_name: z.string().trim().min(2).max(160),
        owner_name: z.string().trim().max(120).optional(),
        phone: z.string().trim().min(10).max(16),
        category: z.string().trim().max(80).optional(),
        address: z.string().trim().max(300).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        source: z.enum(["manual", "ocr", "link"]),
        photo_out_url: z.string().max(1000).optional(),
        photo_in_url: z.string().max(1000).optional(),
        kyc_aadhaar_url: z.string().max(1000).optional(),
        kyc_pan_url: z.string().max(1000).optional(),
        kyc_gst_url: z.string().max(1000).optional(),
        otp_verified: z.boolean().optional(),
        confirm_similar: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await createOnboarding(req.userId!, parsed.data);
    if (!result.ok) return fail(res, 400, result.error);
    return ok(res, result, 201);
  }),
);

staffRouter.post(
  "/onboard/:id/kyc",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = z
      .object({
        kyc_aadhaar_url: z.string().max(1000).optional(),
        kyc_pan_url: z.string().max(1000).optional(),
        kyc_gst_url: z.string().max(1000).optional(),
      })
      .safeParse(req.body);
    if (!id.success || !parsed.success) return fail(res, 400, "Invalid KYC update");
    const result = await addOnboardingKyc(req.userId!, id.data, {
      aadhaar: parsed.data.kyc_aadhaar_url,
      pan: parsed.data.kyc_pan_url,
      gst: parsed.data.kyc_gst_url,
    });
    if (!result.ok) return fail(res, 400, result.error);
    return ok(res, result);
  }),
);

staffRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const { data, error } = await req.userClient!.from("staff_profiles").select("*").eq("user_id", req.userId!).maybeSingle();
    if (error) return fail(res, 400, error.message);
    return ok(res, { staff: data });
  }),
);

staffRouter.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    const sid = await myStaffId(req);
    if (!sid) return ok(res, { tasks: [] });
    const { data, error } = await req.userClient!
      .from("staff_tasks")
      .select("*")
      .eq("staff_id", sid)
      .order("assigned_at", { ascending: false });
    if (error) return fail(res, 400, error.message);
    return ok(res, { tasks: data ?? [] });
  }),
);

staffRouter.post(
  "/tasks/:id/status",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        status: z.enum(["in_progress", "submitted"]),
        proof_urls: z.array(z.string()).optional(),
        result_note: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sid = await myStaffId(req);
    if (!sid) return fail(res, 404, "Staff profile not found");
    if (parsed.data.status === "submitted") {
      const current = await getPool().query(`select task_type, qr_codes, target_count, done_count from public.staff_tasks where id = $1 and staff_id = $2`, [req.params.id, sid]);
      const task = current.rows[0];
      if (task?.task_type === "standee" && !(task.qr_codes?.length > 0)) {
        return fail(res, 400, "Kam se kam 1 QR scan karein");
      }
      if (task && Number(task.target_count) > 0 && Number(task.done_count) < Number(task.target_count)) {
        return fail(res, 400, `Abhi ${task.done_count}/${task.target_count} poora hua hai`);
      }
    }
    const { rows } = await getPool().query(
      `update public.staff_tasks
          set status = $3,
              submitted_at = case when $3 = 'submitted' then now() else submitted_at end,
              proof_urls = coalesce($4::text[], proof_urls),
              result_note = coalesce($5, result_note)
        where id = $1 and staff_id = $2
        returning id`,
      [req.params.id, sid, parsed.data.status, parsed.data.proof_urls ?? null, parsed.data.result_note ?? null],
    );
    if (!rows[0]) return fail(res, 404, "Task not found");
    return ok(res, { updated: true });
  }),
);

staffRouter.post(
  "/tasks/:id/qr",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = z.object({ code: z.string().min(4).max(200) }).safeParse(req.body);
    if (!id.success || !parsed.success) return fail(res, 400, "Invalid QR");
    const result = await mapStaffQr(req.userId!, id.data, parsed.data.code);
    if (!result.ok) return fail(res, 409, result.error);
    return ok(res, result);
  }),
);

staffRouter.post(
  "/tasks/:id/qr-test",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = z.object({ code: z.string().min(4).max(200) }).safeParse(req.body);
    if (!id.success || !parsed.success) return fail(res, 400, "Invalid QR");
    const result = await testStaffQr(req.userId!, id.data, parsed.data.code);
    if (!result.ok) return fail(res, 400, result.error);
    return ok(res, result);
  }),
);

staffRouter.get(
  "/tasks/:id/work",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid task");
    const result = await taskWork(req.userId!, id.data);
    if (!result.ok) return fail(res, 404, result.error);
    return ok(res, result);
  }),
);

staffRouter.post(
  "/tasks/:id/desk",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = z
      .object({
        title: z.string().min(2).max(160),
        parent_name: z.string().max(80).optional(),
        detail: z.string().max(500).optional(),
        status: z.string().max(40).optional(),
      })
      .safeParse(req.body);
    if (!id.success || !parsed.success) return fail(res, 400, "Invalid desk item");
    const result = await addDeskItem(req.userId!, id.data, {
      title: parsed.data.title,
      parentName: parsed.data.parent_name,
      detail: parsed.data.detail,
      status: parsed.data.status,
    });
    if (!result.ok) return fail(res, 400, result.error);
    return ok(res, result, 201);
  }),
);

staffRouter.post(
  "/tasks/:id/reviews/:reviewId",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const reviewId = z.string().uuid().safeParse(req.params.reviewId);
    const parsed = z.object({ hide: z.boolean() }).safeParse(req.body);
    if (!id.success || !reviewId.success || !parsed.success) return fail(res, 400, "Invalid review");
    const result = await decideReview(req.userId!, id.data, reviewId.data, parsed.data.hide);
    if (!result.ok) return fail(res, 400, result.error);
    return ok(res, result);
  }),
);

staffRouter.post(
  "/qr-stock/request",
  asyncHandler(async (req, res) => {
    const result = await requestQrStock(req.userId!);
    if (!result.ok) return fail(res, 404, result.error);
    return ok(res, result, 201);
  }),
);

staffRouter.post(
  "/tickets/:id/resolve",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = z.object({ note: z.string().max(500).optional() }).safeParse(req.body ?? {});
    if (!id.success || !parsed.success) return fail(res, 400, "Invalid ticket");
    const result = await resolveStaffTicket(req.userId!, id.data, parsed.data.note);
    if (!result.ok) return fail(res, 404, result.error);
    return ok(res, result);
  }),
);

staffRouter.get(
  "/wallet",
  asyncHandler(async (req, res) => {
    const sid = await myStaffId(req);
    if (!sid) return ok(res, { wallet: null, ledger: [] });
    const [{ data: wallet }, { data: ledger }] = await Promise.all([
      req.userClient!.from("staff_wallets").select("*").eq("staff_id", sid).maybeSingle(),
      req.userClient!.from("staff_wallet_ledger").select("*").eq("staff_id", sid).order("created_at", { ascending: false }).limit(50),
    ]);
    return ok(res, { wallet: wallet ?? null, ledger: ledger ?? [] });
  }),
);

staffRouter.post(
  "/wallet/withdraw",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ amount_inr: z.number().min(500), upi_id: z.string().min(4).max(80) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sid = await myStaffId(req);
    if (!sid) return fail(res, 404, "Staff profile not found");
    const { data: w } = await req.userClient!.from("staff_wallets").select("balance_inr").eq("staff_id", sid).maybeSingle();
    if (!w || Number(w.balance_inr) < parsed.data.amount_inr) return fail(res, 400, "Insufficient balance");
    const { error } = await req.userClient!.from("staff_withdrawal_requests").insert({
      staff_id: sid,
      amount_inr: parsed.data.amount_inr,
      upi_id: parsed.data.upi_id,
      status: "pending",
    });
    if (error) return fail(res, 400, error.message);
    return ok(res, { requested: true });
  }),
);

staffRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    await ensureVendorSchema();
    const parsed = z
      .object({
        name: z.string().min(2).max(100),
        email: z.string().email(),
        phone: z.string().min(6).max(20).optional(),
        note: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { error } = await req.userClient!.from("staff_signup_requests").insert({
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      note: parsed.data.note ?? null,
      user_id: req.userId,
      status: "pending",
    });
    if (error) return fail(res, 400, error.message);
    return ok(res, { submitted: true });
  }),
);

staffRouter.post(
  "/invite/accept",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = z.object({ token: z.string().min(8).max(64) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const admin = getServiceRoleClient();
    const { data: inv } = await admin.from("staff_invites").select("*").eq("invite_token", parsed.data.token).maybeSingle();
    if (!inv || inv.used_at) return fail(res, 400, "Invite invalid or already used");
    if (new Date(inv.expires_at).getTime() < Date.now()) return fail(res, 400, "Invite expired");
    await admin.from("user_roles").upsert({ user_id: req.userId, role: "staff" }, { onConflict: "user_id,role" });
    await admin.from("staff_profiles").upsert(
      {
        user_id: req.userId,
        name: inv.name,
        email: inv.email ?? null,
        phone: inv.phone,
        payout_model: inv.payout_model,
        monthly_salary_inr: inv.monthly_salary_inr ?? 0,
        staff_status: "active",
        joined_at: new Date().toISOString(),
        approved_by: inv.invited_by,
        approved_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    await admin
      .from("staff_invites")
      .update({ used_at: new Date().toISOString(), staff_user_id: req.userId })
      .eq("id", inv.id);
    return ok(res, { accepted: true });
  }),
);
