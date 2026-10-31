-- 요트 다이스(yacht) 공개. 관리자 확인을 마쳤다.
-- src/games/yacht/manifest.ts의 hidden: false와 같아야 한다 (src/games/registry.test.ts).

delete from hidden_games where game_id = 'yacht';
