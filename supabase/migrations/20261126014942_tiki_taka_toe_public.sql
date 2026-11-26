-- 티키타카토 공개: 숨김 목록에서 뺀다 (manifest hidden: false 와 일치해야 한다 — registry.test.ts).
delete from hidden_games where game_id = 'tiki-taka-toe';
