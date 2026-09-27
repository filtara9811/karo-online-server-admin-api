import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { requireAuth } from "../middleware/auth.js";
import { tryServiceRole } from "../lib/supabase.js";
import { listKyc, submitKyc } from "../lib/kyc.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const sb = tryServiceRole() ?? req.userClient!;
    const { data, error } = await sb.from("customers").select("*").eq("user_id", req.userId!).maybeSingle();
    if (error) {
      const { tableMissing } = await import("../lib/memory.js");
      if (tableMissing(error)) {
        return ok(res, {
          customer: {
            user_id: req.userId,
            name: (req.authUser?.user_metadata as { name?: string } | undefined)?.name ?? null,
            phone: (req.authUser?.user_metadata as { phone?: string } | undefined)?.phone ?? null,
            email: req.authUser?.email ?? null,
          },
          user: req.authUser,
          seeded: true,
        });
      }
      return fail(res, 400, error.message);
    }
    const loginPhone = (req.authUser?.user_metadata as { phone?: string } | undefined)?.phone ?? req.authUser?.phone ?? null;
    const customer = data && !data.phone && loginPhone ? { ...data, phone: loginPhone } : data;
    return ok(res, { customer, user: req.authUser });
  }),
);

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  first_name: z.string().trim().min(1).max(60).optional(),
  last_name: z.string().trim().max(60).optional(),
  avatar_url: z.string().max(1000).nullable().optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(500).optional(),
  gender: z.string().max(40).optional(),
});

meRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const body = { ...parsed.data };
    if (body.first_name !== undefined && body.name === undefined) {
      body.name = [body.first_name, body.last_name].filter((s) => s && s.trim()).join(" ");
    }
    const sb = tryServiceRole() ?? req.userClient!;
    const { data, error } = await sb
      .from("customers")
      .upsert({ user_id: req.userId, ...body, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      .select("*")
      .maybeSingle();
    if (error) {
      const { tableMissing } = await import("../lib/memory.js");
      if (tableMissing(error)) return ok(res, { customer: { user_id: req.userId, ...parsed.data }, seeded: true });
      return fail(res, 400, error.message);
    }
    return ok(res, { customer: data });
  }),
);

meRouter.get(
  "/referrals",
  asyncHandler(async (req, res) => {
    const sb = tryServiceRole() ?? req.userClient!;
    const { data, error } = await sb.from("referrals").select("*").eq("referrer_id", req.userId!).order("created_at", { ascending: false });
    if (error) {
      const { tableMissing, listMemReferrals } = await import("../lib/memory.js");
      if (tableMissing(error)) {
        const rows = listMemReferrals(req.userId!);
        return ok(res, {
          referrals: rows,
          earned: rows.reduce((s, r) => s + (r.reward ?? 0), 0),
          pending: rows.filter((r) => !r.reward).length,
          seeded: true,
        });
      }
      return fail(res, 400, error.message);
    }
    const rows = data ?? [];
    return ok(res, {
      referrals: rows,
      earned: rows.reduce((s, r) => s + Number((r as { reward?: number }).reward ?? 0), 0),
      pending: rows.filter((r) => !Number((r as { reward?: number }).reward)).length,
    });
  }),
);

meRouter.post(
  "/referrals/claim",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ code: z.string().min(3).max(40) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = tryServiceRole() ?? req.userClient!;
    const name = (req.authUser?.user_metadata as { name?: string } | undefined)?.name ?? null;
    const { data, error } = await sb
      .from("referrals")
      .insert({
        referrer_id: req.userId,
        referred_user_id: req.userId,
        code: parsed.data.code.toUpperCase(),
        name,
        status: "Joined",
        reward: 200,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      const { tableMissing, claimMemReferral } = await import("../lib/memory.js");
      if (tableMissing(error)) {
        const row = claimMemReferral(req.userId!, parsed.data.code, name);
        return ok(res, { referral: row, claimed: true, seeded: true });
      }
      return fail(res, 400, error.message);
    }
    return ok(res, { referral: data, claimed: true });
  }),
);

meRouter.get(
  "/wallet",
  asyncHandler(async (req, res) => {
    const sb = tryServiceRole() ?? req.userClient!;
    const { data, error } = await sb.from("customer_wallets").select("*").eq("user_id", req.userId!).maybeSingle();
    if (error) return ok(res, { wallet: { user_id: req.userId, balance_inr: 0 }, transactions: [] });
    const { data: tx } = await sb
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(25);
    return ok(res, { wallet: data ?? { user_id: req.userId, balance_inr: 0 }, transactions: tx ?? [] });
  }),
);

meRouter.post(
  "/kyc",
  asyncHandler(async (req, res) => {
    const r = await submitKyc(req.userId!, "customer", req.body);
    if (!r.ok) return r.zod ? zodFail(res, r.zod) : fail(res, r.status, r.message, r.code ? { code: r.code } : undefined);
    return ok(res, { check: r.check }, 201);
  }),
);

meRouter.get(
  "/kyc",
  asyncHandler(async (req, res) => {
    const checks = await listKyc(req.userId!, "customer");
    return ok(res, { checks, rows: checks });
  }),
);

meRouter.post(
  "/withdraw",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ amount_inr: z.number().min(1), upi_id: z.string().min(4).max(80) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = tryServiceRole() ?? req.userClient!;
    const { data: kyc } = await sb.from("kyc_verifications").select("id").eq("user_id", req.userId!).eq("status", "approved").limit(1);
    if (!kyc?.length) return fail(res, 400, "KYC approval required before withdraw");
    const { data: wallet } = await sb.from("customer_wallets").select("balance_inr").eq("user_id", req.userId!).maybeSingle();
    if (!wallet || Number(wallet.balance_inr) < parsed.data.amount_inr) return fail(res, 400, "Insufficient balance");
    const { data, error } = await sb
      .from("withdrawal_requests")
      .insert({ user_id: req.userId, amount_inr: parsed.data.amount_inr, upi_id: parsed.data.upi_id, status: "pending" })
      .select("*")
      .maybeSingle();
    if (error) return fail(res, 400, error.message);
    return ok(res, { request: data }, 201);
  }),
);

meRouter.post(
  "/presence",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { ensureVendorSchema } = await import("../lib/apply-vendor-schema.js");
    const { getPool } = await import("../lib/pg-client.js");
    await ensureVendorSchema();
    const pool = getPool();
    const r = await pool.query(
      `update public.customers set last_lat = $2, last_lng = $3, last_seen_at = now() where user_id = $1`,
      [req.userId, parsed.data.lat, parsed.data.lng],
    );
    if (!r.rowCount) {
      await pool.query(
        `insert into public.customers (user_id, last_lat, last_lng, last_seen_at) values ($1, $2, $3, now())`,
        [req.userId, parsed.data.lat, parsed.data.lng],
      ).catch(() => {});
    }
    return ok(res, { saved: true });
  }),
);
