-- 대회·기록 테이블과 RLS (Task 5)
-- 한 트랜잭션 안에서 now()는 고정이므로, 진행 중/종료는 starts_at·ends_at을 now() 기준으로 잡아 흉내낸다.
begin;
select plan(65);

-- ---------------------------------------------------------------- fixture (superuser)
-- pu pending, a1·a2·a3 approved, adm admin
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'pu@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'a1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'a3@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'adm@example.com');
update public.profiles set status = 'approved', handle = 'aone'   where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'approved', handle = 'atwo'   where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'approved', handle = 'athree' where id = '00000000-0000-0000-0000-0000000000a3';
update public.profiles set status = 'approved', handle = 'boss', is_admin = true where id = '00000000-0000-0000-0000-0000000000ad';

-- 대회
--   c1 진행 중 공개   c2 종료된 공개   c3 진행 중 초대(a1 개설)
--   c4 종료된, 숨김 게임만 든 대회   c5 진행 중 공개(테스트 중간에 종료시킨다)
insert into public.contests (id, kind, title, created_by, visibility, invite_code, starts_at, ends_at) values
  ('c0000000-0000-0000-0000-000000000001', 'friendly', 'live',   '00000000-0000-0000-0000-0000000000a1', 'public', null,
     now() - interval '10 minutes', now() + interval '1 hour'),
  ('c0000000-0000-0000-0000-000000000002', 'friendly', 'ended',  '00000000-0000-0000-0000-0000000000a1', 'public', null,
     now() - interval '2 hours', now() - interval '1 hour'),
  ('c0000000-0000-0000-0000-000000000003', 'friendly', 'invite', '00000000-0000-0000-0000-0000000000a1', 'invite', 'ABCDEFGHIJ',
     now() - interval '10 minutes', now() + interval '1 hour'),
  ('c0000000-0000-0000-0000-000000000004', 'official', 'hidden', null, 'public', null,
     now() - interval '2 hours', now() - interval '1 hour'),
  ('c0000000-0000-0000-0000-000000000005', 'friendly', 'flip',   '00000000-0000-0000-0000-0000000000a1', 'public', null,
     now() - interval '10 minutes', now() + interval '1 hour');

insert into public.contest_items (id, contest_id, position, game_id, options, puzzle, puzzle_key, logic_version, generated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'open-game', '{}', '{"answer":42}', 'k42', 1, now()),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1, 'open-game', '{}', '{"answer":7}',  'k7',  1, now()),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 1, 'open-game', '{}', '{"answer":9}',  'k9',  1, now()),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 1, 'number-guess', '{"range":"100"}', '{"answer":5}', '100:5', 1, now()),
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 1, 'open-game', '{}', '{"answer":3}',  'k3',  1, now());

insert into public.contest_entries (contest_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2'),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2'),
  ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2'),
  ('c0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a2');

-- a2는 모든 문제를 끝냈다(끝낸 상태에는 정답이 들어 있을 수 있다). a1은 c1을 진행 중.
insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count, finished_at) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', '{"answer":42}', 1, true, 8.5, 3, now()),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', '{"answer":7}',  1, true, 7.0, 4, now()),
  ('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2', '{"answer":5}',  1, true, 9.0, 2, now()),
  ('d0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a2', '{"answer":3}',  1, true, 6.0, 5, now()),
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '{"secret":42}', 1, false, 2.0, 1, null);

insert into public.puzzle_bank (game_id, puzzle, puzzle_key) values ('open-game', '{"answer":1}', 'p1');

-- a2의 자유 플레이: 숨김 게임 1건, 일반 게임 1건
insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'number-guess', '{}', 1, true, 9.0, 2),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', 'open-game',   '{}', 1, false, 0.0, 8);

-- schema sanity
select has_view('public', 'contest_items_public', 'contest_items_public view exists');
select is((select 'number-guess' in (select game_id from public.hidden_games)), true,
  'hidden_games is seeded with number-guess');

-- ---------------------------------------------------------------- pu (pending)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a0","role":"authenticated"}';

-- pending_cannot_insert_free_play
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, true, 5.0, 3)$$, '42501', null,
  'pending_cannot_insert_free_play: RLS rejects insert from pending user');
select is((select count(*)::int from public.free_plays), 0, 'pending user reads no free_plays');
select is((select count(*)::int from public.contests), 0, 'pending user sees no contests');
select is(public.can_see_contest('c0000000-0000-0000-0000-000000000001'), false, 'can_see_contest false for pending user');

-- ---------------------------------------------------------------- a1 (approved, c3 개설자)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- approved_inserts_own_free_play
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values ('f0000000-0000-0000-0000-0000000000a1', auth.uid(), 'open-game', '{"x":"1"}', 1, true, 10.0, 3)$$,
  'approved_inserts_own_free_play: insert succeeds');
select is((select count(*)::int from public.free_plays where user_id = auth.uid()), 1,
  'approved_inserts_own_free_play: row is readable by owner');

-- free_play_score_bounds
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, true, 10.1, 3)$$, '23514', null,
  'free_play_score_bounds: 10.1 rejected');
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, true, 10.05, 3)$$, '23514', null,
  'free_play_score_bounds: 10.05 (rounds to 10.1) rejected');
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, true, -0.1, 3)$$, '23514', null,
  'free_play_score_bounds: -0.1 rejected');
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, false, 0.0, 8)$$,
  'free_play_score_bounds: 0.0 accepted');
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), auth.uid(), 'Bad Game', '{}', 1, false, 0.0, 8)$$, '23514', null,
  'free_play game_id must match ^[a-z0-9-]+$');

-- free_play_other_user_id_denied
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', 'open-game', '{}', 1, true, 5.0, 3)$$, '42501', null,
  'free_play_other_user_id_denied: insert for another user rejected');

-- free_play_duplicate_client_id_ignored
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values ('f0000000-0000-0000-0000-0000000000a1', auth.uid(), 'open-game', '{}', 1, false, 1.0, 9)
  on conflict (client_id) do nothing$$,
  'free_play_duplicate_client_id_ignored: on conflict do nothing succeeds');
select is((select count(*)::int from public.free_plays where client_id = 'f0000000-0000-0000-0000-0000000000a1'), 1,
  'free_play_duplicate_client_id_ignored: still exactly one row');
select is((select score from public.free_plays where client_id = 'f0000000-0000-0000-0000-0000000000a1'), 10.0::numeric,
  'free_play_duplicate_client_id_ignored: original row unchanged');
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values ('f0000000-0000-0000-0000-0000000000a1', auth.uid(), 'open-game', '{}', 1, false, 1.0, 9)$$, '23505', null,
  'free_plays.client_id is unique');
select throws_ok($$insert into public.free_plays (id, client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  values (999, gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, false, 1.0, 9)$$, null, null,
  'free_plays.id cannot be chosen by the client');
select throws_ok($$insert into public.free_plays (client_id, user_id, game_id, options, logic_version, solved, score, action_count, played_at)
  values (gen_random_uuid(), auth.uid(), 'open-game', '{}', 1, false, 1.0, 9, now() - interval '1 year')$$, '42501', null,
  'free_plays.played_at cannot be backdated by the client');

-- free_play_update_delete_denied
select throws_ok($$update public.free_plays set score = 10 where user_id = auth.uid()$$, '42501', null,
  'free_play_update_delete_denied: update denied');
select throws_ok($$delete from public.free_plays where user_id = auth.uid()$$, '42501', null,
  'free_play_update_delete_denied: delete denied');

-- attempts_direct_insert_denied (+ 다른 직접 쓰기)
select throws_ok($$insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count)
  values ('d0000000-0000-0000-0000-000000000003', auth.uid(), '{}', 1, true, 10, 1)$$, '42501', null,
  'attempts_direct_insert_denied: insert denied');
select throws_ok($$update public.attempts set score = 10 where user_id = auth.uid()$$, '42501', null,
  'attempts_direct_insert_denied: update denied');
select throws_ok($$insert into public.contest_entries (contest_id, user_id) values ('c0000000-0000-0000-0000-000000000003', auth.uid())$$,
  '42501', null, 'contest_entries direct insert denied');
select throws_ok($$insert into public.contests (kind, title, visibility, starts_at, ends_at)
  values ('official', 'x', 'public', now(), now() + interval '1 hour')$$, '42501', null, 'contests direct insert denied');
select throws_ok($$update public.contests set cancelled_at = now()$$, '42501', null, 'contests direct update denied');
select throws_ok($$update public.contest_items set puzzle = null$$, '42501', null, 'contest_items direct update denied');

-- 본인 기록은 언제나 (진행 중인 본인 기록의 원본 state는 뷰에서 가린다)
select is((select count(*)::int from public.attempts where user_id = auth.uid()), 1, 'own attempts always readable');
select throws_ok($$select state from public.attempts$$, '42501', null, 'attempts.state is not directly readable');
select is((select state from public.attempts_public where user_id = auth.uid() and item_id = 'd0000000-0000-0000-0000-000000000001'),
  null, 'own unfinished attempt state is masked before contest end');

-- others_attempts_hidden_until_contest_end
select is((select count(*)::int from public.attempts
            where item_id = 'd0000000-0000-0000-0000-000000000005' and user_id <> auth.uid()), 0,
  'others_attempts_hidden_until_contest_end: live contest → 0 rows');
select is((select count(*)::int from public.attempts_public
            where item_id = 'd0000000-0000-0000-0000-000000000005' and user_id <> auth.uid()), 0,
  'others_attempts_hidden_until_contest_end: live contest → 0 rows via attempts_public');
select is((select count(*)::int from public.attempts
            where item_id = 'd0000000-0000-0000-0000-000000000002' and user_id <> auth.uid()), 1,
  'others attempts in an ended public contest are readable');
select is((select state->>'answer' from public.attempts_public
            where item_id = 'd0000000-0000-0000-0000-000000000002' and user_id <> auth.uid()), '7',
  'others attempt state readable via attempts_public after end');

-- puzzle_hidden_until_end
select throws_ok($$select id from public.contest_items$$, '42501', null, 'contest_items base table is not readable');
select is((select count(*)::int from public.contest_items_public where id = 'd0000000-0000-0000-0000-000000000001'), 1,
  'puzzle_hidden_until_end: live item row is visible');
select ok((select puzzle is null and puzzle_key is null from public.contest_items_public
            where id = 'd0000000-0000-0000-0000-000000000001'),
  'puzzle_hidden_until_end: live contest → puzzle and puzzle_key are null');
select is((select puzzle->>'answer' from public.contest_items_public where id = 'd0000000-0000-0000-0000-000000000002'), '7',
  'puzzle_hidden_until_end: ended contest → puzzle visible');
select is((select puzzle_key from public.contest_items_public where id = 'd0000000-0000-0000-0000-000000000002'), 'k7',
  'puzzle_hidden_until_end: ended contest → puzzle_key visible');

-- invite_code: 개설자만
select throws_ok($$select invite_code from public.contests$$, '42501', null, 'contests.invite_code column not readable');
select is(public.contest_invite_code('c0000000-0000-0000-0000-000000000003'), 'ABCDEFGHIJ', 'creator reads own invite code');

-- puzzle_bank_admin_only (non-admin)
select is((select count(*)::int from public.puzzle_bank), 0, 'puzzle_bank_admin_only: approved non-admin reads 0 rows');
select throws_ok($$insert into public.puzzle_bank (game_id, puzzle, puzzle_key) values ('open-game', '{}', 'zz')$$, '42501', null,
  'puzzle_bank_admin_only: direct insert denied');

-- ---------------------------------------------------------------- a3 (approved, 초대 대회 비참가자)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- invite_contest_invisible_to_non_participant
select is(public.can_see_contest('c0000000-0000-0000-0000-000000000003'), false,
  'invite_contest_invisible_to_non_participant: can_see_contest false');
select is((select count(*)::int from public.contests where id = 'c0000000-0000-0000-0000-000000000003'), 0,
  'invite_contest_invisible_to_non_participant: contest row hidden');
select is((select count(*)::int from public.contest_items_public where contest_id = 'c0000000-0000-0000-0000-000000000003'), 0,
  'invite_contest_invisible_to_non_participant: items hidden');
select is((select count(*)::int from public.contest_entries where contest_id = 'c0000000-0000-0000-0000-000000000003'), 0,
  'invite_contest_invisible_to_non_participant: entries hidden');
select is(public.contest_invite_code('c0000000-0000-0000-0000-000000000003'), null,
  'non-creator gets null invite code');
select is(public.can_see_contest('c0000000-0000-0000-0000-000000000001'), true, 'public contest visible to approved non-participant');

-- hidden_game_rows_admin_only (non-admin)
select is(public.can_see_contest('c0000000-0000-0000-0000-000000000004'), false,
  'hidden_game_rows_admin_only: hidden-only contest invisible to non-admin');
select is((select count(*)::int from public.attempts where item_id = 'd0000000-0000-0000-0000-000000000004'), 0,
  'hidden_game_rows_admin_only: hidden-game attempts invisible to non-admin');
select is((select count(*)::int from public.free_plays where game_id = 'number-guess'), 0,
  'hidden_game_rows_admin_only: hidden-game free_plays invisible to non-admin');
select is((select count(*)::int from public.free_plays where game_id = 'open-game'), 3,
  'approved users read everyone''s non-hidden free_plays');

-- ---------------------------------------------------------------- 대회 c5를 종료시킨다 (superuser)
reset role;
update public.contests set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute'
  where id = 'c0000000-0000-0000-0000-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.attempts
            where item_id = 'd0000000-0000-0000-0000-000000000005' and user_id <> auth.uid()), 1,
  'others_attempts_hidden_until_contest_end: after end → 1 row');
select is((select puzzle->>'answer' from public.contest_items_public where id = 'd0000000-0000-0000-0000-000000000005'), '3',
  'puzzle_hidden_until_end: same contest after end → puzzle visible');

-- ---------------------------------------------------------------- adm (admin)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';

select is(public.can_see_contest('c0000000-0000-0000-0000-000000000004'), true, 'hidden_game_rows_admin_only: admin sees hidden-only contest');
select is((select count(*)::int from public.attempts where item_id = 'd0000000-0000-0000-0000-000000000004'), 1,
  'hidden_game_rows_admin_only: admin reads hidden-game attempts');
select is((select count(*)::int from public.free_plays where game_id = 'number-guess'), 1,
  'hidden_game_rows_admin_only: admin reads hidden-game free_plays');
select is(public.contest_invite_code('c0000000-0000-0000-0000-000000000003'), 'ABCDEFGHIJ', 'admin reads invite code');
select is((select count(*)::int from public.puzzle_bank), 1, 'puzzle_bank_admin_only: admin reads puzzle_bank');
select ok((select puzzle is null from public.contest_items_public where id = 'd0000000-0000-0000-0000-000000000001'),
  'puzzle stays hidden before end even for admin');

-- ---------------------------------------------------------------- anon
reset role;
set local request.jwt.claims = '';
set local role anon;
select throws_ok($$select id from public.contests$$, '42501', null, 'anon cannot read contests');
select throws_ok($$select id from public.contest_items_public$$, '42501', null, 'anon cannot read contest_items_public');
select throws_ok($$select id from public.free_plays$$, '42501', null, 'anon cannot read free_plays');

reset role;
select * from finish();
rollback;
