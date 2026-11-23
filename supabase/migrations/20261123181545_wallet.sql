-- 지갑과 골드 장부 (지갑 1단계 Task 1, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §5)
--
-- 원칙
--   * 골드를 바꾸는 길은 _gold_move 하나뿐이다. Edge Function·트리거·관리자 RPC 모두 이 함수를 부른다.
--     wallets·gold_ledger에는 authenticated의 쓰기 권한·정책이 없다.
--   * 잠금 순서: 다른 행(세이브·대국·대회)을 먼저, 지갑을 나중에. 한 트랜잭션에서 여러 지갑은 user_id 오름차순.
--   * 같은 (user_id, reason, ref)는 한 번만 반영된다(재전송·재시도 방지).
--
-- reason · ref · game_id (설계 §5.1)
--   migrate        게임 id                   게임 id     옛 세이브 골드 이전
--   world          요청마다 gen_random_uuid   게임 id     지속형 게임 안 증감
--   free           free_plays.client_id      게임 id     자유 플레이 지급(2단계)
--   daily_prize    대회 id                   게임 id     데일리 상금(3단계)
--   duel_*         대국 id                   게임 id     판돈(4단계)
--   contest_*      대회 id                   null        참가비(5단계)
--   admin          gen_random_uuid           null        관리자 조정
--
-- 사이트 하루 상한 (설계 §5.6, 상수 원본 src/games/economy.ts, 사본 _economy())
--   reason          오늘 합계에 셈   줄임
--   world (+만)     예               예
--   free            예               예
--   daily_prize     예               아니오
--   migrate·admin·duel_*·contest_*   아니오   아니오
--   오늘 = KST 하루(장부 created_at 기준). 지출(−)은 합계를 줄이지 않는다.
--   줄일 때: room = greatest(cap − s, 0), got = least(d, room) + floor((d − least(d, room)) × rate).
--   got < d이면 장부 delta = got, raw_delta = d. got = 0이면 장부에 쓰지 않는다.
--   상한은 _gold_move 안에서만 계산한다(지갑을 잠근 뒤, 동시 지급이 같은 합계를 보지 않게).

create table public.wallets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.gold_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  delta         bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason        text not null check (reason in ('migrate', 'world', 'free', 'daily_prize', 'duel_stake', 'duel_payout',
                                                'duel_refund', 'contest_fee', 'contest_prize', 'contest_refund', 'admin')),
  ref           text not null,
  game_id       text,
  note          text,
  raw_delta     bigint,             -- 사이트 하루 상한으로 줄기 전 금액. 줄지 않았으면 null
  created_at    timestamptz not null default now(),
  unique (user_id, reason, ref),
  check (raw_delta is null or raw_delta > delta)
);

create index gold_ledger_free_idx   on public.gold_ledger (user_id, reason, game_id, created_at);
create index gold_ledger_day_idx    on public.gold_ledger (user_id, created_at);
create index gold_ledger_recent_idx on public.gold_ledger (created_at desc);

alter table public.wallets     enable row level security;
alter table public.gold_ledger enable row level security;

-- 잔액은 친구끼리 서로 본다(설계 §14). 장부는 본인·관리자만.
create policy wallets_select on public.wallets
  for select to authenticated using (public.is_approved());
create policy gold_ledger_select on public.gold_ledger
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

revoke all on table public.wallets, public.gold_ledger from public, anon, authenticated;
grant select on table public.wallets, public.gold_ledger to authenticated;

-- ------------------------------------------------------------------ 경제 상수 (economy.ts 사본)
-- src/games/economy.test.ts가 마이그레이션의 가장 마지막 _economy() 본문 JSON을 economy.ts와 비교한다.
create or replace function public._economy() returns jsonb
language sql immutable security definer set search_path = public as $$
  select '{"daily_soft_cap": 30750, "soft_cap_rate": 0.2}'::jsonb
$$;

-- 오늘(KST) 0시
create function public._kst_today_start() returns timestamptz
language sql stable security definer set search_path = public as $$
  select (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul'
$$;

-- 오늘(KST) 사이트 상한에 세는 실제 수입 합계 (world·free·daily_prize, delta > 0)
create function public._earned_today(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.delta), 0)::bigint
    from public.gold_ledger l
   where l.user_id = p_user
     and l.reason in ('world', 'free', 'daily_prize')
     and l.delta > 0
     and l.created_at >= public._kst_today_start()
$$;

-- ------------------------------------------------------------------ 변경 함수
-- 지갑 행이 없으면 0으로 만들고 잠근 뒤 잔액을 돌려준다.
create function public._wallet_lock(p_user uuid) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_bal bigint;
begin
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select w.balance into v_bal from public.wallets w where w.user_id = p_user for update;
  return v_bal;
end
$$;

create function public._gold_move(
  p_user uuid, p_delta bigint, p_reason text, p_ref text,
  p_game text default null, p_note text default null) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_bal  bigint;
  v_got  bigint := p_delta;
  v_raw  bigint;
  v_eco  jsonb;
  v_cap  bigint;
  v_rate numeric;
  v_s    bigint;
  v_room bigint;
begin
  -- 1) 지갑을 먼저 잠근다 (중복 확인·상한 합계는 잠근 뒤에 읽어야 동시 요청이 같은 값을 보지 않는다)
  v_bal := public._wallet_lock(p_user);
  if p_delta is null or p_delta = 0 then
    return v_bal;
  end if;

  -- 2) 같은 지급은 한 번만
  if exists (select 1 from public.gold_ledger l
              where l.user_id = p_user and l.reason = p_reason and l.ref = p_ref) then
    return v_bal;
  end if;

  -- 3) 사이트 하루 상한 (줄임 reason의 수입만)
  if p_delta > 0 and p_reason in ('world', 'free') then
    v_eco  := public._economy();
    v_cap  := (v_eco ->> 'daily_soft_cap')::bigint;
    v_rate := (v_eco ->> 'soft_cap_rate')::numeric;
    v_s    := public._earned_today(p_user);   -- 지갑을 잠근 뒤에 읽는다
    v_room := greatest(v_cap - v_s, 0);
    v_got  := least(p_delta, v_room) + floor((p_delta - least(p_delta, v_room)) * v_rate)::bigint;
    if v_got <= 0 then
      return v_bal;
    end if;
    if v_got < p_delta then
      v_raw := p_delta;
    end if;
  end if;

  -- 4) 잔액 음수 금지
  if v_bal + v_got < 0 then
    raise exception using errcode = 'P0001', message = 'not_enough_gold';
  end if;

  update public.wallets set balance = v_bal + v_got, updated_at = now() where user_id = p_user;
  insert into public.gold_ledger (user_id, delta, balance_after, reason, ref, game_id, note, raw_delta)
  values (p_user, v_got, v_bal + v_got, p_reason, p_ref, p_game, p_note, v_raw);
  return v_bal + v_got;
end
$$;

revoke execute on function public._economy()                                    from public, anon, authenticated;
revoke execute on function public._kst_today_start()                            from public, anon, authenticated;
revoke execute on function public._earned_today(uuid)                           from public, anon, authenticated;
revoke execute on function public._wallet_lock(uuid)                            from public, anon, authenticated;
revoke execute on function public._gold_move(uuid, bigint, text, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ 읽기 RPC
-- {"balance": n, "today": {"<game_id>": 오늘 free 줄기 전 합계}, "earned_today": 오늘 상한에 세는 실제 수입}
create function public.my_wallet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public._require_approved();
  return jsonb_build_object(
    'balance', coalesce((select w.balance from public.wallets w where w.user_id = v_uid), 0),
    'today', coalesce((
      select jsonb_object_agg(t.game_id, t.total)
        from (select l.game_id, sum(coalesce(l.raw_delta, l.delta))::bigint as total
                from public.gold_ledger l
               where l.user_id = v_uid and l.reason = 'free' and l.game_id is not null
                 and l.created_at >= public._kst_today_start()
               group by l.game_id) t), '{}'::jsonb),
    'earned_today', public._earned_today(v_uid));
end
$$;

-- 프로필용 잔액. 승인된 대상이 아니면 null, 지갑이 없으면 0 (user_records와 같은 handle 규칙).
create function public.user_wallet(p_handle text) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  v_target uuid;
begin
  perform public._require_approved();
  select p.id into v_target
    from public.profiles p
   where p.handle::text = lower(btrim(p_handle)) and p.status = 'approved';
  if v_target is null then
    return null;
  end if;
  return coalesce((select w.balance from public.wallets w where w.user_id = v_target), 0);
end
$$;

revoke execute on function public.my_wallet()        from public, anon, authenticated;
revoke execute on function public.user_wallet(text)  from public, anon, authenticated;
grant  execute on function public.my_wallet()        to authenticated;
grant  execute on function public.user_wallet(text)  to authenticated;

-- ------------------------------------------------------------------ 관리자
create function public.admin_gold_adjust(p_handle text, p_delta bigint, p_note text) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_target uuid;
  v_note   text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if char_length(v_note) < 1 or char_length(v_note) > 100 then
    raise exception using errcode = 'P0001', message = 'note_invalid';
  end if;
  select p.id into v_target from public.profiles p where p.handle::text = lower(btrim(p_handle));
  if v_target is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  return public._gold_move(v_target, p_delta, 'admin', gen_random_uuid()::text, null, v_note);
end
$$;

create function public.admin_gold_ledger(p_limit int default 50)
returns table (id bigint, handle citext, delta bigint, balance_after bigint, reason text, ref text,
               game_id text, note text, raw_delta bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select l.id, p.handle, l.delta, l.balance_after, l.reason, l.ref, l.game_id, l.note, l.raw_delta, l.created_at
      from public.gold_ledger l
      join public.profiles p on p.id = l.user_id
     order by l.created_at desc, l.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end
$$;

revoke execute on function public.admin_gold_adjust(text, bigint, text) from public, anon, authenticated;
revoke execute on function public.admin_gold_ledger(int)                from public, anon, authenticated;
grant  execute on function public.admin_gold_adjust(text, bigint, text) to authenticated;
grant  execute on function public.admin_gold_ledger(int)                to authenticated;
