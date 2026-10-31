-- 0007_who_are_ya_public: 후알야(who-are-ya) 공개. 관리자 확인을 마쳤다.
-- src/games/who-are-ya/manifest.ts의 hidden: false와 같아야 한다 (src/games/registry.test.ts).

delete from hidden_games where game_id = 'who-are-ya';
