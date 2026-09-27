import { getPool } from "./pg-client.js";
import { ensureVendorSchema } from "./apply-vendor-schema.js";
import { acceptLeadForVendor } from "./vendor-leads.js";

const TICK_MS = 5_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Same rule as the website's `auto_accept_expired_lead_notifications`: a pending lead notification
 * that isn't answered within 15 s is accepted for the vendor when they have enough coins, otherwise
 * it expires. Rows created before `auto_accept_at` existed are never charged; they expire after a day.
 */
export async function processExpiredLeadNotifications() {
  await ensureVendorSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, lead_id, vendor_id from public.lead_notifications
      where status = 'pending' and auto_accept_at is not null and auto_accept_at <= now()
      order by auto_accept_at asc limit 200`,
  );
  let accepted = 0;
  let expired = 0;
  for (const n of rows) {
    try {
      const res = await acceptLeadForVendor(n.lead_id, n.vendor_id, { auto: true });
      if (res.ok) {
        accepted++;
        continue;
      }
    } catch (err) {
      console.warn("[lead-expiry] accept", err instanceof Error ? err.message : err);
    }
    await pool.query(
      `update public.lead_notifications set status = 'expired', responded_at = now() where id = $1 and status = 'pending'`,
      [n.id],
    );
    expired++;
  }
  const stale = await pool.query(
    `update public.lead_notifications set status = 'expired', responded_at = now()
      where status = 'pending' and auto_accept_at is null and created_at < now() - interval '1 day'`,
  );
  return { accepted, expired: expired + (stale.rowCount ?? 0) };
}

export function startLeadExpiryWorker() {
  if (timer || process.env.LEAD_EXPIRY_WORKER === "off") return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await processExpiredLeadNotifications();
      if (r.accepted || r.expired) console.log(`[lead-expiry] accepted=${r.accepted} expired=${r.expired}`);
    } catch (err) {
      console.warn("[lead-expiry]", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, TICK_MS);
  timer.unref();
}
