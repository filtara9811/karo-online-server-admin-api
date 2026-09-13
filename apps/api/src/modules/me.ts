import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { requireAuth } from "../middleware/auth.js";
import { tryServiceRole } from "../lib/supabase.js";

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
    return ok(res, { customer: data, user: req.authUser });
  }),
);

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(500).optional(),
  gender: z.string().max(40).optional(),
});

meRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = tryServiceRole() ?? req.userClient!;
    const { data, error } = await sb
      .from("customers")
      .upsert({ user_id: req.userId, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
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
    const { claimMemReferral } = await import("../lib/memory.js");
    const row = claimMemReferral(req.userId!, parsed.data.code, (req.authUser?.user_metadata as { name?: string } | undefined)?.name ?? null);
    return ok(res, { referral: row, claimed: true });
  }),
);
