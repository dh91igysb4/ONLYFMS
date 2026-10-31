-- 1대1 대전 테이블·권한·Elo·목록·통계 함수 (duel Task 3, 설계 §4~§7)
-- 한 트랜잭션 안에서 now()는 고정이다. 대국 행은 슈퍼유저(= Edge Function의 소유자 연결)로 직접 넣는다.
-- 게임 id는 등록부와 무관한 테스트용 문자열(g-*)을 쓰고, 숨김 게임 확인에만 yacht를 쓴다.
begin;
select plan(101);

\set PU  '{"sub":"00000000-0000-0000-0000-0000000000c0","role":"authenticated"}'
\set C1  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'
\set C2  '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'
\set C3  '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}'
\set C5  '{"sub":"00000000-0000-0000-0000-0000000000c5","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000cd","role":"authenticated"}'
\set u1 '00000000-0000-0000-0000-0000000000c1'
\set u2 '00000000-0000-0000-0000-0000000000c2'
\set u3 '00000000-0000-0000-0000-0000000000c3'
\set u4 '00000000-0000-0000-0000-0000000000c4'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c0', 'pu@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'c1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'c3@example.com'),
  ('00000000-0000-0000-0000-0000000000c4', 'c4@example.com'),
  ('00000000-0000-0000-0000-0000000000c5', 'c5@example.com'),
  ('00000000-0000-0000-0000-0000000000cd', 'adm@example.com');
update public.profiles set handle = 'pendo' where id = '00000000-0000-0000-0000-0000000000c0';
update public.profiles set status = 'approved', handle = 'duela' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set status = 'approved', handle = 'duelb' where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set status = 'approved', handle = 'duelc' where id = '00000000-0000-0000-0000-0000000000c3';
update public.profiles set status = 'approved', handle = 'dueld' where id = '00000000-0000-0000-0000-0000000000c4';
update public.profiles set status = 'approved', handle = 'duele' where id = '00000000-0000-0000-0000-0000000000c5';
update public.profiles set status = 'approved', handle = 'dboss', is_admin = true where id = '00000000-0000-0000-0000-0000000000cd';

-- 대기·진행 대국
--   01 b의 초대 waiting   02 b의 공개 waiting   03 b vs c 초대 active
--   04 a vs b active(마감 지남, 수 2개)   05 a vs b active(마감 전)
--   06 c의 공개 waiting 11분 전   07 c의 공개 waiting 9분 전   08 c의 yacht 공개 waiting
insert into public.duel_matches
  (id, game_id, logic_version, rated, visibility, invite_code, status, created_by, players,
   turn_seconds, turn_deadline, created_at, started_at) values
  ('f0000000-0000-0000-0000-000000000001', 'g-lobby', 1, true, 'invite', 'duelinv001', 'waiting', :'u2', null, 60, null, now(), null),
  ('f0000000-0000-0000-0000-000000000002', 'g-lobby', 1, true, 'public', 'duelpub002', 'waiting', :'u2', null, 60, null, now(), null),
  ('f0000000-0000-0000-0000-000000000003', 'g-lobby', 1, true, 'invite', 'duelinv003', 'active', :'u2',
     array[:'u2', :'u3']::uuid[], 60, now() + interval '1 minute', now(), now()),
  ('f0000000-0000-0000-0000-000000000004', 'g-lobby', 1, true, 'public', null, 'active', :'u1',
     array[:'u1', :'u2']::uuid[], 60, now() - interval '1 minute', now() - interval '5 minutes', now() - interval '4 minutes'),
  ('f0000000-0000-0000-0000-000000000005', 'g-lobby', 1, false, 'public', null, 'active', :'u1',
     array[:'u2', :'u1']::uuid[], 60, now() + interval '1 minute', now() - interval '5 minutes', now() - interval '4 minutes'),
  ('f0000000-0000-0000-0000-000000000006', 'g-lobby', 1, true, 'public', null, 'waiting', :'u3', null, 60, null,
     now() - interval '11 minutes', null),
  ('f0000000-0000-0000-0000-000000000007', 'g-lobby', 1, true, 'public', null, 'waiting', :'u3', null, 60, null,
     now() - interval '9 minutes', null),
  ('f0000000-0000-0000-0000-000000000008', 'yacht', 1, true, 'public', null, 'waiting', :'u3', null, 60, null, now(), null);
update public.duel_matches set state = '{"secret":1}' where id = 'f0000000-0000-0000-0000-000000000004';

-- 종료 대국 (ended_at으로 순서를 고정한다)
--   11 g-win 랭크 a 승   12 g-draw 랭크 무   13 g-k 랭크 a 승   14 g-fr 친선 a 승   15 g-fr 무효
--   21~24 g-h2h: a 승(a 선공), a 승(a 후공), 무, b 승 (21·23 친선)   25 g-h2h 무효(a vs b)   26 g-h2h a vs c
--   31 a vs b 종료(수 있음)
insert into public.duel_matches
  (id, game_id, logic_version, rated, visibility, status, created_by, players, turn_seconds,
   winner, end_reason, final_scores, moved, created_at, started_at, ended_at) values
  ('f0000000-0000-0000-0000-000000000011', 'g-win', 1, true, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     0, 'normal', '{200,150}', '{true,true}', now() - interval '3 hours', now() - interval '3 hours', now() - interval '170 minutes'),
  ('f0000000-0000-0000-0000-000000000012', 'g-draw', 1, true, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     null, 'normal', '{180,180}', '{true,true}', now() - interval '3 hours', now() - interval '3 hours', now() - interval '169 minutes'),
  ('f0000000-0000-0000-0000-000000000013', 'g-k', 1, true, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     0, 'resign', null, '{true,true}', now() - interval '3 hours', now() - interval '3 hours', now() - interval '168 minutes'),
  ('f0000000-0000-0000-0000-000000000014', 'g-fr', 1, false, 'public', 'finished', :'u1', array[:'u2', :'u1']::uuid[], 60,
     1, 'normal', '{100,120}', '{true,true}', now() - interval '3 hours', now() - interval '3 hours', now() - interval '167 minutes'),
  ('f0000000-0000-0000-0000-000000000015', 'g-fr', 1, true, 'public', 'void', :'u1', array[:'u1', :'u2']::uuid[], 60,
     null, 'void', null, '{true,false}', now() - interval '3 hours', now() - interval '3 hours', now() - interval '166 minutes'),
  ('f0000000-0000-0000-0000-000000000021', 'g-h2h', 1, false, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     0, 'normal', '{10,5}', '{true,true}', now() - interval '2 hours', now() - interval '2 hours', now() - interval '110 minutes'),
  ('f0000000-0000-0000-0000-000000000022', 'g-h2h', 1, true, 'public', 'finished', :'u2', array[:'u2', :'u1']::uuid[], 60,
     1, 'timeout', '{3,8}', '{true,true}', now() - interval '2 hours', now() - interval '2 hours', now() - interval '100 minutes'),
  ('f0000000-0000-0000-0000-000000000023', 'g-h2h', 1, false, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     null, 'normal', '{7,7}', '{true,true}', now() - interval '2 hours', now() - interval '2 hours', now() - interval '90 minutes'),
  ('f0000000-0000-0000-0000-000000000024', 'g-h2h', 1, true, 'public', 'finished', :'u2', array[:'u2', :'u1']::uuid[], 60,
     0, 'normal', '{9,4}', '{true,true}', now() - interval '2 hours', now() - interval '2 hours', now() - interval '80 minutes'),
  ('f0000000-0000-0000-0000-000000000025', 'g-h2h', 1, true, 'public', 'void', :'u2', array[:'u2', :'u1']::uuid[], 60,
     null, 'void', null, '{false,false}', now() - interval '2 hours', now() - interval '2 hours', now() - interval '70 minutes'),
  ('f0000000-0000-0000-0000-000000000026', 'g-h2h', 1, true, 'public', 'finished', :'u1', array[:'u1', :'u3']::uuid[], 60,
     0, 'normal', '{9,4}', '{true,true}', now() - interval '2 hours', now() - interval '2 hours', now() - interval '60 minutes'),
  ('f0000000-0000-0000-0000-000000000041', 'yacht', 1, true, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     0, 'normal', '{250,200}', '{true,true}', now() - interval '1 hour', now() - interval '1 hour', now() - interval '55 minutes'),
  ('f0000000-0000-0000-0000-000000000051', 'g-del', 1, true, 'public', 'finished', :'u4', array[:'u4', :'u3']::uuid[], 60,
     1, 'normal', '{1,2}', '{true,true}', now() - interval '1 hour', now() - interval '1 hour', now() - interval '45 minutes'),
  ('f0000000-0000-0000-0000-000000000031', 'g-moves', 1, true, 'public', 'finished', :'u1', array[:'u1', :'u2']::uuid[], 60,
     0, 'normal', '{1,0}', '{true,true}', now() - interval '1 hour', now() - interval '1 hour', now() - interval '50 minutes');

insert into public.duel_moves (match_id, action_no, seat, action, auto) values
  ('f0000000-0000-0000-0000-000000000004', 0, 0, '{"type":"roll"}', false),
  ('f0000000-0000-0000-0000-000000000004', 1, 0, '{"type":"roll"}', true),
  ('f0000000-0000-0000-0000-000000000031', 0, 0, '{"type":"roll"}', false),
  ('f0000000-0000-0000-0000-000000000031', 1, 1, '{"type":"roll"}', false),
  ('f0000000-0000-0000-0000-000000000031', 2, 0, '{"type":"roll"}', false);

-- 미리 있는 레이팅: g-draw a 1200(10판)·b 1000(0판), g-k a 1000(9판)·b 1000(10판),
-- g-lb a 1100(5판)·b 1200(4판)·c 1050(7판), yacht a 1000(1판)
insert into public.duel_ratings (user_id, game_id, rating, rated_games, wins, draws, losses) values
  (:'u1', 'g-draw', 1200, 10, 5, 0, 5),
  (:'u2', 'g-draw', 1000, 0, 0, 0, 0),
  (:'u1', 'g-k', 1000, 9, 4, 1, 4),
  (:'u2', 'g-k', 1000, 10, 5, 0, 5),
  (:'u1', 'g-lb', 1100, 5, 3, 0, 2),
  (:'u2', 'g-lb', 1200, 4, 4, 0, 0),
  (:'u3', 'g-lb', 1050, 7, 3, 1, 3),
  (:'u1', 'yacht', 1000, 1, 1, 0, 0);
-- 숨김 게임 대국의 레이팅 변화(레이팅 행은 그대로 두려고 직접 넣는다)
insert into public.duel_rating_changes (match_id, user_id, before, after) values
  ('f0000000-0000-0000-0000-000000000041', :'u1', 980, 1000);

-- ---------------------------------------------------------------- schema
select has_table('public', 'duel_matches', 'duel_matches exists');
select has_table('public', 'duel_moves', 'duel_moves exists');
select has_table('public', 'duel_ratings', 'duel_ratings exists');
select has_table('public', 'duel_rating_changes', 'duel_rating_changes exists');
select results_eq($$select enum_range(null::public.duel_status)::text$$, $$values ('{waiting,active,finished,void}')$$,
  'duel_status enum');
select is((select count(*)::int from pg_publication_tables
            where schemaname = 'public'
              and tablename in ('duel_matches', 'duel_moves', 'duel_ratings', 'duel_rating_changes')), 0,
  'no duel table is in any publication (no realtime postgres_changes)');
select throws_ok($$update public.duel_matches set end_reason = 'void' where id = 'f0000000-0000-0000-0000-000000000011'$$,
  '23514', null, 'constraint: finished match cannot have end_reason void');
select results_eq($$select enum_range(null::public.duel_end_reason)::text$$, $$values ('{normal,resign,timeout,void}')$$,
  'duel_end_reason enum');

-- ---------------------------------------------------------------- column / write privileges
set local role authenticated;
set local request.jwt.claims = :'C1';
select throws_ok($$select state from public.duel_matches$$, '42501', null, 'state_not_readable');
select throws_ok($$select * from public.duel_matches$$, '42501', null, 'state_not_readable: select * denied');
select throws_ok($$select invite_code from public.duel_matches$$, '42501', null,
  'invite_code column not readable (duel_invite_code only)');
select lives_ok($$select id, game_id, status, players, action_no, turn_deadline, winner, final_scores from public.duel_matches$$,
  'state_not_readable: other columns readable');

select throws_ok($$insert into public.duel_matches (game_id, logic_version, rated, visibility, created_by, turn_seconds)
                   values ('g-x', 1, true, 'public', auth.uid(), 60)$$,
  '42501', null, 'no_browser_writes: insert duel_matches');
select throws_ok($$update public.duel_matches set status = 'void' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'no_browser_writes: update duel_matches');
select throws_ok($$delete from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'no_browser_writes: delete duel_matches');
select throws_ok($$insert into public.duel_moves (match_id, action_no, seat, action)
                   values ('f0000000-0000-0000-0000-000000000004', 9, 0, '{}')$$,
  '42501', null, 'no_browser_writes: insert duel_moves');
select throws_ok($$update public.duel_ratings set rating = 3000$$, '42501', null, 'no_browser_writes: update duel_ratings');
select throws_ok($$insert into public.duel_rating_changes (match_id, user_id, before, after)
                   values ('f0000000-0000-0000-0000-000000000011', auth.uid(), 1, 2)$$,
  '42501', null, 'no_browser_writes: insert duel_rating_changes');
select throws_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'no_browser_writes: _duel_apply_elo not executable');

-- ---------------------------------------------------------------- RLS
-- a(C1)에게: b의 초대 waiting·b vs c active는 안 보이고, b의 공개 waiting과 내 대국은 보인다
select is((select count(*)::int from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000001'), 0,
  'rls_hides_others_invite_match: other''s invite waiting hidden');
select is((select count(*)::int from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000003'), 0,
  'rls_hides_others_invite_match: other people''s active match hidden');
select is((select count(*)::int from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000002'), 1,
  'rls_hides_others_invite_match: public waiting visible');
select is((select count(*)::int from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000004'), 1,
  'rls: own active match visible');
set local request.jwt.claims = :'C2';
select is((select count(*)::int from public.duel_matches where id in ('f0000000-0000-0000-0000-000000000001',
                                                                     'f0000000-0000-0000-0000-000000000003')), 2,
  'rls: creator sees own invite match');
set local request.jwt.claims = :'C3';
select is((select count(*)::int from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000003'), 1,
  'rls: joined player sees invite match');
set local request.jwt.claims = :'PU';
select is((select count(*)::int from public.duel_matches), 0, 'rls: pending user sees no matches');

-- moves: 진행 중은 참가자도 0행, 종료 후 참가자 보임, 제3자 0행
set local request.jwt.claims = :'C1';
select is((select count(*)::int from public.duel_moves where match_id = 'f0000000-0000-0000-0000-000000000004'), 0,
  'moves_hidden_until_finished: active match moves hidden from player');
select is((select count(*)::int from public.duel_moves where match_id = 'f0000000-0000-0000-0000-000000000031'), 3,
  'moves_hidden_until_finished: finished match moves visible to player');
set local request.jwt.claims = :'C5';
select is((select count(*)::int from public.duel_moves where match_id = 'f0000000-0000-0000-0000-000000000031'), 0,
  'moves_hidden_until_finished: third party sees none');

-- ---------------------------------------------------------------- Elo (소유자 연결)
reset role;
select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000011')$$, 'apply_elo 11');
select results_eq(
  $$select user_id::text, rating, rated_games, wins, draws, losses from public.duel_ratings where game_id = 'g-win' order by rating desc$$,
  $$values ('00000000-0000-0000-0000-0000000000c1', 1020, 1, 1, 0, 0), ('00000000-0000-0000-0000-0000000000c2', 980, 1, 0, 0, 1)$$,
  'elo_win: 1000 vs 1000 → 1020 / 980');
select results_eq(
  $$select user_id::text, before, after from public.duel_rating_changes
     where match_id = 'f0000000-0000-0000-0000-000000000011' order by after desc$$,
  $$values ('00000000-0000-0000-0000-0000000000c1', 1000, 1020), ('00000000-0000-0000-0000-0000000000c2', 1000, 980)$$,
  'elo_win: rating changes recorded');

select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000012')$$, 'apply_elo 12');
select results_eq(
  $$select user_id::text, rating, rated_games, draws from public.duel_ratings where game_id = 'g-draw' order by rating desc$$,
  $$values ('00000000-0000-0000-0000-0000000000c1', 1195, 11, 1), ('00000000-0000-0000-0000-0000000000c2', 1010, 1, 1)$$,
  'elo_draw_unequal: 1200(K20) vs 1000(K40) draw → 1195 / 1010');

select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000013')$$, 'apply_elo 13');
select results_eq(
  $$select user_id::text, rating from public.duel_ratings where game_id = 'g-k' order by user_id$$,
  $$values ('00000000-0000-0000-0000-0000000000c1', 1020), ('00000000-0000-0000-0000-0000000000c2', 990)$$,
  'elo_k_switch: rated_games 9 → K 40 (+20), 10 → K 20 (−10)');

select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000011')$$, 'apply_elo 11');
select results_eq(
  $$select rating, rated_games from public.duel_ratings where game_id = 'g-win' order by rating desc$$,
  $$values (1020, 1), (980, 1)$$,
  'elo_idempotent: second call changes nothing');
select is((select count(*)::int from public.duel_rating_changes where match_id = 'f0000000-0000-0000-0000-000000000011'), 2,
  'elo_idempotent: still two change rows');

select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000014')$$, 'apply_elo 14');
select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000015')$$, 'apply_elo 15');
select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000004')$$, 'apply_elo 04');
select is((select count(*)::int from public.duel_ratings where game_id in ('g-fr', 'g-lobby')), 0,
  'friendly_and_void_unrated: friendly, void and active matches leave ratings alone');
select is((select count(*)::int from public.duel_rating_changes
            where match_id in ('f0000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000015',
                               'f0000000-0000-0000-0000-000000000004')), 0,
  'friendly_and_void_unrated: no change rows');

-- ---------------------------------------------------------------- duel_stats
set local role authenticated;
set local request.jwt.claims = :'C5';
select is(public.duel_stats('duela', 'g-fr') -> 'all', '{"w":1,"d":0,"l":0,"rate":1.000}'::jsonb,
  'friendly_and_void_unrated: friendly win in all, void excluded');
select is(public.duel_stats('duela', 'g-fr') -> 'rated', '{"w":0,"d":0,"l":0,"rate":null}'::jsonb,
  'friendly_and_void_unrated: friendly not in rated');
select is((public.duel_stats('duela', 'g-win') ->> 'rating')::int, 1020, 'duel_stats: rating');
select is(public.duel_stats('duela', 'g-h2h') -> 'all', '{"w":3,"d":1,"l":1,"rate":0.600}'::jsonb,
  'duel_stats: all counts (incl. friendly, excl. void)');
select is(public.duel_stats('duela', 'g-h2h') -> 'rated', '{"w":2,"d":0,"l":1,"rate":0.667}'::jsonb,
  'duel_stats: rated counts');
select is(public.duel_stats('duela', 'g-h2h') -> 'recent' -> 0,
  jsonb_build_object('id', 'f0000000-0000-0000-0000-000000000026', 'opponent_handle', 'duelc', 'result', 'win',
                     'rated', true, 'ended_at', now() - interval '60 minutes', 'my_score', 9, 'opp_score', 4),
  'duel_stats: recent newest first with shape');
select is(public.duel_stats('duela', 'g-h2h') -> 'recent' -> 1 ->> 'result', 'loss',
  'duel_stats: result from my seat (b won as seat 0)');
select is(jsonb_array_length(public.duel_stats('duela', 'g-h2h') -> 'recent'), 5, 'duel_stats: recent excludes void');
select ok(jsonb_typeof(public.duel_stats('duela', null)) = 'array'
          and (select count(*) from jsonb_array_elements(public.duel_stats('duela', null)) e
                where e ->> 'game_id' in ('g-win', 'g-h2h', 'g-fr')) = 3,
  'duel_stats: p_game null → per-game array');
select is(public.duel_stats('nobody', 'g-win'), null::jsonb, 'duel_stats: unknown handle → null');
select is(public.duel_stats('손 흥민', null), null::jsonb, 'duel_stats: invalid handle → null (no error)');
select is(public.duel_h2h('ㅋ', 'duelb', null), null::jsonb, 'duel_h2h: invalid handle → null (no error)');

-- 한글 아이디: NFC로 저장된 사용자를 NFD·대소문자·공백이 섞인 입력으로도 찾는다 (0009_hangul_handle)
reset role;
update public.profiles set handle = '손흥민' where id = '00000000-0000-0000-0000-0000000000c1';
set local role authenticated;
set local request.jwt.claims = :'C5';
select ok(normalize('손흥민', NFD) <> '손흥민', 'hangul_handle: NFD input differs from stored NFC bytes');
select ok(public.duel_stats(' ' || normalize('손흥민', NFD) || ' ', 'g-win') is not null
          and public.duel_stats(' ' || normalize('손흥민', NFD) || ' ', 'g-win') = public.duel_stats('손흥민', 'g-win'),
  'hangul_handle: duel_stats finds NFC-stored user from NFD input');
select is(public.duel_h2h(normalize('손흥민', NFD), 'DUELB', 'g-h2h') -> 'games',
  '[{"game_id":"g-h2h","a_wins":2,"draws":1,"b_wins":1}]'::jsonb, 'hangul_handle: duel_h2h finds NFC-stored user from NFD input');
reset role;
update public.profiles set handle = 'duela' where id = '00000000-0000-0000-0000-0000000000c1';
set local role authenticated;
set local request.jwt.claims = :'C5';

-- ---------------------------------------------------------------- duel_h2h
select is(public.duel_h2h('duela', 'duelb', 'g-h2h') -> 'games',
  '[{"game_id":"g-h2h","a_wins":2,"draws":1,"b_wins":1}]'::jsonb, 'h2h_counts: 2 wins 1 draw 1 loss');
select is(public.duel_h2h('duelb', 'duela', 'g-h2h') -> 'games',
  '[{"game_id":"g-h2h","a_wins":1,"draws":1,"b_wins":2}]'::jsonb, 'h2h_counts: mirrored');
select is(jsonb_array_length(public.duel_h2h('duela', 'duelb', 'g-h2h') -> 'recent'), 4,
  'h2h_counts: recent has only finished a-vs-b matches');
select is(public.duel_h2h('duela', 'duelb', 'g-h2h') -> 'recent' -> 0 ->> 'result', 'loss',
  'h2h: recent newest first, result from a''s side');
select ok((select count(*) from jsonb_array_elements(public.duel_h2h('duela', 'duelb', null) -> 'games')) >= 5,
  'h2h: p_game null → every game they played');

-- ---------------------------------------------------------------- lb_duel
select results_eq($$select handle, rating, rated_games, placed from public.lb_duel('g-lb')$$,
  $$values ('duelb'::text, 1200, 4, false), ('duela'::text, 1100, 5, true), ('duelc'::text, 1050, 7, true)$$,
  'lb_placed: placed = rated_games >= 5, ordered by rating desc');

-- 숨김 게임(yacht): 비관리자에게는 통계·상대 전적·레이팅·레이팅 변화가 보이지 않는다
select is(public.duel_stats('duela', 'yacht'), null::jsonb, 'hidden_game_excluded: duel_stats(yacht) null for non-admin');
select ok(not (public.duel_stats('duela', null) @> '[{"game_id":"yacht"}]'),
  'hidden_game_excluded: duel_stats(all games) has no yacht for non-admin');
select is(public.duel_h2h('duela', 'duelb', 'yacht') -> 'games', '[]'::jsonb,
  'hidden_game_excluded: duel_h2h(yacht) empty for non-admin');
select ok(not (public.duel_h2h('duela', 'duelb', null) -> 'games' @> '[{"game_id":"yacht"}]')
          and not (public.duel_h2h('duela', 'duelb', null) -> 'recent' @> '[{"game_id":"yacht"}]'),
  'hidden_game_excluded: duel_h2h(all games) has no yacht for non-admin');
select is((select count(*)::int from public.duel_ratings where game_id = 'yacht'), 0,
  'hidden_game_excluded: duel_ratings RLS hides yacht from non-admin');
select is((select count(*)::int from public.duel_rating_changes where match_id = 'f0000000-0000-0000-0000-000000000041'), 0,
  'hidden_game_excluded: duel_rating_changes RLS hides yacht from non-admin');
select is((select count(*)::int from public.duel_rating_changes where match_id = 'f0000000-0000-0000-0000-000000000011'), 2,
  'duel_rating_changes: approved user reads non-hidden changes');

-- ---------------------------------------------------------------- duel_list
set local request.jwt.claims = :'C1';
select ok(not (public.duel_list() -> 'lobby' @> '[{"id":"f0000000-0000-0000-0000-000000000006"}]'),
  'list_autovoids_stale_waiting: stale waiting not in lobby');
reset role;
select is((select status::text from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000006'), 'void',
  'list_autovoids_stale_waiting: 11-minute waiting → void');
select is((select end_reason::text from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000006'), 'void',
  'list_autovoids_stale_waiting: end_reason void');
select is((select status::text from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000007'), 'waiting',
  'list_autovoids_stale_waiting: 9-minute waiting kept');
set local role authenticated;
set local request.jwt.claims = :'C1';
select ok(public.duel_list() -> 'lobby' @> '[{"id":"f0000000-0000-0000-0000-000000000007"},{"id":"f0000000-0000-0000-0000-000000000002"}]'
          and not (public.duel_list() -> 'lobby' @> '[{"id":"f0000000-0000-0000-0000-000000000001"}]'),
  'duel_list: lobby = public waiting only');
select is(public.duel_list() -> 'due', '["f0000000-0000-0000-0000-000000000004"]'::jsonb,
  'list_due: my active match past its deadline');
select ok(public.duel_list() -> 'mine' @> '[{"id":"f0000000-0000-0000-0000-000000000004"},{"id":"f0000000-0000-0000-0000-000000000005"}]',
  'duel_list: mine has my active matches');
select is(jsonb_array_length(public.duel_list() -> 'recent'), 10, 'duel_list: recent capped at 10');
select is((select e -> 'players' from jsonb_array_elements(public.duel_list() -> 'mine') e
            where e ->> 'id' = 'f0000000-0000-0000-0000-000000000005'),
  '[{"id":"00000000-0000-0000-0000-0000000000c2","handle":"duelb","rating":1000},{"id":"00000000-0000-0000-0000-0000000000c1","handle":"duela","rating":1000}]'::jsonb,
  'duel_list: players in seat order with rating');
select ok(not exists (select 1 from jsonb_array_elements(public.duel_list() -> 'mine') e where e ? 'state' or e ? 'invite_code'),
  'duel_list: items carry no state or invite_code');

-- ---------------------------------------------------------------- hidden game
select ok(not (public.duel_list() -> 'lobby' @> '[{"id":"f0000000-0000-0000-0000-000000000008"}]'),
  'hidden_game_excluded: non-admin lobby has no yacht match');
select is((select count(*)::int from public.lb_duel('yacht')), 0, 'hidden_game_excluded: non-admin lb_duel(yacht) empty');
set local request.jwt.claims = :'ADM';
select ok(public.duel_list() -> 'lobby' @> '[{"id":"f0000000-0000-0000-0000-000000000008","game_id":"yacht"}]',
  'hidden_game_excluded: admin lobby shows yacht match');
select is((select count(*)::int from public.lb_duel('yacht')), 1, 'hidden_game_excluded: admin sees lb_duel(yacht)');
select is(public.duel_stats('duela', 'yacht') -> 'all' ->> 'w', '1', 'hidden_game_excluded: admin sees duel_stats(yacht)');
select is(public.duel_h2h('duela', 'duelb', 'yacht') -> 'games',
  '[{"game_id":"yacht","a_wins":1,"draws":0,"b_wins":0}]'::jsonb, 'hidden_game_excluded: admin sees duel_h2h(yacht)');
select is((select count(*)::int from public.duel_ratings where game_id = 'yacht'), 1,
  'hidden_game_excluded: admin reads yacht duel_ratings');
select is((select count(*)::int from public.duel_rating_changes where match_id = 'f0000000-0000-0000-0000-000000000041'), 1,
  'hidden_game_excluded: admin reads yacht duel_rating_changes');

-- ---------------------------------------------------------------- invite code
set local request.jwt.claims = :'C2';
select is(public.duel_invite_code('f0000000-0000-0000-0000-000000000001'), 'duelinv001', 'invite_code_owner_only: creator gets code');
set local request.jwt.claims = :'C3';
select is(public.duel_invite_code('f0000000-0000-0000-0000-000000000003'), null, 'invite_code_owner_only: joined player gets null');
set local request.jwt.claims = :'C5';
select is(public.duel_invite_code('f0000000-0000-0000-0000-000000000001'), null, 'invite_code_owner_only: third party gets null');
reset role;
update public.profiles set status = 'pending' where id = :'u2';
set local role authenticated;
set local request.jwt.claims = :'C2';
select is(public.duel_invite_code('f0000000-0000-0000-0000-000000000001'), null,
  'invite_code_owner_only: creator who is no longer approved gets null');
reset role;
update public.profiles set status = 'approved' where id = :'u2';
set local role authenticated;

-- ---------------------------------------------------------------- pending / anon
set local request.jwt.claims = :'PU';
select throws_ok($$select public.duel_list()$$, 'P0001', 'forbidden', 'duel_list: pending user forbidden');
reset role;

-- ---------------------------------------------------------------- creator deleted
-- d(만든 사람, 선공)가 c에게 진 랭크 대국. d를 지워도 대국과 c의 레이팅 변화는 남는다.
select lives_ok($$select public._duel_apply_elo('f0000000-0000-0000-0000-000000000051')$$, 'apply_elo 51');
delete from auth.users where id = :'u4';
select is((select created_by is null and players[1] = '00000000-0000-0000-0000-0000000000c4'
             from public.duel_matches where id = 'f0000000-0000-0000-0000-000000000051'), true,
  'creator_deleted: match kept with created_by null');
select results_eq($$select user_id::text, before, after from public.duel_rating_changes
                     where match_id = 'f0000000-0000-0000-0000-000000000051'$$,
  $$values ('00000000-0000-0000-0000-0000000000c3', 1000, 1020)$$,
  'creator_deleted: opponent''s rating change kept, deleted user''s removed');
insert into public.duel_matches (id, game_id, logic_version, rated, visibility, status, created_by, turn_seconds)
values ('f0000000-0000-0000-0000-000000000052', 'g-del', 1, true, 'public', 'waiting', null, 60);
set local role authenticated;
set local request.jwt.claims = :'C3';
select ok(not (public.duel_list() -> 'lobby' @> '[{"id":"f0000000-0000-0000-0000-000000000052"}]')
          and public.duel_list() -> 'recent' @> '[{"id":"f0000000-0000-0000-0000-000000000051","created_by_handle":null}]',
  'creator_deleted: orphan waiting not in lobby, finished match still in opponent''s recent');
select is(public.duel_stats('duelc', 'g-del') -> 'all', '{"w":1,"d":0,"l":0,"rate":1.000}'::jsonb,
  'creator_deleted: opponent''s stats keep the match');
reset role;
set local role anon;
select throws_ok($$select public.duel_list()$$, '42501', null, 'anon cannot execute duel_list');
reset role;

select * from finish();
rollback;
