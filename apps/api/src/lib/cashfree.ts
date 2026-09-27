import { cfBase, createOrder, pickService } from "./payments.js";

export { cfBase, pickService };

export async function createCashfreeOrder(
  userId: string,
  data: { amount_inr: number; purpose: "vendor_wallet_recharge" | "leadx_purchase"; coins?: number },
  appOrigin: string,
) {
  return createOrder(
    userId,
    data.purpose === "leadx_purchase"
      ? { purpose: "coin_purchase", provider: "cashfree", coins: data.coins }
      : { purpose: "wallet_recharge", provider: "cashfree", amount_inr: data.amount_inr },
    appOrigin,
  );
}
