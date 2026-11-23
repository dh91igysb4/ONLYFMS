-- 정산과 데일리 상금 (지갑 3단계, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §8, §8.1)

-- ------------------------------------------------------------------ 경제 상수 (economy.ts 사본)
-- 상금 표 REF × [0.3, 0.25, 0.2, 0.15, 0.12, 0.1](10 단위 내림), 판돈·참가비 상한 REF × 2.
-- src/games/economy.test.ts가 마이그레이션의 가장 마지막 _economy() 본문 JSON을 economy.ts와 비교한다.
create or replace function public._economy() returns jsonb
language sql immutable security definer set search_path = public as $$
  select '{"daily_soft_cap": 30750, "soft_cap_rate": 0.2, "daily_soft_cap_2": 41000, "soft_cap_rate_2": 0.04, "daily_prizes": [6150, 5120, 4100, 3070, 2460, 2050], "stake_max": 41000, "fee_max": 41000}'::jsonb
$$;

revoke execute on function public._economy() from public, anon, authenticated;

-- ------------------------------------------------------------------ 정산 (설계 §8)
-- 원칙
--   * 예약 작업이 없다. 끝난 대회는 접속한 사람이 정산시킨다: my_wallet()이 처음에 settle_due()를 부른다.
--   * 소급 없음: 이 마이그레이션 시점에 이미 끝난 대회는 모두 정산된 것으로 표시한다(아래 update).
--     그때 진행 중이던 그날 데일리는 끝난 뒤 정상 정산된다.
--   * 한 사람 × 한 대회 = 장부 한 줄(unique (user_id, reason, ref), ref = 대회 id). settled_at은 일을 줄이는 표시이고,
--     두 번 들어가지 않음은 장부가 보장한다.
--   * 잠금 순서: 대회 행(for update skip locked)을 먼저, 지갑을 나중에. 여러 대회를 한 번에 정산해도 지급 목록을 모아
--     트랜잭션 전체에서 user_id 오름차순으로 _gold_move를 부른다(대회별 오름차순이면 두 정산이 서로 다른 순서로
--     지갑을 잡아 교착이 생길 수 있다).
--   * 데일리 상금(§8.1): _lb_contest_rows(대회, false)(리더보드 정렬, 승인 사용자만, 숨김 게임 기록 제외) 가운데
--     행동을 한 번 이상 한 사람(action_count > 0)만 남겨 다시 센 등수 k. 금액 = _economy()->'daily_prizes'[min(k, 6)].
--     장부 note = 'k등'. 열기만 한 사람(점수 0·행동 0)은 행동한 0점보다 앞에 정렬되므로 빼고 다시 센다.
--   * 사이트 하루 상한은 여기서 계산하지 않는다: daily_prize는 _gold_move가 합계에만 넣고 줄이지 않는다(§5.6).

alter table public.contests add column settled_at timestamptz;
create index contests_unsettled_idx on public.contests (ends_at) where settled_at is null;
-- 소급 없음
update public.contests set settled_at = now() where ends_at <= now();
-- 화면이 "정산 중"을 안다
grant select (settled_at) on table public.contests to authenticated;

-- 대회별 지급 조회(대회 페이지 상금, 4·5단계 판돈·참가비 합계)
create index gold_ledger_ref_idx on public.gold_ledger (ref, reason);

-- 대회 하나의 지급 목록(계산만). 취소됐거나 데일리가 아니면 빈 결과(5단계에서 공식·친선 분배를 더한다).
create function public._contest_payouts(p_contest uuid)
returns table (user_id uuid, amount bigint, reason text, game_id text, note text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_c      public.contests%rowtype;
  v_prizes jsonb;
  v_n      int;
  v_game   text;
begin
  select * into v_c from public.contests c where c.id = p_contest;
  if not found or v_c.cancelled_at is not null or v_c.kind <> 'daily' then
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
end
$$;

-- 끝났고 정산 안 된 대회를 최대 20개 정산한다. 잡은 대회 수를 돌려준다. 승인 사용자 누구나.
create function public.settle_due() returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ids uuid[];
  r     record;
begin
  perform public._require_approved();
  -- 1) 대회 행을 먼저 잡는다. 다른 정산이 잡고 있는 대회는 기다리지 않고 건너뛴다
  select coalesce(array_agg(t.id), '{}') into v_ids
    from (select c.id from public.contests c
           where c.settled_at is null and c.ends_at <= now()
           order by c.ends_at, c.id
           limit 20
           for update skip locked) t;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  -- 2) 지급 목록을 모아 트랜잭션 전체에서 user_id 오름차순으로 (지갑 잠금 순서)
  for r in
    select p.user_id, p.amount, p.reason, p.game_id, p.note, x.id as contest_id
      from unnest(v_ids) as x(id)
      cross join lateral public._contest_payouts(x.id) p
     order by p.user_id, x.id
  loop
    perform public._gold_move(r.user_id, r.amount, r.reason, r.contest_id::text, r.game_id, r.note);
  end loop;
  -- 3) 표시
  update public.contests set settled_at = now() where id = any(v_ids);
  return cardinality(v_ids);
end
$$;

-- my_wallet: 처음에 정산하고(실패해도 잔액은 읽힌다), 최근 3일 받은 상금 목록을 함께 돌려준다.
-- {"balance", "today", "earned_today", "prizes": [{id, reason, contest_id, game_id, amount, note, at}]}
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

-- 대회 페이지: 그 대회에서 받은 상금(데일리 상금, 5단계 대회 상금). 볼 수 있는 대회만.
create function public.contest_prizes(p_contest uuid)
returns table (user_id uuid, handle citext, amount bigint, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  if not public.can_see_contest(p_contest) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select l.user_id, p.handle, l.delta, l.note
      from public.gold_ledger l
      join public.profiles p on p.id = l.user_id
     where l.ref = p_contest::text and l.reason in ('daily_prize', 'contest_prize')
     order by l.delta desc, p.handle asc nulls last, l.user_id;
end
$$;

-- 프로필: 데일리 상금 누적. 승인된 대상이 아니면 null, 없으면 0 (user_wallet과 같은 handle 규칙).
create function public.user_prize_total(p_handle text) returns bigint
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
  return coalesce((select sum(l.delta) from public.gold_ledger l
                    where l.user_id = v_target and l.reason = 'daily_prize'), 0)::bigint;
end
$$;

revoke execute on function public._contest_payouts(uuid)  from public, anon, authenticated;
revoke execute on function public.settle_due()            from public, anon, authenticated;
revoke execute on function public.my_wallet()             from public, anon, authenticated;
revoke execute on function public.contest_prizes(uuid)    from public, anon, authenticated;
revoke execute on function public.user_prize_total(text)  from public, anon, authenticated;
grant  execute on function public.settle_due()            to authenticated;
grant  execute on function public.my_wallet()             to authenticated;
grant  execute on function public.contest_prizes(uuid)    to authenticated;
grant  execute on function public.user_prize_total(text)  to authenticated;
