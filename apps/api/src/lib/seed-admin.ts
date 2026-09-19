import { getServiceRoleClient, tryServiceRole } from "./supabase.js";
import { hasDatabase } from "../config/env.js";

const EMAIL = "admin@karoonline.local";
const PASSWORD = "KaroAdmin@2026";

export async function seedBootstrapAdmin() {
  const { env } = await import("../config/env.js");
  if (env.supabaseUrl.includes("lxwttwccbtxdpnrzadgj") && !hasDatabase()) {
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
    user = created.data.user ?? undefined;
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

const SMS_SEEDS = [
  {
    provider: "msg91",
    display_name: "MSG91",
    is_active: false,
    is_test_mode: true,
    config: { auth_key: "", sender_id: "", template_id: "", route: "4", country: "91" },
  },
  {
    provider: "fast2sms",
    display_name: "Fast2SMS",
    is_active: false,
    is_test_mode: true,
    config: { api_key: "", sender_id: "FSTSMS", route: "otp", message_id: "", template_id: "" },
  },
];

/** SMS keys were never copied from Supabase (table skipped in dump + RLS). Ensure both cards exist. */
export async function seedSmsGateways() {
  const admin = tryServiceRole();
  if (!admin) return;
  const { data, error } = await admin.from("sms_gateways").select("id, provider, display_name");
  if (error) {
    console.warn("[seed-sms]", error.message);
    return;
  }
  const have = new Map<string, { id: string; provider: string; display_name?: string }>(
    (data ?? []).map((r: { id: string; provider: string; display_name?: string }) => [String(r.provider), r]),
  );
  for (const seed of SMS_SEEDS) {
    const existing = have.get(seed.provider);
    if (!existing) {
      const { error: insErr } = await admin.from("sms_gateways").insert(seed);
      if (insErr) console.warn("[seed-sms] insert", seed.provider, insErr.message);
      else console.log("[seed-sms] inserted", seed.provider);
      continue;
    }
    if (/dev/i.test(String(existing.display_name ?? ""))) {
      await admin.from("sms_gateways").update({ display_name: seed.display_name }).eq("id", existing.id);
    }
  }
}
