-- Karo Online — minimum schema for an EMPTY new project only.
-- Do NOT run this on lxwttwccbtxdpnrzadgj (production). It must not alter live data.

create extension if not exists "pgcrypto";

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  role text not null,
  created_at timestamptz default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  name text,
  phone text,
  email text,
  gender text,
  address text,
  avatar_url text,
  referral_code text,
  is_blocked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  business_name text,
  owner_name text,
  avatar_url text,
  profile_photo_url text,
  cover_image_url text,
  status text default 'active',
  is_blocked boolean default false,
  is_online boolean default true,
  lat double precision,
  lng double precision,
  service_radius_km int default 10,
  created_at timestamptz default now()
);

create table if not exists public.catalog_types (
  id uuid primary key default gen_random_uuid(),
  name text,
  slug text,
  sort_order int default 0,
  is_active boolean default true
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  image_url text,
  icon text,
  parent_id uuid,
  sort_order int default 0,
  keywords text[] default '{}',
  type_id uuid,
  is_active boolean default true
);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid,
  image_url text,
  keywords text[] default '{}',
  group_tag text,
  sort_order int default 0,
  is_active boolean default true,
  price_min numeric,
  price_max numeric,
  slug text
);

create table if not exists public.vendor_item_mappings (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid,
  item_id uuid,
  is_active boolean default true
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  customer_name text,
  customer_phone text,
  sub_category_id uuid,
  sub_category_name text not null default 'Service',
  item_ids uuid[] default '{}',
  item_names text[] default '{}',
  note text,
  address text,
  images text[] default '{}',
  lat double precision,
  lng double precision,
  search_radius_km numeric default 5,
  status text default 'placed',
  accepted_vendor_id uuid,
  accepted_vendor_ids uuid[] default '{}',
  accepted_count int default 0,
  max_slots int default 3,
  is_marketplace boolean default false,
  source text default 'quick',
  lead_price_inr numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  sender_id uuid,
  sender_role text,
  recipient_id uuid,
  body text,
  image_url text,
  created_at timestamptz default now()
);

create table if not exists public.lead_notifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid,
  vendor_id uuid,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text,
  provider text,
  verified_at timestamptz,
  expires_at timestamptz default (now() + interval '10 minutes'),
  attempts int default 0,
  created_at timestamptz default now()
);

create table if not exists public.test_accounts (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  otp_code text not null default '1234',
  enabled boolean default true
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  value jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_roles enable row level security;
alter table public.customers enable row level security;
alter table public.vendors enable row level security;
alter table public.categories enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_types enable row level security;
alter table public.leads enable row level security;
alter table public.lead_messages enable row level security;
alter table public.otp_codes enable row level security;
alter table public.test_accounts enable row level security;

do $$ begin
  create policy "public read categories" on public.categories for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read items" on public.catalog_items for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read types" on public.catalog_types for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own customer" on public.customers for all using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own leads" on public.leads for all using (auth.uid() = customer_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own messages" on public.lead_messages for all using (auth.uid() = sender_id or auth.uid() = recipient_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read own roles" on public.user_roles for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

insert into public.test_accounts (phone, otp_code, enabled)
values ('9999999999', '1234', true)
on conflict (phone) do nothing;

insert into public.catalog_types (id, name, slug, sort_order)
values ('11111111-1111-4111-8111-111111111111', 'Service', 'service', 1)
on conflict do nothing;

insert into public.categories (id, name, slug, parent_id, sort_order, image_url) values
  ('22222222-2222-4222-8222-222222222221', 'Home repair', 'home-repair', null, 1, '🔧'),
  ('22222222-2222-4222-8222-222222222222', 'Electrician', 'electrician', '22222222-2222-4222-8222-222222222221', 1, '⚡'),
  ('22222222-2222-4222-8222-222222222223', 'Plumber', 'plumber', '22222222-2222-4222-8222-222222222221', 2, '🚰')
on conflict do nothing;

create or replace function public.get_admin_stats()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'customers', jsonb_build_object('total', (select count(*) from public.customers), 'week', 0, 'month', 0, 'blocked', 0),
    'vendors', jsonb_build_object('total', (select count(*) from public.vendors), 'week', 0, 'month', 0, 'blocked', 0),
    'staff', jsonb_build_object('total', 0, 'week', 0, 'month', 0, 'blocked', 0)
  );
$$;
