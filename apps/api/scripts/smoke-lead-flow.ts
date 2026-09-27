import "dotenv/config";
import { getPool, signLocalJwt } from "../src/lib/pg-client.js";

// Inserts a lead directly (no matching, no pushes, no coin charges), exercises the
// customer endpoints, then deletes everything it created.
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  console.log(method, path.replace(/[0-9a-f-]{36}/, ":id"), r.status, JSON.stringify(j).slice(0, 500));
  return j as any;
}

const pool = getPool();
const { rows: vs } = await pool.query(
  `select v.user_id, v.lat, v.lng from vendors v where v.lat is not null and v.lng is not null limit 1`,
);
const { rows: cs } = await pool.query(
  `select id, email from public.local_users where id not in (select user_id from vendors) and email is not null limit 1`,
);
if (!vs[0] || !cs[0]) throw new Error("need a located vendor and a customer");
const vendorId = vs[0].user_id as string;
const custTok = (await signLocalJwt({ id: cs[0].id, email: cs[0].email })).token;

const { rows: ins } = await pool.query(
  `insert into leads (customer_id, sub_category_name, note, lat, lng, status, source, search_radius_km, accepted_vendor_ids)
   values ($1, 'Smoke test', 'smoke test - auto deleted', $2, $3, 'accepted', 'quick', 5, array[$4]::uuid[]) returning id`,
  [cs[0].id, vs[0].lat, vs[0].lng, vendorId],
);
const leadId = ins[0].id as string;
try {
  await call(custTok, "GET", `/v1/leads/${leadId}/vendors`);
  await call(custTok, "POST", `/v1/leads/${leadId}/approve`, { vendor_id: cs[0].id });
  await call(custTok, "POST", `/v1/leads/${leadId}/approve`, { vendor_id: vendorId });
  await call(custTok, "POST", `/v1/leads/${leadId}/expand`, { radius_km: 500 });
  const { rows } = await pool.query(
    `select status, accepted_vendor_id, customer_approved_vendor_id from leads where id = $1`,
    [leadId],
  );
  console.log("row after approve:", rows[0]);
} finally {
  await pool.query(`delete from lead_messages where lead_id = $1`, [leadId]).catch(() => {});
  await pool.query(`delete from leads where id = $1`, [leadId]);
  await pool.end();
}
