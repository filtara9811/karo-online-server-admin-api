import "dotenv/config";
import { getPool, signLocalJwt } from "../src/lib/pg-client.js";

// Read-only pass over the vendor dashboard endpoints for the seeded test vendor.
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000";
const VENDOR = process.env.SMOKE_VENDOR ?? "44444444-4444-4444-8444-444444444441";

const tok = (await signLocalJwt({ id: VENDOR, email: "smoke-vendor@karoonline.in" })).token;
for (const path of [
  "/v1/vendor/nearby",
  "/v1/vendor/nearby?radius_km=5",
  "/v1/vendor/stats?range=week",
  "/v1/vendor/accepted",
  "/v1/vendor/notifications",
  "/v1/vendor/profile-finder",
  "/v1/vendor/leads?filter=all&tab=my",
  "/v1/vendor/leads?filter=all&tab=auto",
]) {
  const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}` } });
  const j = (await r.json().catch(() => ({}))) as any;
  console.log(r.status, path, JSON.stringify(j.data ?? j).slice(0, 220));
}
await getPool().end();
