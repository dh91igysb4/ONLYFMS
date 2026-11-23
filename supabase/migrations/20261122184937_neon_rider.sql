-- 20261122184937_neon_rider: 네온 라이더(neon-rider) 자유 플레이 점수 게임 등록
--
--   * game_modes: 자유 플레이만 켬, score_max 9999.
--     src/games/neon-rider/manifest.ts의 modes·scoreMax와 같아야 한다 (scoreMax를 바꾸면 새 마이그레이션으로 score_max도 바꾼다).
--   * hidden_games: 넣지 않는다. 사용자 결정으로 처음부터 공개한다.
--   src/games/registry.test.ts가 이 시드와 등록부(games + duels)가 같은지 검사한다.

insert into game_modes (game_id, daily, contest, free, score_max) values ('neon-rider', false, false, true, 9999);
