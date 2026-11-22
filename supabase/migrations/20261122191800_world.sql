-- 월드(지속형) 게임: 사용자별 저장 상태, 게임 기록, 프로필용 user_records (fishing Task 2)
-- 쓰기는 world Edge Function이 소유자 연결로만 한다. 브라우저(authenticated)는 읽기만.

create table public.world_saves (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  game_id       text not null check (game_id ~ '^[a-z0-9-]+$'),
  state         jsonb not null,
  logic_version int not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table public.game_records (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null,
  key        text not null,
  value      numeric not null,
  detail     text,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, key)
);

alter table public.world_saves  enable row level security;
alter table public.game_records enable row level security;

create policy world_saves_select on public.world_saves
  for select to authenticated
  using (user_id = auth.uid() and public.is_approved());

create policy game_records_select on public.game_records
  for select to authenticated
  using (public.is_approved() and (public.is_admin() or not public._is_hidden_game(game_id)));

-- insert/update/delete 정책 없음

revoke all on table public.world_saves, public.game_records from public, anon, authenticated;
grant select on table public.world_saves, public.game_records to authenticated;

-- ------------------------------------------------------------------ user_records
-- 프로필에 보여 줄 게임 기록. 승인된 대상만, 관리자가 아니면 숨김 게임 제외. 없으면 null.
create function public.user_records(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin  boolean;
  v_target uuid;
begin
  perform public._require_approved();
  v_admin := public.is_admin();

  select p.id into v_target
    from public.profiles p
   where p.handle::text = lower(btrim(p_handle)) and p.status = 'approved';
  if v_target is null then
    return null;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'game_id', r.game_id, 'key', r.key, 'value', r.value, 'detail', r.detail)
           order by r.game_id, r.key), '[]'::jsonb)
      from public.game_records r
     where r.user_id = v_target
       and (v_admin or not public._is_hidden_game(r.game_id))
  );
end
$$;

revoke execute on function public.user_records(text) from public, anon, authenticated;
grant execute on function public.user_records(text) to authenticated;
