import { getPool } from "./pg-client.js";
import { ensureVendorSchema } from "./apply-vendor-schema.js";

export type VisitSource = "qr" | "shop" | "lead" | "profile" | "stand" | "card" | "poster" | "referral" | "direct";

/** Resolves a public shop / QR / referral code to the vendor's user id, or null when the code isn't a vendor. */
export async function vendorIdForCode(code: string): Promise<string | null> {
  const pool = getPool();
  const c = code.trim();
  if (!c) return null;
  const tries = [
    `select user_id::text as id from public.digital_shops where lower(slug) = lower($1) limit 1`,
    `select user_id::text as id from public.referral_codes where lower(code) = lower($1) limit 1`,
    `select coalesce(user_id, id)::text as id from public.customers where lower(referral_code) = lower($1) limit 1`,
  ];
  for (const sql of tries) {
    try {
      const { rows } = await pool.query(sql, [c]);
      const id = rows[0]?.id as string | undefined;
      if (!id) continue;
      const v = await pool.query(`select 1 from public.vendors where user_id::text = $1 limit 1`, [id]);
      if (v.rows[0]) return id;
    } catch {
      /* table may not exist on this database */
    }
  }
  if (/^[0-9a-f-]{36}$/i.test(c)) {
    const v = await pool.query(`select 1 from public.vendors where user_id = $1::uuid limit 1`, [c]);
    if (v.rows[0]) return c;
  }
  return null;
}

async function visitorIdentity(userId: string) {
  try {
    const { rows } = await getPool().query(
      `select to_jsonb(c) as j from public.customers c where c.user_id = $1::uuid or c.id = $1::uuid limit 1`,
      [userId],
    );
    const j = (rows[0]?.j ?? {}) as Record<string, unknown>;
    const name = [j.name, [j.first_name, j.last_name].filter(Boolean).join(" ")].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const phone = [j.phone, j.mobile, j.whatsapp].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    return { name: name?.trim() ?? null, phone: phone?.trim() ?? null };
  } catch {
    return { name: null, phone: null };
  }
}

/** Counts one visit per visitor per vendor; repeat visits bump `visit_count`. Anonymous visits without a phone are counted as new rows. */
export async function recordVendorVisit(input: {
  vendorId: string;
  userId?: string | null;
  name?: string | null;
  phone?: string | null;
  source: VisitSource;
  code?: string | null;
}) {
  await ensureVendorSchema();
  if (input.userId && input.userId === input.vendorId) return null;
  const ident = input.userId ? await visitorIdentity(input.userId) : { name: null, phone: null };
  const name = input.name?.trim() || ident.name;
  const phone = (input.phone ?? ident.phone)?.replace(/\D/g, "").slice(-10) || null;
  const pool = getPool();
  if (input.userId || phone) {
    const { rows } = await pool.query(
      `update public.vendor_customer_visits
          set visit_count = coalesce(visit_count, 0) + 1, last_visit_at = now(),
              visitor_name = coalesce($4, visitor_name), visitor_phone = coalesce($3, visitor_phone),
              visitor_user_id = coalesce(visitor_user_id, $2::uuid), source_kind = $5
        where id = (select id from public.vendor_customer_visits
                     where vendor_id = $1 and (($2::uuid is not null and visitor_user_id = $2::uuid) or ($3::text is not null and visitor_phone = $3))
                     order by last_visit_at desc limit 1)
        returning *`,
      [input.vendorId, input.userId ?? null, phone, name, input.source],
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await pool.query(
    `insert into public.vendor_customer_visits (vendor_id, visitor_user_id, visitor_name, visitor_phone, source_kind, source_qr_code)
     values ($1, $2::uuid, $3, $4, $5, $6) returning *`,
    [input.vendorId, input.userId ?? null, name, phone, input.source, input.code ?? null],
  );
  return rows[0];
}
