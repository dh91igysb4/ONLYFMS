-- 대전 판돈 (지갑 4단계 Task 19, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §9, §14)
--
-- 원칙
--   * 판돈 duel_matches.stake는 0 ~ 41,000(STAKE_MAX, economy.ts / _economy()->>'stake_max'). 만든 뒤 바뀌지 않는다.
--     숨김 게임은 0만(invalid_stake). 같은 화면 2인 모드는 서버 대국이 없으므로 판돈도 없다.
--   * 맡기기: duel Edge Function이 대국 행을 잡은 트랜잭션에서 _gold_move(…, −stake, 'duel_stake', 대국 id, 게임 id).
--     만들 때 만든 사람, 참가 때 참가자. 잔액이 모자라면 not_enough_gold로 트랜잭션 전체가 되돌려진다.
--   * 지급·환불은 이 파일의 트리거 _duel_settle_stakes 한 곳에서만 한다. status가 finished/void로 바뀌는 모든 길
--     (save, create의 오래된 대기 일괄 무효, duel_list의 만료 정리, expireIfStale, 버전 변경 무효, 취소,
--     첫 행동 전 종료)이 같은 update를 지나기 때문이다.
--       finished + 승자  → 승자에게 맡긴 돈 합계 'duel_payout'
--       finished 무승부, void → 맡긴 사람마다 그만큼 'duel_refund'
--     금액은 stake 열이 아니라 장부 duel_stake 줄(실제로 빠진 돈)에서 읽는다. 승자 계정이 지워졌으면 환불로 처리한다
--     (트리거가 대국 종료를 막지 않게).
--   * 잠금 순서: 트리거는 대국 행 update 안에서 돌므로 대국 행을 이미 잡고 있다. 지갑은 user_id 오름차순.
--     duel_list의 만료 정리는 대기 행을 만든 사람 순서로 하나씩 잠그고(skip locked) 무효로 해 지갑도 오름차순이 된다.
--   * 판돈은 사람 사이에서 옮기는 돈이라 사이트 하루 상한에 세지도 줄이지도 않는다(_gold_move의 표, §5.6).
--   * Elo·전적은 판돈과 무관하다.

alter table public.duel_matches
  add column stake int not null default 0,
  add constraint duel_matches_stake check (stake between 0 and 41000);

grant select (stake) on table public.duel_matches to authenticated;

-- ------------------------------------------------------------------ 판돈 검사 (숨김 게임 0만, 바꾸기 금지)
create function public._duel_stake_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.stake > 0 and public._is_hidden_game(new.game_id) then
      raise exception using errcode = 'P0001', message = 'invalid_stake';
    end if;
  elsif new.stake is distinct from old.stake then
    raise exception using errcode = 'P0001', message = 'stake_immutable';
  end if;
  return new;
end
$$;

create trigger duel_matches_stake_guard
  before insert or update of stake on public.duel_matches
  for each row execute function public._duel_stake_guard();

-- ------------------------------------------------------------------ 지급·환불 (한 곳)
create function public._duel_settle_stakes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ref    text := new.id::text;
  v_total  bigint;
  v_winner uuid;
  r        record;
begin
  select coalesce(sum(-l.delta), 0)::bigint into v_total
    from public.gold_ledger l
   where l.reason = 'duel_stake' and l.ref = v_ref;
  if v_total <= 0 then
    return null;
  end if;

  if new.status = 'finished' and new.winner is not null and new.players is not null then
    v_winner := new.players[new.winner + 1];
  end if;

  if v_winner is not null and exists (select 1 from public.profiles p where p.id = v_winner) then
    perform public._gold_move(v_winner, v_total, 'duel_payout', v_ref, new.game_id);
  else
    for r in
      select l.user_id, -l.delta as amount
        from public.gold_ledger l
       where l.reason = 'duel_stake' and l.ref = v_ref
       order by l.user_id
    loop
      perform public._gold_move(r.user_id, r.amount, 'duel_refund', v_ref, new.game_id);
    end loop;
  end if;
  return null;
end
$$;

create trigger duel_matches_settle_stakes
  after update of status on public.duel_matches
  for each row
  when (old.status not in ('finished', 'void') and new.status in ('finished', 'void'))
  execute function public._duel_settle_stakes();

revoke execute on function public._duel_stake_guard()   from public, anon, authenticated;
revoke execute on function public._duel_settle_stakes() from public, anon, authenticated;

-- ------------------------------------------------------------------ 목록 항목에 stake
create or replace function public._duel_item(m public.duel_matches) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id,
    'game_id', m.game_id,
    'rated', m.rated,
    'visibility', m.visibility,
    'turn_seconds', m.turn_seconds,
    'status', m.status,
    'stake', m.stake,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', u.uid, 'handle', p.handle::text, 'rating', public._duel_rating(u.uid, m.game_id))
                        order by u.ord), '[]'::jsonb)
                  from unnest(coalesce(m.players, array_remove(array[m.created_by], null))) with ordinality as u(uid, ord)
                  left join public.profiles p on p.id = u.uid),
    'created_by_handle', (select p.handle::text from public.profiles p where p.id = m.created_by),
    'created_at', m.created_at,
    'winner', m.winner,
    'end_reason', m.end_reason,
    'final_scores', m.final_scores)
$$;

-- ------------------------------------------------------------------ duel_list: 만료 정리를 지갑 순서로
-- 예전에는 한 문장 update로 여러 사람의 대기를 무효로 했다. 이제 무효가 환불(지갑 잠금)을 낳으므로
-- 만든 사람 순서로 하나씩 잠그고(이미 다른 트랜잭션이 잡은 행은 건너뜀) 무효로 한다.
create or replace function public.duel_list() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_lobby jsonb;
  v_mine  jsonb;
  v_recent jsonb;
  v_due   jsonb;
  v_stale record;
begin
  perform public._require_approved();
  v_admin := public.is_admin();

  for v_stale in
    select m.id from public.duel_matches m
     where m.status = 'waiting' and m.created_at < now() - interval '10 minutes'
     order by m.created_by, m.id
       for update skip locked
  loop
    update public.duel_matches
       set status = 'void', end_reason = 'void', ended_at = now()
     where id = v_stale.id and status = 'waiting';
  end loop;

  select coalesce(jsonb_agg(public._duel_item(m) order by m.created_at desc, m.id), '[]'::jsonb)
    into v_lobby
    from public.duel_matches m
   where m.status = 'waiting' and m.visibility = 'public'
     and m.created_by is not null and m.created_by <> v_uid
     and (v_admin or not public._is_hidden_game(m.game_id));

  select coalesce(jsonb_agg(public._duel_item(m) order by m.created_at desc, m.id), '[]'::jsonb)
    into v_mine
    from public.duel_matches m
   where m.status in ('waiting', 'active')
     and (m.players @> array[v_uid] or m.created_by = v_uid)
     and (v_admin or not public._is_hidden_game(m.game_id));

  select coalesce(jsonb_agg(public._duel_item(m) order by m.ended_at desc nulls last, m.id), '[]'::jsonb)
    into v_recent
    from public.duel_matches m
   where m.id in (
     select x.id from public.duel_matches x
      where x.status in ('finished', 'void')
        and x.players @> array[v_uid]
        and (v_admin or not public._is_hidden_game(x.game_id))
      order by x.ended_at desc nulls last, x.id
      limit 10);

  select coalesce(jsonb_agg(m.id order by m.turn_deadline, m.id), '[]'::jsonb)
    into v_due
    from public.duel_matches m
   where m.status = 'active'
     and m.players @> array[v_uid]
     and m.turn_deadline < now()
     and (v_admin or not public._is_hidden_game(m.game_id));

  return jsonb_build_object('lobby', v_lobby, 'mine', v_mine, 'recent', v_recent, 'due', v_due);
end
$$;
