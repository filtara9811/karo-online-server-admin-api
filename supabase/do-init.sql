-- Vanilla Postgres preamble (DigitalOcean / local). Safe to re-run.
-- gen_random_uuid() is built in on Postgres 13+ (no pgcrypto needed).

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists public.local_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  name text,
  phone text,
  user_metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
