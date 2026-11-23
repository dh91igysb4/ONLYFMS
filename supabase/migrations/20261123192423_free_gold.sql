-- 자유 플레이 골드 지급 (지갑 2단계 Task 9, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §7)
--
--   * game_modes.gold_per_point·gold_play_cap·gold_daily_cap: 게임별 수치. 원본은 manifest `gold`이고
--     src/games/registry.test.ts가 아래 고정 형식 update 문장을 읽어 비교한다. 0/0/0 = 지급 없음.
--     수치 근거(기준 플레이 시간당 REF ±20%)는 게임별 src/games/<id>/gold.test.ts.
--   * _free_plays_gold: free_plays after insert 트리거. 판당 least(floor(score × perPoint), playCap),
--     지갑을 잠근 뒤 오늘(KST) 그 게임 free 합계(줄기 전 금액 coalesce(raw_delta, delta))로 게임별 하루 상한,
--     그리고 _gold_move(…, 'free', client_id, game_id). 사이트 하루 상한은 _gold_move가 적용한다(여기에 상한 계산 없음).
--   * 숨김 게임·free = false·설정 없는 게임은 지급하지 않는다. 같은 client_id 재전송은 on conflict로 행이 안 들어가
--     트리거도 돌지 않고, 들어가더라도 장부 unique (user, 'free', client_id)가 막는다.
--   * 잠금 순서: free_plays 행(새 행이라 다른 트랜잭션과 겹치지 않음) → 지갑.

alter table public.game_modes
  add column gold_per_point numeric(10,4) not null default 0 check (gold_per_point >= 0),
  add column gold_play_cap  int not null default 0 check (gold_play_cap >= 0),
  add column gold_daily_cap int not null default 0 check (gold_daily_cap >= 0);

update game_modes set gold_per_point = 64, gold_play_cap = 1860, gold_daily_cap = 20500 where game_id = 'toothbrush';
update game_modes set gold_per_point = 0.62, gold_play_cap = 2860, gold_daily_cap = 20500 where game_id = 'sneak-exam';
update game_modes set gold_per_point = 3.3, gold_play_cap = 990, gold_daily_cap = 20500 where game_id = 'ball-run';
update game_modes set gold_per_point = 9.5, gold_play_cap = 1430, gold_daily_cap = 20500 where game_id = 'neon-rider';
update game_modes set gold_per_point = 90, gold_play_cap = 2700, gold_daily_cap = 20500 where game_id = 'who-are-ya';

create function public._free_plays_gold() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mode public.game_modes%rowtype;
  v_amt  bigint;
  v_used bigint;
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
  select coalesce(sum(coalesce(l.raw_delta, l.delta)), 0)::bigint into v_used
    from public.gold_ledger l
   where l.user_id = new.user_id
     and l.reason = 'free'
     and l.game_id = new.game_id
     and l.created_at >= public._kst_today_start();

  v_amt := least(v_amt, v_mode.gold_daily_cap - v_used);
  if v_amt > 0 then
    perform public._gold_move(new.user_id, v_amt, 'free', new.client_id::text, new.game_id);
  end if;
  return null;
end
$$;
revoke execute on function public._free_plays_gold() from public, anon, authenticated;

create trigger free_plays_gold
  after insert on public.free_plays
  for each row execute function public._free_plays_gold();
