-- 볼 런 공개: 숨김 목록에서 뺀다 (manifest hidden: false 와 일치해야 한다 — registry.test.ts).
-- free_plays 기록은 건드리지 않는다.
delete from hidden_games where game_id = 'ball-run';
