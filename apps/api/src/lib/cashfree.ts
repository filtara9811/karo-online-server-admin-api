import { z } from "zod";
import { getServiceRoleClient } from "./supabase.js";

type AssignedUse = "vendor_wallet_recharge" | "leadx_purchase";

export const CashfreeCreateSchema = z.object({
  amount_inr: z.number().min(1).max(500000),
  purpose: z.enum(["vendor_wallet_recharge", "leadx_purchase"]),
  coins: z.number().int().min(0).max(100000).optional(),
});

export const CashfreeVerifySchema = z.object({
  order_id: z.string().min(3).max(80),
  purpose: z.enum(["vendor_wallet_recharge", "leadx_purchase"]),
});

async function logSys(status: "success" | "error", message: string, meta: Record<string, unknown> = {}) {
  try {
    const admin = getServiceRoleClient();
    await admin.from("system_logs").insert({
      kind: "payment",
      provider: "cashfree",
      status,
      message: message.slice(0, 500),
      meta,
    });
  } catch {
    /* ignore */
  }
}

export async function pickService(use: AssignedUse) {
  const admin = getServiceRoleClient();
  const exact = await admin
    .from("cashfree_services")
    .select("*")
    .eq("assigned_use", use)
    .eq("is_active", true)
    .not("app_id", "is", null)
    .not("secret_key", "is", null)
    .order("priority")
    .limit(1)
    .maybeSingle();
  if (exact.data && exact.data.app_id && exact.data.secret_key) return exact.data;

  const fallback = await admin
    .from("cashfree_services")
    .select("*")
    .eq("service_key", "payment_gateway")
    .eq("is_active", true)
    .not("app_id", "is", null)
    .not("secret_key", "is", null)
    .limit(1)
    .maybeSingle();
  if (fallback.data && fallback.data.app_id && fallback.data.secret_key) return fallback.data;

  const any = await admin
    .from("cashfree_services")
    .select("*")
    .eq("is_active", true)
    .not("app_id", "is", null)
    .not("secret_key", "is", null)
    .order("priority")
    .limit(1)
    .maybeSingle();
  if (any.data && any.data.app_id && any.data.secret_key) return any.data;

  const purposeMap: Record<AssignedUse, string[]> = {
    vendor_wallet_recharge: ["wallet_recharge", "both"],
    leadx_purchase: ["coin_purchase", "both"],
  };
  const legacy = await admin
    .from("payment_gateways")
    .select("*")
    .eq("provider", "cashfree")
    .eq("is_active", true)
    .in("purpose", purposeMap[use])
    .order("priority")
    .limit(1)
    .maybeSingle();
  const cfg = (legacy.data?.config ?? {}) as { secret_key?: string };
  if (legacy.data && legacy.data.public_key && cfg.secret_key) {
    return {
      app_id: legacy.data.public_key,
      secret_key: cfg.secret_key,
      is_test_mode: !!legacy.data.is_test_mode,
      display_name: legacy.data.display_name ?? "Cashfree",
    };
  }
  return null;
}

export function cfBase(testMode: boolean) {
  return testMode ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg";
}

export async function createCashfreeOrder(
  userId: string,
  data: z.infer<typeof CashfreeCreateSchema>,
  appOrigin: string,
) {
  const admin = getServiceRoleClient();
  let svc: {
    app_id?: string;
    secret_key?: string;
    is_test_mode?: boolean;
    service_key?: string;
  } | null = null;
  try {
    svc = await pickService(data.purpose);
  } catch (e) {
    console.error("[cashfree] pickService threw", e);
  }
  if (!svc || !svc.app_id || !svc.secret_key) {
    await logSys("error", `No active Cashfree service for ${data.purpose}`);
    return {
      ok: false as const,
      error: `Cashfree configured nahi hai. Admin Panel → Cashfree Services me jaayein, "Payment Gateway" row me App ID & Secret Key bharein, Active toggle ON karein, aur Save dabayein.`,
    };
  }

  const { data: vendor } = await admin
    .from("vendors")
    .select("owner_name, email, whatsapp")
    .eq("user_id", userId)
    .maybeSingle();

  const order_id = `KO_${data.purpose === "vendor_wallet_recharge" ? "WAL" : "COIN"}_${Date.now()}_${userId.slice(0, 6)}`;
  const phone = (vendor?.whatsapp ?? "").toString().replace(/\D/g, "").slice(-10) || "9999999999";
  const email = vendor?.email ?? `vendor_${userId.slice(0, 8)}@karoonline.in`;

  try {
    const res = await fetch(`${cfBase(!!svc.is_test_mode)}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": svc.app_id,
        "x-client-secret": svc.secret_key,
      },
      body: JSON.stringify({
        order_id,
        order_amount: data.amount_inr,
        order_currency: "INR",
        customer_details: {
          customer_id: userId,
          customer_email: email,
          customer_phone: phone,
          customer_name: vendor?.owner_name ?? "Vendor",
        },
        order_meta: {
          return_url: `${appOrigin}/vendor/wallet?cf_order_id={order_id}&cf_purpose=${data.purpose}`,
        },
        order_note:
          data.purpose === "vendor_wallet_recharge"
            ? "Wallet Recharge"
            : `LeadX Purchase ${data.coins ?? 0} coins`,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { payment_session_id?: string; message?: string; error?: { description?: string } };
    if (!res.ok || !json.payment_session_id) {
      const msg = json?.message || json?.error?.description || `HTTP ${res.status}`;
      await logSys("error", `Order create failed: ${msg}`, { order_id });
      return { ok: false as const, error: `Cashfree: ${msg}` };
    }

    await admin.from("wallet_transactions").insert({
      vendor_id: userId,
      wallet_kind: data.purpose === "vendor_wallet_recharge" ? "service" : "coin",
      txn_type: data.purpose === "vendor_wallet_recharge" ? "recharge" : "coin_purchase",
      direction: "credit",
      amount_paise: data.purpose === "vendor_wallet_recharge" ? Math.round(data.amount_inr * 100) : 0,
      coins: data.purpose === "leadx_purchase" ? (data.coins ?? 0) : 0,
      status: "pending",
      reference_id: order_id,
      gateway: "cashfree",
      description:
        data.purpose === "vendor_wallet_recharge"
          ? "Cashfree wallet recharge (pending)"
          : "LeadX coin purchase (pending)",
    });

    await logSys("success", `Order created ${order_id}`, { amount: data.amount_inr });
    return {
      ok: true as const,
      order_id,
      payment_session_id: json.payment_session_id,
      mode: svc.is_test_mode ? ("sandbox" as const) : ("production" as const),
    };
  } catch (e) {
    const msg = (e as Error).message;
    await logSys("error", `Network: ${msg}`);
    return { ok: false as const, error: `Network: ${msg}` };
  }
}

export async function verifyCashfreeOrder(
  userId: string,
  data: z.infer<typeof CashfreeVerifySchema>,
) {
  const admin = getServiceRoleClient();
  const svc = await pickService(data.purpose);
  if (!svc || !svc.app_id || !svc.secret_key) {
    return { ok: false as const, error: "Cashfree service inactive" };
  }

  const { data: pending } = await admin
    .from("wallet_transactions")
    .select("*")
    .eq("reference_id", data.order_id)
    .eq("vendor_id", userId)
    .maybeSingle();

  if (pending && pending.status === "success") {
    return { ok: true as const, already: true as const };
  }

  try {
    const res = await fetch(`${cfBase(!!svc.is_test_mode)}/orders/${data.order_id}`, {
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": svc.app_id,
        "x-client-secret": svc.secret_key,
      },
    });
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      order_status?: string;
      order_amount?: number;
    };
    if (!res.ok) {
      return { ok: false as const, error: json?.message || `HTTP ${res.status}` };
    }
    const status = String(json?.order_status ?? "").toUpperCase();
    if (status !== "PAID") {
      return { ok: false as const, error: `Order status: ${status || "UNKNOWN"}` };
    }

    const amountPaise = Math.round(
      Number(json?.order_amount ?? (pending?.amount_paise ? pending.amount_paise / 100 : 0)) * 100,
    );

    await admin
      .from("vendor_wallets")
      .upsert({ vendor_id: userId }, { onConflict: "vendor_id", ignoreDuplicates: true });
    const { data: wallet } = await admin
      .from("vendor_wallets")
      .select("*")
      .eq("vendor_id", userId)
      .maybeSingle();

    if (data.purpose === "vendor_wallet_recharge") {
      const newBal = (wallet?.service_balance_paise ?? 0) + amountPaise;
      const newLifetime = (wallet?.lifetime_recharged_paise ?? 0) + amountPaise;
      await admin
        .from("vendor_wallets")
        .update({
          service_balance_paise: newBal,
          lifetime_recharged_paise: newLifetime,
          updated_at: new Date().toISOString(),
        })
        .eq("vendor_id", userId);

      if (pending) {
        await admin
          .from("wallet_transactions")
          .update({
            status: "success",
            balance_after_paise: newBal,
            description: "Cashfree wallet recharge",
          })
          .eq("id", pending.id);
      }
      await logSys("success", `Wallet credited ₹${amountPaise / 100}`, { order: data.order_id });
      return { ok: true as const, credited_paise: amountPaise };
    }

    const coins = pending?.coins ?? 0;
    const newCoins = (wallet?.leadx_coins ?? 0) + coins;
    const newLifeCoins = (wallet?.lifetime_coins_purchased ?? 0) + coins;
    await admin
      .from("vendor_wallets")
      .update({
        leadx_coins: newCoins,
        lifetime_coins_purchased: newLifeCoins,
        updated_at: new Date().toISOString(),
      })
      .eq("vendor_id", userId);
    if (pending) {
      await admin
        .from("wallet_transactions")
        .update({
          status: "success",
          coin_balance_after: newCoins,
          description: `Bought ${coins} LeadX coins`,
        })
        .eq("id", pending.id);
    }
    await admin
      .from("vendors")
      .update({
        payment_completed: true,
        payment_completed_at: new Date().toISOString(),
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    await logSys("success", `Coins credited ${coins}`, { order: data.order_id });
    return { ok: true as const, credited_coins: coins };
  } catch (e) {
    const msg = (e as Error).message;
    await logSys("error", `Verify failed: ${msg}`);
    return { ok: false as const, error: msg };
  }
}
