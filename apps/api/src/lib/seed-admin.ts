import { getServiceRoleClient, tryServiceRole } from "./supabase.js";

const EMAIL = "admin@karoonline.local";
const PASSWORD = "KaroAdmin@2026";

export async function seedBootstrapAdmin() {
  const { env } = await import("../config/env.js");
  if (env.supabaseUrl.includes("lxwttwccbtxdpnrzadgj")) {
    console.log("[seed-admin] skipped — live Supabase project, no writes");
    return;
  }
  const sb = tryServiceRole();
  if (!sb) return;
  const admin = getServiceRoleClient();
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = existing.users.find((u) => u.email === EMAIL);
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: "super_admin", name: "Super Admin" },
    });
    if (created.error) {
      console.warn("[seed-admin]", created.error.message);
      return;
    }
    user = created.data.user;
  }
  if (!user) return;
  const { error } = await admin.from("user_roles").upsert(
    { user_id: user.id, role: "super_admin" },
    { onConflict: "user_id" },
  );
  if (error && /no unique|on conflict/i.test(error.message)) {
    await admin.from("user_roles").insert({ user_id: user.id, role: "super_admin" });
  }
  if (error && !/schema cache|does not exist/i.test(error.message)) {
    console.warn("[seed-admin] roles", error.message);
    return;
  }
  console.log(`[seed-admin] ready  ${EMAIL}  /  ${PASSWORD}`);
}
