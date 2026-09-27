import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { requireAuth } from "../middleware/auth.js";
import {
  CashfreeVerifySchema,
  OrderSchema,
  RazorpayVerifySchema,
  createOrder,
  handleCashfreeWebhook,
  handleRazorpayWebhook,
  pickProvider,
  quote,
  verifyCashfree,
  verifyRazorpay,
} from "../lib/payments.js";

export const paymentsRouter = Router();

const originOf = (req: { headers: Record<string, unknown>; protocol: string; get(h: string): string | undefined }) =>
  (req.headers.origin as string) || `${req.protocol}://${req.get("host")}` || "https://karoonline.in";

// Gateway webhooks are unauthenticated; they are verified by signature.
paymentsRouter.post(
  "/razorpay/webhook",
  asyncHandler(async (req, res) => {
    const r = await handleRazorpayWebhook(req.rawBody ?? JSON.stringify(req.body ?? {}), String(req.headers["x-razorpay-signature"] ?? ""));
    if (!r.ok) return fail(res, r.status, r.error);
    return ok(res, r);
  }),
);

paymentsRouter.post(
  "/cashfree/webhook",
  asyncHandler(async (req, res) => {
    const r = await handleCashfreeWebhook(
      req.rawBody ?? JSON.stringify(req.body ?? {}),
      String(req.headers["x-webhook-signature"] ?? ""),
      String(req.headers["x-webhook-timestamp"] ?? ""),
    );
    if (!r.ok) return fail(res, r.status, r.error);
    return ok(res, r);
  }),
);

paymentsRouter.use(requireAuth);

paymentsRouter.get(
  "/options",
  asyncHandler(async (_req, res) => {
    const [wallet, coins] = await Promise.all([pickProvider("wallet_recharge"), pickProvider("coin_purchase")]);
    return ok(res, { wallet_recharge: wallet, coin_purchase: coins, upi: true });
  }),
);

paymentsRouter.post(
  "/quote",
  asyncHandler(async (req, res) => {
    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const q = await quote(parsed.data);
    if ("error" in q) return fail(res, 400, q.error);
    return ok(res, { quote: q, provider: await pickProvider(q.purpose) });
  }),
);

paymentsRouter.post(
  "/order",
  asyncHandler(async (req, res) => {
    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const r = await createOrder(req.userId!, parsed.data, originOf(req));
    return r.ok ? ok(res, r) : fail(res, 400, r.error, r);
  }),
);

paymentsRouter.post(
  "/razorpay/order",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ amount_inr: z.number().int().min(1).max(500000), purpose: z.enum(["wallet_recharge", "coin_purchase"]), coins: z.number().int().optional(), pack_id: z.string().uuid().optional() })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const r = await createOrder(req.userId!, { ...parsed.data, provider: "razorpay" }, originOf(req));
    return r.ok ? ok(res, r) : fail(res, 400, r.error, r);
  }),
);

paymentsRouter.post(
  "/razorpay/verify",
  asyncHandler(async (req, res) => {
    const parsed = RazorpayVerifySchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const r = await verifyRazorpay(req.userId!, parsed.data);
    return r.ok ? ok(res, r) : fail(res, 400, r.error, r);
  }),
);

paymentsRouter.post(
  "/cashfree/order",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ amount_inr: z.number().min(1).max(500000), purpose: z.enum(["vendor_wallet_recharge", "leadx_purchase"]), coins: z.number().int().optional(), pack_id: z.string().uuid().optional() })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const b = parsed.data;
    const r = await createOrder(
      req.userId!,
      b.purpose === "leadx_purchase"
        ? { purpose: "coin_purchase", provider: "cashfree", coins: b.coins, pack_id: b.pack_id }
        : { purpose: "wallet_recharge", provider: "cashfree", amount_inr: b.amount_inr, pack_id: b.pack_id },
      originOf(req),
    );
    return r.ok ? ok(res, r) : fail(res, 400, r.error, r);
  }),
);

paymentsRouter.post(
  "/cashfree/verify",
  asyncHandler(async (req, res) => {
    const parsed = CashfreeVerifySchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const r = await verifyCashfree(req.userId!, parsed.data);
    return r.ok ? ok(res, r) : fail(res, 400, r.error ?? "Payment not completed", r);
  }),
);
