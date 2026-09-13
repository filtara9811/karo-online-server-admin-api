import { Router } from "express";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { RazorpayOrderSchema, RazorpayVerifySchema, createRazorpayOrder, verifyRazorpayPayment } from "../lib/payments.js";
import { CashfreeCreateSchema, CashfreeVerifySchema, createCashfreeOrder, verifyCashfreeOrder } from "../lib/cashfree.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post(
  "/razorpay/order",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = RazorpayOrderSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await createRazorpayOrder(req.userId!, parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error, result);
  }),
);

paymentsRouter.post(
  "/razorpay/verify",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = RazorpayVerifySchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await verifyRazorpayPayment(req.userId!, parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error, result);
  }),
);

paymentsRouter.post(
  "/cashfree/order",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = CashfreeCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const origin = (req.headers.origin as string) || `${req.protocol}://${req.get("host")}` || "https://karoonline.in";
    const result = await createCashfreeOrder(req.userId!, parsed.data, origin);
    return result.ok ? ok(res, result) : fail(res, 400, result.error, result);
  }),
);

paymentsRouter.post(
  "/cashfree/verify",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = CashfreeVerifySchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await verifyCashfreeOrder(req.userId!, parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? "verify failed", result);
  }),
);
