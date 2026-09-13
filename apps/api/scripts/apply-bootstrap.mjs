import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(import.meta.dirname, "../.env");
const envText = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envText
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
if (!url || !key) {
  console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (url.includes("lxwttwccbtxdpnrzadgj")) {
  console.error("refusing to touch the old Lovable project");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${key}`,
  apikey: key,
  "Content-Type": "application/json",
};

async function probe(label, request) {
  try {
    const res = await fetch(request);
    const text = await res.text();
    const snippet = text.slice(0, 160).replace(/\s+/g, " ");
    console.log(`${label}  ${res.status}  ${snippet}`);
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    console.log(`${label}  error  ${err instanceof Error ? err.message : err}`);
    return { ok: false, status: 0, text: "" };
  }
}

const auth = await probe(
  "auth",
  new Request(`${url}/auth/v1/admin/users?page=1&per_page=1`, { headers }),
);
if (!auth.ok) {
  console.error("service_role key was rejected");
  process.exit(1);
}

const tables = await probe(
  "tables",
  new Request(`${url}/rest/v1/user_roles?select=id&limit=1`, { headers }),
);

if (tables.ok) {
  console.log("schema already present");
} else {
  const sql = readFileSync(resolve(import.meta.dirname, "../../../supabase/bootstrap.sql"), "utf8");
  const attempts = [
    `${url}/pg/query`,
    `${url}/pg-meta/default/query`,
  ];
  let applied = false;
  for (const endpoint of attempts) {
    const result = await probe(
      endpoint.replace(url, ""),
      new Request(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: sql }),
      }),
    );
    if (result.ok) {
      applied = true;
      break;
    }
  }
  if (!applied) {
    console.log("could not apply SQL remotely — open SQL Editor and run supabase/bootstrap.sql");
  }
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = "admin@karoonline.local";
const password = "KaroAdmin@2026";
const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
let user = existing.users.find((u) => u.email === email);
if (!user) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "super_admin", name: "Super Admin" },
  });
  if (created.error) {
    console.error("create admin", created.error.message);
    process.exit(1);
  }
  user = created.data.user;
  console.log("created bootstrap admin user");
} else {
  console.log("bootstrap admin user already exists");
}
if (user) {
  const { error } = await admin.from("user_roles").upsert(
    { user_id: user.id, role: "super_admin" },
    { onConflict: "user_id" },
  );
  if (error) console.log("user_roles", error.message);
  else console.log("user_roles ready");
}
console.log("done");
