-- 대회 개설·수정·취소·참가, 문제 은행 함수 (Task 6)
-- 한 트랜잭션 안에서 now()는 고정이므로 시작 전/진행 중/종료는 starts_at·ends_at을 now() 기준으로 잡아 흉내낸다.
begin;
select plan(119);

\set PU  '{"sub":"00000000-0000-0000-0000-0000000000a0","role":"authenticated"}'
\set A1  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'
\set A2  '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}'
\set OK1 '[{"game_id":"open-game","options":{"range":"100"},"count":1}]'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'pu@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'a1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'adm@example.com');
update public.profiles set status = 'approved', handle = 'aone' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'approved', handle = 'atwo' where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'approved', handle = 'boss', is_admin = true where id = '00000000-0000-0000-0000-0000000000ad';

-- 테스트 전용 게임 (트랜잭션 끝에 롤백): open-game 대회 가능·숨김 아님, free-only 대회 불가
insert into public.game_modes (game_id, daily, contest, free) values
  ('open-game', false, true, true),
  ('free-only', false, false, true);

-- 이미 만들어진 대회 (a1 개설)
--   e1 진행 중 공개   e2 종료된 공개   e3 취소된 미래 공개   e4 숨김 게임만 든 미래 공개(관리자 개설)
insert into public.contests (id, kind, title, created_by, visibility, invite_code, starts_at, ends_at, cancelled_at) values
  ('e0000000-0000-0000-0000-000000000001', 'friendly', 'live',  '00000000-0000-0000-0000-0000000000a1', 'public', null,
     now() - interval '10 minutes', now() + interval '1 hour', null),
  ('e0000000-0000-0000-0000-000000000002', 'friendly', 'ended', '00000000-0000-0000-0000-0000000000a1', 'public', null,
     now() - interval '2 hours', now() - interval '1 hour', null),
  ('e0000000-0000-0000-0000-000000000003', 'friendly', 'gone',  '00000000-0000-0000-0000-0000000000a1', 'public', null,
     now() + interval '1 hour', now() + interval '2 hours', now()),
  ('e0000000-0000-0000-0000-000000000004', 'official', 'hidden', '00000000-0000-0000-0000-0000000000ad', 'public', null,
     now() + interval '1 hour', now() + interval '2 hours', null),
  -- e6 개설자가 지워진(created_by null) 미래 초대 대회
  ('e0000000-0000-0000-0000-000000000006', 'official', 'orphan', null, 'invite', 'orphan0001',
     now() + interval '1 hour', now() + interval '2 hours', null);
insert into public.contest_items (contest_id, position, game_id, options) values
  ('e0000000-0000-0000-0000-000000000006', 1, 'open-game', '{}'),
  ('e0000000-0000-0000-0000-000000000001', 1, 'open-game', '{}'),
  ('e0000000-0000-0000-0000-000000000002', 1, 'open-game', '{}'),
  ('e0000000-0000-0000-0000-000000000003', 1, 'open-game', '{}'),
  ('e0000000-0000-0000-0000-000000000004', 1, 'number-guess', '{}');

-- 문제 은행: open-game에 이미 k1이 있고, 하나(used)는 출제됨
insert into public.puzzle_bank (game_id, puzzle, puzzle_key, used_item_id)
  select 'open-game', '{"a":1}'::jsonb, 'k1', null::uuid
  union all
  select 'open-game', '{"a":0}'::jsonb, 'used', (select id from public.contest_items where contest_id = 'e0000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------- schema
select has_table('public', 'game_modes', 'game_modes table exists');
select results_eq($$select daily, contest, free from public.game_modes where game_id = 'number-guess'$$,
  $$values (true, true, true)$$, 'game_modes is seeded with number-guess (daily, contest, free)');

-- ---------------------------------------------------------------- pending
set local role authenticated;
set local request.jwt.claims = :'PU';

select throws_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'forbidden', 'create_validations: pending user cannot create');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'forbidden', 'join: pending user cannot join');
select throws_ok($$select public.contest_games_allowed('[]')$$, '42501', null,
  'contest_games_allowed is internal (no execute for authenticated)');
select throws_ok($$select count(*) from public.game_modes$$, '42501', null,
  'game_modes is not readable directly by authenticated');

-- ---------------------------------------------------------------- a1: create validations
set local request.jwt.claims = :'A1';

-- 제목
select throws_ok(format($$select * from public.create_contest('', now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'title_invalid', 'create_validations: empty title');
select throws_ok(format($$select * from public.create_contest('   ', now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'title_invalid', 'create_validations: blank title (trimmed to 0)');
select throws_ok(format($$select * from public.create_contest(null, now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'title_invalid', 'create_validations: null title');
select throws_ok(format($$select * from public.create_contest(repeat('가', 41), now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'title_invalid', 'create_validations: 41-char title');
select lives_ok(format($$select * from public.create_contest(repeat('가', 40), now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'create_validations: 40-char title ok');
select lives_ok(format($$select * from public.create_contest('  가 ', now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'create_validations: 1-char title after trim ok');

-- 시작 시각
select throws_ok(format($$select * from public.create_contest('t', now() + interval '4 minutes', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'start_too_soon', 'create_validations: start now+4min');
select throws_ok(format($$select * from public.create_contest('t', now() - interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'start_too_soon', 'create_validations: start in the past');
select throws_ok(format($$select * from public.create_contest('t', null, 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'start_too_soon', 'create_validations: null start');
select throws_ok(format($$select * from public.create_contest('t', now() + interval '31 days', 30, 'public', %L, false)$$, :'OK1'),
  'P0001', 'start_too_far', 'create_validations: start now+31d');
select lives_ok(format($$select * from public.create_contest('t', now() + interval '5 minutes', 30, 'public', %L, false)$$, :'OK1'),
  'create_validations: start exactly now+5min ok');
select lives_ok(format($$select * from public.create_contest('t', now() + interval '30 days', 30, 'public', %L, false)$$, :'OK1'),
  'create_validations: start exactly now+30d ok');

-- 제한 시간
select throws_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 4, 'public', %L, false)$$, :'OK1'),
  'P0001', 'duration_invalid', 'create_validations: duration 4');
select throws_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 181, 'public', %L, false)$$, :'OK1'),
  'P0001', 'duration_invalid', 'create_validations: duration 181');
select throws_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', null, 'public', %L, false)$$, :'OK1'),
  'P0001', 'duration_invalid', 'create_validations: null duration');
select lives_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 5, 'public', %L, false)$$, :'OK1'),
  'create_validations: duration 5 ok');
select lives_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 180, 'public', %L, false)$$, :'OK1'),
  'create_validations: duration 180 ok');

-- 문제 목록
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public', '[]', false)$$,
  'P0001', 'items_invalid', 'create_validations: 0 items');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":{},"count":11}]', false)$$,
  'P0001', 'items_invalid', 'create_validations: 11 items (one entry)');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":{},"count":6},{"game_id":"open-game","options":{"range":"1000"},"count":5}]', false)$$,
  'P0001', 'items_invalid', 'create_validations: 11 items (6+5)');
select lives_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":{},"count":6},{"game_id":"open-game","options":{"range":"1000"},"count":4}]', false)$$,
  'create_validations: 10 items ok');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":{},"count":0}]', false)$$,
  'P0001', 'items_invalid', 'create_validations: count 0');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":{},"count":1.5}]', false)$$,
  'P0001', 'items_invalid', 'create_validations: fractional count');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":[],"count":1}]', false)$$,
  'P0001', 'items_invalid', 'create_validations: options not an object');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"options":{},"count":1}]', false)$$,
  'P0001', 'items_invalid', 'create_validations: missing game_id');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '{"game_id":"open-game","options":{},"count":1}', false)$$,
  'P0001', 'items_invalid', 'create_validations: items not an array');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public', null, false)$$,
  'P0001', 'items_invalid', 'create_validations: null items');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"free-only","options":{},"count":1}]', false)$$,
  'P0001', 'game_not_allowed', 'create_validations: game without contest mode');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"open-game","options":{},"count":1},{"game_id":"no-such-game","options":{},"count":1}]', false)$$,
  'P0001', 'game_not_allowed', 'create_validations: unknown game');
select throws_ok($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"number-guess","options":{},"count":1}]', false)$$,
  'P0001', 'game_not_allowed', 'create_validations: non-admin cannot use a hidden game');

-- official_by_non_admin_forbidden
select throws_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public', %L, true)$$, :'OK1'),
  'P0001', 'official_forbidden', 'official_by_non_admin_forbidden');

-- ---------------------------------------------------------------- a1: friendly_by_approved_ok
select id as c_pub, coalesce(invite_code, '<null>') as c_pub_code from public.create_contest(
  '  친선전  ', date_trunc('minute', now()) + interval '2 hours', 45, 'public',
  '[{"game_id":"open-game","options":{"range":"100"},"count":2},{"game_id":"open-game","options":{"range":"1000"},"count":1}]',
  false) \gset
select is(:'c_pub_code'::text, '<null>', 'friendly_by_approved_ok: public contest returns null invite_code');
select results_eq(
  format($$select kind::text, title, created_by, visibility::text, ends_at - starts_at, cancelled_at is null
             from public.contests where id = %L$$, :'c_pub'),
  $$values ('friendly', '친선전', '00000000-0000-0000-0000-0000000000a1'::uuid, 'public', interval '45 minutes', true)$$,
  'friendly_by_approved_ok: row has kind friendly, trimmed title, creator, public, duration');
select is((select starts_at from public.contests where id = :'c_pub'), date_trunc('minute', now()) + interval '2 hours',
  'friendly_by_approved_ok: starts_at stored as given');
select is((select count(*)::int from public.contest_entries where contest_id = :'c_pub' and user_id = auth.uid()), 1,
  'friendly_by_approved_ok: creator auto-joined');
select is(public.contest_invite_code(:'c_pub'), null::text, 'friendly_by_approved_ok: no invite code stored');

-- invite_code_is_10_chars_and_only_for_invite
select id as c_inv, invite_code as c_inv_code from public.create_contest(
  '초대전', now() + interval '1 hour', 30, 'invite', :'OK1', false) \gset
select matches(:'c_inv_code'::text, '^[a-z0-9]{10}$', 'invite_code_is_10_chars_and_only_for_invite: code is 10 of [a-z0-9]');
select is(public.contest_invite_code(:'c_inv'), :'c_inv_code'::text,
  'invite_code_is_10_chars_and_only_for_invite: returned code is the stored one');
select isnt((select invite_code from public.create_contest('초대전2', now() + interval '1 hour', 30, 'invite', :'OK1', false)),
  :'c_inv_code', 'invite_code_is_10_chars_and_only_for_invite: codes differ between contests');

reset role;
select results_eq(format($$select position, game_id, options from public.contest_items where contest_id = %L order by position$$, :'c_pub'),
  $$values (1, 'open-game', '{"range":"100"}'::jsonb), (2, 'open-game', '{"range":"100"}'::jsonb), (3, 'open-game', '{"range":"1000"}'::jsonb)$$,
  'friendly_by_approved_ok: items expanded by count into positions 1..n');
select is((select count(*)::int from public.contest_items where contest_id = :'c_pub' and puzzle is not null), 0,
  'friendly_by_approved_ok: no puzzle generated before start');
select is((select count(*)::int from public.contests where kind = 'daily'), 0, 'create_contest never makes daily contests');
set local role authenticated;

-- ---------------------------------------------------------------- admin: official
set local request.jwt.claims = :'ADM';
select id as c_off from public.create_contest('공식전', now() + interval '1 hour', 60, 'public',
  '[{"game_id":"number-guess","options":{"range":"100"},"count":1}]', true) \gset
select is((select kind::text from public.contests where id = :'c_off'), 'official',
  'official_by_admin_ok: kind official, admin may use a hidden game');
select id as c_adm_f from public.create_contest('관리자 친선', now() + interval '1 hour', 60, 'public', :'OK1', false) \gset
select is((select kind::text from public.contests where id = :'c_adm_f'), 'friendly', 'admin with official=false makes friendly');

-- ---------------------------------------------------------------- update / cancel
-- update_and_cancel_only_before_start_by_creator
set local request.jwt.claims = :'A2';
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '1 hour', 30, 'public', %L)$$, :'c_pub', :'OK1'),
  'P0001', 'forbidden', 'update_and_cancel_only_before_start_by_creator: other user cannot update');
select throws_ok(format($$select public.cancel_contest(%L)$$, :'c_pub'),
  'P0001', 'forbidden', 'update_and_cancel_only_before_start_by_creator: other user cannot cancel');
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '1 hour', 30, 'public', %L)$$,
  'e0000000-0000-0000-0000-0000000000ff', :'OK1'),
  'P0001', 'forbidden', 'update: unknown contest is forbidden');

set local request.jwt.claims = :'A1';
select lives_ok(format($$select public.update_contest(%L, ' 바뀐 제목 ', now() + interval '3 hours', 90, 'public',
  '[{"game_id":"open-game","options":{"range":"1000"},"count":4}]')$$, :'c_pub'),
  'update_and_cancel_only_before_start_by_creator: creator updates before start');
select results_eq(format($$select title, ends_at - starts_at, starts_at from public.contests where id = %L$$, :'c_pub'),
  $$values ('바뀐 제목', interval '90 minutes', now() + interval '3 hours')$$,
  'update: title trimmed, start and duration changed');
select is((select count(*)::int from public.contest_entries where contest_id = :'c_pub'), 1, 'update: entries untouched');

select throws_ok(format($$select public.update_contest(%L, repeat('a', 41), now() + interval '1 hour', 30, 'public', %L)$$, :'c_pub', :'OK1'),
  'P0001', 'title_invalid', 'update: title validation');
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '4 minutes', 30, 'public', %L)$$, :'c_pub', :'OK1'),
  'P0001', 'start_too_soon', 'update: start validation');
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '1 hour', 181, 'public', %L)$$, :'c_pub', :'OK1'),
  'P0001', 'duration_invalid', 'update: duration validation');
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '1 hour', 30, 'public', '[]')$$, :'c_pub'),
  'P0001', 'items_invalid', 'update: items validation');
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '1 hour', 30, 'public',
  '[{"game_id":"number-guess","options":{},"count":1}]')$$, :'c_pub'),
  'P0001', 'game_not_allowed', 'update: non-admin cannot switch to a hidden game');

-- public → invite → public
select lives_ok(format($$select public.update_contest(%L, '바뀐 제목', now() + interval '3 hours', 90, 'invite',
  '[{"game_id":"open-game","options":{"range":"1000"},"count":4}]')$$, :'c_pub'),
  'update: public -> invite');
select matches(public.contest_invite_code(:'c_pub'), '^[a-z0-9]{10}$', 'update: public -> invite generates a 10-char code');
select public.contest_invite_code(:'c_pub') as c_pub_code2 \gset
select lives_ok(format($$select public.update_contest(%L, '다시', now() + interval '3 hours', 90, 'invite', %L)$$, :'c_pub', :'OK1'),
  'update: invite -> invite');
select is(public.contest_invite_code(:'c_pub'), :'c_pub_code2'::text, 'update: invite -> invite keeps the code');
select lives_ok(format($$select public.update_contest(%L, '다시', now() + interval '3 hours', 90, null, %L)$$, :'c_pub', :'OK1'),
  'update_null_visibility_keeps_current: invite with null visibility');
select is((select visibility::text from public.contests where id = :'c_pub'), 'invite',
  'update_null_visibility_keeps_current: stays invite');
select is(public.contest_invite_code(:'c_pub'), :'c_pub_code2'::text, 'update_null_visibility_keeps_current: code kept');
select lives_ok(format($$select public.update_contest(%L, '다시', now() + interval '3 hours', 90, 'public', %L)$$, :'c_pub', :'OK1'),
  'update: invite -> public');
select is(public.contest_invite_code(:'c_pub'), null::text, 'update: invite -> public clears the code');

reset role;
select results_eq(format($$select position, options from public.contest_items where contest_id = %L order by position$$, :'c_pub'),
  $$values (1, '{"range":"100"}'::jsonb)$$, 'update: items replaced');
set local role authenticated;

-- 시작 후·취소 후
select throws_ok(format($$select public.update_contest('e0000000-0000-0000-0000-000000000001', 'x', now() + interval '1 hour', 30, 'public', %L)$$, :'OK1'),
  'P0001', 'not_editable', 'update_and_cancel_only_before_start_by_creator: creator cannot update after start');
select throws_ok($$select public.cancel_contest('e0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'not_editable', 'update_and_cancel_only_before_start_by_creator: creator cannot cancel after start');
select throws_ok(format($$select public.update_contest('e0000000-0000-0000-0000-000000000003', 'x', now() + interval '1 hour', 30, 'public', %L)$$, :'OK1'),
  'P0001', 'not_editable', 'update: cancelled contest is not editable');
select throws_ok($$select public.cancel_contest('e0000000-0000-0000-0000-000000000003')$$,
  'P0001', 'not_editable', 'cancel: already cancelled');

select lives_ok(format($$select public.cancel_contest(%L)$$, :'c_inv'),
  'update_and_cancel_only_before_start_by_creator: creator cancels before start');
select isnt((select cancelled_at from public.contests where id = :'c_inv'), null, 'cancel: cancelled_at set');
select throws_ok(format($$select public.update_contest(%L, 'x', now() + interval '1 hour', 30, 'public', %L)$$, :'c_inv', :'OK1'),
  'P0001', 'not_editable', 'update: just-cancelled contest not editable');

-- admin_can_cancel_live
set local request.jwt.claims = :'ADM';
select lives_ok(format($$select public.update_contest(%L, '관리자가 고침', now() + interval '2 hours', 30, 'public', %L)$$, :'c_pub', :'OK1'),
  'admin can update another user''s contest before start');
select throws_ok(format($$select public.update_contest('e0000000-0000-0000-0000-000000000001', 'x', now() + interval '1 hour', 30, 'public', %L)$$, :'OK1'),
  'P0001', 'not_editable', 'admin cannot update after start either');
select throws_ok($$select public.cancel_contest('e0000000-0000-0000-0000-000000000002')$$,
  'P0001', 'not_editable', 'admin_can_cancel_live: admin cannot cancel an ended contest');
select lives_ok($$select public.cancel_contest('e0000000-0000-0000-0000-000000000001')$$,
  'admin_can_cancel_live: admin cancels a live contest');
select isnt((select cancelled_at from public.contests where id = 'e0000000-0000-0000-0000-000000000001'), null,
  'admin_can_cancel_live: cancelled_at set');
select is((select kind::text from public.contests where id = :'c_pub'), 'friendly', 'update keeps kind');

-- cancel_daily_not_editable: 데일리는 관리자도 취소할 수 없다 (진행 중·시작 전 모두)
reset role;
insert into public.contests (id, kind, title, visibility, starts_at, ends_at, daily_key) values
  ('e0000000-0000-0000-0000-0000000000d1', 'daily', 'daily live', 'public',
   now() - interval '1 hour', now() + interval '1 hour', 'number-guess:test-live'),
  ('e0000000-0000-0000-0000-0000000000d2', 'daily', 'daily next', 'public',
   now() + interval '1 hour', now() + interval '25 hours', 'number-guess:test-next');
set local role authenticated;
select throws_ok($$select public.cancel_contest('e0000000-0000-0000-0000-0000000000d1')$$,
  'P0001', 'not_editable', 'cancel_daily_not_editable: admin cannot cancel a live daily');
select throws_ok($$select public.cancel_contest('e0000000-0000-0000-0000-0000000000d2')$$,
  'P0001', 'not_editable', 'cancel_daily_not_editable: admin cannot cancel a future daily');
select is((select count(*)::int from public.contests where kind = 'daily' and cancelled_at is not null), 0,
  'cancel_daily_not_editable: dailies stay uncancelled');

-- ---------------------------------------------------------------- join
set local request.jwt.claims = :'A1';
select id as c_j, invite_code as c_j_code from public.create_contest(
  '참가 테스트', now() + interval '1 hour', 30, 'invite', :'OK1', false) \gset
select id as c_jp from public.create_contest('공개 참가', now() + interval '1 hour', 30, 'public', :'OK1', false) \gset

set local request.jwt.claims = :'A2';
-- join_rejects_wrong_code_closed_cancelled
select throws_ok(format($$select public.join_contest(%L)$$, :'c_j'),
  'P0001', 'invite_required', 'join_rejects_wrong_code_closed_cancelled: missing code');
select throws_ok(format($$select public.join_contest(%L, 'zzzzzzzzzz')$$, :'c_j'),
  'P0001', 'invite_required', 'join_rejects_wrong_code_closed_cancelled: wrong code');
select is((select count(*)::int from public.contest_entries where contest_id = :'c_j' and user_id = auth.uid()), 0,
  'join: wrong code adds no entry');
select lives_ok(format($$select public.join_contest(%L, %L)$$, :'c_j', '  ' || upper(:'c_j_code') || ' '),
  'join: correct code (case-insensitive, trimmed) joins');
select is((select count(*)::int from public.contest_entries where contest_id = :'c_j' and user_id = auth.uid()), 1,
  'join: entry created');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000002')$$,
  'P0001', 'contest_closed', 'join_rejects_wrong_code_closed_cancelled: ended contest');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000003')$$,
  'P0001', 'contest_closed', 'join_rejects_wrong_code_closed_cancelled: cancelled contest');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'contest_closed', 'join_rejects_wrong_code_closed_cancelled: live contest cancelled by admin');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-0000000000ff')$$,
  'P0001', 'forbidden', 'join: unknown contest');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000004')$$,
  'P0001', 'forbidden', 'join: hidden-only contest is admin-only');

-- created_by가 null인 대회: 아무나 개설자로 취급되면 안 된다
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000006')$$,
  'P0001', 'invite_required', 'join: null-creator invite contest still needs the code');
select throws_ok($$select public.cancel_contest('e0000000-0000-0000-0000-000000000006')$$,
  'P0001', 'forbidden', 'cancel: non-admin cannot cancel a null-creator contest');
select throws_ok(format($$select public.update_contest('e0000000-0000-0000-0000-000000000006', 'x', now() + interval '1 hour', 30, 'public', %L)$$, :'OK1'),
  'P0001', 'forbidden', 'update: non-admin cannot update a null-creator contest');

-- join_is_idempotent
select lives_ok(format($$select public.join_contest(%L)$$, :'c_jp'), 'join_is_idempotent: first join');
select lives_ok(format($$select public.join_contest(%L)$$, :'c_jp'), 'join_is_idempotent: second join');
select is((select count(*)::int from public.contest_entries where contest_id = :'c_jp' and user_id = auth.uid()), 1,
  'join_is_idempotent: exactly one entry');
select lives_ok(format($$select public.join_contest(%L, 'ignored')$$, :'c_jp'), 'join: code ignored for public contest');

-- 진행 중 공개 대회에 늦게 참가 (취소되지 않은 것을 새로 만든다)
reset role;
insert into public.contests (id, kind, title, created_by, visibility, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-000000000005', 'friendly', 'live2', '00000000-0000-0000-0000-0000000000a1', 'public',
   now() - interval '10 minutes', now() + interval '1 hour');
insert into public.contest_items (contest_id, position, game_id) values ('e0000000-0000-0000-0000-000000000005', 1, 'open-game');
set local role authenticated;
select lives_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000005')$$, 'join: late join to a live public contest');

set local request.jwt.claims = :'ADM';
select lives_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000004')$$, 'join: admin joins hidden-only contest');

-- ---------------------------------------------------------------- puzzle bank
set local request.jwt.claims = :'A1';
select throws_ok($$select * from public.admin_upload_puzzles('open-game', '[]')$$,
  'P0001', 'forbidden', 'upload: non-admin forbidden');
select throws_ok($$select * from public.admin_bank_status()$$,
  'P0001', 'forbidden', 'bank_status: non-admin forbidden');

set local request.jwt.claims = :'ADM';
-- upload_skips_duplicates: k1은 이미 있음, k2는 요청 안에서 두 번
select results_eq($$select added, skipped from public.admin_upload_puzzles('open-game',
  '[{"puzzle_key":"k1","puzzle":{"a":9}},{"puzzle_key":"k2","puzzle":{"a":2}},{"puzzle_key":"k3","puzzle":{"a":3}},{"puzzle_key":"k2","puzzle":{"a":22}}]')$$,
  $$values (2, 2)$$, 'upload_skips_duplicates: 2 added, 2 skipped');
select results_eq($$select added, skipped from public.admin_upload_puzzles('open-game', '[]')$$,
  $$values (0, 0)$$, 'upload: empty array is a no-op');
select throws_ok($$select * from public.admin_upload_puzzles('open-game', '[{"puzzle_key":"","puzzle":{}}]')$$,
  'P0001', 'items_invalid', 'upload: empty puzzle_key');
select throws_ok($$select * from public.admin_upload_puzzles('open-game', '[{"puzzle_key":"k9","puzzle":[1]}]')$$,
  'P0001', 'items_invalid', 'upload: puzzle not an object');
select throws_ok($$select * from public.admin_upload_puzzles('open-game', '[{"puzzle_key":"k9","puzzle":{}}, 5]')$$,
  'P0001', 'items_invalid', 'upload: element not an object');
select throws_ok($$select * from public.admin_upload_puzzles('open-game', '{"puzzle_key":"k9","puzzle":{}}')$$,
  'P0001', 'items_invalid', 'upload: payload not an array');
select throws_ok($$select * from public.admin_upload_puzzles('no-such-game', '[{"puzzle_key":"k9","puzzle":{}}]')$$,
  'P0001', 'game_not_allowed', 'upload: unknown game');

reset role;
select results_eq($$select puzzle_key, puzzle from public.puzzle_bank where game_id = 'open-game' order by puzzle_key$$,
  $$values ('k1', '{"a":1}'::jsonb), ('k2', '{"a":2}'::jsonb), ('k3', '{"a":3}'::jsonb), ('used', '{"a":0}'::jsonb)$$,
  'upload_skips_duplicates: existing rows unchanged, first of in-request duplicates kept, invalid uploads added nothing');
set local role authenticated;

-- bank_status_counts_unused: open-game = k1,k2,k3 (used 제외), 나머지 0
select results_eq($$select game_id, remaining from public.admin_bank_status() order by game_id$$,
  $$values ('free-only', 0), ('number-guess', 0), ('open-game', 3), ('who-are-ya', 0), ('yacht', 0)$$,
  'bank_status_counts_unused: per game_modes game, unused rows only');

-- ---------------------------------------------------------------- anon
reset role;
set local role anon;
select throws_ok(format($$select * from public.create_contest('t', now() + interval '1 hour', 30, 'public', %L, false)$$, :'OK1'),
  '42501', null, 'anon cannot execute create_contest');
select throws_ok($$select public.join_contest('e0000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'anon cannot execute join_contest');
reset role;

select * from finish();
rollback;
