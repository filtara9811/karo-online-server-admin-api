import "dotenv/config";
import { getPool } from "../src/lib/pg-client.js";

// Throwaway E2E logins: test_accounts rows let a phone sign in with a fixed OTP (no SMS).
//   npx tsx scripts/e2e-accounts.ts list
//   npx tsx scripts/e2e-accounts.ts add 9000000101 [otp]
//   npx tsx scripts/e2e-accounts.ts cleanup 9000000101   # deletes the user and everything they created
const [cmd, phone, otp = "1234"] = process.argv.slice(2);
const pool = getPool();

async function userFor(p: string) {
  const { rows } = await pool.query(
    `select id, email, phone from local_users where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1`,
    [p],
  );
  return rows[0] as { id: string; email: string | null; phone: string } | undefined;
}

try {
  if (cmd === "list") {
    const { rows } = await pool.query(`select phone, enabled from test_accounts order by phone`);
    for (const r of rows) {
      const u = await userFor(r.phone);
      const vendor = u ? (await pool.query(`select 1 from vendors where user_id = $1`, [u.id])).rowCount : 0;
      console.log(r.phone, r.enabled ? "enabled" : "disabled", u ? `user=${u.id}` : "no user yet", vendor ? "vendor" : "");
    }
  } else if (cmd === "add" && /^\d{10}$/.test(phone ?? "")) {
    await pool.query(
      `insert into test_accounts (phone, otp_code, enabled) values ($1, $2, true)
       on conflict (phone) do update set otp_code = excluded.otp_code, enabled = true`,
      [phone, otp],
    );
    console.log(`test login ready: ${phone} / OTP ${otp}`);
  } else if (cmd === "cleanup" && /^\d{10}$/.test(phone ?? "")) {
    const u = await userFor(phone!);
    if (u) {
      const id = u.id;
      const leads = (await pool.query(`select id from leads where customer_id = $1`, [id])).rows.map((r) => r.id);
      const steps: Array<[string, unknown[]]> = [
        [`delete from lead_messages where lead_id = any($1::uuid[]) or sender_id = $2 or recipient_id = $2`, [leads, id]],
        [`delete from lead_notifications where lead_id = any($1::uuid[]) or vendor_id = $2`, [leads, id]],
        [`delete from vendor_reviews where customer_id = $1 or vendor_id = $1`, [id]],
        [`delete from leads where customer_id = $1`, [id]],
        [`update leads set accepted_vendor_ids = array_remove(accepted_vendor_ids, $1::uuid) where $1::uuid = any(accepted_vendor_ids)`, [id]],
        [`update leads set customer_approved_vendor_id = null where customer_approved_vendor_id = $1`, [id]],
        [`delete from shop_orders where customer_id = $1 or vendor_id = $1 or user_id = $1`, [id]],
        [`delete from shop_invoices where vendor_id = $1`, [id]],
        [`delete from shop_stock_log where vendor_id = $1`, [id]],
        [`delete from shop_products where user_id = $1`, [id]],
        [`delete from shop_categories where user_id = $1`, [id]],
        [`delete from shop_banners where user_id = $1`, [id]],
        [`delete from digital_shops where user_id = $1`, [id]],
        [`delete from vendor_item_mappings where vendor_id = $1`, [id]],
        [`delete from vendor_kyc where vendor_id = $1`, [id]],
        [`delete from kyc_verifications where user_id = $1`, [id]],
        [`delete from notification_logs where user_id = $1`, [id]],
        [`delete from vendor_visits where vendor_id = $1 or visitor_id = $1`, [id]],
        [`delete from wallet_transactions where user_id = $1`, [id]],
        [`delete from wallets where user_id = $1`, [id]],
        [`delete from device_tokens where user_id = $1`, [id]],
        [`delete from vendors where user_id = $1`, [id]],
        [`delete from customers where user_id = $1`, [id]],
        [`delete from profiles where id = $1`, [id]],
        [`delete from local_sessions where user_id = $1`, [id]],
        [`delete from local_users where id = $1`, [id]],
      ];
      for (const [sql, params] of steps) {
        try {
          const r = await pool.query(sql, params);
          if (r.rowCount) console.log(`${r.rowCount}\t${sql.slice(0, 70)}`);
        } catch (e) {
          console.log(`skip\t${sql.slice(0, 50)} (${(e as Error).message.slice(0, 60)})`);
        }
      }
    }
    await pool.query(`delete from test_accounts where phone = $1`, [phone]);
    await pool.query(`delete from otp_codes where phone = $1`, [phone]).catch(() => null);
    console.log(`cleaned ${phone}${u ? ` (user ${u.id})` : ""}`);
  } else {
    console.log("usage: list | add <10-digit phone> [otp] | cleanup <10-digit phone>");
  }
} finally {
  await pool.end();
}
