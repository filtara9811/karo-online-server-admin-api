import { randomUUID } from "crypto";

export const DEV_OTP = "1234";

export type MemLead = {
  id: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  sub_category_id: string | null;
  sub_category_name: string;
  item_ids: string[];
  item_names: string[];
  note: string | null;
  address: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  is_marketplace?: boolean;
  marketplace_reason?: string | null;
  marketplace_at?: string | null;
  accepted_count?: number;
  max_slots?: number;
  created_at: string;
  updated_at: string;
};

export type MemMessage = {
  id: string;
  lead_id: string;
  sender_id: string;
  sender_role: string;
  body: string | null;
  created_at: string;
};

const otpByPhone = new Map<string, { code: string; at: number }>();
const leads: MemLead[] = [];
const messages: MemMessage[] = [];

export function tableMissing(err: { message?: string } | null | undefined) {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    m.includes("could not find the function")
  );
}

export const SEED_CATALOG = {
  types: [{ id: "11111111-1111-4111-8111-111111111111", name: "Service", slug: "service", sort_order: 1, is_active: true }],
  categories: [
    { id: "22222222-2222-4222-8222-222222222221", name: "Home repair", slug: "home-repair", parent_id: null, sort_order: 1, image_url: "🔧", icon: null, keywords: [], type_id: "11111111-1111-4111-8111-111111111111", is_active: true },
    { id: "22222222-2222-4222-8222-222222222222", name: "Electrician", slug: "electrician", parent_id: "22222222-2222-4222-8222-222222222221", sort_order: 1, image_url: "⚡", icon: null, keywords: [], type_id: "11111111-1111-4111-8111-111111111111", is_active: true },
    { id: "22222222-2222-4222-8222-222222222223", name: "Plumber", slug: "plumber", parent_id: "22222222-2222-4222-8222-222222222221", sort_order: 2, image_url: "🚰", icon: null, keywords: [], type_id: "11111111-1111-4111-8111-111111111111", is_active: true },
    { id: "22222222-2222-4222-8222-222222222224", name: "AC repair", slug: "ac-repair", parent_id: "22222222-2222-4222-8222-222222222221", sort_order: 3, image_url: "❄️", icon: null, keywords: [], type_id: "11111111-1111-4111-8111-111111111111", is_active: true },
  ],
  items: [
    { id: "33333333-3333-4333-8333-333333333331", name: "Fan / switch", category_id: "22222222-2222-4222-8222-222222222222", image_url: null, group_tag: null, sort_order: 1, is_active: true },
    { id: "33333333-3333-4333-8333-333333333332", name: "Tap leak", category_id: "22222222-2222-4222-8222-222222222223", image_url: null, group_tag: null, sort_order: 1, is_active: true },
  ],
};

export function rememberOtp(phone: string, code = DEV_OTP) {
  otpByPhone.set(phone, { code, at: Date.now() });
  return code;
}

export function checkMemOtp(phone: string, code: string) {
  const row = otpByPhone.get(phone);
  if (!row) return code === DEV_OTP;
  return row.code === code;
}

export function createMemLead(input: Omit<MemLead, "id" | "created_at" | "updated_at" | "status"> & { status?: string }) {
  const now = new Date().toISOString();
  const lead: MemLead = {
    ...input,
    id: randomUUID(),
    status: input.status ?? "placed",
    is_marketplace: false,
    accepted_count: 0,
    max_slots: 3,
    created_at: now,
    updated_at: now,
  };
  leads.unshift(lead);
  return lead;
}

export function listMemLeads(customerId: string) {
  return leads.filter((l) => l.customer_id === customerId);
}

export function getMemLead(id: string) {
  return leads.find((l) => l.id === id) ?? null;
}

export function updateMemLead(id: string, patch: Partial<MemLead>) {
  const row = leads.find((l) => l.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  return row;
}

export function filterMemLeads(bucket = "all") {
  return leads.filter((l) => {
    if (bucket === "marketplace") return !!l.is_marketplace;
    if (bucket === "fulfilled") return l.status === "fulfilled" || l.status === "delivered" || l.status === "accepted";
    if (bucket === "zero") return !l.is_marketplace && (l.accepted_count ?? 0) === 0;
    if (bucket === "active") return !l.is_marketplace && (l.status === "placed" || l.status === "new");
    return true;
  });
}

export function addMemMessage(leadId: string, senderId: string, body: string, role = "customer") {
  const msg: MemMessage = {
    id: randomUUID(),
    lead_id: leadId,
    sender_id: senderId,
    sender_role: role,
    body,
    created_at: new Date().toISOString(),
  };
  messages.push(msg);
  return msg;
}

export function listMemMessages(leadId: string) {
  return messages.filter((m) => m.lead_id === leadId);
}

export function listAllMemLeads() {
  return leads;
}

export function seedNearbyVendors(origin?: { lat?: number; lng?: number } | null) {
  const lat = origin?.lat ?? 28.6562;
  const lng = origin?.lng ?? 77.241;
  return [
    {
      id: "44444444-4444-4444-8444-444444444441",
      user_id: "44444444-4444-4444-8444-444444444441",
      business_name: "Gold Hands Electric",
      owner_name: "Ravi",
      avatar_url: null,
      cover_image_url: null,
      status: "active",
      is_online: true,
      area: "Connaught Place",
      lat: lat + 0.004,
      lng: lng + 0.003,
      service_radius_km: 10,
      km: 0.6,
    },
    {
      id: "44444444-4444-4444-8444-444444444442",
      user_id: "44444444-4444-4444-8444-444444444442",
      business_name: "Quick Fix Plumbing",
      owner_name: "Aman",
      avatar_url: null,
      cover_image_url: null,
      status: "active",
      is_online: true,
      area: "Old Delhi",
      lat: lat - 0.003,
      lng: lng + 0.002,
      service_radius_km: 10,
      km: 0.4,
    },
    {
      id: "44444444-4444-4444-8444-444444444443",
      user_id: "44444444-4444-4444-8444-444444444443",
      business_name: "Cool Air AC",
      owner_name: "Neha",
      avatar_url: null,
      cover_image_url: null,
      status: "active",
      is_online: false,
      area: "Karol Bagh",
      lat: lat + 0.008,
      lng: lng - 0.004,
      service_radius_km: 12,
      km: 1.1,
    },
  ];
}

type MemShop = { id: string; user_id: string; name: string; slug: string; created_at: string };
type MemReferral = { id: string; referrer_id: string; code: string; name: string | null; phone: string | null; status: string; reward: number; created_at: string };

const shops: MemShop[] = [];
const referrals: MemReferral[] = [];

export function createMemShop(userId: string, name: string, slug: string) {
  const existing = shops.find((s) => s.user_id === userId);
  if (existing) {
    existing.name = name;
    existing.slug = slug;
    return existing;
  }
  const shop: MemShop = { id: randomUUID(), user_id: userId, name, slug, created_at: new Date().toISOString() };
  shops.unshift(shop);
  return shop;
}

export function getMemShopByUser(userId: string) {
  return shops.find((s) => s.user_id === userId) ?? null;
}

export function getMemShopBySlug(slug: string) {
  return shops.find((s) => s.slug === slug) ?? null;
}

export function listMemReferrals(referrerId: string) {
  return referrals.filter((r) => r.referrer_id === referrerId);
}

export function claimMemReferral(userId: string, code: string, name: string | null) {
  const row: MemReferral = {
    id: randomUUID(),
    referrer_id: userId,
    code: code.toUpperCase(),
    name,
    phone: null,
    status: "Joined",
    reward: 200,
    created_at: new Date().toISOString(),
  };
  referrals.unshift(row);
  return row;
}

const LANDING_PRODUCTS = [
  { id: "p1", name: "Express service visit", price: 299, category: "Quick" },
  { id: "p2", name: "Premium add-on kit", price: 799, category: "Shop" },
  { id: "p3", name: "Monthly care plan", price: 1499, category: "Plans" },
];

export function publicLanding(kind: string, code: string) {
  seedAdminTables();
  const shop = getMemShopBySlug(code);
  const name = shop?.name ?? (kind === "r" ? `Invite ${code}` : prettyCode(code));
  const visits = listMemVisits(code);
  return {
    ok: true,
    kind,
    code,
    name,
    title: name,
    slug: shop?.slug ?? code,
    phone: "9999999999",
    whatsapp: "919999999999",
    trade: "Verified local shop",
    is_online: true,
    linked: Boolean(shop) || kind !== "q",
    description: `Watch ${name}'s latest work, browse products, and chat on Karo Online.`,
    products: LANDING_PRODUCTS,
    stats: { views: 128 + visits.length, products: LANDING_PRODUCTS.length, rating: 4.8 },
    visit_count: visits.length + 1,
    is_returning: visits.length > 0,
    seeded: true,
  };
}

function prettyCode(code: string) {
  return code.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || code;
}

type MemVisit = {
  id: string;
  code: string;
  kind: string;
  source: string;
  visitor_name: string | null;
  visitor_phone: string | null;
  created_at: string;
};

const visits: MemVisit[] = [];

export function recordMemVisit(input: {
  code: string;
  kind?: string;
  source?: string;
  visitor_name?: string | null;
  visitor_phone?: string | null;
}) {
  const row: MemVisit = {
    id: randomUUID(),
    code: input.code,
    kind: input.kind ?? "s",
    source: input.source ?? "qr",
    visitor_name: input.visitor_name ?? null,
    visitor_phone: input.visitor_phone ?? null,
    created_at: new Date().toISOString(),
  };
  visits.unshift(row);
  memTableInsert("referral_link_visits", {
    id: row.id,
    source: row.source,
    visitor_name: row.visitor_name,
    visitor_phone: row.visitor_phone,
    created_at: row.created_at,
    code: row.code,
  });
  return row;
}

export function listMemVisits(code?: string) {
  return code ? visits.filter((v) => v.code === code) : visits;
}

type MemFormSub = { id: string; slug: string; data: Record<string, unknown>; created_at: string };
const formSubs: MemFormSub[] = [];

export function memCmsPage(slug: string) {
  seedAdminTables();
  const page = memTableList("web_pages").find((p) => p.slug === slug) ?? {
    slug,
    title: prettyCode(slug),
    is_active: true,
  };
  return {
    page,
    hero: memTableList("web_hero_sections").find((h) => h.page_slug === slug) ?? null,
    blocks: memTableList("web_content_blocks").filter((b) => b.page_slug === slug),
    faqs: memTableList("web_faqs").filter((f) => !f.page_slug || f.page_slug === slug),
    offer: memTableList("web_offers")[0] ?? null,
  };
}

export function memBlogPosts() {
  seedAdminTables();
  return memTableList("web_blog_posts").filter((p) => p.is_published !== false);
}

export function memBlogPost(slug: string) {
  return memBlogPosts().find((p) => p.slug === slug) ?? null;
}

export function memLegalPage(slug: string) {
  seedAdminTables();
  return memTableList("legal_pages").find((p) => p.slug === slug) ?? null;
}

export function memSubmitForm(slug: string, data: Record<string, unknown>, sourcePage?: string) {
  seedAdminTables();
  const form = memTableList("web_forms").find((f) => f.slug === slug && f.is_active !== false);
  if (!form) return { ok: false as const, error: "Form not found" };
  const row: MemFormSub = { id: randomUUID(), slug, data, created_at: new Date().toISOString() };
  formSubs.unshift(row);
  memTableInsert("web_form_submissions", { ...row, form_id: form.id, source_page: sourcePage ?? null });
  return { ok: true as const };
}

export function memSiteBundle() {
  seedAdminTables();
  return {
    offer: memTableList("web_offers")[0] ?? null,
    testimonials: memTableList("web_testimonials"),
    pricing: memTableList("web_pricing_plans"),
    faqs: memTableList("web_faqs"),
    apk: memTableList("web_apk_releases")[0] ?? {
      play_store_url: "https://play.google.com/store/apps/details?id=app.karoonline.twa",
      label: "Get the app",
    },
  };
}

const adminTables = new Map<string, Record<string, unknown>[]>();

function seedAdminTables() {
  if (adminTables.size) return;
  adminTables.set("catalog_types", SEED_CATALOG.types.map((r) => ({ ...r })));
  adminTables.set("categories", SEED_CATALOG.categories.map((r) => ({ ...r })));
  adminTables.set("catalog_items", SEED_CATALOG.items.map((r) => ({ ...r })));
  adminTables.set("sms_gateways", [
    {
      id: randomUUID(),
      provider: "fast2sms",
      display_name: "Fast2SMS (dev)",
      is_active: false,
      is_test_mode: true,
      config: { api_key: "", sender_id: "", template_id: "" },
      created_at: new Date().toISOString(),
    },
  ]);
  adminTables.set("payment_gateways", [
    {
      id: randomUUID(),
      provider: "razorpay",
      display_name: "Razorpay",
      is_active: false,
      is_test_mode: true,
      public_key: "",
      config: { secret_key: "" },
      purpose: "both",
      priority: 1,
      created_at: new Date().toISOString(),
    },
  ]);
  adminTables.set("whatsapp_providers", [
    {
      id: randomUUID(),
      provider: "meta",
      display_name: "WhatsApp Cloud",
      is_active: false,
      is_test_mode: true,
      phone_number_id: "",
      access_token: "",
      default_template: "otp_login",
      created_at: new Date().toISOString(),
    },
  ]);
  adminTables.set("test_accounts", [
    { id: randomUUID(), phone: "9999999999", otp_code: "1234", enabled: true, created_at: new Date().toISOString() },
  ]);
  adminTables.set("maps_services", [
    { id: randomUUID(), provider: "google", name: "Google Maps", is_active: false, created_at: new Date().toISOString() },
  ]);
  adminTables.set("qr_landing_themes", [
    {
      id: "classic",
      key: "classic",
      name: "Classic gold",
      preset: "classic",
      accent_color: "#d4af37",
      bg_from: "#1a1208",
      bg_to: "#0a0804",
      is_premium: false,
      is_active: true,
    },
    {
      id: "cream",
      key: "cream",
      name: "Cream maison",
      preset: "cream",
      accent_color: "#b8860b",
      bg_from: "#faf9f6",
      bg_to: "#f5f4f0",
      is_premium: false,
      is_active: true,
    },
    {
      id: "night",
      key: "night",
      name: "Night market",
      preset: "night",
      accent_color: "#f5d97a",
      bg_from: "#12100a",
      bg_to: "#000000",
      is_premium: true,
      is_active: false,
    },
  ]);
  adminTables.set("merchant_link_settings", [
    { id: randomUUID(), user_id: "seed-merchant", landing_theme_key: "classic", updated_at: new Date().toISOString() },
  ]);
  adminTables.set("referral_link_visits", []);
  adminTables.set("qr_projects", [
    { id: randomUUID(), title: "Storefront QR", slug: "demo", is_paid: true, created_at: new Date().toISOString() },
  ]);
  adminTables.set("vendor_subscription_plans", [
    { id: "starter", name: "Starter", price: 0, interval: "lead", is_active: true, features: ["Pay per accepted lead"] },
    { id: "pro", name: "Pro", price: 999, interval: "month", is_active: true, features: ["Priority leads", "Featured shop"] },
  ]);
  adminTables.set("web_pages", [
    { id: randomUUID(), slug: "welcome", title: "KaroOnline", is_active: true },
    { id: randomUUID(), slug: "about", title: "About", is_active: true },
  ]);
  adminTables.set("web_hero_sections", [
    {
      id: randomUUID(),
      page_slug: "welcome",
      eyebrow: "India's Premium Hyperlocal Marketplace",
      title: "Local vendors. Premium service. Delivered fast.",
      subtitle: "Find trusted vendors near you — repairs, beauty, cleaning, products and more.",
      is_active: true,
    },
  ]);
  adminTables.set("web_content_blocks", []);
  adminTables.set("web_faqs", [
    { id: randomUUID(), page_slug: "welcome", question: "Is Karo Online free for customers?", answer: "Yes. Customers never pay a platform fee.", is_active: true, sort_order: 1 },
    { id: randomUUID(), page_slug: "welcome", question: "How do vendors get paid?", answer: "Vendors pay only for accepted leads. No monthly minimum.", is_active: true, sort_order: 2 },
  ]);
  adminTables.set("web_offers", [
    { id: randomUUID(), text: "Scan a shop QR and order in one tap.", is_active: true, updated_at: new Date().toISOString() },
  ]);
  adminTables.set("web_testimonials", [
    { id: randomUUID(), name: "Asha", city: "Delhi", quote: "Found a plumber in minutes.", rating: 5, is_active: true },
    { id: randomUUID(), name: "Ravi", city: "Jaipur", quote: "My One QR shop gets walk-ins every day.", rating: 5, is_active: true },
  ]);
  adminTables.set("web_pricing_plans", [
    { id: "customer", name: "Customer", price: "Free", sub: "Forever, for everyone.", accent: false, features: ["Unlimited service requests", "Real-time vendor bids", "Secure payments", "Live tracking"] },
    { id: "starter", name: "Vendor — Starter", price: "₹0", sub: "Setup fee. Pay-per-lead.", accent: true, features: ["Free onboarding", "Pay only for accepted leads", "Shop + catalog", "In-app chat"] },
    { id: "pro", name: "Vendor — Pro", price: "Custom", sub: "For high-volume businesses.", accent: false, features: ["Priority leads", "Featured shop", "Multi-staff", "Dedicated manager"] },
  ]);
  adminTables.set("web_blog_posts", [
    {
      id: randomUUID(),
      slug: "why-one-qr",
      title: "Why every shop needs One QR",
      excerpt: "One printed code. Videos, products, chat and orders.",
      body: "One QR turns a physical shop into a live storefront. Customers scan, watch your work, and order without downloading an app first.",
      is_published: true,
      author_name: "Karo Online",
      published_at: new Date().toISOString(),
      reading_minutes: 3,
      tags: ["one-qr", "shops"],
    },
    {
      id: randomUUID(),
      slug: "hyperlocal-leads",
      title: "How hyperlocal leads work",
      excerpt: "Nearby vendors bid. You pick. Work starts.",
      body: "Karo Online matches a request to online vendors in your radius. You see quotes, chat, and track the job.",
      is_published: true,
      author_name: "Karo Online",
      published_at: new Date().toISOString(),
      reading_minutes: 4,
      tags: ["quick", "leads"],
    },
  ]);
  adminTables.set("web_forms", [
    {
      id: "contact",
      slug: "contact",
      title: "Contact Karo Online",
      is_active: true,
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "phone", label: "Phone", type: "tel", required: true },
        { name: "message", label: "Message", type: "textarea", required: true },
      ],
    },
    {
      id: "join-vendor",
      slug: "join-vendor",
      title: "Become a vendor",
      is_active: true,
      fields: [
        { name: "name", label: "Business name", type: "text", required: true },
        { name: "phone", label: "Phone", type: "tel", required: true },
        { name: "city", label: "City", type: "text", required: true },
      ],
    },
  ]);
  adminTables.set("legal_pages", [
    { id: randomUUID(), slug: "privacy", title: "Privacy Policy", html: "<p>Karo Online collects only what is needed to match you with nearby vendors, process orders, and keep your account secure.</p>" },
    { id: randomUUID(), slug: "terms", title: "Terms and Conditions", html: "<p>By using Karo Online you agree to fair use, verified identity for withdrawals, and our lead-acceptance rules for vendors.</p>" },
    { id: randomUUID(), slug: "shipping", title: "Shipping Policy", html: "<p>Digital shop orders are fulfilled by the merchant. Delivery windows are shown at checkout.</p>" },
    { id: randomUUID(), slug: "refund", title: "Refund Policy", html: "<p>Unused lead charges and undelivered shop orders are refunded to the original payment method.</p>" },
  ]);
  adminTables.set("web_apk_releases", [
    { id: randomUUID(), play_store_url: "https://play.google.com/store/apps/details?id=app.karoonline.twa", label: "Download on Play Store" },
  ]);
  if (!getMemShopBySlug("demo")) createMemShop("seed-merchant", "Karo Maison", "demo");
}

export function memTableList(table: string) {
  seedAdminTables();
  return adminTables.get(table) ?? [];
}

export function memTableInsert(table: string, row: Record<string, unknown>) {
  seedAdminTables();
  const next = {
    id: typeof row.id === "string" && row.id ? row.id : randomUUID(),
    ...row,
    created_at: row.created_at ?? new Date().toISOString(),
  };
  const rows = adminTables.get(table) ?? [];
  rows.unshift(next);
  adminTables.set(table, rows);
  return next;
}

export function memTableUpdate(table: string, id: string, patch: Record<string, unknown>) {
  seedAdminTables();
  const rows = adminTables.get(table) ?? [];
  const idx = rows.findIndex((r) => String(r.id) === id);
  if (idx < 0) {
    const created = memTableInsert(table, { ...patch, id });
    return created;
  }
  rows[idx] = { ...rows[idx], ...patch, id, updated_at: new Date().toISOString() };
  return rows[idx];
}

export function memTableDelete(table: string, id: string) {
  seedAdminTables();
  const rows = (adminTables.get(table) ?? []).filter((r) => String(r.id) !== id);
  adminTables.set(table, rows);
  return id;
}

export function memStats() {
  seedAdminTables();
  return {
    customers: { total: new Set(leads.map((l) => l.customer_id)).size, week: 0, month: 0, blocked: 0 },
    vendors: { total: 3, week: 0, month: 0, blocked: 0 },
    staff: { total: 0, week: 0, month: 0, blocked: 0 },
    categories: memTableList("categories").length,
    catalog: memTableList("categories").length,
    activeGateways: memTableList("payment_gateways").filter((g) => g.is_active).length,
    activeLogistics: 0,
    coinRate: 1,
    leads: leads.length,
    using_memory: true,
  };
}
