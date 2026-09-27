/**
 * Seeds a throwaway chat between a customer and the test vendor so the chat UI can be checked on a device.
 * Rows go straight into Postgres, so nobody gets a push.
 *
 *   npx tsx scripts/seed-device-chat.ts seed <customer_user_id>
 *   npx tsx scripts/seed-device-chat.ts clean
 */
import "dotenv/config";
import { ensureVendorSchema } from "../src/lib/apply-vendor-schema.js";
import { getPool } from "../src/lib/pg-client.js";

const VENDOR = "44444444-4444-4444-8444-444444444441";
const MARK = "device chat test - auto deleted";
const pool = getPool();
const [mode, customer] = process.argv.slice(2);

async function clean() {
  const { rows } = await pool.query(`select id from leads where note = $1`, [MARK]);
  const before = await pool.query(`select rating_avg, rating_count from vendors where user_id = $1`, [VENDOR]);
  for (const { id } of rows) {
    await pool.query(`delete from feedback_reports where message like $1`, [`%lead ${id}%`]);
    await pool.query(`delete from vendor_reviews where lead_id = $1`, [id]);
    await pool.query(`delete from vendor_status_updates where lead_id = $1`, [id]);
    await pool.query(`delete from lead_chat_presence where lead_id = $1`, [id]);
    await pool.query(`delete from lead_messages where lead_id = $1`, [id]);
    await pool.query(`delete from lead_notifications where lead_id = $1`, [id]);
    await pool.query(`delete from leads where id = $1`, [id]);
  }
  await pool.query(
    `update vendors v set rating_count = coalesce(s.n, 0), rating_avg = coalesce(s.avg, 0)
       from (select count(*)::int n, round(avg(stars)::numeric, 2) avg from vendor_reviews where vendor_id = $1) s
      where v.user_id = $1`,
    [VENDOR],
  );
  console.log(`removed ${rows.length} test lead(s); vendor rating was`, before.rows[0]);
}

async function seed(customerId: string) {
  await ensureVendorSchema();
  const leadId = (
    await pool.query(
      `insert into leads (customer_id, customer_name, sub_category_name, note, status, source, accepted_vendor_ids, address)
       values ($1, 'Device Test', 'AC Repair', $2, 'placed', 'quick', array[$3]::uuid[], 'Sector 18, Noida') returning id`,
      [customerId, MARK, VENDOR],
    )
  ).rows[0].id as string;
  await pool.query(`insert into lead_notifications (lead_id, vendor_id, status, responded_at) values ($1, $2, 'accepted', now())`, [leadId, VENDOR]);

  const msgs: Array<[string, string | null, string | null, Record<string, unknown>, string | null, number]> = [
    // sender, body, kind, attachment, image_url, minutes ago
    [VENDOR, "Namaste 👋 I have accepted your AC repair request.", "text", {}, null, 30],
    [customerId, "Hi, the AC is not cooling. When can you come?", "text", {}, null, 28],
    [VENDOR, "Quote: ₹950", "quote", {
      items: [
        { name: "Gas top-up", qty: 1, price: 700, amount: 700 },
        { name: "Filter cleaning", qty: 1, price: 100, amount: 100 },
      ],
      visit_charge: 150, note: "Includes a 30 day service warranty", total: 950, status: "pending",
    }, null, 25],
    [VENDOR, "📍 My location", "location", { lat: 28.5708, lng: 77.3261, label: "Near Sector 18 metro" }, null, 20],
    [VENDOR, "Payment request: ₹150", "payment", { amount: 150, note: "Visit charge", upi_id: "testvendor@okaxis", payee: "Test Vendor", status: "pending" }, null, 5],
    [VENDOR, "Please pay the visit charge and I will leave in 10 minutes.", "text", {}, null, 4],
  ];
  for (const [sender, body, kind, att, img, ago] of msgs) {
    await pool.query(
      `insert into lead_messages (lead_id, sender_id, recipient_id, body, kind, attachment, image_url, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, now() - make_interval(mins => $8))`,
      [leadId, sender, sender === VENDOR ? customerId : VENDOR, body, kind, JSON.stringify(att), img, ago],
    );
  }
  await pool.query(
    `insert into lead_chat_presence (lead_id, user_id, last_seen_at) values ($1, $2, now())
     on conflict (lead_id, user_id) do update set last_seen_at = now()`,
    [leadId, VENDOR],
  );
  console.log("lead", leadId);
}

try {
  if (mode === "seed" && customer) await seed(customer);
  else if (mode === "clean") await clean();
  else console.log("usage: seed <customer_user_id> | clean");
} finally {
  await pool.end();
}
