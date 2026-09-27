import pg from "pg";
import { env } from "../config/env.js";
import { hasDatabase } from "./pg-client.js";

/** Columns/tables the vendor module needs on DigitalOcean. Every statement is idempotent. */
const STATEMENTS = [
  // vendors — business profile, onboarding, social, operation settings
  ...[
    "whatsapp text",
    "email text",
    "entity text",
    "trade text",
    "deals_in text",
    "role text",
    "city text",
    "state text",
    "pincode text",
    "address text",
    "gst text",
    "pan text",
    "onboarding_step int default 0",
    "auto_accept_leads boolean default false",
    "verified boolean default false",
    "is_premium boolean default false",
    "plan text",
    "plan_ref text",
    "payment_completed boolean default false",
    "gallery_urls text[] default '{}'",
    "cover_video_url text",
    "shop_bio text",
    "instagram text",
    "facebook text",
    "website text",
    "google_place_id text",
    "updated_at timestamptz default now()",
  ].map((c) => `alter table public.vendors add column if not exists ${c}`),

  ...[
    "price_min numeric",
    "price_max numeric",
    "notes text",
    "variations jsonb default '[]'::jsonb",
    "created_at timestamptz default now()",
    "updated_at timestamptz default now()",
  ].map((c) => `alter table public.vendor_item_mappings add column if not exists ${c}`),
  `create unique index if not exists vendor_item_mappings_vendor_item_uidx on public.vendor_item_mappings (vendor_id, item_id)`,

  ...[
    "responded_at timestamptz",
    "vendor_started_at timestamptz",
    "auto_matched boolean default false",
    "rejection_reason text",
    "quoted_price numeric",
    "sub_category_name text",
  ].map((c) => `alter table public.lead_notifications add column if not exists ${c}`),
  `create unique index if not exists lead_notifications_lead_vendor_uidx on public.lead_notifications (lead_id, vendor_id)`,
  `alter table public.lead_notifications add column if not exists auto_accept_at timestamptz`,
  `alter table public.lead_notifications alter column auto_accept_at set default (now() + interval '15 seconds')`,
  `create index if not exists lead_notifications_auto_accept_idx on public.lead_notifications (auto_accept_at) where status = 'pending'`,

  ...[
    "accepted_at timestamptz",
    "group_name text",
    "vendor_types text[]",
    "search_radius_km numeric",
    "verified_only boolean default false",
    "online_only boolean default false",
    "customer_approved_vendor_id uuid",
  ].map(
    (c) => `alter table public.leads add column if not exists ${c}`,
  ),

  `alter table public.lead_messages add column if not exists read_at timestamptz`,

  ...[
    "leadx_coins int default 0",
    "leads_total int default 0",
    "leads_used int default 0",
    "lifetime_coins_purchased int default 0",
    "lifetime_coins_used int default 0",
  ].map((c) => `alter table public.vendor_wallets add column if not exists ${c}`),

  ...[
    "direction text",
    "coins int",
    "description text",
    "status text default 'success'",
    "wallet_kind text",
    "metadata jsonb default '{}'::jsonb",
  ].map((c) => `alter table public.wallet_transactions add column if not exists ${c}`),

  ...[
    "subject_type text",
    "check_type text",
    "document_number text",
    "document_urls text[] default '{}'",
    "request_payload jsonb default '{}'::jsonb",
    "reviewer_notes text",
  ].map((c) => `alter table public.kyc_verifications add column if not exists ${c}`),

  ...["lead_id uuid", "status_key text"].map(
    (c) => `alter table public.vendor_status_updates add column if not exists ${c}`,
  ),

  ...[
    "description text",
    "image_url text",
    "mrp numeric",
    "wholesale_price numeric",
    "unit text",
    "sort_order int default 0",
    "category_id uuid",
    "updated_at timestamptz default now()",
  ].map((c) => `alter table public.shop_products add column if not exists ${c}`),

  `create table if not exists public.shop_categories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null, name text not null, image_url text, icon text,
    sort_order int default 0, is_active boolean default true,
    created_at timestamptz default now())`,
  `create table if not exists public.shop_banners (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null, image_url text not null, title text, subtitle text, link_url text,
    sort_order int default 0, is_active boolean default true,
    created_at timestamptz default now())`,
  `create table if not exists public.vendor_customer_visits (
    id uuid primary key default gen_random_uuid(),
    vendor_id uuid not null, visitor_name text, visitor_phone text,
    visit_count int default 1, source_kind text, source_qr_code text,
    first_visit_at timestamptz default now(), last_visit_at timestamptz default now(),
    created_at timestamptz default now())`,
  `alter table public.vendor_customer_visits add column if not exists visitor_user_id uuid`,
  `create index if not exists vendor_customer_visits_vendor_idx on public.vendor_customer_visits (vendor_id, last_visit_at desc)`,
  `create table if not exists public.media_files (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, kind text, mime text not null, bytes int, data bytea not null,
    created_at timestamptz default now())`,
  `create table if not exists public.wallet_recharge_packs (
    id uuid primary key default gen_random_uuid(),
    label text not null, amount_inr numeric not null, bonus_inr numeric default 0,
    is_active boolean default true, sort_order int default 0,
    created_at timestamptz default now())`,
  `alter table public.vendor_wallets add column if not exists lifetime_recharged_inr numeric default 0`,
  `alter table public.vendor_wallets add column if not exists lifetime_spent_inr numeric default 0`,
  `create unique index if not exists wallet_transactions_gateway_ref_uq on public.wallet_transactions (provider, ref)
     where provider in ('razorpay', 'cashfree') and ref is not null`,
  `create index if not exists wallet_transactions_vendor_idx on public.wallet_transactions (vendor_id, created_at desc)`,
  `alter table public.customers add column if not exists last_lat double precision`,
  `alter table public.customers add column if not exists last_lng double precision`,
  `alter table public.customers add column if not exists last_seen_at timestamptz`,
  `create index if not exists customers_last_seen_idx on public.customers (last_seen_at desc) where last_lat is not null`,
  `alter table public.lead_notifications add column if not exists seen_at timestamptz`,

  // chat: rich messages, edits/deletes, delivery ticks, presence, ratings
  ...[
    "kind text default 'text'",
    "attachment jsonb default '{}'::jsonb",
    "is_deleted boolean default false",
    "deleted_at timestamptz",
    "edited_at timestamptz",
    "original_body text",
    "delivered_at timestamptz",
  ].map((c) => `alter table public.lead_messages add column if not exists ${c}`),
  `create index if not exists lead_messages_lead_idx on public.lead_messages (lead_id, created_at)`,
  `create index if not exists lead_messages_unread_idx on public.lead_messages (recipient_id) where read_at is null`,
  `create table if not exists public.lead_chat_presence (
    lead_id uuid not null, user_id uuid not null,
    last_seen_at timestamptz default now(), typing_until timestamptz,
    primary key (lead_id, user_id))`,
  `alter table public.lead_notifications add column if not exists customer_declined_at timestamptz`,
  `create table if not exists public.vendor_reviews (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null, vendor_id uuid not null, customer_id uuid not null,
    stars int not null check (stars between 1 and 5), comment text, tags text[] default '{}',
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (lead_id, vendor_id))`,
  `create index if not exists vendor_reviews_vendor_idx on public.vendor_reviews (vendor_id, created_at desc)`,
  `alter table public.vendors add column if not exists rating_avg numeric default 0`,
  `alter table public.vendors add column if not exists rating_count int default 0`,

  // shop: full product editor, stock log, invoices, orders placed from the public shop page
  ...[
    "media jsonb default '[]'::jsonb",
    "tagline text",
    "badge text",
    "buying_price numeric",
    "gst_percent numeric default 0",
    "gst_mode text default 'include'",
    "variations jsonb default '[]'::jsonb",
    "bulk_tiers jsonb default '[]'::jsonb",
    "highlights jsonb default '[]'::jsonb",
    "faqs jsonb default '[]'::jsonb",
    "terms text",
    "policy text",
    "cta jsonb default '{}'::jsonb",
    "low_stock_alert numeric default 5",
    "sku text",
  ].map((c) => `alter table public.shop_products add column if not exists ${c}`),
  `create index if not exists shop_products_user_idx on public.shop_products (user_id, sort_order)`,
  `create table if not exists public.shop_stock_log (
    id uuid primary key default gen_random_uuid(),
    vendor_id uuid not null, product_id uuid not null,
    delta numeric not null, stock_after numeric, reason text, ref_id uuid,
    created_at timestamptz default now())`,
  `create index if not exists shop_stock_log_product_idx on public.shop_stock_log (product_id, created_at desc)`,
  `create table if not exists public.shop_invoices (
    id uuid primary key default gen_random_uuid(),
    vendor_id uuid not null, number text not null,
    customer_name text, customer_phone text, customer_gst text, customer_address text,
    items jsonb not null default '[]'::jsonb,
    subtotal numeric not null default 0, discount numeric not null default 0, discount_label text,
    tax numeric not null default 0, tax_label text, delivery numeric not null default 0,
    total numeric not null default 0, pay_mode text, status text not null default 'paid',
    order_id uuid, note text,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (vendor_id, number))`,
  `create index if not exists shop_invoices_vendor_idx on public.shop_invoices (vendor_id, created_at desc)`,
  ...[
    "vendor_id uuid",
    "customer_id uuid",
    "address text",
    "note text",
    "invoice_id uuid",
    "updated_at timestamptz default now()",
  ].map((c) => `alter table public.shop_orders add column if not exists ${c}`),
  `create index if not exists shop_orders_vendor_idx on public.shop_orders (vendor_id, created_at desc)`,
  `create index if not exists shop_orders_customer_idx on public.shop_orders (customer_id, created_at desc)`,
  `create unique index if not exists digital_shops_slug_uq on public.digital_shops (lower(slug))`,
];

let applied: Promise<void> | null = null;

async function run() {
  const url = (process.env.DATABASE_ADMIN_URL || env.databaseUrl || "").trim();
  if (!url || !hasDatabase()) return;
  const connectionString = url.replace(/[?&]sslmode=[^&]+/i, "").replace(/[?&]uselibpqcompat=[^&]+/i, "");
  const db = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15_000 });
  try {
    for (const sql of STATEMENTS) {
      try {
        await db.query(sql);
      } catch (err) {
        console.warn("[vendor-schema]", err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    await db.end();
  }
}

/** Runs once per process; safe to await from request handlers (serverless cold starts). */
export function ensureVendorSchema() {
  applied ??= run().catch((err) => {
    applied = null;
    console.warn("[vendor-schema]", err instanceof Error ? err.message : String(err));
  });
  return applied;
}
