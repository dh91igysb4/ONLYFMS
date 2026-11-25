-- 낚시 수입(reason world)을 사이트 하루 상한에서 뺀다 (설계 docs/superpowers/specs/2026-11-25-fishing-sell-decay-design.md).
-- 낚시는 이제 판매 마릿수 감쇠(낚시 logic.version 15)로 하루 수입을 줄인다. 사이트 상한은 미니게임(free)에만 걸리고,
-- 하루 합계(_earned_today)도 free·daily_prize만 센다. 이미 지급된 골드·장부는 건드리지 않는다.

create or replace function public._earned_today(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.delta), 0)::bigint
    from public.gold_ledger l
   where l.user_id = p_user
     and l.reason in ('free', 'daily_prize')
     and l.delta > 0
     and l.created_at >= public._kst_today_start()
$$;
revoke execute on function public._earned_today(uuid) from public, anon, authenticated;

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

  -- 3) 사이트 하루 상한 2단 (미니게임 free 수입만, 2026-11-25부터 낚시 world 제외). 들어간 합계 기준 구간 적분, 마지막에 한 번 내림
  if p_delta > 0 and p_reason = 'free' then
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
      -- v_rate = 0이면 둘째 구간이 차지 않으므로 v_full만 (아래 나눗셈에 닿지 않게 명시)
      if v_rate = 0 then
        v_got := v_full;
      elsif v_d1 * v_rate <= v_room2 then
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
revoke execute on function public._gold_move(uuid, bigint, text, text, text, text) from public, anon, authenticated;
