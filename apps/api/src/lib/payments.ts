import { createHmac, timingSafeEqual } from "crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ensureVendorSchema } from "./apply-vendor-schema.js";
import { getPool } from "./pg-client.js";

export type Purpose = "wallet_recharge" | "coin_purchase";
export type Provider = "razorpay" | "cashfree";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function logSystem(provider: string | null, status: "success" | "error", message: string, meta: Record<string, unknown> = {}) {
  try {
    await getPool().query(
      `insert into public.system_logs (kind, provider, status, message, meta) values ('payment', $1, $2, $3, $4::jsonb)`,
      [provider, status, message.slice(0, 500), JSON.stringify(meta)],
    );
  } catch (e) {
    console.error("[system_logs] failed", e);
  }
}

// ── Gateways ────────────────────────────────────────────────────────────────

type RazorpayCfg = { key_id: string; secret: string; webhook_secret?: string; test: boolean };
type CashfreeCfg = { app_id: string; secret_key: string; test: boolean };

export async function razorpayConfig(purpose?: Purpose): Promise<RazorpayCfg | null> {
  const { rows } = await getPool().query(
    `select public_key, config, is_test_mode from public.payment_gateways
      where provider = 'razorpay' and is_active and ($1::text is null or purpose in ($1, 'both'))
      order by priority nulls last limit 1`,
    [purpose ?? null],
  );
  const g = rows[0];
  const secret = String(g?.config?.secret_key ?? "").trim();
  const keyId = String(g?.public_key ?? "").trim();
  if (!keyId || !secret) return null;
  return { key_id: keyId, secret, webhook_secret: String(g.config?.webhook_secret ?? "").trim() || undefined, test: !!g.is_test_mode };
}

export async function cashfreeConfig(purpose?: Purpose): Promise<CashfreeCfg | null> {
  const use = purpose === "coin_purchase" ? "leadx_purchase" : purpose ? "vendor_wallet_recharge" : null;
  const svc = await getPool().query(
    `select app_id, secret_key, is_test_mode from public.cashfree_services
      where is_active and app_id is not null and secret_key is not null
      order by (config->>'assigned_use' = $1) desc nulls last, priority nulls last limit 1`,
    [use],
  );
  if (svc.rows[0]) return { app_id: svc.rows[0].app_id, secret_key: svc.rows[0].secret_key, test: !!svc.rows[0].is_test_mode };
  const legacy = await getPool().query(
    `select public_key, config, is_test_mode from public.payment_gateways
      where provider = 'cashfree' and is_active and ($1::text is null or purpose in ($1, 'both'))
      order by priority nulls last limit 1`,
    [purpose ?? null],
  );
  const g = legacy.rows[0];
  const secret = String(g?.config?.secret_key ?? "").trim();
  if (!g?.public_key || !secret) return null;
  return { app_id: String(g.public_key).trim(), secret_key: secret, test: !!g.is_test_mode };
}

/** Service wallet prefers Razorpay and coins prefer Cashfree, like the website; falls back to whichever is set up. */
export async function pickProvider(purpose: Purpose): Promise<Provider | null> {
  const [rzp, cf] = await Promise.all([razorpayConfig(purpose), cashfreeConfig(purpose)]);
  const order: Provider[] = purpose === "wallet_recharge" ? ["razorpay", "cashfree"] : ["cashfree", "razorpay"];
  return order.find((p) => (p === "razorpay" ? rzp : cf)) ?? null;
}

/** Kept for grow.ts, which only needs to know whether Cashfree keys exist. */
export async function pickService(_use?: string) {
  return cashfreeConfig();
}

export function cfBase(testMode: boolean) {
  return testMode ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg";
}

// ── Pricing ─────────────────────────────────────────────────────────────────

export const OrderSchema = z.object({
  purpose: z.enum(["wallet_recharge", "coin_purchase"]),
  provider: z.enum(["razorpay", "cashfree"]).optional(),
  pack_id: z.string().uuid().optional(),
  coins: z.number().int().min(1).max(100000).optional(),
  amount_inr: z.number().min(1).max(500000).optional(),
});
type OrderInput = z.infer<typeof OrderSchema>;

export type Quote = {
  purpose: Purpose;
  label: string;
  base_inr: number;
  gst_percent: number;
  gst_inr: number;
  amount_inr: number;
  coins: number;
  credit_inr: number;
  pack_id: string | null;
};

export async function quote(input: OrderInput): Promise<Quote | { error: string }> {
  await ensureVendorSchema();
  const pool = getPool();
  if (input.purpose === "coin_purchase") {
    const { rows: cfgRows } = await pool.query(
      `select coin_rate_inr, min_purchase_coins, max_purchase_coins, gst_percent from public.coin_pricing_config
        order by updated_at desc nulls last limit 1`,
    );
    const cfg = cfgRows[0] ?? {};
    const gst = Number(cfg.gst_percent ?? 0);
    let coins: number;
    let base: number;
    let label: string;
    if (input.pack_id) {
      const { rows } = await pool.query(`select * from public.coin_packs where id = $1 and coalesce(is_active, true)`, [input.pack_id]);
      if (!rows[0]) return { error: "This coin pack is no longer available" };
      coins = Number(rows[0].coins ?? 0) + Number(rows[0].bonus_coins ?? 0);
      base = Number(rows[0].price_inr ?? 0);
      label = `${rows[0].pack_name ?? "Coin pack"} · ${coins} LeadX`;
    } else {
      coins = input.coins ?? 0;
      const min = Number(cfg.min_purchase_coins ?? 1);
      const max = Number(cfg.max_purchase_coins ?? 100000);
      if (coins < min || coins > max) return { error: `Buy between ${min} and ${max} coins` };
      base = round2(coins * Number(cfg.coin_rate_inr ?? 1));
      label = `${coins} LeadX coins`;
    }
    if (coins <= 0 || base <= 0) return { error: "Invalid coin pack" };
    const gstInr = round2((base * gst) / 100);
    return { purpose: "coin_purchase", label, base_inr: base, gst_percent: gst, gst_inr: gstInr, amount_inr: round2(base + gstInr), coins, credit_inr: 0, pack_id: input.pack_id ?? null };
  }

  if (input.pack_id) {
    const { rows } = await pool.query(`select * from public.wallet_recharge_packs where id = $1 and coalesce(is_active, true)`, [input.pack_id]);
    if (!rows[0]) return { error: "This recharge pack is no longer available" };
    const amt = Number(rows[0].amount_inr);
    const bonus = Number(rows[0].bonus_inr ?? 0);
    return { purpose: "wallet_recharge", label: rows[0].label ?? `₹${amt} recharge`, base_inr: amt, gst_percent: 0, gst_inr: 0, amount_inr: amt, coins: 0, credit_inr: amt + bonus, pack_id: rows[0].id };
  }
  const amt = Math.round(input.amount_inr ?? 0);
  if (amt < 1) return { error: "Enter an amount" };
  return { purpose: "wallet_recharge", label: `₹${amt} wallet recharge`, base_inr: amt, gst_percent: 0, gst_inr: 0, amount_inr: amt, coins: 0, credit_inr: amt, pack_id: null };
}

// ── Orders ──────────────────────────────────────────────────────────────────

async function insertPending(userId: string, provider: Provider, ref: string, q: Quote) {
  await getPool().query(
    `insert into public.wallet_transactions (vendor_id, user_id, amount_inr, kind, purpose, provider, ref, direction, coins, description, wallet_kind, status, metadata)
     values ($1, $1, $2, 'credit', $3, $4, $5, 'credit', $6, $7, $8, 'pending', $9::jsonb)`,
    [
      userId,
      q.purpose === "coin_purchase" ? q.amount_inr : q.credit_inr,
      q.purpose === "coin_purchase" ? "leadx_purchase" : "wallet_recharge",
      provider,
      ref,
      q.coins || null,
      `${q.label} (pending)`,
      q.purpose === "coin_purchase" ? "leadx" : "service",
      JSON.stringify({ quote: q }),
    ],
  );
}

export async function createOrder(userId: string, input: OrderInput, appOrigin: string) {
  const q = await quote(input);
  if ("error" in q) return { ok: false as const, error: q.error };
  const provider = input.provider ?? (await pickProvider(q.purpose));
  if (!provider) {
    await logSystem(null, "error", `No active payment gateway for ${q.purpose}`);
    return { ok: false as const, error: "Online payment is not set up yet. Pay by UPI instead.", no_gateway: true };
  }
  const paise = Math.round(q.amount_inr * 100);

  if (provider === "razorpay") {
    const cfg = await razorpayConfig(q.purpose);
    if (!cfg) return { ok: false as const, error: "Razorpay is not set up", no_gateway: true };
    try {
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.key_id}:${cfg.secret}`).toString("base64")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: paise,
          currency: "INR",
          receipt: `r_${Date.now().toString(36)}_${userId.slice(0, 6)}`,
          notes: { user_id: userId, purpose: q.purpose, coins: String(q.coins) },
        }),
      });
      const json = (await r.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
      if (!r.ok || !json.id) {
        const msg = json.error?.description ?? `HTTP ${r.status}`;
        await logSystem("razorpay", "error", `Order create failed: ${msg}`);
        return { ok: false as const, error: `Razorpay: ${msg}` };
      }
      await insertPending(userId, "razorpay", json.id, q);
      await logSystem("razorpay", "success", `Order created ${json.id}`, { amount: q.amount_inr, purpose: q.purpose });
      return { ok: true as const, provider, order_id: json.id, key_id: cfg.key_id, amount_paise: paise, currency: "INR", is_test_mode: cfg.test, quote: q };
    } catch (e) {
      await logSystem("razorpay", "error", `Network: ${(e as Error).message}`);
      return { ok: false as const, error: `Network error: ${(e as Error).message}` };
    }
  }

  const cfg = await cashfreeConfig(q.purpose);
  if (!cfg) return { ok: false as const, error: "Cashfree is not set up", no_gateway: true };
  const { rows: vr } = await getPool().query(`select owner_name, email, whatsapp from public.vendors where user_id = $1`, [userId]);
  const v = vr[0] ?? {};
  const orderId = `KO_${q.purpose === "coin_purchase" ? "COIN" : "WAL"}_${Date.now()}_${userId.slice(0, 6)}`;
  try {
    const r = await fetch(`${cfBase(cfg.test)}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-version": "2023-08-01", "x-client-id": cfg.app_id, "x-client-secret": cfg.secret_key },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: q.amount_inr,
        order_currency: "INR",
        customer_details: {
          customer_id: userId,
          customer_email: v.email ?? `vendor_${userId.slice(0, 8)}@karoonline.in`,
          customer_phone: String(v.whatsapp ?? "").replace(/\D/g, "").slice(-10) || "9999999999",
          customer_name: v.owner_name ?? "Vendor",
        },
        order_meta: { return_url: `${appOrigin}/vendor/wallet?cf_order_id={order_id}&cf_purpose=${q.purpose}` },
        order_note: q.label,
      }),
    });
    const json = (await r.json().catch(() => ({}))) as { payment_session_id?: string; message?: string };
    if (!r.ok || !json.payment_session_id) {
      const msg = json.message || `HTTP ${r.status}`;
      await logSystem("cashfree", "error", `Order create failed: ${msg}`, { order_id: orderId });
      return { ok: false as const, error: `Cashfree: ${msg}` };
    }
    await insertPending(userId, "cashfree", orderId, q);
    await logSystem("cashfree", "success", `Order created ${orderId}`, { amount: q.amount_inr });
    return { ok: true as const, provider, order_id: orderId, payment_session_id: json.payment_session_id, mode: cfg.test ? ("sandbox" as const) : ("production" as const), quote: q };
  } catch (e) {
    await logSystem("cashfree", "error", `Network: ${(e as Error).message}`);
    return { ok: false as const, error: `Network: ${(e as Error).message}` };
  }
}

// ── Settlement ──────────────────────────────────────────────────────────────

/** Credits a pending gateway transaction exactly once. Safe to call from verify and webhooks concurrently. */
export async function settle(
  sel: { provider: Provider; ref: string } | { id: string },
  paidInr: number | null,
  extra: Record<string, unknown> = {},
) {
  const provider = "id" in sel ? "upi" : sel.provider;
  const ref = "id" in sel ? sel.id : sel.ref;
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } =
      "id" in sel
        ? await client.query(`select * from public.wallet_transactions where id = $1 and kind = 'credit' for update`, [sel.id])
        : await client.query(`select * from public.wallet_transactions where provider = $1 and ref = $2 for update`, [sel.provider, sel.ref]);
    const t = rows[0];
    if (!t) {
      await client.query("rollback");
      return { ok: false as const, error: "Unknown order" };
    }
    if (t.status === "success") {
      await client.query("rollback");
      return { ok: true as const, already: true, transaction_id: t.id };
    }
    const q = (t.metadata?.quote ?? {}) as Partial<Quote>;
    if (paidInr != null && q.amount_inr != null && paidInr + 0.01 < Number(q.amount_inr)) {
      await client.query(`update public.wallet_transactions set status = 'failed', metadata = metadata || $2::jsonb where id = $1`, [
        t.id,
        JSON.stringify({ ...extra, failure: `paid ${paidInr} < ${q.amount_inr}` }),
      ]);
      await client.query("commit");
      await logSystem(provider, "error", `Amount mismatch on ${ref}`, { paidInr, expected: q.amount_inr });
      return { ok: false as const, error: "Paid amount does not match the order" };
    }
    const vendorId = t.vendor_id as string;
    await client.query(`insert into public.vendor_wallets (vendor_id) values ($1) on conflict (vendor_id) do nothing`, [vendorId]);
    let wallet;
    if (t.wallet_kind === "leadx") {
      const coins = Number(t.coins ?? 0);
      wallet = await client.query(
        `update public.vendor_wallets
            set leadx_coins = coalesce(leadx_coins, 0) + $2,
                lifetime_coins_purchased = coalesce(lifetime_coins_purchased, 0) + $2,
                lifetime_recharged_inr = coalesce(lifetime_recharged_inr, 0) + $3,
                updated_at = now()
          where vendor_id = $1 returning leadx_coins, balance_inr`,
        [vendorId, coins, Number(q.amount_inr ?? t.amount_inr ?? 0)],
      );
      await client.query(
        `update public.vendors set payment_completed = true,
                status = case when status in ('pending', 'draft') or status is null then 'active' else status end,
                updated_at = now()
          where user_id = $1`,
        [vendorId],
      );
    } else {
      wallet = await client.query(
        `update public.vendor_wallets
            set balance_inr = coalesce(balance_inr, 0) + $2,
                lifetime_recharged_inr = coalesce(lifetime_recharged_inr, 0) + $3,
                updated_at = now()
          where vendor_id = $1 returning leadx_coins, balance_inr`,
        [vendorId, Number(t.amount_inr ?? 0), Number(q.amount_inr ?? t.amount_inr ?? 0)],
      );
    }
    await client.query(
      `update public.wallet_transactions
          set status = 'success', description = $2,
              metadata = metadata || $3::jsonb
        where id = $1`,
      [t.id, String(t.description ?? "").replace(/ \(pending\)$/, ""), JSON.stringify({ ...extra, balance_after: wallet.rows[0] })],
    );
    await client.query("commit");
    await logSystem(provider, "success", `Credited ${ref}`, { vendorId, coins: t.coins, amount: t.amount_inr });
    return { ok: true as const, credited_coins: Number(t.coins ?? 0), credited_inr: t.wallet_kind === "service" ? Number(t.amount_inr) : 0, wallet: wallet.rows[0] };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function ownsOrder(userId: string, provider: Provider, ref: string) {
  const { rows } = await getPool().query(
    `select metadata from public.wallet_transactions where provider = $1 and ref = $2 and vendor_id = $3`,
    [provider, ref, userId],
  );
  return rows[0] ?? null;
}

export const RazorpayVerifySchema = z.object({
  razorpay_order_id: z.string().min(5).max(100),
  razorpay_payment_id: z.string().min(5).max(100),
  razorpay_signature: z.string().min(10).max(200),
});

export async function verifyRazorpay(userId: string, data: z.infer<typeof RazorpayVerifySchema>) {
  const row = await ownsOrder(userId, "razorpay", data.razorpay_order_id);
  if (!row) return { ok: false as const, error: "Unknown order" };
  const cfg = await razorpayConfig(row.metadata?.quote?.purpose);
  if (!cfg) return { ok: false as const, error: "Razorpay is not set up" };
  const expected = createHmac("sha256", cfg.secret).update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`).digest("hex");
  if (!safeEqual(expected, data.razorpay_signature)) {
    await logSystem("razorpay", "error", "Signature mismatch", { order: data.razorpay_order_id });
    return { ok: false as const, error: "Signature verification failed" };
  }
  return settle({ provider: "razorpay", ref: data.razorpay_order_id }, null, { payment_id: data.razorpay_payment_id });
}

export const CashfreeVerifySchema = z.object({ order_id: z.string().min(3).max(80) });

async function cashfreeOrderStatus(orderId: string, purpose?: Purpose) {
  const cfg = await cashfreeConfig(purpose);
  if (!cfg) return { error: "Cashfree is not set up" };
  const r = await fetch(`${cfBase(cfg.test)}/orders/${encodeURIComponent(orderId)}`, {
    headers: { "x-api-version": "2023-08-01", "x-client-id": cfg.app_id, "x-client-secret": cfg.secret_key },
  });
  const json = (await r.json().catch(() => ({}))) as { order_status?: string; order_amount?: number; message?: string };
  if (!r.ok) return { error: json.message || `HTTP ${r.status}` };
  return { status: String(json.order_status ?? "").toUpperCase(), amount: Number(json.order_amount ?? 0) };
}

export async function verifyCashfree(userId: string, data: z.infer<typeof CashfreeVerifySchema>) {
  const row = await ownsOrder(userId, "cashfree", data.order_id);
  if (!row) return { ok: false as const, error: "Unknown order" };
  const s = await cashfreeOrderStatus(data.order_id, row.metadata?.quote?.purpose);
  if ("error" in s) return { ok: false as const, error: s.error };
  if (s.status !== "PAID") return { ok: false as const, error: `Payment ${s.status.toLowerCase() || "not completed"}`, status: s.status };
  return settle({ provider: "cashfree", ref: data.order_id }, s.amount);
}

// ── Webhooks ────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handleRazorpayWebhook(rawBody: string, signature: string) {
  const cfg = await razorpayConfig();
  const secret = cfg?.webhook_secret;
  if (!secret) return { ok: false as const, status: 503, error: "webhook secret not set" };
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (!signature || !safeEqual(expected, signature)) return { ok: false as const, status: 401, error: "bad signature" };
  const body = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } } };
  };
  const p = body.payload?.payment?.entity;
  if (!["payment.captured", "order.paid"].includes(body.event ?? "") || !p?.order_id) return { ok: true as const, ignored: true };
  const r = await settle({ provider: "razorpay", ref: p.order_id }, p.amount != null ? p.amount / 100 : null, { payment_id: p.id, via: "webhook" });
  return { ok: true as const, result: r };
}

export async function handleCashfreeWebhook(rawBody: string, signature: string, timestamp: string) {
  const cfg = await cashfreeConfig();
  if (!cfg) return { ok: false as const, status: 503, error: "cashfree not set up" };
  const expected = createHmac("sha256", cfg.secret_key).update(timestamp + rawBody).digest("base64");
  if (!signature || !safeEqual(expected, signature)) return { ok: false as const, status: 401, error: "bad signature" };
  const body = JSON.parse(rawBody) as {
    type?: string;
    data?: { order?: { order_id?: string; order_amount?: number }; payment?: { payment_status?: string; payment_amount?: number; cf_payment_id?: string | number } };
  };
  const orderId = body.data?.order?.order_id;
  if (!orderId || body.data?.payment?.payment_status !== "SUCCESS") return { ok: true as const, ignored: true };
  const r = await settle({ provider: "cashfree", ref: orderId }, Number(body.data.payment.payment_amount ?? body.data.order?.order_amount ?? 0), {
    payment_id: String(body.data.payment.cf_payment_id ?? ""),
    via: "webhook",
  });
  return { ok: true as const, result: r };
}
