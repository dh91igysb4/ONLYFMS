-- 데일리 채팅: 테이블·권한·RPC·Realtime·Storage (daily-chat Task 1, 설계 §3, §6)
-- 한 트랜잭션 안에서 now()는 고정이다. chat_post의 도배 검사는 now()와 비교하므로, 같은 사용자가 다시
-- 보내기 전에는 소유자 권한으로 그 사용자 행의 created_at을 과거로 민다(age).
-- 게임 id는 등록부와 무관한 테스트용 문자열(g-chat*)을 쓴다.
begin;
select plan(103);
insert into public.hidden_games (game_id) values ('g-chat-hidden');

\set A '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'
\set B '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}'
\set C '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}'
\set D '{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}'
\set E '{"sub":"00000000-0000-0000-0000-0000000000e5","role":"authenticated"}'
\set F '{"sub":"00000000-0000-0000-0000-0000000000e6","role":"authenticated"}'
\set ua '00000000-0000-0000-0000-0000000000e1'
\set ub '00000000-0000-0000-0000-0000000000e2'
\set ue '00000000-0000-0000-0000-0000000000e5'
-- 문항: today(데일리 오늘) / yday(데일리 어제) / off(일반 대회) / canc(취소된 데일리) / hid(오늘 데일리, 숨김 게임)
\set today 'd1000000-0000-0000-0000-000000000001'
\set yday  'd1000000-0000-0000-0000-000000000002'
\set off   'd1000000-0000-0000-0000-000000000003'
\set canc  'd1000000-0000-0000-0000-000000000004'
\set hid   'd1000000-0000-0000-0000-000000000005'

-- ---------------------------------------------------------------- fixture (superuser)
-- A 오늘 맞힘, B 오늘 포기(finished, 0점), C 시작만, D 미시작, E 관리자(오늘·어제·숨김 끝냄), F 미승인(오늘 끝냄)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ca@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'cb@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'cc@example.com'),
  ('00000000-0000-0000-0000-0000000000e4', 'cd@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'ce@example.com'),
  ('00000000-0000-0000-0000-0000000000e6', 'cf@example.com');
update public.profiles set status = 'approved', handle = 'chata' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set status = 'approved', handle = 'chatb' where id = '00000000-0000-0000-0000-0000000000e2';
update public.profiles set status = 'approved', handle = 'chatc' where id = '00000000-0000-0000-0000-0000000000e3';
update public.profiles set status = 'approved', handle = 'chatd' where id = '00000000-0000-0000-0000-0000000000e4';
update public.profiles set status = 'approved', handle = 'chate', is_admin = true where id = '00000000-0000-0000-0000-0000000000e5';
update public.profiles set handle = 'chatf' where id = '00000000-0000-0000-0000-0000000000e6';

insert into public.contests (id, kind, title, visibility, starts_at, ends_at, cancelled_at, daily_key) values
  ('c1000000-0000-0000-0000-000000000001', 'daily', 'today', 'public',
     now() - interval '1 hour', now() + interval '23 hours', null, 'chat-today'),
  ('c1000000-0000-0000-0000-000000000002', 'daily', 'yesterday', 'public',
     now() - interval '25 hours', now() - interval '1 hour', null, 'chat-yday'),
  ('c1000000-0000-0000-0000-000000000003', 'official', 'official', 'public',
     now() - interval '1 hour', now() + interval '1 hour', null, null),
  ('c1000000-0000-0000-0000-000000000004', 'daily', 'cancelled', 'public',
     now() - interval '1 hour', now() + interval '23 hours', now(), 'chat-canc');
insert into public.contest_items (id, contest_id, position, game_id, logic_version, generated_at) values
  (:'today', 'c1000000-0000-0000-0000-000000000001', 1, 'g-chat', 1, now()),
  (:'hid',   'c1000000-0000-0000-0000-000000000001', 2, 'g-chat-hidden', 1, now()),
  (:'yday',  'c1000000-0000-0000-0000-000000000002', 1, 'g-chat', 1, now()),
  (:'off',   'c1000000-0000-0000-0000-000000000003', 1, 'g-chat', 1, now()),
  (:'canc',  'c1000000-0000-0000-0000-000000000004', 1, 'g-chat', 1, now());
insert into public.attempts (item_id, user_id, state, logic_version, finished, score, finished_at) values
  (:'today', '00000000-0000-0000-0000-0000000000e1', '{}', 1, true, 10, now()),
  (:'today', '00000000-0000-0000-0000-0000000000e2', '{}', 1, true, 0, now()),
  (:'today', '00000000-0000-0000-0000-0000000000e3', '{}', 1, false, 0, null),
  (:'today', '00000000-0000-0000-0000-0000000000e5', '{}', 1, true, 5, now()),
  (:'today', '00000000-0000-0000-0000-0000000000e6', '{}', 1, true, 5, now()),
  (:'yday',  '00000000-0000-0000-0000-0000000000e5', '{}', 1, true, 5, now()),
  (:'off',   '00000000-0000-0000-0000-0000000000e1', '{}', 1, true, 5, now()),
  (:'canc',  '00000000-0000-0000-0000-0000000000e1', '{}', 1, true, 5, now()),
  (:'hid',   '00000000-0000-0000-0000-0000000000e1', '{}', 1, true, 5, now()),
  (:'hid',   '00000000-0000-0000-0000-0000000000e5', '{}', 1, true, 5, now());
-- 다른 날·숨김 문항의 글(E). 오늘 문항 목록에 섞이지 않아야 한다.
insert into public.daily_chat (item_id, user_id, body, created_at) values
  (:'yday', :'ue', 'yesterday', now() - interval '1 day'),
  (:'hid',  :'ue', 'hidden', now() - interval '1 minute');

-- ---------------------------------------------------------------- schema
select has_table('public', 'daily_chat', 'daily_chat exists');
select has_index('public', 'daily_chat', 'daily_chat_item_created_idx', array['item_id', 'created_at'],
  'index (item_id, created_at)');
select throws_ok($$insert into public.daily_chat (item_id, user_id) values ('d1000000-0000-0000-0000-000000000001',
                   '00000000-0000-0000-0000-0000000000e1')$$, '23514', null, 'constraint: body or image required');
select throws_ok($$insert into public.daily_chat (item_id, user_id, body) values ('d1000000-0000-0000-0000-000000000001',
                   '00000000-0000-0000-0000-0000000000e1', '   ')$$, '23514', null, 'constraint: blank body rejected');
select throws_ok($$insert into public.daily_chat (item_id, user_id, body) values ('d1000000-0000-0000-0000-000000000001',
                   '00000000-0000-0000-0000-0000000000e1', repeat('x', 301))$$, '23514', null, 'constraint: 301 chars rejected');
select throws_ok($$insert into public.daily_chat (item_id, user_id, image_path) values ('d1000000-0000-0000-0000-000000000001',
                   '00000000-0000-0000-0000-0000000000e1',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e2/1730000000000.jpg')$$,
  '23514', null, 'constraint: image_path must be author''s folder');
select throws_ok($$insert into public.daily_chat (item_id, user_id, body) values ('d1000000-0000-0000-0000-000000000001',
                   '00000000-0000-0000-0000-0000000000e1', E'\n\t \r')$$, '23514', null,
  'constraint: whitespace-only (newline/tab/CR) body rejected');

-- ---------------------------------------------------------------- publication
select is((select count(*)::int from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_chat'), 1,
  'publication: daily_chat in supabase_realtime');
select is((select count(*)::int from pg_publication_tables
            where schemaname = 'public'
              and tablename in ('duel_matches', 'duel_moves', 'duel_ratings', 'duel_rating_changes')), 0,
  'publication: duel tables still excluded');

-- ---------------------------------------------------------------- storage bucket
select results_eq($$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'daily-chat'$$,
  $$values (false, 1048576::bigint, array['image/jpeg'])$$, 'bucket daily-chat: private, 1MB, jpeg only');

-- ---------------------------------------------------------------- can_chat_rules
set local role authenticated;
set local request.jwt.claims = :'A';
select ok(public.can_chat(:'today'), 'can_chat_rules: A solved today → true');
select ok(not public.can_chat(:'yday'), 'can_chat_rules: A did not play yesterday → false');
select ok(not public.can_chat(:'off'), 'can_chat_rules: non-daily contest item → false');
select ok(not public.can_chat(:'canc'), 'can_chat_rules: cancelled daily → false');
select ok(not public.can_chat(gen_random_uuid()), 'can_chat_rules: unknown item → false');
set local request.jwt.claims = :'B';
select ok(public.can_chat(:'today'), 'can_chat_rules: B gave up (finished) → true');
set local request.jwt.claims = :'C';
select ok(not public.can_chat(:'today'), 'can_chat_rules: C started only → false');
set local request.jwt.claims = :'D';
select ok(not public.can_chat(:'today'), 'can_chat_rules: D not started → false');
set local request.jwt.claims = :'F';
select ok(not public.can_chat(:'today'), 'can_chat_rules: F unapproved → false');
set local request.jwt.claims = :'E';
select ok(public.can_chat(:'yday'), 'can_chat_rules: E finished yesterday → still true next day');

-- ---------------------------------------------------------------- post_ok_and_lengths (A)
set local request.jwt.claims = :'A';
select lives_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', '  ' || repeat('a', 300) || '  ')$$,
  'post_ok_and_lengths: 300 chars (after trim) ok');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', repeat('a', 301))$$,
  'P0001', 'invalid_message', 'post_ok_and_lengths: 301 chars invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', '   ')$$,
  'P0001', 'invalid_message', 'post_ok_and_lengths: blank invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', E'\n\t ')$$,
  'P0001', 'invalid_message', 'post_ok_and_lengths: newline/tab-only invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', E'\r\n' || repeat('a', 301) || E'\n')$$,
  'P0001', 'invalid_message', 'post_ok_and_lengths: 301 chars inside newlines invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', null, null)$$,
  'P0001', 'invalid_message', 'post_ok_and_lengths: null + null invalid');
reset role;
select is((select body from public.daily_chat where user_id = :'ua'), repeat('a', 300),
  'post_ok_and_lengths: body stored trimmed');
set local role authenticated;

-- ---------------------------------------------------------------- post_forbidden
set local request.jwt.claims = :'C';
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'hi')$$,
  'P0001', 'forbidden', 'post_forbidden: C (unfinished)');
set local request.jwt.claims = :'D';
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'hi')$$,
  'P0001', 'forbidden', 'post_forbidden: D (not started)');
set local request.jwt.claims = :'F';
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'hi')$$,
  'P0001', 'forbidden', 'post_forbidden: F (unapproved)');
set local request.jwt.claims = :'A';
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000003', 'hi')$$,
  'P0001', 'forbidden', 'post_forbidden: non-daily item');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000002', 'hi')$$,
  'P0001', 'forbidden', 'post_forbidden: A on yesterday');

-- ---------------------------------------------------------------- image_path_rules (A)
reset role;
update public.daily_chat set created_at = created_at - interval '10 seconds' where user_id = :'ua';
set local role authenticated;
set local request.jwt.claims = :'A';
select lives_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', null,
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000000.jpg')$$,
  'image_path_rules: own folder, image only ok');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'x',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e2/1730000000000.jpg')$$,
  'P0001', 'invalid_message', 'image_path_rules: B''s folder invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'x',
                   'd1000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-0000000000e1/1730000000000.jpg')$$,
  'P0001', 'invalid_message', 'image_path_rules: other item''s path invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'x',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000000.png')$$,
  'P0001', 'invalid_message', 'image_path_rules: .png invalid');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'x',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/173000000000.jpg')$$,
  'P0001', 'invalid_message', 'image_path_rules: 12-digit name invalid');

reset role;
update public.daily_chat set created_at = created_at - interval '10 seconds' where user_id = :'ua';
set local role authenticated;
set local request.jwt.claims = :'B';
select results_eq($$select count(*)::int from public.chat_post('d1000000-0000-0000-0000-000000000001', 'hello b')$$,
  $$values (1)$$, 'post: B (gave up) can post, returns one row');

-- ---------------------------------------------------------------- select_rls
set local request.jwt.claims = :'C';
select is((select count(*)::int from public.daily_chat), 0, 'select_rls: C sees no rows');
set local request.jwt.claims = :'D';
select is((select count(*)::int from public.daily_chat), 0, 'select_rls: D sees no rows');
set local request.jwt.claims = :'F';
select is((select count(*)::int from public.daily_chat), 0, 'select_rls: F sees no rows');
set local request.jwt.claims = :'A';
select is((select count(*)::int from public.daily_chat), 3,
  'select_rls: A sees only today''s 3 rows (not yesterday / hidden)');
set local request.jwt.claims = :'E';
select is((select count(*)::int from public.daily_chat), 5, 'select_rls: admin E sees today + yesterday + hidden');

-- ---------------------------------------------------------------- chat_list
set local request.jwt.claims = :'C';
select throws_ok($$select * from public.chat_list('d1000000-0000-0000-0000-000000000001')$$,
  'P0001', 'forbidden', 'list_forbidden: C');
set local request.jwt.claims = :'F';
select throws_ok($$select * from public.chat_list('d1000000-0000-0000-0000-000000000001')$$,
  'P0001', 'forbidden', 'list_forbidden: F (unapproved)');
set local request.jwt.claims = :'A';
select throws_ok($$select * from public.chat_list('d1000000-0000-0000-0000-000000000002')$$,
  'P0001', 'forbidden', 'list_forbidden: A on yesterday');
select results_eq(
  $$select handle, char_length(body), image_path, deleted, mine
      from public.chat_list('d1000000-0000-0000-0000-000000000001')$$,
  $$values ('chatb'::text, 7, null::text, false, false),
           ('chata'::text, null::int,
            'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000000.jpg', false, true),
           ('chata'::text, 300, null::text, false, true)$$,
  'chat_list: newest first, handle, mine');
select is((select count(*)::int from public.chat_list('d1000000-0000-0000-0000-000000000001', now() - interval '5 seconds')),
  2, 'chat_list: p_before');
select results_eq($$select handle from public.chat_list('d1000000-0000-0000-0000-000000000001', null, 1)$$,
  $$values ('chatb'::text)$$, 'chat_list: p_limit 1');
select is((select count(*)::int from public.chat_list('d1000000-0000-0000-0000-000000000001', null, 0)), 1,
  'chat_list: p_limit 0 clamped to 1');
select is((select count(*)::int from public.chat_list('d1000000-0000-0000-0000-000000000001', null, 1000)), 3,
  'chat_list: p_limit 1000 clamped (all 3)');
set local request.jwt.claims = :'B';
select results_eq($$select mine from public.chat_list('d1000000-0000-0000-0000-000000000001')$$,
  $$values (true), (false), (false)$$, 'chat_list: mine from B''s view');

-- ---------------------------------------------------------------- delete_rules
set local request.jwt.claims = :'A';
select is(public.chat_delete((select id from public.chat_list('d1000000-0000-0000-0000-000000000001') where image_path is not null)),
  'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000000.jpg',
  'delete_rules: own delete returns image path');
select results_eq(
  $$select deleted, body, image_path from public.chat_list('d1000000-0000-0000-0000-000000000001') where mine and body is null$$,
  $$values (true, null::text, null::text)$$, 'delete_rules: chat_list shows deleted with nulls');
reset role;
select results_eq(
  $$select body, image_path, deleted_at = now() from public.daily_chat where user_id = '00000000-0000-0000-0000-0000000000e1'
      and deleted_at is not null$$,
  $$values (null::text, null::text, true)$$, 'delete_rules: row body/image_path null, deleted_at now()');
set local role authenticated;
set local request.jwt.claims = :'B';
select throws_ok(format('select public.chat_delete(%L)',
                   (select id from public.daily_chat where user_id = :'ua' and deleted_at is null)),
  'P0001', 'forbidden', 'delete_rules: B cannot delete A''s message');
set local request.jwt.claims = :'F';
select throws_ok(format('select public.chat_delete(%L)', (select id from public.daily_chat where user_id = :'ub')),
  'P0001', 'forbidden', 'delete_rules: unapproved cannot delete');
set local request.jwt.claims = :'E';
select is(public.chat_delete((select id from public.daily_chat where user_id = :'ub')), null::text,
  'delete_rules: admin deletes B''s text message (no image → null)');
select throws_ok($$select public.chat_delete(gen_random_uuid())$$, 'P0001', 'not_found', 'delete_rules: unknown id');
reset role;
select is((select count(*)::int from public.daily_chat where user_id = :'ub' and deleted_at is not null), 1,
  'delete_rules: B''s message marked deleted');
select is((select count(*)::int from public.daily_chat where user_id = :'ua' and deleted_at is null), 1,
  'delete_rules: A''s other message untouched');
set local role authenticated;

-- ---------------------------------------------------------------- hidden_game
set local request.jwt.claims = :'A';
select ok(not public.can_chat(:'hid'), 'hidden_game: normal user (finished) → false');
select throws_ok($$select * from public.chat_list('d1000000-0000-0000-0000-000000000005')$$,
  'P0001', 'forbidden', 'hidden_game: normal user list forbidden');
set local request.jwt.claims = :'E';
select ok(public.can_chat(:'hid'), 'hidden_game: admin (finished) → true');
select results_eq($$select body from public.chat_list('d1000000-0000-0000-0000-000000000005')$$,
  $$values ('hidden'::text)$$, 'hidden_game: admin lists hidden item chat');

-- ---------------------------------------------------------------- no_direct_writes
set local request.jwt.claims = :'A';
select throws_ok($$insert into public.daily_chat (item_id, user_id, body)
                   values ('d1000000-0000-0000-0000-000000000001', auth.uid(), 'direct')$$,
  '42501', null, 'no_direct_writes: insert denied');
select throws_ok($$update public.daily_chat set body = 'x'$$, '42501', null, 'no_direct_writes: update denied');
select throws_ok($$delete from public.daily_chat$$, '42501', null, 'no_direct_writes: delete denied');
reset role;
set local role anon;
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'anon')$$,
  '42501', null, 'no_direct_writes: anon cannot call chat_post');
select throws_ok($$select * from public.chat_list('d1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon cannot call chat_list');
select throws_ok($$select count(*) from public.daily_chat$$, '42501', null, 'anon cannot select daily_chat');
reset role;

-- ---------------------------------------------------------------- storage_policies
set local role authenticated;
set local request.jwt.claims = :'A';
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('daily-chat',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000001.jpg', auth.uid())$$,
  'storage_policies: A uploads to own folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('daily-chat',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e2/1730000000001.jpg', auth.uid())$$,
  '42501', null, 'storage_policies: A cannot upload to B''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('daily-chat',
                   'd1000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-0000000000e1/1730000000001.jpg', auth.uid())$$,
  '42501', null, 'storage_policies: A cannot upload to an item they cannot chat on');
select is((select count(*)::int from storage.objects where bucket_id = 'daily-chat'), 1, 'storage_policies: A sees object');
set local request.jwt.claims = :'C';
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('daily-chat',
                   'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e3/1730000000001.jpg', auth.uid())$$,
  '42501', null, 'storage_policies: C (unfinished) cannot upload to own folder');
select is((select count(*)::int from storage.objects), 0, 'storage_policies: C sees no objects');
set local request.jwt.claims = :'F';
select is((select count(*)::int from storage.objects), 0, 'storage_policies: F sees no objects');
set local request.jwt.claims = :'B';
select is((select count(*)::int from storage.objects where bucket_id = 'daily-chat'), 1, 'storage_policies: B (finished) sees object');
select lives_ok($$delete from storage.objects where bucket_id = 'daily-chat'$$, 'storage_policies: B delete runs');
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'daily-chat'), 1,
  'storage_policies: B could not delete A''s object');
set local role authenticated;
set local request.jwt.claims = :'E';
select lives_ok($$delete from storage.objects where bucket_id = 'daily-chat'$$, 'storage_policies: admin delete runs');
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'daily-chat'), 0,
  'storage_policies: admin deleted A''s object');
-- 본인 폴더 삭제
insert into storage.objects (bucket_id, name, owner) values ('daily-chat',
  'd1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000002.jpg', :'ua');
set local role authenticated;
set local request.jwt.claims = :'A';
select lives_ok($$delete from storage.objects where bucket_id = 'daily-chat'$$, 'storage_policies: A delete own runs');
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'daily-chat'), 0,
  'storage_policies: A deleted own object');

-- 첫 폴더가 uuid가 아닌 경로: 오류 없이 false·거부
set local role authenticated;
set local request.jwt.claims = :'A';
select is(public.can_chat_path('not-a-uuid/00000000-0000-0000-0000-0000000000e1/1730000000003.jpg'), false,
  'can_chat_path: non-uuid folder → false, no error');
select is(public.can_chat_path('1730000000003.jpg'), false, 'can_chat_path: no folder → false');
select is(public.can_chat_path(null), false, 'can_chat_path: null → false');
select ok(public.can_chat_path('d1000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000e1/1730000000003.jpg'),
  'can_chat_path: today item folder → true for A');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('daily-chat',
                   'not-a-uuid/00000000-0000-0000-0000-0000000000e1/1730000000003.jpg', auth.uid())$$,
  '42501', null, 'storage_policies: non-uuid folder upload rejected by RLS (not a cast error)');
-- 소유자가 넣은 비정상 이름 객체와, 관리자 E가 끝내지 않은 문항(일반 대회 off)의 사진
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('daily-chat', 'not-a-uuid/x/1730000000004.jpg', :'ua'),
  ('daily-chat', 'd1000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-0000000000e1/1730000000005.jpg', :'ua');
set local role authenticated;
set local request.jwt.claims = :'A';
select is((select count(*)::int from storage.objects where bucket_id = 'daily-chat'), 0,
  'storage_policies: select over a non-uuid object does not error (A sees 0)');
set local request.jwt.claims = :'E';
select ok(not public.can_chat('d1000000-0000-0000-0000-000000000003'), 'admin_storage: E has not finished item off');
select is((select count(*)::int from storage.objects
            where name = 'd1000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-0000000000e1/1730000000005.jpg'), 1,
  'admin_storage: admin sees photo of an item they did not finish');
select lives_ok($$delete from storage.objects
                   where name = 'd1000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-0000000000e1/1730000000005.jpg'$$,
  'admin_storage: admin delete runs');
reset role;
select is((select count(*)::int from storage.objects
            where name = 'd1000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-0000000000e1/1730000000005.jpg'), 0,
  'admin_storage: admin deleted photo of an unfinished item');
delete from storage.objects where bucket_id = 'daily-chat';

-- ---------------------------------------------------------------- too_fast / too_many
update public.daily_chat set created_at = created_at - interval '10 seconds' where user_id = :'ua';
set local role authenticated;
set local request.jwt.claims = :'A';
select lives_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'one')$$, 'too_fast: first post ok');
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'two')$$,
  'P0001', 'too_fast', 'too_fast: second post within 2s');

-- A: 기존 글은 2시간 전으로 밀고, 최근 1시간에 60개(now()-10초 ~ now()-57분)
reset role;
update public.daily_chat set created_at = now() - interval '2 hours' where user_id = :'ua';
insert into public.daily_chat (item_id, user_id, body, created_at)
  select :'today', :'ua', 'spam', now() - interval '10 seconds' - g * interval '58 seconds' from generate_series(0, 59) g;
-- B: 경계(59개면 아직 보낼 수 있다)
update public.daily_chat set created_at = now() - interval '2 hours' where user_id = :'ub';
insert into public.daily_chat (item_id, user_id, body, created_at)
  select :'today', :'ub', 'spam', now() - interval '10 seconds' - g * interval '58 seconds' from generate_series(0, 58) g;
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'more')$$,
  'P0001', 'too_many', 'too_many: 60 in the last hour');
set local request.jwt.claims = :'B';
select lives_ok($$select public.chat_post('d1000000-0000-0000-0000-000000000001', 'b ok')$$,
  'too_many: 59 in the last hour still ok');
reset role;

-- ---------------------------------------------------------------- function privileges
select ok(not has_function_privilege('anon', 'public.can_chat(uuid)', 'execute'), 'anon cannot execute can_chat');
select ok(not has_function_privilege('anon', 'public.chat_delete(uuid)', 'execute'), 'anon cannot execute chat_delete');
select ok(has_function_privilege('authenticated', 'public.chat_post(uuid, text, text)', 'execute'),
  'authenticated can execute chat_post');
select ok(not has_table_privilege('authenticated', 'public.daily_chat', 'insert'), 'authenticated has no insert on daily_chat');

select * from finish();
rollback;
