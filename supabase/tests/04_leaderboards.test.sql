-- 리더보드·통계 함수 (Task 7, 설계 §5.1, §9)
-- 고정 시드: 지난 주(2025-03-09 일 ~ 2025-03-10 월)의 종료된 데일리·대회 + 오늘(now 기준) 진행 중 데일리·대회.
-- 한 트랜잭션 안에서 now()는 고정이다.
begin;
select plan(74);

-- 테스트 전용 숨김 게임 test-guess (운영 숫자 맞히기는 0008에서 제거됨). 트랜잭션 끝에 롤백
insert into public.game_modes (game_id, daily, contest, free) values ('test-guess', true, true, true);
insert into public.hidden_games (game_id) values ('test-guess');

\set PU  '{"sub":"00000000-0000-0000-0000-0000000000b0","role":"authenticated"}'
\set U1  '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'
\set U2  '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}'
\set U3  '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000bd","role":"authenticated"}'

select (now() at time zone 'Asia/Seoul')::date as today \gset

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b0', 'pu@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'u1@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'u2@example.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'u3@example.com'),
  ('00000000-0000-0000-0000-0000000000bd', 'adm@example.com');
update public.profiles set handle = 'pendo' where id = '00000000-0000-0000-0000-0000000000b0';
update public.profiles set status = 'approved', handle = 'alpha'   where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set status = 'approved', handle = 'bravo'   where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set status = 'approved', handle = 'charlie' where id = '00000000-0000-0000-0000-0000000000b3';
update public.profiles set status = 'approved', handle = 'boss', is_admin = true where id = '00000000-0000-0000-0000-0000000000bd';

-- 대회 (open-game = 공개 게임, test-guess = 숨김 게임)
--   01 D0 데일리 일 03-09   02 D1 데일리 월 03-10   03 DH 숨김 게임 데일리 월 03-10
--   04 O1 공식, 월 00:30 KST 종료(UTC로는 일요일) 2문제   05 O0 공식, 일 23:30 KST 종료
--   06 F1 친선 월 종료   07 X1 취소된 공식 월 종료   08 OI 초대 공식 화 종료(charlie만 참가)
--   09 DT 오늘 데일리(진행 중)   10 OL 진행 중 공식   11 L 진행 중 공개 친선 2문제
--   12 LI 진행 중 초대 친선(alpha만 참가)   13 HO 숨김 게임만 든 공식 수 종료
insert into public.contests (id, kind, title, created_by, visibility, invite_code, starts_at, ends_at, cancelled_at, daily_key) values
  ('c0000000-0000-0000-0000-000000000001', 'daily', 'D0', null, 'public', null,
     '2025-03-09 00:00+09', '2025-03-10 00:00+09', null, 'open-game:2025-03-09'),
  ('c0000000-0000-0000-0000-000000000002', 'daily', 'D1', null, 'public', null,
     '2025-03-10 00:00+09', '2025-03-11 00:00+09', null, 'open-game:2025-03-10'),
  ('c0000000-0000-0000-0000-000000000003', 'daily', 'DH', null, 'public', null,
     '2025-03-10 00:00+09', '2025-03-11 00:00+09', null, 'test-guess:2025-03-10'),
  ('c0000000-0000-0000-0000-000000000004', 'official', 'O1', '00000000-0000-0000-0000-0000000000bd', 'public', null,
     '2025-03-09 23:30+09', '2025-03-10 00:30+09', null, null),
  ('c0000000-0000-0000-0000-000000000005', 'official', 'O0', '00000000-0000-0000-0000-0000000000bd', 'public', null,
     '2025-03-09 22:30+09', '2025-03-09 23:30+09', null, null),
  ('c0000000-0000-0000-0000-000000000006', 'friendly', 'F1', '00000000-0000-0000-0000-0000000000b3', 'public', null,
     '2025-03-10 11:00+09', '2025-03-10 12:00+09', null, null),
  ('c0000000-0000-0000-0000-000000000007', 'official', 'X1', '00000000-0000-0000-0000-0000000000bd', 'public', null,
     '2025-03-10 12:00+09', '2025-03-10 13:00+09', '2025-03-10 12:30+09', null),
  ('c0000000-0000-0000-0000-000000000008', 'official', 'OI', '00000000-0000-0000-0000-0000000000bd', 'invite', 'invite0001',
     '2025-03-11 11:00+09', '2025-03-11 12:00+09', null, null),
  ('c0000000-0000-0000-0000-000000000009', 'daily', 'DT', null, 'public', null,
     (:'today'::date)::timestamp at time zone 'Asia/Seoul', (:'today'::date + 1)::timestamp at time zone 'Asia/Seoul',
     null, 'open-game:' || :'today'),
  ('c0000000-0000-0000-0000-000000000010', 'official', 'OL', '00000000-0000-0000-0000-0000000000bd', 'public', null,
     now() - interval '10 minutes', now() + interval '1 hour', null, null),
  ('c0000000-0000-0000-0000-000000000011', 'friendly', 'L', '00000000-0000-0000-0000-0000000000b1', 'public', null,
     now() - interval '10 minutes', now() + interval '1 hour', null, null),
  ('c0000000-0000-0000-0000-000000000012', 'friendly', 'LI', '00000000-0000-0000-0000-0000000000b1', 'invite', 'invite0002',
     now() - interval '10 minutes', now() + interval '1 hour', null, null),
  ('c0000000-0000-0000-0000-000000000013', 'official', 'HO', '00000000-0000-0000-0000-0000000000bd', 'public', null,
     '2025-03-12 11:00+09', '2025-03-12 12:00+09', null, null);

insert into public.contest_items (id, contest_id, position, game_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 1, 'test-guess'),
  ('d0000000-0000-0000-0000-000000000041', 'c0000000-0000-0000-0000-000000000004', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000042', 'c0000000-0000-0000-0000-000000000004', 2, 'open-game'),
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000007', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000008', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000009', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000010', 1, 'open-game'),
  ('d0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-000000000011', 1, 'open-game'),
  ('d0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-000000000011', 2, 'open-game'),
  ('d0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000012', 1, 'open-game'),
  ('d0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000013', 1, 'test-guess');

insert into public.contest_entries (contest_id, user_id) values
  ('c0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000b3'),
  ('c0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000b1');

insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count, last_action_at, finished_at) values
  -- D0 (일)
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 5.0, 2, '2025-03-09 10:00+09', '2025-03-09 10:00+09'),
  -- D1 (월): 모두 8.0. charlie·bravo 4번(charlie가 먼저 끝냄), alpha 5번
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 8.0, 5, '2025-03-10 03:00+09', '2025-03-10 03:00+09'),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', '{"secret":1}', 1, true, 8.0, 4, '2025-03-10 05:00+09', '2025-03-10 05:00+09'),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b3', '{"secret":1}', 1, true, 8.0, 4, '2025-03-10 02:00+09', '2025-03-10 02:00+09'),
  -- DH (숨김 게임)
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 10.0, 1, '2025-03-10 01:00+09', '2025-03-10 01:00+09'),
  -- O1: alpha 7.0 + 미완료 3.0, bravo 9.0
  ('d0000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 7.0, 3, '2025-03-10 00:10+09', '2025-03-10 00:10+09'),
  ('d0000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, false, 3.0, 2, '2025-03-10 00:25+09', null),
  ('d0000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000b2', '{"secret":1}', 1, true, 9.0, 6, '2025-03-10 00:20+09', '2025-03-10 00:20+09'),
  -- O0 (일)
  ('d0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b2', '{"secret":1}', 1, true, 6.0, 3, '2025-03-09 23:10+09', '2025-03-09 23:10+09'),
  -- F1 친선, X1 취소, OI 초대 공식
  ('d0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b3', '{"secret":1}', 1, true, 10.0, 2, '2025-03-10 11:30+09', '2025-03-10 11:30+09'),
  ('d0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b3', '{"secret":1}', 1, true, 10.0, 1, '2025-03-10 12:10+09', '2025-03-10 12:10+09'),
  ('d0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000b3', '{"secret":1}', 1, true, 4.0, 2, '2025-03-11 11:30+09', '2025-03-11 11:30+09'),
  -- DT 오늘 데일리: alpha 끝냄, bravo 진행 중
  ('d0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 6.0, 3, now() - interval '1 minute', now() - interval '1 minute'),
  ('d0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b2', '{"secret":1}', 1, false, 4.0, 2, now() - interval '1 minute', null),
  -- OL 진행 중 공식
  ('d0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 9.0, 1, now() - interval '30 seconds', now() - interval '30 seconds'),
  -- L 진행 중 친선
  ('d0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 7.0, 3, now() - interval '2 minutes', now() - interval '2 minutes'),
  ('d0000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, false, 2.0, 1, now() - interval '3 minutes', null),
  ('d0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '{"secret":1}', 1, false, 5.0, 2, now() - interval '1 minute', null),
  -- LI 진행 중 초대 친선
  ('d0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, false, 1.0, 1, now() - interval '1 minute', null),
  -- HO 숨김 게임만 든 공식
  ('d0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000b1', '{"secret":1}', 1, true, 2.0, 1, '2025-03-12 11:10+09', '2025-03-12 11:10+09');

-- 자유 플레이: alpha open-game W W L W W W (+숨김 게임 W 1판), bravo W W W L W
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count, played_at)
select gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'open-game', 1, s, case when s then 10.0 else 0.0 end, 3,
       '2025-03-01 10:00+09'::timestamptz + n * interval '1 minute'
  from unnest(array[true, true, false, true, true, true]) with ordinality as t(s, n);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count, played_at)
select gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'open-game', 1, s, case when s then 10.0 else 0.0 end, 3,
       '2025-03-01 10:00+09'::timestamptz + n * interval '1 minute'
  from unnest(array[true, true, true, false, true]) with ordinality as t(s, n);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count, played_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'test-guess', 1, true, 10.0, 1, '2025-03-01 12:00+09');

-- ---------------------------------------------------------------- schema / grants
select has_function('public', 'lb_daily',    array['date', 'text'], 'lb_daily exists');
select has_function('public', 'lb_range',    array['date', 'date', 'text'], 'lb_range exists');
select has_function('public', 'lb_contest',  array['uuid'], 'lb_contest exists');
select has_function('public', 'lb_contests', array['date', 'date'], 'lb_contests exists');
select has_function('public', 'lb_free',     array['text'], 'lb_free exists');
select has_function('public', 'user_stats',  array['text'], 'user_stats exists');
select ok(not has_function_privilege('anon', 'public.lb_daily(date, text)', 'execute'), 'anon cannot execute lb_daily');
select ok(not has_function_privilege('authenticated', 'public._lb_attempt_rows(date, date, text, boolean, boolean, boolean)', 'execute'),
  '_lb_attempt_rows is internal');
select ok(not has_function_privilege('authenticated', 'public._lb_contest_rows(uuid, boolean)', 'execute'),
  '_lb_contest_rows is internal');

-- ---------------------------------------------------------------- pending_user_forbidden
set local role authenticated;
set local request.jwt.claims = :'PU';

select throws_ok($$select * from public.lb_daily('2025-03-10')$$, 'P0001', 'forbidden', 'pending_user_forbidden: lb_daily');
select throws_ok($$select * from public.lb_range('2025-03-10', '2025-03-16')$$, 'P0001', 'forbidden', 'pending_user_forbidden: lb_range');
select throws_ok($$select * from public.lb_contest('c0000000-0000-0000-0000-000000000011')$$, 'P0001', 'forbidden', 'pending_user_forbidden: lb_contest');
select throws_ok($$select public.lb_contests('2025-03-09', '2025-03-16')$$, 'P0001', 'forbidden', 'pending_user_forbidden: lb_contests');
select throws_ok($$select * from public.lb_free()$$, 'P0001', 'forbidden', 'pending_user_forbidden: lb_free');
select throws_ok($$select public.user_stats('alpha')$$, 'P0001', 'forbidden', 'pending_user_forbidden: user_stats');

-- ---------------------------------------------------------------- bravo (일반 승인 사용자)
set local request.jwt.claims = :'U2';

-- daily_rank_order_and_tiebreak
select results_eq(
  $$select rank, handle::text, score, action_count, finished_at from public.lb_daily('2025-03-10')$$,
  $$values (1, 'charlie', 8.0, 4, '2025-03-10 02:00+09'::timestamptz),
           (2, 'bravo',   8.0, 4, '2025-03-10 05:00+09'::timestamptz),
           (3, 'alpha',   8.0, 5, '2025-03-10 03:00+09'::timestamptz)$$,
  'daily_rank_order_and_tiebreak: same score → fewer actions → earlier finish');
select results_eq(
  $$select rank, handle::text, score from public.lb_daily('2025-03-10', 'open-game')$$,
  $$values (1, 'charlie', 8.0), (2, 'bravo', 8.0), (3, 'alpha', 8.0)$$,
  'lb_daily with game filter');
select results_eq(
  $$select rank, handle::text, score, action_count from public.lb_daily('2025-03-09')$$,
  $$values (1, 'alpha', 5.0, 2)$$,
  'lb_daily: other day only has that day''s daily (official ending that day not counted)');
select is((select count(*)::int from public.lb_daily('2025-03-10') where user_id = '00000000-0000-0000-0000-0000000000b1'), 1,
  'lb_daily: one row per user');
-- 오늘(진행 중): 끝낸 기록만
select results_eq(
  format($$select rank, handle::text, score, action_count from public.lb_daily(%L)$$, :'today'),
  $$values (1, 'alpha', 6.0, 3)$$,
  'lb_daily(today): live day includes finished attempts only');

-- range_includes_official_excludes_friendly_and_cancelled + week_range_monday_start
select results_eq(
  $$select rank, handle::text, score, action_count from public.lb_range('2025-03-10', '2025-03-16')$$,
  $$values (1, 'alpha', 18.0, 10), (2, 'bravo', 17.0, 10), (3, 'charlie', 12.0, 6)$$,
  'range_includes_official_excludes_friendly_and_cancelled: daily + ended official (incl. invite), not friendly/cancelled');
select is((select score from public.lb_range('2025-03-10', '2025-03-16') where handle = 'charlie'), 12.0,
  'range_includes_official_excludes_friendly_and_cancelled: charlie has D1 8 + OI 4 only (F1 10, X1 10 excluded)');
select is((select score from public.lb_range('2025-03-10', '2025-03-16') where handle = 'alpha'), 18.0,
  'week_range_monday_start: official ending Mon 00:30 KST (Sun UTC) counts in the Mon-start week; Sunday daily does not');
select results_eq(
  $$select rank, handle::text, score from public.lb_range('2025-03-03', '2025-03-09')$$,
  $$values (1, 'bravo', 6.0), (2, 'alpha', 5.0)$$,
  'week_range_monday_start: previous week holds Sunday daily and official ending Sun 23:30 KST');
select results_eq(
  $$select rank, handle::text, score, action_count from public.lb_range('2025-03-09', '2025-03-16')$$,
  $$values (1, 'alpha', 23.0, 12), (2, 'bravo', 23.0, 13), (3, 'charlie', 12.0, 6)$$,
  'lb_range: tie on score broken by total actions');
select results_eq(
  $$select handle::text, score from public.lb_range('2025-03-10', '2025-03-16', 'open-game')$$,
  $$values ('alpha', 18.0), ('bravo', 17.0), ('charlie', 12.0)$$,
  'lb_range with game filter');
select results_eq(
  format($$select handle::text, score from public.lb_range(%L, %L)$$, :'today', :'today'),
  $$values ('alpha', 6.0)$$,
  'lb_range(today): live official not counted, live daily only finished');
select results_eq(
  $$select handle::text, score from public.lb_range('2000-01-01', '2025-03-16')$$,
  $$values ('alpha', 23.0), ('bravo', 23.0), ('charlie', 12.0)$$,
  'lb_range all-time (from 2000-01-01)');

-- hidden_game_excluded_for_non_admin
select is((select count(*)::int from public.lb_daily('2025-03-10', 'test-guess')), 0,
  'hidden_game_excluded_for_non_admin: lb_daily(hidden game) is empty');
select is((select count(*)::int from public.lb_range('2025-03-01', '2025-03-31', 'test-guess')), 0,
  'hidden_game_excluded_for_non_admin: lb_range(hidden game) is empty');
select is((select score from public.lb_range('2025-03-01', '2025-03-31') where handle = 'alpha'), 23.0,
  'hidden_game_excluded_for_non_admin: lb_range sum excludes hidden daily and hidden-only official');
select is((select count(*)::int from public.lb_free('test-guess')), 0,
  'hidden_game_excluded_for_non_admin: lb_free(hidden game) is empty');
select is((select plays from public.lb_free() where handle = 'alpha'), 6,
  'hidden_game_excluded_for_non_admin: lb_free totals exclude hidden plays');

-- contest_live_partial_scores_visible
select results_eq(
  $$select rank, handle::text, score, solved_items, action_count, last_finished_at from public.lb_contest('c0000000-0000-0000-0000-000000000011')$$,
  format($$values (1, 'alpha', 9.0, 1, 4, %L::timestamptz), (2, 'bravo', 5.0, 0, 2, %L::timestamptz)$$,
         now() - interval '2 minutes', now() - interval '1 minute'),
  'contest_live_partial_scores_visible: live contest shows score, solved items, actions');
select unalike(pg_get_function_result('public.lb_contest(uuid)'::regprocedure), '%state%',
  'contest_live_partial_scores_visible: result has no state column');
select results_eq(
  $$select rank, handle::text, score, solved_items from public.lb_contest('c0000000-0000-0000-0000-000000000004')$$,
  $$values (1, 'alpha', 10.0, 1), (2, 'bravo', 9.0, 1)$$,
  'lb_contest: ended contest uses all attempts (unfinished at final score)');
select throws_ok($$select * from public.lb_contest('c0000000-0000-0000-0000-000000000012')$$, 'P0001', 'forbidden',
  'lb_contest: invite contest not visible → forbidden');
select throws_ok($$select * from public.lb_contest('c0000000-0000-0000-0000-000000000013')$$, 'P0001', 'forbidden',
  'hidden_game_excluded_for_non_admin: hidden-only contest → forbidden');
select is((select count(*)::int from public.lb_contest('c0000000-0000-0000-0000-000000000007')), 0,
  'lb_contest: cancelled contest has no ranking');

-- lb_contests
select is(
  (select jsonb_agg(jsonb_build_object('title', e ->> 'title', 'podium', e -> 'podium') order by n)
     from jsonb_array_elements(public.lb_contests('2025-03-09', '2025-03-16') -> 'contests') with ordinality as t(e, n)),
  '[{"title":"O1","podium":[{"handle":"alpha","score":10.0},{"handle":"bravo","score":9.0}]},
    {"title":"O0","podium":[{"handle":"bravo","score":6.0}]}]'::jsonb,
  'lb_contests: ended official only (no friendly/cancelled/invisible invite/hidden-only), newest first, podium');
select is(
  (select jsonb_agg(jsonb_build_object('handle', e ->> 'handle', 'total', e -> 'total') order by n)
     from jsonb_array_elements(public.lb_contests('2025-03-09', '2025-03-16') -> 'totals') with ordinality as t(e, n)),
  '[{"handle":"bravo","total":15.0},{"handle":"alpha","total":10.0},{"handle":"charlie","total":4.0}]'::jsonb,
  'lb_contests: totals per user over ended official contests');
select ok((select bool_and(e ? 'contest_id' and e ? 'ends_at')
             from jsonb_array_elements(public.lb_contests('2025-03-09', '2025-03-16') -> 'contests') e),
  'lb_contests: contests carry contest_id and ends_at');
select ok((select bool_and(e ? 'user_id')
             from jsonb_array_elements(public.lb_contests('2025-03-09', '2025-03-16') -> 'totals') e),
  'lb_contests: totals carry user_id');
select is(public.lb_contests(:'today'::date - 1, :'today'::date + 1),
  '{"contests":[],"totals":[]}'::jsonb,
  'lb_contests: live official not included; empty arrays when none');

-- free_streaks
select results_eq(
  $$select handle::text, plays, wins, win_rate, current_streak, best_streak, avg_score from public.lb_free('open-game')$$,
  $$values ('alpha', 6, 5, 0.833, 3, 3, 8.3), ('bravo', 5, 4, 0.800, 1, 3, 8.0)$$,
  'free_streaks: W W L W W W → current 3, best 3; W W W L W → current 1, best 3');
select results_eq(
  $$select handle::text, plays, wins, current_streak, best_streak from public.lb_free()$$,
  $$values ('alpha', 6, 5, null::int, null::int), ('bravo', 5, 4, null::int, null::int)$$,
  'lb_free(all games): streak columns null');

-- user_stats
select is(public.user_stats('nobody'), null::jsonb, 'user_stats: unknown handle → null');
select is(public.user_stats('pendo'), null::jsonb, 'user_stats: pending user''s handle → null');
select is(public.user_stats('Alpha ') -> 'daily_by_game',
  '[{"game_id":"open-game","days":3,"avg_score":6.3}]'::jsonb,
  'user_stats: daily_by_game (input trimmed/lowercased, hidden excluded, live finished counted)');
select is(
  (select jsonb_agg(jsonb_build_object('title', e ->> 'title', 'kind', e ->> 'kind', 'rank', e -> 'rank', 'score', e -> 'score') order by n)
     from jsonb_array_elements(public.user_stats('alpha') -> 'contests') with ordinality as t(e, n)),
  '[{"title":"O1","kind":"official","rank":1,"score":10.0}]'::jsonb,
  'user_stats: contests = ended, non-cancelled, visible (live and hidden-only excluded)');
select is(public.user_stats('alpha') -> 'free_by_game',
  '[{"game_id":"open-game","plays":6,"wins":5,"win_rate":0.833,"best_streak":3}]'::jsonb,
  'user_stats: free_by_game');
select is(jsonb_array_length(public.user_stats('alpha') -> 'recent'), 13,
  'user_stats: recent mixes counted attempts (finished or ended) and free plays, hidden excluded');
select is(public.user_stats('alpha') -> 'recent' -> 0,
  jsonb_build_object('type', 'contest', 'game_id', 'open-game', 'score', 9.0, 'at', now() - interval '30 seconds'),
  'user_stats: recent newest first with type/game_id/score/at');
select is(
  (select jsonb_agg(distinct e ->> 'type') from jsonb_array_elements(public.user_stats('alpha') -> 'recent') e),
  '["contest","daily","free"]'::jsonb,
  'user_stats: recent types');
select is(
  (select jsonb_agg(jsonb_build_object('title', e ->> 'title', 'kind', e ->> 'kind', 'rank', e -> 'rank') order by n)
     from jsonb_array_elements(public.user_stats('charlie') -> 'contests') with ordinality as t(e, n)),
  '[{"title":"F1","kind":"friendly","rank":1}]'::jsonb,
  'user_stats: friendly contests appear on profile; invite contest hidden from non-participant; cancelled excluded');
select ok(public.user_stats('bravo') ?& array['daily_by_game', 'contests', 'free_by_game', 'recent'], 'user_stats: has all keys');

-- ---------------------------------------------------------------- charlie
set local request.jwt.claims = :'U3';
select is(
  (select jsonb_agg(e ->> 'title' order by n)
     from jsonb_array_elements(public.user_stats('charlie') -> 'contests') with ordinality as t(e, n)),
  '["OI","F1"]'::jsonb,
  'user_stats: participant sees own invite contest');
select is(
  (select jsonb_agg(e ->> 'title' order by n)
     from jsonb_array_elements(public.lb_contests('2025-03-09', '2025-03-16') -> 'contests') with ordinality as t(e, n)),
  '["OI","O1","O0"]'::jsonb,
  'lb_contests: invite official visible to its participant');
select results_eq(
  $$select rank, handle::text, score from public.lb_contest('c0000000-0000-0000-0000-000000000006')$$,
  $$values (1, 'charlie', 10.0)$$,
  'lb_contest: friendly contest page ranking');

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = :'ADM';
select results_eq(
  $$select rank, handle::text, score, action_count from public.lb_daily('2025-03-10')$$,
  $$values (1, 'alpha', 18.0, 6), (2, 'charlie', 8.0, 4), (3, 'bravo', 8.0, 4)$$,
  'hidden_game_excluded_for_non_admin: admin sees hidden game daily summed');
select results_eq(
  $$select handle::text, score from public.lb_daily('2025-03-10', 'test-guess')$$,
  $$values ('alpha', 10.0)$$,
  'admin: lb_daily(hidden game)');
select is((select score from public.lb_range('2025-03-01', '2025-03-31') where handle = 'alpha'), 35.0,
  'admin: lb_range includes hidden daily and hidden-only official');
select is((select plays from public.lb_free() where handle = 'alpha'), 7, 'admin: lb_free includes hidden plays');
select results_eq(
  $$select handle::text, plays, wins, current_streak, best_streak from public.lb_free('test-guess')$$,
  $$values ('alpha', 1, 1, 1, 1)$$,
  'admin: lb_free(hidden game)');
select results_eq(
  $$select rank, handle::text, score from public.lb_contest('c0000000-0000-0000-0000-000000000013')$$,
  $$values (1, 'alpha', 2.0)$$,
  'admin: lb_contest on hidden-only contest');
select is(
  (select jsonb_agg(e ->> 'title' order by n)
     from jsonb_array_elements(public.lb_contests('2025-03-09', '2025-03-16') -> 'contests') with ordinality as t(e, n)),
  '["HO","OI","O1","O0"]'::jsonb,
  'admin: lb_contests shows every ended official incl. invite and hidden-only');
select is(jsonb_array_length(public.user_stats('alpha') -> 'daily_by_game'), 2, 'admin: user_stats daily_by_game includes hidden game');
select is(jsonb_array_length(public.user_stats('alpha') -> 'recent'), 16, 'admin: user_stats recent includes hidden-game records');

-- ---------------------------------------------------------------- tiebreak by last finish across days, recent cap
reset role;
-- bravo가 자유 플레이를 30판 더 → recent는 30개로 자른다
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count, played_at)
select gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'open-game', 1, true, 10.0, 2,
       '2025-02-01 10:00+09'::timestamptz + n * interval '1 minute'
  from generate_series(1, 30) n;
set local role authenticated;
set local request.jwt.claims = :'U1';
select is(jsonb_array_length(public.user_stats('bravo') -> 'recent'), 30, 'user_stats: recent capped at 30');
select ok(
  (select bool_and(a >= b) from (
     select (e ->> 'at')::timestamptz a, lead((e ->> 'at')::timestamptz) over (order by n) b
       from jsonb_array_elements(public.user_stats('bravo') -> 'recent') with ordinality as t(e, n)) s
    where b is not null),
  'user_stats: recent ordered newest first');
select is((select plays from public.lb_free('open-game') where handle = 'bravo'), 35, 'lb_free: counts all plays');
select is((select best_streak from public.lb_free('open-game') where handle = 'bravo'), 33,
  'free_streaks: best run spans played_at order (30 earlier W + W W W)');

-- 반려된 사용자는 순위표에서 빠진다
reset role;
update public.profiles set status = 'rejected' where id = '00000000-0000-0000-0000-0000000000b3';
set local role authenticated;
set local request.jwt.claims = :'U1';
select results_eq(
  $$select rank, handle::text from public.lb_daily('2025-03-10')$$,
  $$values (1, 'bravo'), (2, 'alpha')$$,
  'non-approved users are not ranked');
select is(public.user_stats('charlie'), null::jsonb, 'user_stats: rejected user → null');

select * from finish();
rollback;
