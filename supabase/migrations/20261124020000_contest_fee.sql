-- 대회 참가비 (지갑 5단계 Task 23, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §10, §14)
--
-- 원칙
--   * contests.entry_fee는 0 ~ 41,000(FEE_MAX, economy.ts / _economy()->>'fee_max'). 만들 때 정하고 바꿀 수 없다
--     (fee_immutable). 데일리는 항상 0(check). 숨김 게임이 든 대회는 0만(fee_not_allowed, 문제 행 트리거가 막는다:
--     create_contest·update_contest 둘 다 contest_items를 넣으므로 한 곳에서).
--   * 참가 = 참가비. 만든 사람은 지금처럼 자동 참가하므로 만들 때 뺀다. join_contest·join_by_invite_code는 처음 참가할
--     때만 뺀다(_contest_enter). 화면이 본 참가비(p_entry_fee, 기본 0)가 대회 참가비와 다르면 fee_mismatch
--     (DETAIL = 지금 참가비). 옛 화면·자동 참가·초대 링크 첫 시도가 모르고 돈을 내지 않게 한다(대전 stake_mismatch와 같은 방식).
--   * 장부: contest_fee(−), contest_prize·contest_refund(+), ref = 대회 id, game_id null. 사람 사이에서 옮기는 돈이라
--     사이트 하루 상한에 세지도 줄이지도 않는다(_gold_move의 표, §5.6). 서버는 상금에 보태지 않는다.
--   * 모인 돈 = 장부의 그 대회 contest_fee 줄 −delta 합(실제로 빠진 돈). entry_fee 열을 믿지 않는다.
--   * 분배는 3단계 정산(settle_due → _settle_contests → _contest_payouts) 한 길로만 한다. 여기서 _contest_payouts에
--     공식·친선 경우를 더한다. 데일리(서버 상금)와 참가비 대회(모인 돈 분배)는 kind로 갈리고, 데일리는 참가비가 0이라
--     둘 다일 수 없다.
--       순위 = _lb_contest_rows(대회, false) 가운데 행동을 한 번 이상 한 사람(action_count > 0)만 남겨 다시 센 등수
--       (데일리 상금과 같은 규칙: 문제만 열어 본 사람이 10% 몫을 받거나 인원 경계를 바꾸지 못하게). 동점은 리더보드 정렬
--       (점수 → 행동 수 적은 쪽 → 먼저 끝낸 쪽 → 아이디)이 가른다. 나눠 갖지 않는다.
--       N = 0 → 낸 사람마다 contest_refund, N = 1·2 → 1등이 전부, N ≥ 3 → 30%·10% 내림, 나머지(60% 내림 + 우수리)는 1등.
--   * 취소: cancel_contest가 같은 트랜잭션에서 전원 환불. 정산이 취소 대회를 잡으면 남은 환불을 마저 한다(장부 unique로 멱등).
--   * 잠금 순서: 대회 행을 먼저(for no key update — 서로는 막지만 contest_entries·contest_items 삽입의 외래 키 확인
--     KEY SHARE는 막지 않는다), 지갑을 나중에. 여러 지갑은 user_id 오름차순. profiles는 잠그지 않는다.
--   * 참가를 떠나는 기능은 없다(참가비는 취소·순위 0명일 때만 돌아온다).

alter table public.contests
  add column entry_fee int not null default 0,
  add constraint contests_entry_fee check (entry_fee between 0 and 41000),
  add constraint contests_daily_no_fee check (kind <> 'daily' or entry_fee = 0);

grant select (entry_fee) on table public.contests to authenticated;

-- ------------------------------------------------------------------ 참가비 검사 (바꾸기 금지, 숨김 게임 0만)
create function public._contest_fee_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entry_fee is distinct from old.entry_fee then
    raise exception using errcode = 'P0001', message = 'fee_immutable';
  end if;
  return new;
end
$$;

create trigger contests_fee_guard
  before update of entry_fee on public.contests
  for each row execute function public._contest_fee_guard();

create function public._contest_item_fee_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._is_hidden_game(new.game_id)
     and exists (select 1 from public.contests c where c.id = new.contest_id and c.entry_fee > 0) then
    raise exception using errcode = 'P0001', message = 'fee_not_allowed';
  end if;
  return new;
end
$$;

create trigger contest_items_fee_guard
  before insert or update of game_id, contest_id on public.contest_items
  for each row execute function public._contest_item_fee_guard();

-- ------------------------------------------------------------------ 참가 (한 곳)
-- 부르는 쪽이 대회 행을 이미 잡고(for no key update) 열림·권한을 확인했어야 한다.
-- 이미 참가했으면 아무 일도 없다(참가비 확인도 하지 않는다: 멱등).
create function public._contest_enter(p_contest uuid, p_uid uuid, p_entry_fee int) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_fee int;
begin
  if exists (select 1 from public.contest_entries e where e.contest_id = p_contest and e.user_id = p_uid) then
    return;
  end if;
  select c.entry_fee into v_fee from public.contests c where c.id = p_contest;
  if v_fee is distinct from coalesce(p_entry_fee, 0) then
    raise exception using errcode = 'P0001', message = 'fee_mismatch', detail = v_fee::text;
  end if;
  insert into public.contest_entries (contest_id, user_id) values (p_contest, p_uid);
  if v_fee > 0 then
    perform public._gold_move(p_uid, -v_fee, 'contest_fee', p_contest::text);
  end if;
end
$$;

-- 낸 참가비 되돌림 목록(장부 기준). 취소·순위 0명 때 쓴다.
create function public._contest_refunds(p_contest uuid)
returns table (user_id uuid, amount bigint)
language sql stable security definer set search_path = public as $$
  select l.user_id, sum(-l.delta)::bigint
    from public.gold_ledger l
   where l.reason = 'contest_fee' and l.ref = p_contest::text
   group by l.user_id
  having sum(-l.delta) > 0
   order by l.user_id
$$;

-- ------------------------------------------------------------------ create_contest (+ p_entry_fee)
-- 시그니처가 바뀌므로 지우고 다시 만든다. 새 인자는 끝에 기본값 0으로 둬 옛 화면의 인자 조합이 그대로 맞는다.
drop function public.create_contest(text, timestamptz, int, public.contest_visibility, jsonb, boolean);

create function public.create_contest(
  p_title text, p_starts_at timestamptz, p_duration_min int,
  p_visibility public.contest_visibility, p_items jsonb, p_official boolean,
  p_entry_fee int default 0)
returns table (id uuid, invite_code text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_title text;
  v_vis   public.contest_visibility := coalesce(p_visibility, 'public');
  v_fee   int := coalesce(p_entry_fee, 0);
  v_id    uuid;
  v_code  text;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if coalesce(p_official, false) and not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'official_forbidden';
  end if;
  if v_fee < 0 or v_fee > (public._economy() ->> 'fee_max')::int then
    raise exception using errcode = 'P0001', message = 'fee_invalid';
  end if;
  v_title := public._validate_contest_input(p_title, p_starts_at, p_duration_min, p_items);
  if v_fee > 0 and exists (select 1 from jsonb_array_elements(p_items) e
                            where public._is_hidden_game(e.value ->> 'game_id')) then
    raise exception using errcode = 'P0001', message = 'fee_not_allowed';
  end if;

  -- 초대 코드가 겹치면(unique_violation) 새로 만들어 다시 넣는다
  for attempt in 1 .. 10 loop
    v_code := case when v_vis = 'invite' then public._new_invite_code() end;
    begin
      insert into public.contests as c (kind, title, created_by, visibility, invite_code, starts_at, ends_at, entry_fee)
      values (case when coalesce(p_official, false) then 'official' else 'friendly' end::public.contest_kind,
              v_title, v_uid, v_vis, v_code, p_starts_at, p_starts_at + make_interval(mins => p_duration_min), v_fee)
      returning c.id into v_id;
      exit;
    exception when unique_violation then
      if v_code is null or attempt = 10 then
        raise;
      end if;
    end;
  end loop;

  perform public._insert_contest_items(v_id, p_items);
  -- 만든 사람 자동 참가 = 참가비. 잔액이 모자라면 not_enough_gold로 대회까지 되돌려진다
  perform public._contest_enter(v_id, v_uid, v_fee);

  return query select v_id, v_code;
end
$$;

-- ------------------------------------------------------------------ cancel_contest (+ 환불)
create or replace function public.cancel_contest(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.contests%rowtype;
  r     record;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_c from public.contests where id = p_id for no key update;
  if not found or not (v_c.created_by is not distinct from v_uid or public.is_admin()) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_c.kind = 'daily'
     or v_c.cancelled_at is not null
     or now() >= v_c.ends_at
     or (not public.is_admin() and now() >= v_c.starts_at) then
    raise exception using errcode = 'P0001', message = 'not_editable';
  end if;
  update public.contests set cancelled_at = now() where id = p_id;
  -- 전원 환불 (지갑은 user_id 오름차순)
  for r in select f.user_id, f.amount from public._contest_refunds(p_id) f order by f.user_id loop
    perform public._gold_move(r.user_id, r.amount, 'contest_refund', p_id::text);
  end loop;
end
$$;

-- ------------------------------------------------------------------ join_contest (+ p_entry_fee)
drop function public.join_contest(uuid, text);

-- 승인 사용자. 숨김 전용 대회는 관리자만. 초대 대회는 코드(대소문자 무시, 앞뒤 공백 제거)가 맞아야 한다
-- (개설자·관리자는 코드 없이). 취소·종료된 대회는 contest_closed. 이미 참가했으면 아무 일도 없다.
-- 처음 참가하면 참가비를 뺀다. p_entry_fee는 화면이 본 참가비(다르면 fee_mismatch).
create function public.join_contest(p_id uuid, p_invite_code text default null, p_entry_fee int default 0)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.contests%rowtype;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_c from public.contests where id = p_id for no key update;
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
  perform public._contest_enter(p_id, v_uid, p_entry_fee);
end
$$;

-- ------------------------------------------------------------------ join_by_invite_code (+ p_entry_fee)
drop function public.join_by_invite_code(text);

create function public.join_by_invite_code(p_code text, p_entry_fee int default 0) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_c    public.contests%rowtype;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_code = '' then
    raise exception using errcode = 'P0001', message = 'invite_required';
  end if;
  select * into v_c from public.contests where lower(invite_code) = v_code for no key update;
  -- 숨김 전용 대회는 관리자만. 존재 여부를 드러내지 않도록 모르는 코드와 같은 오류를 준다.
  if not found or (public._contest_hidden_only(v_c.id) and not public.is_admin()) then
    raise exception using errcode = 'P0001', message = 'invite_required';
  end if;
  if v_c.cancelled_at is not null or now() >= v_c.ends_at then
    raise exception using errcode = 'P0001', message = 'contest_closed';
  end if;
  perform public._contest_enter(v_c.id, v_uid, p_entry_fee);
  return v_c.id;
end
$$;

-- ------------------------------------------------------------------ 정산: 공식·친선 분배를 더한다
-- 대회 하나의 지급 목록(계산만). 데일리는 3단계 그대로(서버 상금), 공식·친선은 모인 참가비 분배·환불.
create or replace function public._contest_payouts(p_contest uuid)
returns table (user_id uuid, amount bigint, reason text, game_id text, note text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_c      public.contests%rowtype;
  v_prizes jsonb;
  v_n      int;
  v_game   text;
  v_pool   bigint;
  v_second bigint;
  v_third  bigint;
begin
  select * into v_c from public.contests c where c.id = p_contest;
  if not found then
    return;
  end if;

  if v_c.kind = 'daily' then
    -- 데일리 상금(3단계). 참가비는 check로 항상 0
    if v_c.cancelled_at is not null then
      return;
    end if;
    v_prizes := public._economy() -> 'daily_prizes';
    v_n := jsonb_array_length(v_prizes);
    select i.game_id into v_game
      from public.contest_items i where i.contest_id = p_contest order by i.position limit 1;
    return query
      select r.uid, (v_prizes ->> (least(r.k, v_n) - 1))::bigint, 'daily_prize'::text, v_game, r.k || '등'
        from (select l.user_id as uid, (row_number() over (order by l.rank))::int as k
                from public._lb_contest_rows(p_contest, false) l
               where l.action_count > 0) r
       order by r.k;
    return;
  end if;

  -- 공식·친선: 모인 돈(장부)
  select coalesce(sum(-l.delta), 0)::bigint into v_pool
    from public.gold_ledger l
   where l.reason = 'contest_fee' and l.ref = p_contest::text;
  if v_pool <= 0 then
    return;
  end if;

  if v_c.cancelled_at is not null then
    return query select f.user_id, f.amount, 'contest_refund'::text, null::text, null::text
                   from public._contest_refunds(p_contest) f;
    return;
  end if;

  select count(*)::int into v_n
    from public._lb_contest_rows(p_contest, false) l where l.action_count > 0;

  if v_n = 0 then
    return query select f.user_id, f.amount, 'contest_refund'::text, null::text, null::text
                   from public._contest_refunds(p_contest) f;
    return;
  end if;

  if v_n <= 2 then
    v_second := 0;
    v_third  := 0;
  else
    v_second := floor(v_pool * 3 / 10.0)::bigint;
    v_third  := floor(v_pool / 10.0)::bigint;
  end if;

  return query
    select r.uid,
           case r.k when 1 then v_pool - v_second - v_third when 2 then v_second else v_third end,
           'contest_prize'::text, null::text, r.k || '등'
      from (select l.user_id as uid, (row_number() over (order by l.rank))::int as k
              from public._lb_contest_rows(p_contest, false) l
             where l.action_count > 0) r
     where r.k <= 3
       and case r.k when 1 then v_pool - v_second - v_third when 2 then v_second else v_third end > 0
     order by r.k;
end
$$;

-- ------------------------------------------------------------------ 권한
revoke execute on function public._contest_fee_guard()                from public, anon, authenticated;
revoke execute on function public._contest_item_fee_guard()           from public, anon, authenticated;
revoke execute on function public._contest_enter(uuid, uuid, int)     from public, anon, authenticated;
revoke execute on function public._contest_refunds(uuid)              from public, anon, authenticated;
revoke execute on function public._contest_payouts(uuid)              from public, anon, authenticated;
revoke execute on function
  public.create_contest(text, timestamptz, int, public.contest_visibility, jsonb, boolean, int),
  public.cancel_contest(uuid),
  public.join_contest(uuid, text, int),
  public.join_by_invite_code(text, int)
from public, anon, authenticated;
grant execute on function
  public.create_contest(text, timestamptz, int, public.contest_visibility, jsonb, boolean, int),
  public.cancel_contest(uuid),
  public.join_contest(uuid, text, int),
  public.join_by_invite_code(text, int)
to authenticated;
