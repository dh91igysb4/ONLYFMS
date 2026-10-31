-- 숫자 맞히기(number-guess) 완전 제거.
--   * 숫자 맞히기 문제가 하나라도 들어간 대회(데일리·친선·공식)는 통째로 지운다.
--     contest_items·contest_entries·attempts는 on delete cascade로 함께 지워진다.
--   * 아직 문제 행이 없는 숫자 맞히기 데일리(daily_key 'number-guess:YYYY-MM-DD')도 지운다.
--   * 자유 플레이 기록, 문제 은행, 모드·숨김 설정도 지운다.
-- 되돌릴 수 없다.
delete from public.contests c
 where c.daily_key like 'number-guess:%'
    or exists (select 1 from public.contest_items i
                where i.contest_id = c.id and i.game_id = 'number-guess');

delete from public.puzzle_bank where game_id = 'number-guess';
delete from public.free_plays where game_id = 'number-guess';
delete from public.game_modes where game_id = 'number-guess';
delete from public.hidden_games where game_id = 'number-guess';
