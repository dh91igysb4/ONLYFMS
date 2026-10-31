-- TEST-ONLY Supabase compatibility shim (Ruling R1). Mirrors what a real Supabase
-- project provides so supabase/migrations/*.sql can run on plain Postgres 16.
-- Never push this file to a real project; migrations must not rely on anything
-- here beyond what Supabase itself provides (roles, auth.users, auth.uid/jwt).

-- Roles (Supabase: anon/authenticated are nologin, switched to by authenticator).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;

-- Extensions: Supabase preinstalls pgcrypto in schema `extensions` and puts it on
-- the default search_path. citext is NOT preinstalled there (migrations create it).
-- pgtap is test-only.
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap;
alter database postgres set search_path = "$user", public, extensions;

-- auth schema: only the parts our migrations reference.
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Same definitions as Supabase's auth.uid() / auth.jwt().
create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- public schema grants as in Supabase: usage for API roles, and default
-- privileges granting ALL on new tables/sequences/functions to them. Migrations
-- must therefore revoke explicitly whatever they don't want exposed.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
