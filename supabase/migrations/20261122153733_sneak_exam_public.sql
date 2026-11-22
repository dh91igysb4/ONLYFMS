-- 몰래 수능 공개: 숨김 목록에서 뺀다 (manifest hidden: false 와 일치해야 한다 — registry.test.ts).
delete from hidden_games where game_id = 'sneak-exam';

-- 공개 전(숨김·쉬운 규칙 v1 포함) 자유 플레이 기록을 지워 리더보드를 0에서 시작한다.
-- free_play_logs는 on delete cascade로 함께 지워진다. 되돌릴 수 없다.
delete from public.free_plays where game_id = 'sneak-exam';
