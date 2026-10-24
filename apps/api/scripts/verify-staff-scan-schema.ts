import "dotenv/config";
import { ensureVendorSchema } from "../src/lib/apply-vendor-schema.js";
import { getPool } from "../src/lib/pg-client.js";

async function main() {
  await ensureVendorSchema();
  const pool = getPool();
  const staff = await pool.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'staff_signup_requests'
      order by ordinal_position`,
  );
  const scans = await pool.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'vendor_scan_history'
      order by ordinal_position`,
  );
  console.log("staff_signup_requests:", staff.rows.map((r) => r.column_name).join(", "));
  console.log("vendor_scan_history:", scans.rows.map((r) => r.column_name).join(", "));

  // Smoke inserts (rollback via delete)
  const uid = "00000000-0000-4000-8000-000000000099";
  const s = await pool.query(
    `insert into public.staff_signup_requests (name, email, phone, user_id, status, note)
     values ($1,$2,$3,$4,'pending',$5) returning id`,
    ["Schema Test", "schema-test@karoonline.test", "9000000099", uid, "verify"],
  );
  console.log("staff insert ok", s.rows[0].id);
  await pool.query(`delete from public.staff_signup_requests where id = $1`, [s.rows[0].id]);

  const sc = await pool.query(
    `insert into public.vendor_scan_history
       (user_id, kinds, thumbnail, extracted, confidence, field_confidence, status)
     values ($1,$2,$3,$4::jsonb,$5,$6::jsonb,'complete') returning id`,
    [uid, ["card"], null, JSON.stringify({ business_name: "Test" }), 0.9, JSON.stringify({ mobile: 0.8 })],
  );
  console.log("scan insert ok", sc.rows[0].id);
  await pool.query(`delete from public.vendor_scan_history where id = $1`, [sc.rows[0].id]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
