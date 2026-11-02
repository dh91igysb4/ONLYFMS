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

-- Storage: 실제 Supabase가 제공, 테스트 전용. 마이그레이션이 쓰는 부분만 흉내 낸다
-- (storage.buckets 행 추가, storage.objects 정책, storage.foldername). 실제 Supabase처럼
-- objects·buckets는 RLS가 켜져 있고 API 역할에게 표 권한이 있다(행은 정책으로만 보인다).
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on table storage.buckets, storage.objects to anon, authenticated, service_role;

-- Supabase와 같은 동작: 경로를 '/'로 나눈 조각에서 마지막(파일 이름)을 뺀 폴더 목록
create function storage.foldername(name text) returns text[]
language plpgsql as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

-- Realtime publication: 실제 Supabase가 제공, 테스트 전용.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
