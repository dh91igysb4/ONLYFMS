-- 20261126080131_career_quiz: 커리어 퀴즈(career-quiz) 자유 플레이 게임 등록
--   설계 docs/superpowers/specs/2026-11-25-career-quiz-design.md
--
--   * game_modes: 자유 플레이만 켬. 점수 상한 10(기본).
--   * hidden_games: 숨김으로 시작한다. 관리자가 미리보기·운영에서 확인한 뒤 새 마이그레이션으로 푼다.
--   * 골드: src/games/career-quiz/manifest.ts gold와 같아야 한다(registry.test.ts, gold.test.ts).
--   답 검색은 football_search RPC(20261102062215)를 쓴다. 운영 DB에 축구 데이터가 적재돼 있어야 한다(npm run football:load).

insert into game_modes (game_id, daily, contest, free) values ('career-quiz', false, false, true);
insert into hidden_games (game_id) values ('career-quiz');
update game_modes set gold_per_point = 9, gold_play_cap = 200, gold_daily_cap = 2050 where game_id = 'career-quiz';
