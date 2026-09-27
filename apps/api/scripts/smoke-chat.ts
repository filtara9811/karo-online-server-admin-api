import "dotenv/config";
import { getPool, signLocalJwt } from "../src/lib/pg-client.js";

// Walks every /v1/chat action on a throwaway lead between the seeded test vendor and a customer
// without device tokens (so no real pushes go out), then deletes everything it created.
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";
const VENDOR = process.env.SMOKE_VENDOR ?? "44444444-4444-4444-8444-444444444441";

let failures = 0;
async function call(token: string, method: string, path: string, body?: unknown, expect = 200) {
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as any;
  const good = r.status === expect || (expect === 200 && r.status === 201);
  if (!good) failures++;
  console.log(good ? "ok " : "BAD", method, path.replace(/[0-9a-f-]{36}/g, ":id"), r.status, good ? "" : JSON.stringify(j).slice(0, 300));
  return j?.data ?? j;
}
function check(label: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(cond ? "ok " : "BAD", label, cond ? "" : JSON.stringify(detail)?.slice(0, 300));
}

const pool = getPool();
const { rows: cs } = await pool.query(
  `select id, email from public.local_users u
    where id not in (select user_id from vendors) and email is not null
      and not exists (select 1 from device_tokens d where d.user_id = u.id and d.is_active) limit 1`,
);
if (!cs[0]) throw new Error("need a customer without device tokens");
const CUSTOMER = cs[0].id as string;
const cTok = (await signLocalJwt({ id: CUSTOMER, email: cs[0].email })).token;
const vTok = (await signLocalJwt({ id: VENDOR, email: "smoke-vendor@karoonline.in" })).token;
const ratingBefore = (await pool.query(`select rating_avg, rating_count from vendors where user_id = $1`, [VENDOR])).rows[0];

const leadId = (
  await pool.query(
    `insert into leads (customer_id, customer_name, sub_category_name, note, status, source, accepted_vendor_ids)
     values ($1, 'Smoke Customer', 'Smoke chat', 'smoke test - auto deleted', 'placed', 'quick', array[$2]::uuid[]) returning id`,
    [CUSTOMER, VENDOR],
  )
).rows[0].id as string;
await pool.query(`insert into lead_notifications (lead_id, vendor_id, status, responded_at) values ($1, $2, 'accepted', now())`, [leadId, VENDOR]);
const productId = (
  await pool.query(`insert into shop_products (user_id, name, price, is_active, stock) values ($1, 'Smoke product', 199, true, 5) returning id`, [VENDOR])
).rows[0].id as string;
const C = `/v1/chat/${leadId}`;

try {
  await call(vTok, "GET", C);
  let t = await call(cTok, "GET", C);
  check("customer sees vendor as peer", t.peer?.id === VENDOR && t.me?.role === "customer", t.peer);
  check("stage accepted", t.stage === "accepted", t.stage);

  const hi = await call(cTok, "POST", `${C}/messages`, { body: "Hello, when can you come?" });
  await call(vTok, "POST", `${C}/messages`, { body: "In 30 minutes" });
  await call(cTok, "POST", `${C}/messages`, { kind: "image", image_url: "https://karoonline.in/logo.png", body: "This one" });
  await call(vTok, "POST", `${C}/messages`, { kind: "location", attachment: { lat: 28.66, lng: 77.24 } });
  await call(cTok, "POST", `${C}/messages`, { kind: "quote", attachment: { items: [{ name: "x", qty: 1, price: 1 }] } }, 403);
  const quote = await call(vTok, "POST", `${C}/messages`, {
    kind: "quote",
    attachment: { items: [{ name: "Fan repair", qty: 1, price: 350 }, { name: "Capacitor", qty: 2, price: 75 }], visit_charge: 50 },
  });
  check("quote total server-side", quote.message?.attachment?.total === 550, quote.message?.attachment);
  await call(cTok, "POST", `${C}/messages/${quote.message.id}/respond`, { action: "accept" });
  await call(cTok, "POST", `${C}/messages/${quote.message.id}/respond`, { action: "accept" }, 409);
  const pay = await call(vTok, "POST", `${C}/messages`, { kind: "payment", attachment: { amount: 550, upi_id: "smoke@okaxis" } });
  check("payment carries upi", pay.message?.attachment?.upi_id === "smoke@okaxis", pay.message?.attachment);
  await call(vTok, "POST", `${C}/messages/${pay.message.id}/respond`, { action: "paid" }, 403);
  await call(cTok, "POST", `${C}/messages/${pay.message.id}/respond`, { action: "paid", utr: "123456789012" });
  await call(vTok, "POST", `${C}/messages/${pay.message.id}/respond`, { action: "received" });
  await call(vTok, "POST", `${C}/messages`, { kind: "product", attachment: { product_id: productId } });

  await call(cTok, "PATCH", `${C}/messages/${hi.message.id}`, { body: "Hello, when can you reach?" });
  await call(vTok, "PATCH", `${C}/messages/${hi.message.id}`, { body: "hack" }, 403);
  const del = await call(cTok, "POST", `${C}/messages`, { body: "oops wrong chat" });
  await call(cTok, "DELETE", `${C}/messages/${del.message.id}`);

  await call(cTok, "POST", `${C}/typing`, { typing: true });
  t = await call(vTok, "GET", C);
  check("vendor sees customer typing", t.peer?.typing === true, t.peer);
  const deletedForVendor = t.messages.find((m: any) => m.id === del.message.id);
  check("deleted text hidden from vendor", deletedForVendor?.is_deleted && deletedForVendor.body == null && deletedForVendor.original_body == null, deletedForVendor);
  const edited = t.messages.find((m: any) => m.id === hi.message.id);
  check("edit visible, original hidden from vendor", edited?.body === "Hello, when can you reach?" && edited.edited_at && edited.original_body == null, edited);
  check("customer messages read by vendor", t.messages.filter((m: any) => m.sender_id === CUSTOMER && m.kind !== "system").every((m: any) => m.read_at), null);

  await call(cTok, "POST", `${C}/rating`, { stars: 5 }, 409);
  await call(vTok, "POST", `${C}/status`, { action: "approve" }, 403);
  let s = await call(cTok, "POST", `${C}/status`, { action: "approve" });
  check("stage approved", s.stage === "approved", s);
  s = await call(vTok, "POST", `${C}/status`, { action: "on_the_way" });
  check("stage on_the_way", s.stage === "on_the_way", s);
  s = await call(cTok, "POST", `${C}/status`, { action: "complete" });
  check("stage completed", s.stage === "completed", s);
  await call(cTok, "POST", `${C}/rating`, { stars: 4, comment: "Good work", tags: ["On time"] });
  await call(cTok, "POST", `${C}/rating`, { stars: 5, comment: "Great work", tags: ["On time", "Fair price"] });
  const rated = (await pool.query(`select rating_count, rating_avg from vendors where user_id = $1`, [VENDOR])).rows[0];
  check("vendor aggregate updated", Number(rated.rating_count) >= 1, rated);

  t = await call(cTok, "GET", C);
  check("customer sees rating", t.rating?.stars === 5, t.rating);
  check("vendor messages read by customer", t.messages.filter((m: any) => m.sender_id === VENDOR).every((m: any) => m.read_at), null);
  const own = t.messages.find((m: any) => m.id === del.message.id);
  check("sender can view original of deleted", own?.original_body === "oops wrong chat", own);
  console.log("kinds:", t.messages.map((m: any) => m.kind).join(","));

  const ci = await call(cTok, "GET", `/v1/chat/inbox`);
  check("customer inbox has thread", ci.threads?.some((r: any) => r.lead_id === leadId && r.peer_id === VENDOR), ci.threads?.[0]);
  const vi = await call(vTok, "GET", `/v1/chat/inbox?as=vendor`);
  check("vendor inbox has thread", vi.threads?.some((r: any) => r.lead_id === leadId), vi.threads?.[0]);
  await call(cTok, "POST", `${C}/report`, { reason: "smoke test report" });

  const stranger = (await signLocalJwt({ id: "55555555-5555-4555-8555-555555555555", email: "x@y.z" })).token;
  await call(stranger, "GET", C, undefined, 403);
} finally {
  await pool.query(`delete from feedback_reports where message like $1`, [`%lead ${leadId}%`]);
  await pool.query(`delete from vendor_reviews where lead_id = $1`, [leadId]);
  await pool.query(`update vendors set rating_avg = $2, rating_count = $3 where user_id = $1`, [VENDOR, ratingBefore?.rating_avg ?? 0, ratingBefore?.rating_count ?? 0]);
  await pool.query(`delete from vendor_status_updates where lead_id = $1`, [leadId]);
  await pool.query(`delete from lead_chat_presence where lead_id = $1`, [leadId]);
  await pool.query(`delete from lead_messages where lead_id = $1`, [leadId]);
  await pool.query(`delete from lead_notifications where lead_id = $1`, [leadId]);
  await pool.query(`delete from leads where id = $1`, [leadId]);
  await pool.query(`delete from shop_products where id = $1`, [productId]);
  await pool.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
}
