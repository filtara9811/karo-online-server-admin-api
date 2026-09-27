import "dotenv/config";
import { getPool, signLocalJwt } from "../src/lib/pg-client.js";

// Exercises quote + UPI request + admin approve on a seeded test vendor, then restores its wallet.
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";
const VENDOR = process.env.SMOKE_VENDOR ?? "44444444-4444-4444-8444-444444444441";

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as any;
  console.log(method, path, r.status, JSON.stringify(j).slice(0, 360));
  return j;
}

const pool = getPool();
const { rows: admins } = await pool.query(
  `select u.id, u.email from public.local_users u join public.user_roles r on r.user_id = u.id
    where r.role in ('admin', 'super_admin') limit 1`,
);
if (!admins[0]) throw new Error("no admin user");
const vTok = (await signLocalJwt({ id: VENDOR, email: "smoke-vendor@karoonline.in" })).token;
const aTok = (await signLocalJwt({ id: admins[0].id, email: admins[0].email })).token;

const before = (await pool.query(`select leadx_coins, balance_inr, lifetime_coins_purchased, lifetime_recharged_inr from vendor_wallets where vendor_id = $1`, [VENDOR])).rows[0];
console.log("wallet before", before);

const w = await call(vTok, "GET", "/v1/vendor/wallet");
const pack = w.data?.packs?.[0];
await call(vTok, "GET", "/v1/payments/options");
await call(vTok, "POST", "/v1/payments/quote", { purpose: "coin_purchase", pack_id: pack?.id });
await call(vTok, "POST", "/v1/payments/quote", { purpose: "coin_purchase", coins: 3 });
await call(vTok, "POST", "/v1/payments/quote", { purpose: "coin_purchase", coins: 30 });
await call(vTok, "POST", "/v1/payments/order", { purpose: "wallet_recharge", amount_inr: 500 });

const req = await call(vTok, "POST", "/v1/vendor/wallet/recharge", { kind: "leadx", amount_inr: 1, coins: 99999, pack_id: pack?.id, utr: "SMOKE123456" });
const txId = req.data?.transaction?.id;
try {
  await call(aTok, "GET", "/v1/admin/wallet-requests");
  await call(aTok, "POST", `/v1/admin/wallet-requests/${txId}/approve`, { note: "smoke" });
  await call(aTok, "POST", `/v1/admin/wallet-requests/${txId}/approve`, { note: "smoke again" });
  const after = (await pool.query(`select leadx_coins, balance_inr, lifetime_coins_purchased, lifetime_recharged_inr from vendor_wallets where vendor_id = $1`, [VENDOR])).rows[0];
  console.log("wallet after", after);
} finally {
  const b = before ?? { leadx_coins: 0, balance_inr: 0, lifetime_coins_purchased: 0, lifetime_recharged_inr: 0 };
  await pool.query(
    `update vendor_wallets set leadx_coins = $2, balance_inr = $3, lifetime_coins_purchased = $4, lifetime_recharged_inr = $5 where vendor_id = $1`,
    [VENDOR, b.leadx_coins, b.balance_inr, b.lifetime_coins_purchased, b.lifetime_recharged_inr],
  );
  if (txId) await pool.query(`delete from wallet_transactions where id = $1`, [txId]);
  await pool.end();
}
