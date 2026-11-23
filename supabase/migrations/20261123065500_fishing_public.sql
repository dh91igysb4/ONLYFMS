-- 펨타듀 낚시 공개: 숨김 목록에서 뺀다 (manifest hidden: false 와 일치해야 한다 — registry.test.ts).
-- world_saves·game_records는 건드리지 않는다 (숨김 기간에 만든 세이브가 그대로 남는다).
delete from hidden_games where game_id = 'fishing';
