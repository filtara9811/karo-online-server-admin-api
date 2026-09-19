-- API connects as karoonline, not the table owner. Disable RLS so the
-- Express API can read/write; authorization stays in the API.
alter table if exists public.user_roles disable row level security;
alter table if exists public.customers disable row level security;
alter table if exists public.vendors disable row level security;
alter table if exists public.categories disable row level security;
alter table if exists public.catalog_items disable row level security;
alter table if exists public.catalog_types disable row level security;
alter table if exists public.leads disable row level security;
alter table if exists public.lead_messages disable row level security;
alter table if exists public.lead_notifications disable row level security;
alter table if exists public.otp_codes disable row level security;
alter table if exists public.test_accounts disable row level security;
alter table if exists public.app_settings disable row level security;
alter table if exists public.sms_gateways disable row level security;
alter table if exists public.payment_gateways disable row level security;
alter table if exists public.whatsapp_providers disable row level security;
alter table if exists public.maps_services disable row level security;
alter table if exists public.firebase_services disable row level security;
alter table if exists public.cashfree_services disable row level security;
alter table if exists public.catalog_items disable row level security;
alter table if exists public.vendor_item_mappings disable row level security;
