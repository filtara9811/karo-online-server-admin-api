import "dotenv/config";

// Walks the Assan Grow API and the public One QR landing with a test_accounts phone.
//   npx tsx scripts/e2e-accounts.ts add 9000000201
//   npx tsx scripts/smoke-grow.ts 9000000201
//   npx tsx scripts/e2e-accounts.ts cleanup 9000000201
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";
const phone = process.argv[2] ?? "";
if (!/^\d{10}$/.test(phone)) throw new Error("pass a 10-digit phone that is in test_accounts");
const VISITOR = "9000000299";

let failures = 0;
async function call(token: string | null, method: string, path: string, body?: unknown, expect = 200) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
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

await call(null, "POST", "/v1/auth/otp/send", { phone: `+91${phone}`, channel: "sms" });
const v = await call(null, "POST", "/v1/auth/otp/verify", { phone: `+91${phone}`, code: "1234" });
const tok: string = v.access_token ?? v.session?.access_token ?? v.token;
check("signed in", !!tok, v);
const G = "/v1/grow";

const empty = await call(tok, "GET", `${G}/projects`);
check("no projects yet", empty.projects?.length === 0, empty);

const a = (await call(tok, "POST", `${G}/projects`, { title: "Smoke Gate", business_name: "Smoke Store", contact_phone: "9000000201", category: "Grocery" })).project;
check("first project is free", a.is_paid === true && a.price_inr === 0, a);
const b = (await call(tok, "POST", `${G}/projects`, { title: "Smoke Counter", business_name: "Smoke Counter" })).project;
check("second project costs 599", b.is_paid === false && b.price_inr === 599, b);
check("same share code", a.share_code === b.share_code, [a.share_code, b.share_code]);

const patched = (await call(tok, "PATCH", `${G}/projects/${a.id}`, { description: "Fresh groceries daily", city: "Delhi" })).project;
check("patch keeps free flag", patched.is_paid === true && patched.city === "Delhi", patched);
await call(tok, "GET", `${G}/projects/00000000-0000-4000-8000-000000000000`, undefined, 404);
await call(tok, "POST", `${G}/projects/00000000-0000-4000-8000-000000000000/products`, { name: "X" }, 404);

const pay = await call(tok, "POST", `${G}/projects/${a.id}/pay`);
check("free project needs no payment", pay.paid === true, pay);
const r = await fetch(`${BASE}${G}/projects/${b.id}/pay`, { method: "POST", headers: { authorization: `Bearer ${tok}` } });
const pj = (await r.json()) as any;
check(
  "paid project opens checkout or says no gateway",
  (r.status === 200 && ["razorpay", "cashfree"].includes(pj.data?.provider)) || (r.status === 400 && /not set up/i.test(pj.error)),
  pj,
);

const code = a.share_code as string;
const S = `/v1/shops/${encodeURIComponent(code)}`;
let landing = await call(null, "GET", `${S}/landing?kind=s&p=${a.slug}`);
check("landing shows the project", landing.name === "Smoke Store" && landing.phone === "9000000201" && landing.products.length === 0, landing);
const landingB = await call(null, "GET", `${S}/landing?kind=s&p=${b.slug}`);
check("landing picks project by ?p", landingB.name === "Smoke Counter" && landingB.phone === null, landingB);
const byStand = await call(null, "GET", `/v1/shops/${a.slug}/landing?kind=q`);
check("stand QR resolves by slug", byStand.project === a.slug, byStand);

const anon = await call(null, "POST", `${S}/visit`, { kind: "s", source: "qr", project: a.slug });
const gate = await call(null, "POST", `${S}/visit`, { kind: "s", source: "qr", project: a.slug, visit_id: anon.visit.id, visitor_name: "Smoke Visitor", visitor_phone: VISITOR });
check("gate completes the same visit", gate.visit.id === anon.visit.id && gate.visit.visitor_phone === VISITOR, gate);
await call(null, "POST", `/v1/shops/${a.slug}/visit`, { kind: "q", source: "stand", visitor_name: "Smoke Visitor", visitor_phone: `+91 ${VISITOR}` });
const va = await call(tok, "GET", `${G}/projects/${a.id}/visits`);
check("visits land on project A", va.visits.length === 2 && va.visits.every((x: any) => x.visit_count === 2), va.visits);
const vb = await call(tok, "GET", `${G}/projects/${b.id}/visits`);
check("project B has no visits", vb.visits.length === 0, vb.visits);
const manual = await call(tok, "POST", `${G}/projects/${a.id}/visits`, { visitor_name: "Walk-in", visitor_phone: "+91 90000 00298" });
check("manual visitor phone cleaned", manual.visit.visitor_phone === "9000000298", manual);
const an = await call(tok, "GET", `${G}/projects/${a.id}/analytics?days=7`);
check("analytics counts today", an.totals.visits === 3 && an.totals.customers === 2 && an.days.length === 7, an.totals);

const p1 = (await call(tok, "POST", `${G}/projects/${a.id}/products`, { name: "Smoke Rice 5kg", price: 450, stock: 3, category: "Staples" })).product;
await call(tok, "PATCH", `${G}/products/${p1.id}`, { price: 420 });
const p2 = (await call(tok, "POST", `${G}/projects/${a.id}/products`, { name: "Smoke Dal", price: 120 })).product;
await call(tok, "PATCH", `${G}/products/${p2.id}`, { is_active: false });
landing = await call(null, "GET", `${S}/landing?kind=s&p=${a.slug}`);
check("landing lists active products only", landing.products.length === 1 && landing.products[0].price === 420, landing.products);

await call(null, "POST", `${S}/orders`, { project: a.slug, visitor_name: "Smoke Visitor", visitor_phone: "123", items: [{ id: p1.id }] }, 400);
await call(null, "POST", `${S}/orders`, { project: a.slug, visitor_name: "Smoke Visitor", visitor_phone: VISITOR, items: [{ id: p2.id }] }, 400);
const order = (await call(null, "POST", `${S}/orders`, { project: a.slug, visitor_name: "Smoke Visitor", visitor_phone: VISITOR, items: [{ id: p1.id, qty: 2, price: 1 }] })).order;
check("order priced by server", Number(order.total_inr) === 840, order);
await call(null, "POST", `${S}/inquiry`, { project: a.slug, visitor_name: "Smoke Visitor", visitor_phone: VISITOR, message: "Do you deliver?" });
const orders = await call(tok, "GET", `${G}/projects/${a.id}/orders`);
check("order + inquiry reach the shop", orders.orders.length === 2 && orders.orders.some((o: any) => o.status === "inquiry" && o.note === "Do you deliver?"), orders.orders);
const confirmed = await call(tok, "PATCH", `${G}/orders/${order.id}`, { status: "confirmed" });
check("order status updated", confirmed.order.status === "confirmed", confirmed);
await call(tok, "PATCH", `${G}/orders/${order.id}`, { status: "shipped-to-mars" }, 400);

const camp = await call(tok, "POST", `${G}/projects/${a.id}/campaigns`, { title: "Meta ads · Instagram", budget_inr: 499 });
check("campaign requested", camp.campaign.status === "requested", camp);
const camps = await call(tok, "GET", `${G}/projects/${a.id}/campaigns`);
check("campaign listed", camps.campaigns.length === 1, camps);

const progs = await call(tok, "GET", `${G}/programs`);
const prog = progs.programs[0];
check("programs listed", !!prog && prog.joined === false, progs);
await call(tok, "POST", `${G}/programs/${prog.id}/join`);
await call(tok, "POST", `${G}/programs/${prog.id}/join`);
const joined = (await call(tok, "GET", `${G}/programs`)).programs.find((x: any) => x.id === prog.id);
check("join is idempotent", joined.joined === true, joined);
await call(tok, "DELETE", `${G}/programs/${prog.id}/join`);
await call(tok, "POST", `${G}/programs/not-a-program/join`, undefined, 404);

const la = await call(tok, "PUT", `${G}/projects/${a.id}/links`, { payment_enabled: true, payment_upi_id: "smoke@upi", extra_links: [{ id: "1", label: "Menu", url: "https://example.com" }] });
check("links saved on free project with premium", la.settings.payment_upi_id === "smoke@upi" && la.settings.premium_unlocked === true && la.settings.extra_links.length === 1, la.settings);
const lb = await call(tok, "PUT", `${G}/projects/${b.id}/links`, { premium_unlocked: true, digital_shop_url: "https://example.com/b" });
check("client can't grant premium", lb.settings.premium_unlocked === false && lb.settings.digital_shop_url === "https://example.com/b", lb.settings);
const la2 = await call(tok, "GET", `${G}/projects/${a.id}/links`);
check("links are per project", la2.settings.payment_upi_id === "smoke@upi" && la2.settings.digital_shop_url !== "https://example.com/b", la2.settings);

await call(tok, "DELETE", `${G}/products/${p2.id}`);
await call(tok, "DELETE", `${G}/projects/${b.id}`);
const left = await call(tok, "GET", `${G}/projects`);
check("project B deleted", left.projects.length === 1 && left.projects[0].id === a.id, left);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
