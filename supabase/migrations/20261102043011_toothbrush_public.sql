-- 양치 시뮬레이터(toothbrush) 공개. 관리자 확인을 마쳤다.
-- src/games/toothbrush/manifest.ts의 hidden: false와 같아야 한다 (src/games/registry.test.ts).

delete from hidden_games where game_id = 'toothbrush';
