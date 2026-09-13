import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tryServiceRole } from "./supabase.js";

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export const LookupSchema = z.object({ q: z.string().min(1).max(120) });
export const UserIdSchema = z.object({ userId: z.string().uuid() });

export const customerPatchSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  avatar_url: z.string().max(2000).nullable().optional(),
  is_blocked: z.boolean().optional(),
  verified: z.boolean().optional(),
  status: z.string().max(40).optional(),
  admin_notes: z.string().max(2000).nullable().optional(),
});

export const vendorPatchSchema = z.object({
  business_name: z.string().max(200).nullable().optional(),
  owner_name: z.string().max(120).nullable().optional(),
  trade: z.string().max(120).nullable().optional(),
  deals_in: z.string().max(120).nullable().optional(),
  whatsapp: z.string().max(20).nullable().optional(),
  manager_email: z.string().max(255).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  gst: z.string().max(50).nullable().optional(),
  pan: z.string().max(50).nullable().optional(),
  aadhaar: z.string().max(50).nullable().optional(),
  plan: z.string().max(40).nullable().optional(),
  status: z.string().max(40).optional(),
  verified: z.boolean().optional(),
  is_blocked: z.boolean().optional(),
  admin_notes: z.string().max(2000).nullable().optional(),
});

export const WalletSchema = z.object({
  kind: z.enum(["coin", "service"]),
  direction: z.enum(["credit", "debit"]),
  amount: z.number().int().positive().max(10_000_000),
  reason: z.string().min(1).max(300),
});

export const BlockSchema = z.object({ blocked: z.boolean() });
export const ApprovalSchema = z.object({ approved: z.boolean() });
export const KycStatusSchema = z.object({
  status: z.enum(["approved", "rejected", "pending"]),
  notes: z.string().max(500).optional(),
});

export async function lookupUser(sb: SupabaseClient, qRaw: string) {
  const q = qRaw.trim();
  const digits = onlyDigits(q);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

  let customers: Record<string, unknown>[] = [];

  if (isUuid) {
    const { data: rows } = await sb.from("customers").select("*").or(`id.eq.${q},user_id.eq.${q}`);
    customers = (rows ?? []) as Record<string, unknown>[];
  } else if (digits.length === 4) {
    const { data: rows } = await sb.from("customers").select("*").eq("support_code", digits);
    customers = (rows ?? []) as Record<string, unknown>[];
  } else {
    const orParts: string[] = [];
    if (digits.length >= 6) orParts.push(`phone.ilike.%${digits.slice(-10)}%`);
    if (q.includes("@")) orParts.push(`email.ilike.%${q}%`);
    orParts.push(`name.ilike.%${q}%`);
    if (digits.length === 4) orParts.push(`support_code.eq.${digits}`);
    const { data: rows } = await sb.from("customers").select("*").or(orParts.join(",")).limit(20);
    customers = (rows ?? []) as Record<string, unknown>[];
  }

  const userIds = customers.map((c) => c.user_id as string).filter(Boolean);
  let vendors: Record<string, unknown>[] = [];
  let wallets: Record<string, unknown>[] = [];
  if (userIds.length > 0) {
    const [{ data: v }, { data: w }] = await Promise.all([
      sb.from("vendors").select("*").in("user_id", userIds),
      sb.from("vendor_wallets").select("*").in("vendor_id", userIds),
    ]);
    vendors = (v ?? []) as Record<string, unknown>[];
    wallets = (w ?? []) as Record<string, unknown>[];
  }

  return {
    results: customers.map((c) => ({
      customer: c,
      vendor: vendors.find((v) => v.user_id === c.user_id) ?? null,
      wallet: wallets.find((w) => w.vendor_id === c.user_id) ?? null,
    })),
  };
}

export async function getUserFull(sb: SupabaseClient, uid: string) {
  const privileged = tryServiceRole() ?? sb;
  const [c, v, w, tx, leads, refs] = await Promise.all([
    sb.from("customers").select("*").eq("user_id", uid).maybeSingle(),
    sb.from("vendors").select("*").eq("user_id", uid).maybeSingle(),
    sb.from("vendor_wallets").select("*").eq("vendor_id", uid).maybeSingle(),
    sb.from("wallet_transactions").select("*").eq("vendor_id", uid).order("created_at", { ascending: false }).limit(25),
    sb
      .from("leads")
      .select("id,sub_category_name,status,created_at,lead_price_inr")
      .or(`customer_id.eq.${uid},accepted_vendor_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(20),
    privileged.from("referrals").select("*").or(`referrer_user_id.eq.${uid},referred_user_id.eq.${uid}`).limit(20),
  ]);
  return {
    customer: c.data ?? null,
    vendor: v.data ?? null,
    wallet: w.data ?? null,
    transactions: tx.data ?? [],
    leads: leads.data ?? [],
    referrals: refs.data ?? [],
  };
}

export async function updateCustomerProfile(
  sb: SupabaseClient,
  userId: string,
  patch: z.infer<typeof customerPatchSchema>,
) {
  const { error } = await sb
    .from("customers")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updateVendorProfile(
  sb: SupabaseClient,
  userId: string,
  patch: z.infer<typeof vendorPatchSchema>,
) {
  const { error } = await sb
    .from("vendors")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function adjustWallet(sb: SupabaseClient, userId: string, data: z.infer<typeof WalletSchema>) {
  const { data: res, error } = await sb.rpc("admin_adjust_wallet", {
    _user_id: userId,
    _kind: data.kind,
    _direction: data.direction,
    _amount: data.amount,
    _reason: data.reason,
  });
  if (error) throw new Error(error.message);
  return res;
}

export async function setUserBlock(sb: SupabaseClient, userId: string, blocked: boolean) {
  await sb.from("customers").update({ is_blocked: blocked, updated_at: new Date().toISOString() }).eq("user_id", userId);
  await sb.from("vendors").update({ is_blocked: blocked, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return { ok: true };
}

export async function setVendorApproval(sb: SupabaseClient, userId: string, approved: boolean) {
  const { error } = await sb
    .from("vendors")
    .update({
      status: approved ? "active" : "pending",
      verified: approved,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function setKycStatus(
  sb: SupabaseClient,
  kycId: string,
  status: "approved" | "rejected" | "pending",
  notes?: string,
) {
  const { error } = await sb.rpc("admin_set_kyc_status", {
    _kyc_id: kycId,
    _status: status,
    _notes: notes ?? null,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getAdminStats(sb: SupabaseClient) {
  const [statsRes, catRes, gwRes, lgRes, cpRes, leadRes] = await Promise.all([
    sb.rpc("get_admin_stats"),
    sb.from("categories").select("id", { count: "exact", head: true }),
    sb.from("payment_gateways").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("logistics_gateways").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("coin_pricing_config").select("coin_rate_inr").limit(1).maybeSingle(),
    sb.from("leads").select("id", { count: "exact", head: true }),
  ]);
  const rpc = statsRes.data as { customers?: { total: number }; vendors?: { total: number }; staff?: { total: number } } | null;
  if (catRes.error || statsRes.error) {
    const { tableMissing, memStats } = await import("./memory.js");
    if (tableMissing(catRes.error) || tableMissing(statsRes.error)) {
      return { ...memStats(), rpc: null, seeded: true };
    }
  }
  return {
    rpc: statsRes.data ?? null,
    rpc_error: statsRes.error?.message ?? null,
    customers: rpc?.customers ?? { total: 0, week: 0, month: 0, blocked: 0 },
    vendors: rpc?.vendors ?? { total: 0, week: 0, month: 0, blocked: 0 },
    staff: rpc?.staff ?? { total: 0, week: 0, month: 0, blocked: 0 },
    categories: catRes.count ?? 0,
    activeGateways: gwRes.count ?? 0,
    activeLogistics: lgRes.count ?? 0,
    coinRate: Number(cpRes.data?.coin_rate_inr ?? 0),
    leads: leadRes.count ?? 0,
  };
}

export const ADMIN_CRUD_TABLES = [
  "payment_gateways",
  "cashfree_services",
  "sms_gateways",
  "whatsapp_providers",
  "firebase_services",
  "maps_services",
  "logistics_gateways",
  "kyc_providers",
  "voice_providers",
  "test_accounts",
  "app_settings",
  "theme_settings",
  "legal_pages",
  "onboarding_slides",
  "oneqr_tutorial_videos",
  "referral_settings",
  "referral_banners",
  "referral_campaigns",
  "coin_packs",
  "coin_pricing_config",
  "notification_templates",
  "notification_triggers",
  "notification_campaigns",
  "form_schemas",
  "web_pages",
  "web_hero_sections",
  "web_content_blocks",
  "web_faqs",
  "web_forms",
  "web_blog_posts",
  "web_testimonials",
  "web_brand_logos",
  "web_offers",
  "web_pricing_plans",
  "web_apk_releases",
  "web_media_assets",
  "feedback_reports",
  "categories",
  "catalog_items",
  "catalog_groups",
  "catalog_types",
  "qr_batches",
  "qr_assets",
  "qr_landing_themes",
  "qr_projects",
  "referral_link_visits",
  "merchant_link_settings",
  "vendor_subscription_plans",
  "staff_tasks",
  "device_fingerprints",
  "kyc_verifications",
  "web_virtual_devices",
] as const;

export type AdminCrudTable = (typeof ADMIN_CRUD_TABLES)[number];

export function isAllowedTable(table: string): table is AdminCrudTable {
  return (ADMIN_CRUD_TABLES as readonly string[]).includes(table);
}
