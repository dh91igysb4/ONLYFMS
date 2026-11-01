-- 자유 플레이 행동 로그 free_play_logs (설계 toothbrush §5.3)
begin;
select plan(17);

-- 테스트 전용 숨김 게임 test-guess. 트랜잭션 끝에 롤백
insert into public.game_modes (game_id, daily, contest, free) values ('test-guess', true, true, true);
insert into public.hidden_games (game_id) values ('test-guess');

\set PU  '{"sub":"00000000-0000-0000-0000-0000000000c0","role":"authenticated"}'
\set U1  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'
\set U2  '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000cd","role":"authenticated"}'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c0', 'pu@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'u1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'u2@example.com'),
  ('00000000-0000-0000-0000-0000000000cd', 'adm@example.com');
update public.profiles set status = 'approved', handle = 'alpha' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set status = 'approved', handle = 'bravo' where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set status = 'approved', handle = 'boss', is_admin = true where id = '00000000-0000-0000-0000-0000000000cd';

-- 점수 행: f1 = U1 공개 게임, f2 = U2, f3 = PU(미승인), f4 = U1 숨김 게임, f5 = U1 (cascade 확인용)
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'open-game',  1, true, 5, 1),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'open-game',  1, true, 5, 1),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c0', 'open-game',  1, true, 5, 1),
  ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c1', 'test-guess', 1, true, 5, 1),
  ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c1', 'open-game',  1, true, 5, 1);

-- ---------------------------------------------------------------- insert
set local role authenticated;
set local request.jwt.claims = :'U1';

select lives_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
          '0123456789abcdef0123456789abcdef', '[[1,2],[3,4]]')$$,
  'owner can insert a log for own free_plays row');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1',
          '0123456789abcdef0123456789abcdef', '[]')$$,
  '42501', null, 'cannot attach a log to another user''s free_plays row');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2',
          '0123456789abcdef0123456789abcdef', '[]')$$,
  '42501', null, 'cannot insert a log as another user');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000c1',
          '0123456789abcdef0123456789abcdef', '[]')$$,
  '42501', null, 'cannot insert a log for a nonexistent free_plays row');

select lives_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c1',
          '0123456789abcdef0123456789abcdef', '[]')$$,
  'owner can log a hidden-game play (helper bypasses free_plays RLS)');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c1',
          '0123456789abcdef0123456789abcde', '[]')$$,
  '23514', null, 'seed of 31 chars is rejected');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c1',
          '0123456789ABCDEF0123456789abcdef', '[]')$$,
  '23514', null, 'uppercase seed is rejected');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c1',
          '0123456789abcdef0123456789abcdef', '{"a":1}')$$,
  '23514', null, 'actions must be a JSON array');

select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  select 'f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c1',
         '0123456789abcdef0123456789abcdef', jsonb_agg(i) from generate_series(100000, 160000) i$$,
  '23514', null, 'actions over 256KB is rejected');

-- 미승인 사용자
set local request.jwt.claims = :'PU';
select throws_ok($$insert into public.free_play_logs (client_id, user_id, seed, actions)
  values ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c0',
          '0123456789abcdef0123456789abcdef', '[]')$$,
  '42501', null, 'unapproved user cannot insert a log');

-- ---------------------------------------------------------------- select
set local request.jwt.claims = :'U2';
select is((select count(*)::int from public.free_play_logs), 0, 'other user sees no logs');

set local request.jwt.claims = :'ADM';
select cmp_ok((select count(*)::int from public.free_play_logs), '>=', 1, 'admin sees logs');

set local request.jwt.claims = :'U1';
select is((select count(*)::int from public.free_play_logs), 2, 'owner sees own logs');

-- ---------------------------------------------------------------- update / delete / anon
select throws_ok($$update public.free_play_logs set seed = 'ffffffffffffffffffffffffffffffff'$$,
  '42501', null, 'owner cannot update a log');
select throws_ok($$delete from public.free_play_logs$$,
  '42501', null, 'owner cannot delete a log');

set local role anon;
select throws_ok($$select client_id from public.free_play_logs$$,
  '42501', null, 'anon cannot read free_play_logs');

-- ---------------------------------------------------------------- cascade
reset role;
delete from public.free_plays where client_id = 'f0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.free_play_logs where client_id = 'f0000000-0000-0000-0000-000000000001'), 0,
  'deleting the free_plays row deletes its log');

select * from finish();
rollback;
