-- 월드(지속형) 게임 테이블·권한·user_records (fishing Task 2)
-- 기록·저장 행은 슈퍼유저(= Edge Function의 소유자 연결)로 직접 넣는다. 숨김 게임 확인용으로 g-wh를 hidden_games에 넣는다.
begin;
select plan(23);

\set PU  '{"sub":"00000000-0000-0000-0000-0000000000e0","role":"authenticated"}'
\set UA  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000ed","role":"authenticated"}'
\set ua '00000000-0000-0000-0000-0000000000e1'
\set ub '00000000-0000-0000-0000-0000000000e2'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e0', 'wp@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'wa@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'wb@example.com'),
  ('00000000-0000-0000-0000-0000000000ed', 'wadm@example.com');
update public.profiles set handle = 'worldp' where id = '00000000-0000-0000-0000-0000000000e0';
update public.profiles set status = 'approved', handle = 'worlda' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set status = 'approved', handle = 'worldb' where id = '00000000-0000-0000-0000-0000000000e2';
update public.profiles set status = 'approved', handle = 'wboss', is_admin = true where id = '00000000-0000-0000-0000-0000000000ed';

insert into public.hidden_games (game_id) values ('g-wh') on conflict do nothing;

insert into public.world_saves (user_id, game_id, state, logic_version) values
  (:'ua', 'g-world', '{"gold":1}', 1),
  (:'ub', 'g-world', '{"gold":2}', 1);
insert into public.game_records (user_id, game_id, key, value, detail) values
  (:'ua', 'g-world', 'heaviest', 12.5, '붕어'),
  (:'ua', 'g-world', 'catches',  3,    null),
  (:'ub', 'g-world', 'heaviest', 7,    '잉어'),
  (:'ua', 'g-wh',    'heaviest', 99,   '숨김');

select has_table('public', 'world_saves',  'world_saves exists');
select has_table('public', 'game_records', 'game_records exists');
select has_function('public', 'user_records', array['text'], 'user_records exists');

-- ---------------------------------------------------------------- approved user A
set local role authenticated;
set local request.jwt.claims = :'UA';

-- 세이브에는 챔 전의 어종·크기가 들어 있으므로 본인도 직접 읽을 수 없다 (select 권한 없음)
select throws_ok($$select state from public.world_saves where user_id = auth.uid()$$,
  '42501', null, 'world_saves: own row not readable by its owner');
select throws_ok($$select state from public.world_saves where user_id = '00000000-0000-0000-0000-0000000000e2'$$,
  '42501', null, 'world_saves: other user''s row not readable');
select throws_ok($$insert into public.world_saves (user_id, game_id, state, logic_version) values (auth.uid(), 'g-x', '{}', 1)$$,
  '42501', null, 'world_saves: insert denied');
select throws_ok($$update public.world_saves set state = '{}' where user_id = auth.uid()$$,
  '42501', null, 'world_saves: update denied');
select throws_ok($$delete from public.world_saves where user_id = auth.uid()$$,
  '42501', null, 'world_saves: delete denied');
select throws_ok($$insert into public.game_records (user_id, game_id, key, value) values (auth.uid(), 'g-x', 'k', 1)$$,
  '42501', null, 'game_records: insert denied');
select throws_ok($$update public.game_records set value = 1000 where user_id = auth.uid()$$,
  '42501', null, 'game_records: update denied');
select throws_ok($$delete from public.game_records where user_id = auth.uid()$$,
  '42501', null, 'game_records: delete denied');

select is((select count(*)::int from public.game_records), 3, 'game_records: everyone''s visible rows, hidden game excluded');
select is((select count(*)::int from public.game_records where game_id = 'g-wh'), 0, 'game_records: hidden game invisible to normal user');

select is(public.user_records('worlda'),
  '[{"game_id":"g-world","key":"catches","value":3,"detail":null},
    {"game_id":"g-world","key":"heaviest","value":12.5,"detail":"붕어"}]'::jsonb,
  'user_records: ordered by game_id, key; hidden excluded');
select is(public.user_records(' WorldA '), public.user_records('worlda'), 'user_records: handle trimmed and lowercased');
select is(public.user_records('없는핸들'), null::jsonb, 'user_records: unknown handle → null');
select is(public.user_records('worldp'), null::jsonb, 'user_records: pending user''s handle → null');

-- ---------------------------------------------------------------- pending user
set local request.jwt.claims = :'PU';

select is((select count(*)::int from public.game_records), 0, 'pending: game_records empty');
select throws_ok($$select count(*) from public.world_saves$$, '42501', null, 'pending: world_saves not readable');
select throws_ok($$select public.user_records('worlda')$$, 'P0001', 'forbidden', 'pending: user_records forbidden');

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = :'ADM';

select is((select count(*)::int from public.game_records where game_id = 'g-wh'), 1, 'admin: hidden game rows visible');
select is(jsonb_array_length(public.user_records('worlda')), 3, 'admin: user_records includes hidden game');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.user_records('worlda')$$, '42501', null, 'anon cannot execute user_records');
reset role;

select * from finish();
rollback;
