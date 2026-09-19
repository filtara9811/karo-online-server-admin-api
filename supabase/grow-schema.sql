-- Assan Grow columns + tables. Idempotent. Safe to re-run.

alter table public.qr_projects add column if not exists name text;
alter table public.qr_projects add column if not exists business_name text;
alter table public.qr_projects add column if not exists contact_phone text;
alter table public.qr_projects add column if not exists category text;
alter table public.qr_projects add column if not exists city text;
alter table public.qr_projects add column if not exists trade_type text;
alter table public.qr_projects add column if not exists theme_key text;
alter table public.qr_projects add column if not exists accent_color text;
alter table public.qr_projects add column if not exists description text;
alter table public.qr_projects add column if not exists price_inr numeric default 599;
alter table public.qr_projects add column if not exists ads_enabled boolean default false;
alter table public.qr_projects add column if not exists ad_budget_inr numeric default 0;
alter table public.qr_projects add column if not exists ad_clicks int default 0;
alter table public.qr_projects add column if not exists avatar_url text;
alter table public.qr_projects add column if not exists cover_image_url text;
alter table public.qr_projects add column if not exists share_code text;
alter table public.qr_projects add column if not exists meta jsonb default '{}'::jsonb;

alter table public.shop_visits add column if not exists project_slug text;
alter table public.shop_visits add column if not exists project_id uuid;

alter table public.digital_shops add column if not exists description text;
alter table public.digital_shops add column if not exists phone text;
alter table public.digital_shops add column if not exists project_id uuid;

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  user_id uuid,
  name text not null,
  price numeric default 0,
  category text,
  stock numeric default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  user_id uuid,
  code text,
  visitor_name text,
  visitor_phone text,
  items jsonb default '[]'::jsonb,
  total_inr numeric default 0,
  status text default 'new',
  created_at timestamptz default now()
);

create table if not exists public.qr_campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  user_id uuid,
  title text,
  budget_inr numeric default 0,
  clicks int default 0,
  status text default 'draft',
  created_at timestamptz default now()
);

create table if not exists public.vendor_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  city text,
  trade text,
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.vendor_program_joins (
  id uuid primary key default gen_random_uuid(),
  program_id uuid,
  user_id uuid,
  created_at timestamptz default now()
);

insert into public.vendor_programs (id, title, city, trade, description, is_active)
values
  ('11111111-1111-1111-1111-111111111111', 'ALL Program — City partners', 'Pan India', 'Multi-trade', 'Featured vendors who accept Assan Grow QR walk-ins and share leads.', true),
  ('22222222-2222-2222-2222-222222222222', 'Gold shopfront', 'Delhi NCR', 'Retail', 'Premium placement on the digital shop catalog.', true)
on conflict (id) do nothing;
