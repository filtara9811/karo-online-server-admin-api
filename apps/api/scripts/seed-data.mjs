import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(import.meta.dirname, "../.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.includes("vnznexcljflhqethnjlh") || !key) {
  console.error("refusing to seed — unexpected project or missing key");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function upsert(table, rows, onConflict) {
  const { error } = await admin.from(table).upsert(rows, { onConflict, ignoreDuplicates: false });
  if (error) {
    console.log(`${table}: ${error.message}`);
    return false;
  }
  console.log(`${table}: ${rows.length} rows`);
  return true;
}

const probe = await admin.from("categories").select("id", { count: "exact", head: true });
if (probe.error) {
  console.error("tables missing:", probe.error.message);
  process.exit(2);
}

const types = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Service", slug: "service", sort_order: 1, is_active: true },
];
const categories = [
  { id: "22222222-2222-4222-8222-222222222221", name: "Home repair", slug: "home-repair", parent_id: null, sort_order: 1, image_url: "🔧", type_id: types[0].id, is_active: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "Electrician", slug: "electrician", parent_id: "22222222-2222-4222-8222-222222222221", sort_order: 1, image_url: "⚡", type_id: types[0].id, is_active: true },
  { id: "22222222-2222-4222-8222-222222222223", name: "Plumber", slug: "plumber", parent_id: "22222222-2222-4222-8222-222222222221", sort_order: 2, image_url: "🚰", type_id: types[0].id, is_active: true },
  { id: "22222222-2222-4222-8222-222222222224", name: "AC repair", slug: "ac-repair", parent_id: "22222222-2222-4222-8222-222222222221", sort_order: 3, image_url: "❄️", type_id: types[0].id, is_active: true },
];
const items = [
  { id: "33333333-3333-4333-8333-333333333331", name: "Fan / switch", category_id: "22222222-2222-4222-8222-222222222222", sort_order: 1, is_active: true },
  { id: "33333333-3333-4333-8333-333333333332", name: "Tap leak", category_id: "22222222-2222-4222-8222-222222222223", sort_order: 1, is_active: true },
  { id: "33333333-3333-4333-8333-333333333333", name: "AC not cooling", category_id: "22222222-2222-4222-8222-222222222224", sort_order: 1, is_active: true },
];
const vendors = [
  { id: "44444444-4444-4444-8444-444444444441", user_id: "44444444-4444-4444-8444-444444444441", business_name: "Gold Hands Electric", owner_name: "Ravi", status: "active", is_online: true, lat: 28.6602, lng: 77.244, service_radius_km: 10 },
  { id: "44444444-4444-4444-8444-444444444442", user_id: "44444444-4444-4444-8444-444444444442", business_name: "Quick Fix Plumbing", owner_name: "Aman", status: "active", is_online: true, lat: 28.6532, lng: 77.243, service_radius_km: 10 },
  { id: "44444444-4444-4444-8444-444444444443", user_id: "44444444-4444-4444-8444-444444444443", business_name: "Cool Air AC", owner_name: "Neha", status: "active", is_online: false, lat: 28.6642, lng: 77.237, service_radius_km: 12 },
];
const mappings = [
  { id: "55555555-5555-4555-8555-555555555551", vendor_id: vendors[0].id, item_id: items[0].id, is_active: true },
  { id: "55555555-5555-4555-8555-555555555552", vendor_id: vendors[1].id, item_id: items[1].id, is_active: true },
  { id: "55555555-5555-4555-8555-555555555553", vendor_id: vendors[2].id, item_id: items[2].id, is_active: true },
];

const okTypes = await upsert("catalog_types", types, "id");
const okCats = await upsert("categories", categories, "id");
const okItems = await upsert("catalog_items", items, "id");
const okVendors = await upsert("vendors", vendors, "id");
const okMaps = await upsert("vendor_item_mappings", mappings, "id");
const okTest = await upsert("test_accounts", [{ phone: "9999999999", otp_code: "1234", enabled: true }], "phone");

const email = "admin@karoonline.local";
const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
let user = existing.users.find((u) => u.email === email);
if (!user) {
  const created = await admin.auth.admin.createUser({
    email,
    password: "KaroAdmin@2026",
    email_confirm: true,
    user_metadata: { role: "super_admin", name: "Super Admin" },
  });
  if (created.error) {
    console.log("admin user:", created.error.message);
  } else {
    user = created.data.user;
    console.log("admin user: created");
  }
} else {
  console.log("admin user: exists");
}
if (user) {
  await upsert("user_roles", [{ user_id: user.id, role: "super_admin" }], "user_id");
}

if (![okTypes, okCats, okItems, okVendors, okMaps, okTest].every(Boolean)) {
  process.exit(1);
}
console.log("seed complete");
