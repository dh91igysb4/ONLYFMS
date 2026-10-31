-- 0003_contest_functions: 대회 개설·수정·취소·참가, 문제 은행 함수 (설계 §5.1~§5.2, §7)
--
-- 원칙
--   * 대회 관련 쓰기는 모두 여기의 security definer 함수로만 한다. 각 함수가 auth.uid()로 권한을 확인한다.
--   * 오류는 errcode P0001 + message 코드(title_invalid, start_too_soon, …)로 돌려준다.
--   * 데일리는 Edge Function(Task 8)이 만든다. create_contest는 official/friendly만 만든다.

-- ------------------------------------------------------------------ game_modes
-- 게임별로 가능한 모드. src/games/registry.test.ts가 이 시드와 등록부 manifest.modes가 같은지 검사한다.
-- authenticated에게 열지 않는다(함수로만 읽는다).
create table public.game_modes (
  game_id text primary key,
  daily   boolean not null,
  contest boolean not null,
  free    boolean not null,
  constraint game_modes_game_id check (game_id ~ '^[a-z0-9-]+$')
);
insert into game_modes (game_id, daily, contest, free) values ('number-guess', true, true, true);

alter table public.game_modes enable row level security;
revoke all on table public.game_modes from public, anon, authenticated;

-- ------------------------------------------------------------------ internal helpers
-- 문제 목록의 모든 게임이 대회 모드를 지원하는지. 관리자가 아니면 숨김 게임도 안 된다.
-- p_items는 _validate_contest_input을 통과한 배열이라고 가정한다.
create function public.contest_games_allowed(p_items jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from jsonb_array_elements(p_items) e
     where not exists (select 1 from public.game_modes g where g.game_id = e ->> 'game_id' and g.contest)
        or (not public.is_admin() and public._is_hidden_game(e ->> 'game_id')))
$$;

-- 제목·시작·제한 시간·문제 목록 검사(설계 §5.2). 앞뒤 공백을 자른 제목을 돌려준다.
create function public._validate_contest_input(
  p_title text, p_starts_at timestamptz, p_duration_min int, p_items jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_title text := btrim(p_title);
  v_item  jsonb;
  v_count numeric;
  v_total int := 0;
begin
  if v_title is null or char_length(v_title) not between 1 and 40 then
    raise exception using errcode = 'P0001', message = 'title_invalid';
  end if;
  if p_starts_at is null or p_starts_at < now() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'start_too_soon';
  end if;
  if p_starts_at > now() + interval '30 days' then
    raise exception using errcode = 'P0001', message = 'start_too_far';
  end if;
  if p_duration_min is null or p_duration_min not between 5 and 180 then
    raise exception using errcode = 'P0001', message = 'duration_invalid';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'items_invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'game_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'options') is distinct from 'object'
       or jsonb_typeof(v_item -> 'count') is distinct from 'number' then
      raise exception using errcode = 'P0001', message = 'items_invalid';
    end if;
    v_count := (v_item ->> 'count')::numeric;
    if v_count < 1 or v_count > 10 or v_count <> trunc(v_count) then
      raise exception using errcode = 'P0001', message = 'items_invalid';
    end if;
    v_total := v_total + v_count::int;
  end loop;
  if v_total not between 1 and 10 then
    raise exception using errcode = 'P0001', message = 'items_invalid';
  end if;

  if not public.contest_games_allowed(p_items) then
    raise exception using errcode = 'P0001', message = 'game_not_allowed';
  end if;
  return v_title;
end
$$;

-- 문제 목록을 count만큼 펼쳐 position 1..n으로 넣는다. 문제(puzzle)는 시작 후 Edge Function이 만든다.
create function public._insert_contest_items(p_contest uuid, p_items jsonb) returns void
language sql volatile security definer set search_path = public as $$
  insert into public.contest_items (contest_id, position, game_id, options)
  select p_contest,
         (row_number() over (order by e.ord, n))::int,
         e.value ->> 'game_id',
         e.value -> 'options'
    from jsonb_array_elements(p_items) with ordinality as e(value, ord)
   cross join lateral generate_series(1, (e.value ->> 'count')::int) as n
$$;

-- [a-z0-9] 10자 무작위. 모듈로 치우침을 없애려고 252(=36*7) 이상 바이트는 버린다.
create function public._new_invite_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_code  text := '';
  v_bytes bytea;
  v_b     int;
begin
  while char_length(v_code) < 10 loop
    v_bytes := extensions.gen_random_bytes(16);
    for i in 0 .. 15 loop
      v_b := get_byte(v_bytes, i);
      if v_b < 252 and char_length(v_code) < 10 then
        v_code := v_code || substr(v_alphabet, v_b % 36 + 1, 1);
      end if;
    end loop;
  end loop;
  return v_code;
end
$$;

-- ------------------------------------------------------------------ contest RPCs
create function public.create_contest(
  p_title text, p_starts_at timestamptz, p_duration_min int,
  p_visibility public.contest_visibility, p_items jsonb, p_official boolean)
returns table (id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_title text;
  v_vis   public.contest_visibility := coalesce(p_visibility, 'public');
  v_id    uuid;
  v_code  text;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if coalesce(p_official, false) and not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'official_forbidden';
  end if;
  v_title := public._validate_contest_input(p_title, p_starts_at, p_duration_min, p_items);

  -- 초대 코드가 겹치면(unique_violation) 새로 만들어 다시 넣는다
  for attempt in 1 .. 10 loop
    v_code := case when v_vis = 'invite' then public._new_invite_code() end;
    begin
      insert into public.contests as c (kind, title, created_by, visibility, invite_code, starts_at, ends_at)
      values (case when coalesce(p_official, false) then 'official' else 'friendly' end::public.contest_kind,
              v_title, v_uid, v_vis, v_code, p_starts_at, p_starts_at + make_interval(mins => p_duration_min))
      returning c.id into v_id;
      exit;
    exception when unique_violation then
      if v_code is null or attempt = 10 then
        raise;
      end if;
    end;
  end loop;

  perform public._insert_contest_items(v_id, p_items);
  insert into public.contest_entries (contest_id, user_id) values (v_id, v_uid);

  return query select v_id, v_code;
end
$$;

-- 시작 전, 취소되지 않은 대회를 개설자(승인 상태) 또는 관리자가 고친다. 문제 목록은 통째로 바꾼다.
create function public.update_contest(
  p_id uuid, p_title text, p_starts_at timestamptz, p_duration_min int,
  p_visibility public.contest_visibility, p_items jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_c     public.contests%rowtype;
  v_title text;
  v_vis   public.contest_visibility := coalesce(p_visibility, 'public');
  v_code  text;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_c from public.contests where id = p_id for update;
  if not found or not (v_c.created_by is not distinct from v_uid or public.is_admin()) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_c.kind = 'daily' or v_c.cancelled_at is not null or now() >= v_c.starts_at then
    raise exception using errcode = 'P0001', message = 'not_editable';
  end if;
  v_title := public._validate_contest_input(p_title, p_starts_at, p_duration_min, p_items);

  for attempt in 1 .. 10 loop
    v_code := case
      when v_vis = 'public' then null
      when v_c.visibility = 'invite' then v_c.invite_code   -- 초대 → 초대: 코드 유지
      else public._new_invite_code() end;
    begin
      update public.contests
         set title = v_title, starts_at = p_starts_at,
             ends_at = p_starts_at + make_interval(mins => p_duration_min),
             visibility = v_vis, invite_code = v_code
       where id = p_id;
      exit;
    exception when unique_violation then
      if v_code is null or v_code = v_c.invite_code or attempt = 10 then
        raise;
      end if;
    end;
  end loop;

  delete from public.contest_items where contest_id = p_id;
  perform public._insert_contest_items(p_id, p_items);
end
$$;

-- 개설자: 시작 전. 관리자: 종료 전 언제든. 이미 취소된 대회는 not_editable.
create function public.cancel_contest(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.contests%rowtype;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_c from public.contests where id = p_id for update;
  if not found or not (v_c.created_by is not distinct from v_uid or public.is_admin()) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_c.cancelled_at is not null
     or now() >= v_c.ends_at
     or (not public.is_admin() and now() >= v_c.starts_at) then
    raise exception using errcode = 'P0001', message = 'not_editable';
  end if;
  update public.contests set cancelled_at = now() where id = p_id;
end
$$;

-- 승인 사용자. 숨김 전용 대회는 관리자만. 초대 대회는 코드(대소문자 무시, 앞뒤 공백 제거)가 맞아야 한다
-- (개설자·관리자는 코드 없이). 취소·종료된 대회는 contest_closed. 이미 참가했으면 아무 일도 없다.
create function public.join_contest(p_id uuid, p_invite_code text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.contests%rowtype;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_c from public.contests where id = p_id;
  if not found or (public._contest_hidden_only(p_id) and not public.is_admin()) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_c.visibility = 'invite'
     and not (v_c.created_by is not distinct from v_uid or public.is_admin())
     and lower(btrim(coalesce(p_invite_code, ''))) is distinct from lower(v_c.invite_code) then
    raise exception using errcode = 'P0001', message = 'invite_required';
  end if;
  if v_c.cancelled_at is not null or now() >= v_c.ends_at then
    raise exception using errcode = 'P0001', message = 'contest_closed';
  end if;
  insert into public.contest_entries (contest_id, user_id) values (p_id, v_uid)
  on conflict do nothing;
end
$$;

-- ------------------------------------------------------------------ puzzle bank RPCs
-- 관리자만. 각 원소 {"puzzle_key": 비어 있지 않은 문자열, "puzzle": 객체}. 하나라도 틀리면 전체 거부.
-- 이미 있는 키와 요청 안의 중복 키(뒤의 것)는 건너뛴다.
create function public.admin_upload_puzzles(p_game text, p_puzzles jsonb)
returns table (added int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_added int;
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if not exists (select 1 from public.game_modes g where g.game_id = p_game) then
    raise exception using errcode = 'P0001', message = 'game_not_allowed';
  end if;
  if p_puzzles is null or jsonb_typeof(p_puzzles) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_puzzles) e
        where jsonb_typeof(e.value) <> 'object'
           or jsonb_typeof(e.value -> 'puzzle_key') is distinct from 'string'
           or btrim(e.value ->> 'puzzle_key') = ''
           or jsonb_typeof(e.value -> 'puzzle') is distinct from 'object') then
    raise exception using errcode = 'P0001', message = 'items_invalid';
  end if;

  v_total := jsonb_array_length(p_puzzles);
  insert into public.puzzle_bank (game_id, puzzle_key, puzzle)
  select p_game, e.value ->> 'puzzle_key', e.value -> 'puzzle'
    from jsonb_array_elements(p_puzzles) with ordinality as e(value, ord)
   order by e.ord
  on conflict (game_id, puzzle_key) do nothing;
  get diagnostics v_added = row_count;

  return query select v_added, v_total - v_added;
end
$$;

-- 관리자만. game_modes의 게임마다 아직 출제되지 않은(used_item_id is null) 문제 수.
create function public.admin_bank_status()
returns table (game_id text, remaining int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select g.game_id,
           (select count(*)::int from public.puzzle_bank b
             where b.game_id = g.game_id and b.used_item_id is null)
      from public.game_modes g
     order by g.game_id;
end
$$;

-- ------------------------------------------------------------------ execute grants
revoke execute on function
  public.contest_games_allowed(jsonb),
  public._validate_contest_input(text, timestamptz, int, jsonb),
  public._insert_contest_items(uuid, jsonb),
  public._new_invite_code(),
  public.create_contest(text, timestamptz, int, public.contest_visibility, jsonb, boolean),
  public.update_contest(uuid, text, timestamptz, int, public.contest_visibility, jsonb),
  public.cancel_contest(uuid),
  public.join_contest(uuid, text),
  public.admin_upload_puzzles(text, jsonb),
  public.admin_bank_status()
from public, anon, authenticated;

-- 내부 함수(contest_games_allowed, _validate_contest_input, _insert_contest_items, _new_invite_code)는 열지 않는다.
grant execute on function
  public.create_contest(text, timestamptz, int, public.contest_visibility, jsonb, boolean),
  public.update_contest(uuid, text, timestamptz, int, public.contest_visibility, jsonb),
  public.cancel_contest(uuid),
  public.join_contest(uuid, text),
  public.admin_upload_puzzles(text, jsonb),
  public.admin_bank_status()
to authenticated;
