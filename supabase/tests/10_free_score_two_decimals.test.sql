-- 자유 플레이 점수 소수 둘째 자리 (20261102052719_free_score_two_decimals)
begin;
select plan(7);

insert into public.game_modes (game_id, daily, contest, free) values ('test-guess', true, true, true);
insert into public.hidden_games (game_id) values ('test-guess');

\set U1  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000fd","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@example.com'),
  ('00000000-0000-0000-0000-0000000000fd', 'fadm@example.com');
update public.profiles set status = 'approved', handle = 'fox1' where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set status = 'approved', handle = 'fboss', is_admin = true where id = '00000000-0000-0000-0000-0000000000fd';

select col_type_is('public', 'free_plays', 'score', 'numeric(4,2)', 'free_plays.score is numeric(4,2)');

-- 본인 insert(열 단위 권한·RLS)로 두 자리 점수를 저장한다
set local role authenticated;
set local request.jwt.claims = :'U1';
insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count) values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'test-guess', '{}', 3, true, 8.37, 0),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'test-guess', '{}', 3, true, 7.16, 0);
reset role;

select is((select score from public.free_plays where client_id = '11111111-0000-0000-0000-000000000001'), 8.37,
  'two-decimal score stored exactly');
select throws_ok(
  $$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
    values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1', 'test-guess', 3, true, 10.01, 0)$$,
  '23514', null, 'score above 10 still rejected');

set local role authenticated;
set local request.jwt.claims = :'ADM';
select is((select best_score from public.lb_free('test-guess') where handle = 'fox1'), 8.37, 'lb_free best_score keeps two decimals');
select is((select avg_score from public.lb_free('test-guess') where handle = 'fox1'), 7.77, 'lb_free avg_score rounded to two decimals');
reset role;

select ok(not has_function_privilege('authenticated', 'public._free_stats(text, boolean)', 'execute'),
  '_free_stats still closed to authenticated');
select ok(has_function_privilege('authenticated', 'public.lb_free(text)', 'execute'), 'lb_free still open to authenticated');

select * from finish();
rollback;
