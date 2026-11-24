-- 미니게임(자유 플레이) 골드를 1/4로 (지갑 설계 §7.3, 2026-11-24 개정).
-- 판당 지급률·판당 상한·게임별 하루 상한을 모두 FREE_REF = REF / 4 = 5,125 G/시간 기준으로 다시 맞춘다.
-- 이미 지급된 골드(지갑 잔액·장부)는 건드리지 않는다. manifest gold와 같아야 한다(registry.test.ts).

update game_modes set gold_per_point = 0.825, gold_play_cap = 250, gold_daily_cap = 5125 where game_id = 'ball-run';
update game_modes set gold_per_point = 2.375, gold_play_cap = 360, gold_daily_cap = 5125 where game_id = 'neon-rider';
update game_modes set gold_per_point = 16, gold_play_cap = 460, gold_daily_cap = 5125 where game_id = 'toothbrush';
update game_modes set gold_per_point = 0.155, gold_play_cap = 710, gold_daily_cap = 5125 where game_id = 'sneak-exam';
update game_modes set gold_per_point = 22.5, gold_play_cap = 680, gold_daily_cap = 5125 where game_id = 'who-are-ya';
