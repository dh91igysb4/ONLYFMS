-- 0011_yacht: 요트 다이스(yacht) 대전 게임 등록
--
--   * game_modes: 솔로 모드는 모두 끔 (src/games/yacht/manifest.ts modes와 같다).
--   * hidden_games: 처음에는 숨김. 관리자 확인 뒤 새 마이그레이션으로 hidden_games 행을 지워 공개한다.
--   src/games/registry.test.ts가 이 시드와 등록부(games + duels)가 같은지 검사한다.

insert into game_modes (game_id, daily, contest, free) values ('yacht', false, false, false);
insert into hidden_games (game_id) values ('yacht');
