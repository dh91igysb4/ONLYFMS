-- 1대1 레이싱(duel-racer, 설계 docs/superpowers/specs/2026-11-28-duel-racer-design.md).
--   * game_modes: 솔로 모드는 모두 끔 (src/games/duel-racer/manifest.ts modes와 같다).
--   * hidden_games: 처음에는 숨김. 관리자 확인 뒤 새 마이그레이션으로 hidden_games 행을 지워 공개한다.
insert into game_modes (game_id, daily, contest, free) values ('duel-racer', false, false, false);
insert into hidden_games (game_id) values ('duel-racer');
