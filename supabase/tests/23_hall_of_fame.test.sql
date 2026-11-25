-- 명예의 전당 (마을회관 설계 §4): hall_of_fame(p_avatar_game) → { records, free, duel }.
-- 테스트 게임: 월드 기록 hw-a(공개)·hw-hid(숨김), 자유 플레이 hf-a, 대전 hd-a. 아바타 원천 게임 hw-a.
begin;
select plan(22);

\set u1 '00000000-0000-0000-0000-0000000000f1'
\set u2 '00000000-0000-0000-0000-0000000000f2'
\set u3 '00000000-0000-0000-0000-0000000000f3'
\set u4 '00000000-0000-0000-0000-0000000000f4'
\set up '00000000-0000-0000-0000-0000000000f5'
\set ad '00000000-0000-0000-0000-0000000000f6'
\set U1 '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
\set AD '{"sub":"00000000-0000-0000-0000-0000000000f6","role":"authenticated"}'

insert into auth.users (id, email) values
  (:'u1', 'hf1@example.com'), (:'u2', 'hf2@example.com'), (:'u3', 'hf3@example.com'), (:'u4', 'hf4@example.com'),
  (:'up', 'hfp@example.com'), (:'ad', 'hfad@example.com');
update public.profiles set status = 'approved', handle = 'hfone' where id = :'u1';
update public.profiles set status = 'approved', handle = 'hftwo' where id = :'u2';
update public.profiles set status = 'approved', handle = 'hfthree' where id = :'u3';
update public.profiles set status = 'approved', handle = 'hffour' where id = :'u4';
update public.profiles set handle = 'hfpend' where id = :'up';
update public.profiles set status = 'approved', handle = 'hfboss', is_admin = true where id = :'ad';
insert into public.hidden_games (game_id) values ('hw-hid');
insert into public.game_modes (game_id, daily, contest, free) values ('hf-a', false, false, true);

-- ---------------------------------------------------------------- 함수·권한
select has_function('public', 'hall_of_fame', array['text'], 'has hall_of_fame');
select ok(not has_function_privilege('anon', 'public.hall_of_fame(text)', 'execute'), 'anon 실행 불가');
select ok(has_function_privilege('authenticated', 'public.hall_of_fame(text)', 'execute'), 'authenticated 실행 가능');

-- ---------------------------------------------------------------- 데이터 없음
set local role authenticated;
set local request.jwt.claims = :'U1';
select is(public.hall_of_fame('hw-a'), '{"records": [], "free": [], "duel": []}'::jsonb, '데이터 없으면 세 배열 모두 []');
reset role;

-- ---------------------------------------------------------------- 데이터
insert into public.game_records (user_id, game_id, key, value, detail) values
  (:'u1', 'hw-a', 'biggest', 40, '참돔'), (:'u2', 'hw-a', 'biggest', 90, '다랑어'),
  (:'u3', 'hw-a', 'biggest', 60, '농어'), (:'u4', 'hw-a', 'biggest', 50, '광어'),
  (:'up', 'hw-a', 'biggest', 999, '대기'),
  (:'u1', 'hw-a', 'avatar', 0, 'AV1'), (:'u2', 'hw-a', 'avatar', 0, 'AV2'),
  (:'u1', 'hw-a', 'free_bonus', 100, null), (:'u1', 'hw-a', 'areas', 0, 'village'),
  (:'u1', 'hw-hid', 'total_earned', 5, null);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'u1', 'hf-a', 1, true, 3.5, 1), (gen_random_uuid(), :'u1', 'hf-a', 1, true, 4, 1),
  (gen_random_uuid(), :'u2', 'hf-a', 1, true, 9.25, 1), (gen_random_uuid(), :'u2', 'hf-a', 1, false, 1, 1),
  (gen_random_uuid(), :'u3', 'hf-a', 1, true, 2, 1),
  (gen_random_uuid(), :'u4', 'hf-a', 1, false, 8, 1),
  (gen_random_uuid(), :'up', 'hf-a', 1, true, 10, 1);
insert into public.duel_ratings (user_id, game_id, rating, rated_games) values
  (:'u1', 'hd-a', 1100, 6), (:'u2', 'hd-a', 1200, 2), (:'u3', 'hd-a', 1100, 9), (:'u4', 'hd-a', 1300, 0);

set local role authenticated;
set local request.jwt.claims = :'U1';
create temp table h as select public.hall_of_fame('hw-a') as j;
reset role;

select is((select jsonb_array_length(j -> 'records') from h), 3, 'records: 공개 키 biggest 상위 3만(avatar·free_bonus·areas 키 빼고, 숨김 게임 빼고)');
select is((select array_agg(x ->> 'handle' order by ord) from h, jsonb_array_elements(j -> 'records') with ordinality t(x, ord)),
  array['hftwo', 'hfthree', 'hffour'], 'records: value 내림차순, 대기 사용자 제외');
select is((select j -> 'records' -> 0 ->> 'detail' from h), '다랑어', 'records: detail');
select is((select j -> 'records' -> 0 ->> 'avatar' from h), 'AV2', 'records: avatar = 아바타 게임 기록 detail');
select is((select j -> 'records' -> 1 -> 'avatar' from h), 'null'::jsonb, 'records: 아바타 없으면 null');
select is((select (j -> 'records' -> 0 ->> 'value')::numeric from h), 90::numeric, 'records: value');

select is((select count(*)::int from h, jsonb_array_elements(j -> 'free') x where x ->> 'by' = 'wins'), 3, 'free wins: 3개');
select is((select array_agg(x ->> 'handle' order by ord) from h, jsonb_array_elements(j -> 'free') with ordinality t(x, ord) where x ->> 'by' = 'wins'),
  array['hfone', 'hfthree', 'hftwo'], 'free wins: wins desc, 정답률 desc');
select is((select array_agg(x ->> 'handle' order by ord) from h, jsonb_array_elements(j -> 'free') with ordinality t(x, ord) where x ->> 'by' = 'best'),
  array['hftwo', 'hffour', 'hfone'], 'free best: 최고 점수 desc, 대기 제외');
select is((select (x ->> 'best_score')::numeric from h, jsonb_array_elements(j -> 'free') x where x ->> 'by' = 'best' and x ->> 'handle' = 'hftwo'), 9.25::numeric, 'free: best_score');
select is((select (x ->> 'wins')::int from h, jsonb_array_elements(j -> 'free') x where x ->> 'by' = 'wins' and x ->> 'handle' = 'hfone'), 2, 'free: wins');
select is((select (x ->> 'plays')::int from h, jsonb_array_elements(j -> 'free') x where x ->> 'by' = 'wins' and x ->> 'handle' = 'hfone'), 2, 'free: plays');
select is((select x ->> 'avatar' from h, jsonb_array_elements(j -> 'free') x where x ->> 'by' = 'wins' and x ->> 'handle' = 'hfone'), 'AV1', 'free: avatar');
select is((select x ->> 'game_id' from h, jsonb_array_elements(j -> 'free') x limit 1), 'hf-a', 'free: game_id');

select is((select array_agg(x ->> 'handle' order by ord) from h, jsonb_array_elements(j -> 'duel') with ordinality t(x, ord)),
  array['hftwo', 'hfthree', 'hfone'], 'duel: rated_games > 0, rating desc, rated_games desc');
select is((select (j -> 'duel' -> 0 ->> 'rating')::int from h), 1200, 'duel: rating');

-- ---------------------------------------------------------------- 관리자는 숨김 게임도 본다
set local role authenticated;
set local request.jwt.claims = :'AD';
select is((select count(*)::int from jsonb_array_elements(public.hall_of_fame('hw-a') -> 'records') x where x ->> 'game_id' = 'hw-hid'), 1, '관리자: 숨김 게임 기록 포함');
reset role;

-- ---------------------------------------------------------------- 승인 안 된 사람은 못 부른다
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select throws_ok($$select public.hall_of_fame('hw-a')$$, null, null, '대기 사용자: 거부');
reset role;

select * from finish();
rollback;
