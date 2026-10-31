-- 초대 코드로 참가, 서버 시각 (Task 11)
begin;
select plan(13);

\set PU '{"sub":"00000000-0000-0000-0000-0000000000a0","role":"authenticated"}'
\set A1 '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'
\set A2 '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'pu@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'a1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.com');
update public.profiles set status = 'approved', handle = 'aone' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'approved', handle = 'atwo' where id = '00000000-0000-0000-0000-0000000000a2';

insert into public.game_modes (game_id, daily, contest, free) values ('open-game', false, true, true);
insert into public.contests (id, kind, title, created_by, visibility, invite_code, starts_at, ends_at, cancelled_at) values
  ('f0000000-0000-0000-0000-000000000001', 'friendly', 'inv',   '00000000-0000-0000-0000-0000000000a1', 'invite', 'abcde12345',
     now() + interval '1 hour', now() + interval '2 hours', null),
  ('f0000000-0000-0000-0000-000000000002', 'friendly', 'gone',  '00000000-0000-0000-0000-0000000000a1', 'invite', 'gone123456',
     now() + interval '1 hour', now() + interval '2 hours', now()),
  ('f0000000-0000-0000-0000-000000000003', 'friendly', 'ended', '00000000-0000-0000-0000-0000000000a1', 'invite', 'ended12345',
     now() - interval '2 hours', now() - interval '1 hour', null);

set local role authenticated;

set local request.jwt.claims = :'A2';
select is(public.join_by_invite_code('  ABCDE12345 '), 'f0000000-0000-0000-0000-000000000001'::uuid,
  'join_by_code: approved user joins (case-insensitive, trimmed) and gets the contest id');
select is((select count(*)::int from public.contest_entries
            where contest_id = 'f0000000-0000-0000-0000-000000000001' and user_id = auth.uid()), 1,
  'join_by_code: entry created');
select lives_ok($$select public.join_by_invite_code('abcde12345')$$, 'join_by_code: idempotent');
select is((select count(*)::int from public.contest_entries
            where contest_id = 'f0000000-0000-0000-0000-000000000001' and user_id = auth.uid()), 1,
  'join_by_code: still one entry after second join');

select throws_ok($$select public.join_by_invite_code('zzzzzzzzzz')$$, 'P0001', 'invite_required', 'join_by_code: wrong code');
select throws_ok($$select public.join_by_invite_code('')$$, 'P0001', 'invite_required', 'join_by_code: empty code');
select throws_ok($$select public.join_by_invite_code(null)$$, 'P0001', 'invite_required', 'join_by_code: null code');
select throws_ok($$select public.join_by_invite_code('gone123456')$$, 'P0001', 'contest_closed', 'join_by_code: cancelled contest');
select throws_ok($$select public.join_by_invite_code('ended12345')$$, 'P0001', 'contest_closed', 'join_by_code: ended contest');
select cmp_ok(public.server_now(), '>', 1e12::double precision, 'server_now: epoch milliseconds');

set local request.jwt.claims = :'PU';
select throws_ok($$select public.join_by_invite_code('abcde12345')$$, 'P0001', 'forbidden', 'join_by_code: pending user forbidden');

set local role anon;
select throws_ok($$select public.join_by_invite_code('abcde12345')$$, '42501', null, 'join_by_code: anon denied');
select throws_ok($$select public.server_now()$$, '42501', null, 'server_now: anon denied');

select * from finish();
rollback;
