import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { readBearer } from "../middleware/auth.js";
import { getServiceRoleClient } from "../lib/supabase.js";
import { recordVendorVisit, vendorIdForCode } from "../lib/vendor-visits.js";

export const visitsRouter = Router();

async function optionalUserId(req: Request): Promise<string | null> {
  const token = readBearer(req);
  if (!token) return null;
  const { data } = await getServiceRoleClient().auth.getUser(token);
  return data.user?.id ?? null;
}

const VisitSchema = z
  .object({
    vendor_id: z.string().uuid().optional(),
    code: z.string().trim().min(1).max(64).optional(),
    source: z.enum(["qr", "shop", "lead", "profile", "stand", "card", "poster", "referral", "direct"]).default("profile"),
    visitor_name: z.string().trim().max(80).optional(),
    visitor_phone: z.string().trim().max(15).optional(),
  })
  .refine((b) => b.vendor_id || b.code, { message: "vendor_id or code required" });

visitsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = VisitSchema.safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const b = parsed.data;
    const vendorId = b.vendor_id ?? (b.code ? await vendorIdForCode(b.code) : null);
    if (!vendorId) return fail(res, 404, "Vendor not found");
    const userId = await optionalUserId(req);
    const visit = await recordVendorVisit({
      vendorId,
      userId,
      name: b.visitor_name,
      phone: b.visitor_phone,
      source: b.source,
      code: b.code ?? null,
    });
    return ok(res, { recorded: Boolean(visit) }, 201);
  }),
);
