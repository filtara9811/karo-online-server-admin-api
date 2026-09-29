import { getPool } from "./pg-client.js";
import { ensureVendorSchema } from "./apply-vendor-schema.js";
import { recordVendorVisit } from "./vendor-visits.js";
import { sendLeadPushToVendorInternal } from "./push.js";

export type AcceptResult =
  | { ok: true; already?: boolean; coins_charged: number; coins_left: number }
  | { ok: false; reason: "not_found" | "own_lead" | "closed" | "full" | "insufficient_coins" | "not_a_vendor"; needed?: number; have?: number };

const CLOSED = ["cancelled", "completed", "expired", "closed"];

export const distanceSql = (latA: string, lngA: string, latB: string, lngB: string) =>
  `(6371 * 2 * asin(sqrt(power(sin(radians(${latB} - ${latA}) / 2), 2) + cos(radians(${latA})) * cos(radians(${latB})) * power(sin(radians(${lngB} - ${lngA}) / 2), 2))))`;

/** `lead_source_multipliers` scales the category coin cost per lead source (e.g. WhatsApp leads cost more). */
async function sourceMultiplier(client: import("pg").PoolClient, source: string | null | undefined): Promise<number> {
  if (!source) return 1;
  try {
    await client.query("savepoint src_mult");
    const { rows } = await client.query(
      `select multiplier from public.lead_source_multipliers where source_key = $1 and coalesce(is_active, true) limit 1`,
      [source],
    );
    await client.query("release savepoint src_mult");
    const m = Number(rows[0]?.multiplier ?? 1);
    return Number.isFinite(m) && m > 0 ? m : 1;
  } catch {
    await client.query("rollback to savepoint src_mult").catch(() => undefined);
    return 1;
  }
}

/** Charges LeadX coins and claims a slot on the lead in one transaction. `vendorId` is the vendor's user id. */
export async function acceptLeadForVendor(leadId: string, vendorId: string, opts: { auto?: boolean } = {}): Promise<AcceptResult> {
  await ensureVendorSchema();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const vendor = await client.query(`select user_id from public.vendors where user_id = $1 and coalesce(is_blocked, false) = false`, [vendorId]);
    if (!vendor.rows[0]) {
      await client.query("rollback");
      return { ok: false, reason: "not_a_vendor" };
    }
    const { rows } = await client.query(
      `select l.*, c.lead_cost_coins, c.max_vendors_per_lead
         from public.leads l left join public.categories c on c.id = l.sub_category_id
        where l.id = $1 for update of l`,
      [leadId],
    );
    const lead = rows[0];
    if (!lead) {
      await client.query("rollback");
      return { ok: false, reason: "not_found" };
    }
    if (lead.customer_id === vendorId) {
      await client.query("rollback");
      return { ok: false, reason: "own_lead" };
    }
    const accepted: string[] = lead.accepted_vendor_ids ?? [];
    await client.query(`insert into public.vendor_wallets (vendor_id) values ($1) on conflict (vendor_id) do nothing`, [vendorId]);
    if (accepted.includes(vendorId)) {
      const w = await client.query(`select leadx_coins from public.vendor_wallets where vendor_id = $1`, [vendorId]);
      await client.query("commit");
      return { ok: true, already: true, coins_charged: 0, coins_left: Number(w.rows[0]?.leadx_coins ?? 0) };
    }
    if (CLOSED.includes(String(lead.status))) {
      await client.query("rollback");
      return { ok: false, reason: "closed" };
    }
    const slots = Number(lead.max_vendors_per_lead ?? lead.max_slots ?? 3) || 3;
    if (Number(lead.accepted_count ?? accepted.length) >= slots) {
      await client.query("rollback");
      return { ok: false, reason: "full" };
    }
    const cost = Math.max(0, Math.ceil(Number(lead.lead_cost_coins ?? 0) * (await sourceMultiplier(client, lead.source))));
    const wallet = await client.query(`select leadx_coins from public.vendor_wallets where vendor_id = $1 for update`, [vendorId]);
    const have = Number(wallet.rows[0]?.leadx_coins ?? 0);
    if (have < cost) {
      await client.query("rollback");
      return { ok: false, reason: "insufficient_coins", needed: cost, have };
    }
    await client.query(
      `update public.vendor_wallets
          set leadx_coins = coalesce(leadx_coins, 0) - $2,
              lifetime_coins_used = coalesce(lifetime_coins_used, 0) + $2,
              leads_used = coalesce(leads_used, 0) + 1,
              updated_at = now()
        where vendor_id = $1`,
      [vendorId, cost],
    );
    if (cost > 0) {
      await client.query(
        `insert into public.wallet_transactions (vendor_id, user_id, amount_inr, kind, purpose, direction, coins, description, ref, wallet_kind, status)
         values ($1, $1, 0, 'debit', 'lead_accept', 'debit', $2, $3, $4, 'leadx', 'success')`,
        [vendorId, cost, `Lead accepted · ${lead.sub_category_name ?? "Service"}`, leadId],
      );
    }
    await client.query(
      `update public.leads
          set accepted_vendor_ids = array_append(coalesce(accepted_vendor_ids, '{}'), $2::uuid),
              accepted_count = coalesce(accepted_count, 0) + 1,
              accepted_vendor_id = coalesce(accepted_vendor_id, $2::uuid),
              status = case when status = 'placed' then 'accepted' else status end,
              accepted_at = coalesce(accepted_at, now()),
              updated_at = now()
        where id = $1`,
      [leadId, vendorId],
    );
    await client.query(
      `insert into public.lead_notifications (lead_id, vendor_id, status, responded_at, vendor_started_at, auto_matched, sub_category_name)
       values ($1, $2, 'accepted', now(), case when $3 then now() end, $3, $4)
       on conflict (lead_id, vendor_id) do update
         set status = 'accepted', responded_at = now(),
             vendor_started_at = coalesce(public.lead_notifications.vendor_started_at, excluded.vendor_started_at)`,
      [leadId, vendorId, Boolean(opts.auto), lead.sub_category_name ?? null],
    );
    await client.query("commit");
    void recordVendorVisit({
      vendorId,
      userId: lead.customer_id ?? null,
      name: lead.customer_name ?? null,
      phone: lead.customer_phone ?? null,
      source: "lead",
    }).catch((err) => console.warn("[visit] lead", err instanceof Error ? err.message : err));
    return { ok: true, coins_charged: cost, coins_left: have - cost };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectLeadForVendor(leadId: string, vendorId: string, reason: string) {
  await ensureVendorSchema();
  const { rows } = await getPool().query(
    `insert into public.lead_notifications (lead_id, vendor_id, status, responded_at, rejection_reason)
     values ($1, $2, 'rejected', now(), $3)
     on conflict (lead_id, vendor_id) do update
       set status = 'rejected', responded_at = now(), rejection_reason = excluded.rejection_reason
     returning *`,
    [leadId, vendorId, reason],
  );
  return rows[0];
}

/** Online vendors who offer the lead's sub-category and are inside both the customer's search radius
 * and their own service radius (0 = serves anywhere), nearest first. */
export async function findVendorsForLead(leadId: string) {
  const dist = distanceSql("l.lat", "l.lng", "coalesce(v.live_lat, v.lat)", "coalesce(v.live_lng, v.lng)");
  const { rows } = await getPool().query(
    `with l as (
            -- Older app builds always sent wholesaler+retailer+manufacturer, which silently excluded service pros.
            select *, case when coalesce(cardinality(vendor_types), 0) = 0
                             or vendor_types::text[] @> array['wholesaler','retailer','manufacturer']
                           then null else vendor_types::text[] end as trade_filter
              from public.leads where id = $1),
          mapped as (
            select distinct m.vendor_id from public.vendor_item_mappings m
              join public.catalog_items ci on ci.id = m.item_id
              join public.vendors mv on mv.user_id = m.vendor_id, l
             where coalesce(m.is_active, true) and ci.category_id = l.sub_category_id
               and coalesce(mv.is_online, true) and coalesce(mv.is_blocked, false) = false
               and coalesce(mv.status, 'active') in ('active', 'approved'))
     select v.user_id, coalesce(v.auto_accept_leads, false) as auto_accept
       from public.vendors v, l
      where v.user_id <> coalesce(l.customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(v.is_blocked, false) = false
        and coalesce(v.status, 'active') in ('active', 'approved')
        and coalesce(v.is_online, true)
        and (l.lat is null
             or (coalesce(v.live_lat, v.lat) is not null
                 and ${dist} <= coalesce(l.search_radius_km, 5)
                 and (coalesce(v.service_radius_km, 10) = 0 or ${dist} <= coalesce(v.service_radius_km, 10))))
        and (l.sub_category_id is null or v.user_id in (select vendor_id from mapped))
        and (l.trade_filter is null or v.trade is null or lower(v.trade) = any(l.trade_filter))
        and (not coalesce(l.verified_only, false) or coalesce(v.verified, false))
      order by case when l.lat is null or coalesce(v.live_lat, v.lat) is null then 1e9 else ${dist} end
      limit 25`,
    [leadId],
  );
  return rows as { user_id: string; auto_accept: boolean }[];
}

/** Fans a new lead out to [findVendorsForLead]. */
export async function matchLeadToVendors(leadId: string) {
  await ensureVendorSchema();
  const pool = getPool();
  const rows = await findVendorsForLead(leadId);
  if (!rows.length) return { notified: 0, auto_accepted: 0 };
  await pool.query(
    `insert into public.lead_notifications (lead_id, vendor_id, status, auto_matched, sub_category_name)
     select $1, unnest($2::uuid[]), 'pending', true, (select sub_category_name from public.leads where id = $1)
     on conflict (lead_id, vendor_id) do nothing`,
    [leadId, rows.map((r) => r.user_id)],
  );
  // Awaited: on serverless, work left running after the response may never finish.
  await Promise.all(
    rows
      .filter((x) => !x.auto_accept)
      .map((r) =>
        sendLeadPushToVendorInternal({ vendor_id: r.user_id, lead_id: leadId }).catch((err) =>
          console.warn("[match] push", err instanceof Error ? err.message : err),
        ),
      ),
  );
  let autoAccepted = 0;
  for (const r of rows.filter((x) => x.auto_accept)) {
    try {
      const res = await acceptLeadForVendor(leadId, r.user_id, { auto: true });
      if (res.ok) autoAccepted++;
    } catch (err) {
      console.warn("[match] auto-accept", err instanceof Error ? err.message : err);
    }
  }
  return { notified: rows.length, auto_accepted: autoAccepted };
}
