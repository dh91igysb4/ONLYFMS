-- 미니게임(자유 플레이) 골드를 1/10로 (지갑 설계 §7.3, 2026-11-24 개정).
-- 판당 지급률·판당 상한·게임별 하루 상한을 모두 FREE_REF = REF / 10 = 2,050 G/시간 기준으로 다시 맞춘다.
-- 판당 상한은 기준 한 판의 5배이되 200을 넘지 않는다(보너스 전, 친구들 기준 "한 판 200 아래, 아주 고득점 아니면 100 아래").
-- 이미 지급된 골드(지갑 잔액·장부)는 건드리지 않는다. manifest gold와 같아야 한다(registry.test.ts).

update game_modes set gold_per_point = 0.33, gold_play_cap = 100, gold_daily_cap = 2050 where game_id = 'ball-run';
update game_modes set gold_per_point = 0.95, gold_play_cap = 140, gold_daily_cap = 2050 where game_id = 'neon-rider';
update game_modes set gold_per_point = 6.4, gold_play_cap = 190, gold_daily_cap = 2050 where game_id = 'toothbrush';
update game_modes set gold_per_point = 0.062, gold_play_cap = 200, gold_daily_cap = 2050 where game_id = 'sneak-exam';
update game_modes set gold_per_point = 9, gold_play_cap = 200, gold_daily_cap = 2050 where game_id = 'who-are-ya';
