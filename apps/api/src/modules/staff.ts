import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import { getPool } from "../lib/pg-client.js";
import { createOnboarding, setDuty, staffHome } from "../lib/staff-ops.js";
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
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await createOnboarding(req.userId!, parsed.data);
    if (!result.ok) return fail(res, 400, result.error);
    return ok(res, result, 201);
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
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sid = await myStaffId(req);
    if (!sid) return fail(res, 404, "Staff profile not found");
    const { rows } = await getPool().query(
      `update public.staff_tasks
          set status = $3,
              submitted_at = case when $3 = 'submitted' then now() else submitted_at end,
              proof_urls = coalesce($4::text[], proof_urls)
        where id = $1 and staff_id = $2
        returning id`,
      [req.params.id, sid, parsed.data.status, parsed.data.proof_urls ?? null],
    );
    if (!rows[0]) return fail(res, 404, "Task not found");
    return ok(res, { updated: true });
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
