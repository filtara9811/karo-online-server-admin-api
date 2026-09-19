-- Extra tables for DigitalOcean (idempotent). Safe to re-run.
-- Authorization lives in Express. RLS is disabled after create.

create table if not exists public.digital_shops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  slug text unique not null,
  created_at timestamptz default now()
);
create unique index if not exists digital_shops_user_id_key on public.digital_shops (user_id);

create table if not exists public.shop_visits (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind text,
  source text,
  visitor_name text,
  visitor_phone text,
  created_at timestamptz default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid,
  referrer_user_id uuid,
  referred_user_id uuid,
  code text,
  name text,
  phone text,
  status text default 'Joined',
  reward numeric default 0,
  created_at timestamptz default now()
);

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  code text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.customer_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,
  balance_inr numeric default 0,
  updated_at timestamptz default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount_inr numeric not null,
  upi_id text,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.vendor_wallets (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid unique not null,
  balance_inr numeric default 0,
  updated_at timestamptz default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid,
  user_id uuid,
  amount_inr numeric,
  kind text,
  purpose text,
  provider text,
  ref text,
  created_at timestamptz default now()
);

create table if not exists public.payment_gateways (
  id uuid primary key default gen_random_uuid(),
  provider text,
  display_name text,
  is_active boolean default false,
  is_test_mode boolean default true,
  public_key text,
  config jsonb default '{}'::jsonb,
  purpose text default 'both',
  priority int default 1,
  created_at timestamptz default now()
);

create table if not exists public.cashfree_services (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_active boolean default false,
  is_test_mode boolean default true,
  app_id text,
  secret_key text,
  config jsonb default '{}'::jsonb,
  priority int default 1,
  created_at timestamptz default now()
);

create table if not exists public.sms_gateways (
  id uuid primary key default gen_random_uuid(),
  provider text,
  display_name text,
  is_active boolean default false,
  is_test_mode boolean default true,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.whatsapp_providers (
  id uuid primary key default gen_random_uuid(),
  provider text,
  display_name text,
  is_active boolean default false,
  is_test_mode boolean default true,
  phone_number_id text,
  access_token text,
  default_template text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.whatsapp_message_logs (
  id uuid primary key default gen_random_uuid(),
  provider text,
  to_phone text,
  body text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.firebase_services (
  id uuid primary key default gen_random_uuid(),
  service_key text default 'fcm',
  project_id text,
  service_account_json jsonb,
  name text,
  is_active boolean default false,
  priority int default 1,
  created_at timestamptz default now()
);

create table if not exists public.maps_services (
  id uuid primary key default gen_random_uuid(),
  provider text default 'google',
  name text,
  api_key text,
  is_active boolean default false,
  priority int default 1,
  created_at timestamptz default now()
);

create table if not exists public.logistics_gateways (
  id uuid primary key default gen_random_uuid(),
  provider text,
  display_name text,
  is_active boolean default false,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.kyc_providers (
  id uuid primary key default gen_random_uuid(),
  provider text,
  display_name text,
  is_active boolean default false,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.voice_providers (
  id uuid primary key default gen_random_uuid(),
  provider text,
  display_name text,
  is_active boolean default false,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.theme_settings (
  id uuid primary key default gen_random_uuid(),
  key text,
  value jsonb,
  created_at timestamptz default now()
);

create table if not exists public.legal_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text,
  html text,
  created_at timestamptz default now()
);

create table if not exists public.onboarding_slides (
  id uuid primary key default gen_random_uuid(),
  title text,
  body text,
  image_url text,
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.oneqr_tutorial_videos (
  id uuid primary key default gen_random_uuid(),
  title text,
  video_url text,
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.referral_settings (
  id uuid primary key default gen_random_uuid(),
  reward_inr numeric default 200,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.referral_banners (
  id uuid primary key default gen_random_uuid(),
  title text,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.referral_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.coin_packs (
  id uuid primary key default gen_random_uuid(),
  name text,
  coins int,
  price_inr numeric,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.coin_pricing_config (
  id uuid primary key default gen_random_uuid(),
  coin_rate_inr numeric default 1,
  created_at timestamptz default now()
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  name text,
  title text,
  body text,
  created_at timestamptz default now()
);

create table if not exists public.notification_triggers (
  id uuid primary key default gen_random_uuid(),
  name text,
  event text,
  last_fired_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_active boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text,
  body text,
  status text,
  created_at timestamptz default now()
);

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  platform text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.form_schemas (
  id uuid primary key default gen_random_uuid(),
  slug text,
  title text,
  fields jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.web_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_hero_sections (
  id uuid primary key default gen_random_uuid(),
  page_slug text,
  eyebrow text,
  title text,
  subtitle text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_content_blocks (
  id uuid primary key default gen_random_uuid(),
  page_slug text,
  body text,
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_faqs (
  id uuid primary key default gen_random_uuid(),
  page_slug text,
  question text,
  answer text,
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_forms (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text,
  fields jsonb default '[]'::jsonb,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.web_blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text,
  excerpt text,
  body text,
  is_published boolean default false,
  author_name text,
  published_at timestamptz,
  reading_minutes int,
  tags text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists public.web_testimonials (
  id uuid primary key default gen_random_uuid(),
  name text,
  city text,
  quote text,
  rating int,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_brand_logos (
  id uuid primary key default gen_random_uuid(),
  name text,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.web_offers (
  id uuid primary key default gen_random_uuid(),
  text text,
  is_active boolean default true,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.web_pricing_plans (
  id uuid primary key default gen_random_uuid(),
  name text,
  price text,
  sub text,
  accent boolean default false,
  features jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.web_apk_releases (
  id uuid primary key default gen_random_uuid(),
  play_store_url text,
  label text,
  created_at timestamptz default now()
);

create table if not exists public.web_media_assets (
  id uuid primary key default gen_random_uuid(),
  url text,
  kind text,
  created_at timestamptz default now()
);

create table if not exists public.web_virtual_devices (
  id uuid primary key default gen_random_uuid(),
  name text,
  url text,
  created_at timestamptz default now()
);

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  message text,
  created_at timestamptz default now()
);

create table if not exists public.catalog_groups (
  id uuid primary key default gen_random_uuid(),
  name text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists public.qr_batches (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz default now()
);

create table if not exists public.qr_assets (
  id uuid primary key default gen_random_uuid(),
  name text,
  url text,
  created_at timestamptz default now()
);

create table if not exists public.qr_landing_themes (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text,
  preset text,
  accent_color text,
  bg_from text,
  bg_to text,
  is_premium boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.qr_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text,
  name text,
  slug text,
  is_paid boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.referral_link_visits (
  id uuid primary key default gen_random_uuid(),
  code text,
  created_at timestamptz default now()
);

create table if not exists public.merchant_link_settings (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  landing_theme_key text,
  updated_at timestamptz default now()
);

create table if not exists public.vendor_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text,
  price numeric,
  interval text,
  is_active boolean default true,
  features jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  name text,
  phone text,
  created_at timestamptz default now()
);

create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  title text,
  status text default 'open',
  proof_urls text[] default '{}',
  assigned_at timestamptz default now(),
  submitted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.staff_wallets (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid unique,
  balance_inr numeric default 0,
  updated_at timestamptz default now()
);

create table if not exists public.staff_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  amount_inr numeric,
  note text,
  created_at timestamptz default now()
);

create table if not exists public.staff_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  amount_inr numeric,
  upi_id text,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.staff_signup_requests (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  created_at timestamptz default now()
);

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  invite_token text unique,
  role text default 'staff',
  created_at timestamptz default now()
);

create table if not exists public.device_fingerprints (
  id uuid primary key default gen_random_uuid(),
  fingerprint text,
  phone text,
  panel text,
  user_agent text,
  unlocked_at timestamptz,
  unlocked_by uuid,
  unlock_reason text,
  last_seen_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.device_unlock_audit (
  id uuid primary key default gen_random_uuid(),
  phone text,
  panel text,
  fingerprint text,
  unlocked_by uuid,
  reason text,
  rows_affected int,
  created_at timestamptz default now()
);

create table if not exists public.kyc_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  document_type text,
  status text default 'pending',
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.vendor_scan_history (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid,
  code text,
  created_at timestamptz default now()
);

create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  kind text,
  provider text,
  status text,
  message text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.vendor_status_updates (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid,
  user_id uuid,
  status text,
  created_at timestamptz default now()
);

create table if not exists public.shop_threads (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid,
  created_at timestamptz default now()
);

create table if not exists public.shop_order_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid,
  event text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function public.admin_adjust_wallet(p_vendor_id uuid, p_amount numeric, p_note text default null)
returns jsonb language plpgsql as $$
begin
  insert into public.vendor_wallets (vendor_id, balance_inr)
  values (p_vendor_id, p_amount)
  on conflict (vendor_id) do update set
    balance_inr = public.vendor_wallets.balance_inr + excluded.balance_inr,
    updated_at = now();
  insert into public.wallet_transactions (vendor_id, amount_inr, kind, purpose)
  values (p_vendor_id, p_amount, 'adjust', coalesce(p_note, 'admin'));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.accept_lead_for_vendor(p_lead_id uuid, p_vendor_id uuid)
returns jsonb language plpgsql as $$
begin
  update public.leads
  set accepted_vendor_id = coalesce(accepted_vendor_id, p_vendor_id),
      accepted_count = coalesce(accepted_count, 0) + 1,
      status = 'accepted',
      updated_at = now()
  where id = p_lead_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.reject_lead_for_vendor(p_lead_id uuid, p_vendor_id uuid)
returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'vendor_id', p_vendor_id);
$$;

insert into public.payment_gateways (provider, display_name, is_active, is_test_mode, purpose, priority)
select 'razorpay', 'Razorpay', false, true, 'both', 1
where not exists (select 1 from public.payment_gateways);
insert into public.sms_gateways (provider, display_name, is_active, is_test_mode, config)
select 'fast2sms', 'Fast2SMS', false, true, '{"api_key":"","sender_id":"FSTSMS","route":"otp"}'::jsonb
where not exists (select 1 from public.sms_gateways where provider = 'fast2sms');
insert into public.sms_gateways (provider, display_name, is_active, is_test_mode, config)
select 'msg91', 'MSG91', false, true, '{"auth_key":"","sender_id":"","template_id":"","route":"4","country":"91"}'::jsonb
where not exists (select 1 from public.sms_gateways where provider = 'msg91');
insert into public.whatsapp_providers (provider, display_name, is_active, is_test_mode, default_template)
select 'meta', 'WhatsApp Cloud', false, true, 'otp_login'
where not exists (select 1 from public.whatsapp_providers);
insert into public.maps_services (provider, name, is_active)
select 'google', 'Google Maps', false
where not exists (select 1 from public.maps_services);
insert into public.coin_pricing_config (coin_rate_inr)
select 1 where not exists (select 1 from public.coin_pricing_config);
insert into public.qr_landing_themes (key, name, preset, accent_color, bg_from, bg_to, is_premium, is_active)
select 'classic', 'Classic gold', 'classic', '#d4af37', '#1a1208', '#0a0804', false, true
where not exists (select 1 from public.qr_landing_themes where key = 'classic');
insert into public.qr_landing_themes (key, name, preset, accent_color, bg_from, bg_to, is_premium, is_active)
select 'cream', 'Cream maison', 'cream', '#b8860b', '#faf9f6', '#f5f4f0', false, true
where not exists (select 1 from public.qr_landing_themes where key = 'cream');
insert into public.legal_pages (slug, title, html)
select 'privacy', 'Privacy Policy', '<p>Karo Online collects only what is needed to match you with nearby vendors.</p>'
where not exists (select 1 from public.legal_pages where slug = 'privacy');
insert into public.legal_pages (slug, title, html)
select 'terms', 'Terms and Conditions', '<p>By using Karo Online you agree to fair use and verified identity for withdrawals.</p>'
where not exists (select 1 from public.legal_pages where slug = 'terms');

alter table public.maps_services add column if not exists rest_key text;
alter table public.maps_services add column if not exists map_sdk_key text;

do $$
declare r record;
begin
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I disable row level security', r.tablename);
  end loop;
end $$;
