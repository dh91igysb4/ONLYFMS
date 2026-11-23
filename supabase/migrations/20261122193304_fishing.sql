-- 낚시(지속형 world 게임) 등록: 모드는 모두 끄고 숨김 게임으로 둔다.
insert into game_modes (game_id, daily, contest, free) values ('fishing', false, false, false);
insert into hidden_games (game_id) values ('fishing');
