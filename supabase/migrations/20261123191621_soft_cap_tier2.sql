-- 사이트 하루 상한 2단 (지갑 2단계, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §5.6, 2026-11-24 개정)
--
-- 오늘(KST) 들어간 수입 합계 s 기준 지급률:
--   s < 30,750 (REF × 1.5)        100%
--   30,750 ≤ s < 41,000 (REF × 2)  20%
--   41,000 ≤ s                      4%
-- 하루 1시간 하는 사람(끝 무렵 하루 원래 약 89,000 → 약 41,300)은 거의 그대로이고, 하루 여러 시간 하는 사람은
-- 낚시 장비·해금을 다 사기까지 3시간 약 25일·5시간 약 22일(옛 1단 20%: 16.4·11.4일). 계산은 src/games/economyPace.test.ts.
-- 상수 원본은 src/games/economy.ts(DAILY_SOFT_CAP_2·SOFT_CAP_RATE_2·softCap), economy.test.ts가 이 _economy()와 비교한다.
-- 셈·줄임 reason 표와 잠금 순서는 20261123181545_wallet.sql 그대로다. 상한 계산은 여전히 _gold_move 한 곳에만 있다.

create or replace function public._economy() returns jsonb
language sql immutable security definer set search_path = public as $$
  select '{"daily_soft_cap": 30750, "soft_cap_rate": 0.2, "daily_soft_cap_2": 41000, "soft_cap_rate_2": 0.04}'::jsonb
$$;

create or replace function public._gold_move(
  p_user uuid, p_delta bigint, p_reason text, p_ref text,
  p_game text default null, p_note text default null) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_bal   bigint;
  v_got   bigint := p_delta;
  v_raw   bigint;
  v_eco   jsonb;
  v_cap   bigint;
  v_rate  numeric;
  v_cap2  bigint;
  v_rate2 numeric;
  v_s     bigint;
  v_full  bigint;
  v_d1    bigint;
  v_room2 bigint;
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

  -- 3) 사이트 하루 상한 2단 (줄임 reason의 수입만). 들어간 합계 기준 구간 적분, 마지막에 한 번 내림
  if p_delta > 0 and p_reason in ('world', 'free') then
    v_eco   := public._economy();
    v_cap   := (v_eco ->> 'daily_soft_cap')::bigint;
    v_rate  := (v_eco ->> 'soft_cap_rate')::numeric;
    v_cap2  := (v_eco ->> 'daily_soft_cap_2')::bigint;
    v_rate2 := (v_eco ->> 'soft_cap_rate_2')::numeric;
    v_s     := public._earned_today(p_user);   -- 지갑을 잠근 뒤에 읽는다
    v_full  := least(p_delta, greatest(v_cap - v_s, 0));
    v_d1    := p_delta - v_full;
    if v_d1 = 0 then
      v_got := v_full;
    else
      v_room2 := greatest(v_cap2 - greatest(v_s, v_cap), 0);
      if v_d1 * v_rate <= v_room2 then
        v_got := v_full + floor(v_d1 * v_rate)::bigint;
      else
        v_got := v_full + v_room2 + floor((v_d1 * v_rate - v_room2) * v_rate2 / v_rate)::bigint;
      end if;
    end if;
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

-- create or replace는 권한을 그대로 두지만, 명시해 둔다
revoke execute on function public._economy()                                      from public, anon, authenticated;
revoke execute on function public._gold_move(uuid, bigint, text, text, text, text) from public, anon, authenticated;
