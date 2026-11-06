-- 자유 플레이 점수 상한이 게임별이다 (20261107..._free_score_max)
begin;
select plan(9);

insert into public.game_modes (game_id, daily, contest, free, score_max) values ('score-test', false, false, true, 1000);
insert into public.game_modes (game_id, daily, contest, free) values ('test-guess', true, true, true);
insert into public.hidden_games (game_id) values ('test-guess'), ('score-test');

\set U1 '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e1@example.com');
update public.profiles set status = 'approved', handle = 'emu1' where id = '00000000-0000-0000-0000-0000000000e1';

select has_column('public', 'game_modes', 'score_max', 'game_modes.score_max exists');
select col_default_is('public', 'game_modes', 'score_max', '10', 'game_modes.score_max defaults to 10');
select col_type_is('public', 'free_plays', 'score', 'numeric(9,2)', 'free_plays.score is numeric(9,2)');

set local role authenticated;
set local request.jwt.claims = :'U1';

select lives_ok(
  $$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
    values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'score-test', 1, false, 583, 0)$$,
  'score-test accepts 583 (max 1000)');
select throws_ok(
  $$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
    values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'score-test', 1, false, 1000.01, 0)$$,
  '23514', null, 'score-test rejects 1000.01');
select throws_ok(
  $$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
    values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'test-guess', 1, true, 10.01, 0)$$,
  '23514', null, 'default game rejects 10.01');
select lives_ok(
  $$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
    values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'test-guess', 1, true, 9.99, 0)$$,
  'default game accepts 9.99');
select throws_ok(
  $$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
    values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'score-test', 1, false, -1, 0)$$,
  '23514', null, 'negative score rejected');

reset role;
select ok(not has_function_privilege('authenticated', 'public._free_plays_score_max()', 'execute'),
  'trigger function closed to authenticated');

select * from finish();
rollback;
