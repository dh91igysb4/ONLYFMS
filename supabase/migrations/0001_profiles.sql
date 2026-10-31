-- 0001_profiles: profiles, 승인제, 관리자 함수 (설계 §2, §6 profiles, §7)

create extension if not exists citext;

-- ------------------------------------------------------------------ types/table
create type public.user_status as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      citext unique,
  status      public.user_status not null default 'pending',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  -- citext의 ~ 는 대소문자를 무시하므로 text로 비교해 소문자 저장을 강제한다
  constraint profiles_handle_format check (handle is null or handle::text ~ '^[a-z0-9_]{3,16}$')
);

alter table public.profiles enable row level security;

-- 직접 쓰기 금지, 읽기는 공개 컬럼만 (Supabase 기본 권한 ALL을 먼저 걷어낸다)
revoke all on table public.profiles from public, anon, authenticated;
grant select (id, handle, created_at) on table public.profiles to authenticated;

-- ------------------------------------------------------------------ helpers
create function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status = 'approved'
  )
$$;

-- 승인 상태인 관리자만. 거절·대기로 바뀐 관리자는 관리자 권한도 잃는다.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_admin and status = 'approved'
  )
$$;

-- 아이디 정규화: 앞뒤 공백 제거 + 소문자. 형식이 틀리면 handle_invalid.
create function public._normalize_handle(p_handle text) returns text
language plpgsql immutable security definer set search_path = public as $$
declare
  v text := lower(btrim(p_handle));
begin
  if v is null or v !~ '^[a-z0-9_]{3,16}$' then
    raise exception using errcode = 'P0001', message = 'handle_invalid';
  end if;
  return v;
end
$$;

-- RLS: 본인 행, 또는 (호출자가 승인 사용자이고 그 행도 승인 상태)
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or (status = 'approved' and public.is_approved()));

-- ------------------------------------------------------------------ signup trigger
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ user RPCs
create function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p where p.id = auth.uid()
$$;

create function public.set_handle(new_handle text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_current text;  -- citext 이름은 search_path=public 밖(extensions)에 있을 수 있어 본문에서는 쓰지 않는다
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select handle::text into v_current from public.profiles where id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_current is not null then
    raise exception using errcode = 'P0001', message = 'handle_already_set';
  end if;

  v_handle := public._normalize_handle(new_handle);

  begin
    update public.profiles set handle = v_handle where id = v_uid;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'handle_taken';
  end;
  return v_handle;
end
$$;

-- ------------------------------------------------------------------ admin RPCs
create function public.admin_list_users(p_status public.user_status)
returns table (id uuid, handle citext, email text, status public.user_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  -- p_status가 null이면 전체
  return query
    select p.id, p.handle, u.email::text, p.status, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p_status is null or p.status = p_status
     order by p.created_at, p.id;
end
$$;

create function public.admin_set_status(p_user uuid, p_status public.user_status) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_user = v_uid then
    raise exception using errcode = 'P0001', message = 'cannot_change_self';
  end if;
  if p_status is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  update public.profiles
     set status      = p_status,
         approved_at = case when p_status = 'approved' then now()  else null end,
         approved_by = case when p_status = 'approved' then v_uid  else null end
   where id = p_user;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
end
$$;

create function public.admin_set_handle(p_user uuid, p_handle text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_handle text;
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  v_handle := public._normalize_handle(p_handle);

  begin
    update public.profiles set handle = v_handle where id = p_user;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'handle_taken';
  end;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
end
$$;

-- ------------------------------------------------------------------ execute grants
-- 함수 EXECUTE는 기본적으로 PUBLIC(+Supabase 기본 권한으로 anon)에 열려 있으므로 걷어내고
-- 로그인 사용자에게만 연다. 권한 판단은 각 함수 안에서 한다.
revoke execute on function
  public.is_approved(),
  public.is_admin(),
  public._normalize_handle(text),
  public.handle_new_user(),
  public.my_profile(),
  public.set_handle(text),
  public.admin_list_users(public.user_status),
  public.admin_set_status(uuid, public.user_status),
  public.admin_set_handle(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.is_approved(),
  public.is_admin(),
  public.my_profile(),
  public.set_handle(text),
  public.admin_list_users(public.user_status),
  public.admin_set_status(uuid, public.user_status),
  public.admin_set_handle(uuid, text)
to authenticated;
