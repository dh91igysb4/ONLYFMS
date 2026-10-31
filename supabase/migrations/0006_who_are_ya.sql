-- 0006_who_are_ya: 후알야(who-are-ya) 게임 등록
--
--   * game_modes: 데일리·대회·자유 모두 가능 (src/games/who-are-ya/manifest.ts modes와 같다).
--   * hidden_games: 처음에는 숨김. 관리자 확인 뒤 새 마이그레이션으로 hidden_games 행을 지워 공개한다.
--   src/games/registry.test.ts가 이 시드와 등록부가 같은지 검사한다.

insert into game_modes (game_id, daily, contest, free) values ('who-are-ya', true, true, true);
insert into hidden_games (game_id) values ('who-are-ya');
