-- 20261122081704_sneak_exam: 몰래 수능(sneak-exam) 자유 플레이 점수 게임 등록
--
--   * game_modes: 자유 플레이만 켬, score_max 1600.
--     src/games/sneak-exam/manifest.ts의 modes·scoreMax와 같아야 한다 (scoreMax를 바꾸면 새 마이그레이션으로 score_max도 바꾼다).
--   * hidden_games: 처음에는 숨김. 관리자 확인 뒤 새 마이그레이션으로 hidden_games 행을 지워 공개한다.
--   src/games/registry.test.ts가 이 시드와 등록부(games + duels)가 같은지 검사한다.

insert into game_modes (game_id, daily, contest, free, score_max) values ('sneak-exam', false, false, true, 1600);
insert into hidden_games (game_id) values ('sneak-exam');
