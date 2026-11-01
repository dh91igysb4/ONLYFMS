-- 자유 플레이 최고 점수: lb_free / _free_stats의 best_score 열 (툴칫솔 설계 §5.1)
begin;
select plan(9);

insert into public.game_modes (game_id, daily, contest, free) values ('test-guess', true, true, true);
insert into public.hidden_games (game_id) values ('test-guess');

\set ADM '{"sub":"00000000-0000-0000-0000-0000000000ed","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@example.com'),
  ('00000000-0000-0000-0000-0000000000ed', 'eadm@example.com');
update public.profiles set status = 'approved', handle = 'echo1' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set status = 'approved', handle = 'echo2' where id = '00000000-0000-0000-0000-0000000000e2';
update public.profiles set status = 'approved', handle = 'eboss', is_admin = true where id = '00000000-0000-0000-0000-0000000000ed';

insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count, played_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'test-guess', 1, true, 3.0, 1, '2025-03-01 10:00+09'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'test-guess', 1, true, 7.5, 1, '2025-03-01 10:01+09'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'test-guess', 1, true, 5.0, 1, '2025-03-01 10:02+09'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e2', 'test-guess', 1, true, 9.0, 1, '2025-03-01 10:03+09');

select has_function('public', 'lb_free', array['text'], 'lb_free exists');
select ok(not has_function_privilege('anon', 'public.lb_free(text)', 'execute'), 'anon cannot execute lb_free');
select ok(has_function_privilege('authenticated', 'public.lb_free(text)', 'execute'), 'authenticated can execute lb_free');
select ok(not has_function_privilege('authenticated', 'public._free_stats(text, boolean)', 'execute'),
  'authenticated cannot execute _free_stats');
select ok(not has_function_privilege('anon', 'public._free_stats(text, boolean)', 'execute'),
  'anon cannot execute _free_stats');

set local role authenticated;
set local request.jwt.claims = :'ADM';


select is((select best_score from public.lb_free('test-guess') where handle = 'echo1'), 7.5, 'lb_free: U1 best_score 7.5');
select is((select best_score from public.lb_free('test-guess') where handle = 'echo2'), 9.0, 'lb_free: U2 best_score 9.0');
select results_eq(
  $$select handle::text, plays, wins, avg_score from public.lb_free('test-guess')$$,
  $$values ('echo1', 3, 3, 5.2), ('echo2', 1, 1, 9.0)$$,
  'lb_free: existing columns and server order unchanged');
select is((select best_score from public.lb_free() where handle = 'echo1'), 7.5, 'lb_free(null): best_score present');
