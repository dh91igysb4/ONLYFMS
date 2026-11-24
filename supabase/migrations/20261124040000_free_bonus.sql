-- 도전과제 보너스: 지속형 게임의 진행이 자유 플레이(미니게임) 골드를 영구히 늘린다
-- (지갑 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §7.5, 2026-11-24 사용자 요청).
--
--   * 원천: game_records의 키 'free_bonus'(값 = %, 0 이상 정수). world 함수만 쓴다(WorldLogic.freeBonus가 있는 게임,
--     요청마다 다시 계산해 바뀌었으면 upsert). 브라우저는 game_records를 쓸 수 없으므로 서버가 정한 값이다.
--     플랫폼은 게임 id를 모른다: 어느 게임이든 이 키를 쓰면 더해진다(낚시는 깬 도전과제의 freeBonusPct 합, 다 깨면 400).
--   * _free_bonus_pct(user) = least(숨김이 아닌 게임의 free_bonus 합, _economy()->'free_bonus_max_pct' = 400).
--   * _free_plays_gold: 판당 금액 floor(least(floor(score × perPoint), playCap) × (100 + pct) / 100),
--     게임별 하루 상한도 floor(gold_daily_cap × (100 + pct) / 100). 오늘 쓴 몫(줄기 전 합계)은 지금처럼 보너스 뒤 금액으로 센다.
--     사이트 하루 상한은 _gold_move가 그대로 적용한다(보너스와 무관). 데일리 상금·판돈·참가비·world 골드에는 곱하지 않는다.
--   * my_wallet()에 free_bonus_pct, 프로필용 user_free_bonus(handle).
--   * economy.ts의 freeGold(…, bonusPct)·withBonus가 같은 식이다(economy.test.ts).

create or replace function public._economy() returns jsonb
language sql immutable security definer set search_path = public as $$
  select '{"daily_soft_cap": 30750, "soft_cap_rate": 0.2, "daily_soft_cap_2": 41000, "soft_cap_rate_2": 0.04, "daily_prizes": [6150, 5120, 4100, 3070, 2460, 2050], "stake_max": 41000, "fee_max": 41000, "free_bonus_max_pct": 400}'::jsonb
$$;
revoke execute on function public._economy() from public, anon, authenticated;

create function public._free_bonus_pct(p_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select least(
           coalesce(sum(greatest(floor(r.value), 0)), 0),
           (public._economy() ->> 'free_bonus_max_pct')::int)::int
    from public.game_records r
   where r.user_id = p_uid
     and r.key = 'free_bonus'
     and not public._is_hidden_game(r.game_id)
$$;
revoke execute on function public._free_bonus_pct(uuid) from public, anon, authenticated;

create or replace function public._free_plays_gold() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mode public.game_modes%rowtype;
  v_amt  bigint;
  v_used bigint;
  v_pct  int;
begin
  select * into v_mode from public.game_modes g where g.game_id = new.game_id;
  if not found or not v_mode.free or public._is_hidden_game(new.game_id) then
    return null;
  end if;

  v_amt := least(floor(new.score * v_mode.gold_per_point), v_mode.gold_play_cap)::bigint;
  if v_amt <= 0 then
    return null;
  end if;

  -- 지갑을 먼저 잠근 뒤 합계를 읽는다 (동시에 들어온 두 판이 같은 합계를 보지 않게)
  perform public._wallet_lock(new.user_id);
  v_pct := public._free_bonus_pct(new.user_id);
  v_amt := (v_amt * (100 + v_pct)) / 100;  -- bigint 나눗셈 = 내림(양수)
  select coalesce(sum(coalesce(l.raw_delta, l.delta)), 0)::bigint into v_used
    from public.gold_ledger l
   where l.user_id = new.user_id
     and l.reason = 'free'
     and l.game_id = new.game_id
     and l.created_at >= public._kst_today_start();

  v_amt := least(v_amt, (v_mode.gold_daily_cap::bigint * (100 + v_pct)) / 100 - v_used);
  if v_amt > 0 then
    perform public._gold_move(new.user_id, v_amt, 'free', new.client_id::text, new.game_id);
  end if;
  return null;
end
$$;
revoke execute on function public._free_plays_gold() from public, anon, authenticated;

create or replace function public.my_wallet() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public._require_approved();
  begin
    perform public.settle_due();
  exception when others then
    raise warning 'settle_due failed: % (%)', sqlerrm, sqlstate;
  end;
  return jsonb_build_object(
    'balance', coalesce((select w.balance from public.wallets w where w.user_id = v_uid), 0),
    'today', coalesce((
      select jsonb_object_agg(t.game_id, t.total)
        from (select l.game_id, sum(coalesce(l.raw_delta, l.delta))::bigint as total
                from public.gold_ledger l
               where l.user_id = v_uid and l.reason = 'free' and l.game_id is not null
                 and l.created_at >= public._kst_today_start()
               group by l.game_id) t), '{}'::jsonb),
    'earned_today', public._earned_today(v_uid),
    'free_bonus_pct', public._free_bonus_pct(v_uid),
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'reason', l.reason, 'contest_id', l.ref, 'game_id', l.game_id,
               'amount', l.delta, 'note', l.note, 'at', l.created_at) order by l.id desc)
        from (select * from public.gold_ledger g
               where g.user_id = v_uid and g.reason in ('daily_prize', 'contest_prize')
                 and g.created_at >= now() - interval '3 days'
               order by g.id desc
               limit 10) l), '[]'::jsonb));
end
$$;
revoke execute on function public.my_wallet() from public, anon, authenticated;
grant  execute on function public.my_wallet() to authenticated;

-- 프로필용 도전과제 보너스(%). 승인된 대상이 아니면 null (user_wallet과 같은 handle 규칙)
create function public.user_free_bonus(p_handle text) returns int
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
  return public._free_bonus_pct(v_target);
end
$$;
revoke execute on function public.user_free_bonus(text) from public, anon, authenticated;
grant  execute on function public.user_free_bonus(text) to authenticated;
