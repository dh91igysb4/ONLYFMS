-- profiles, 승인제, 관리자 함수 (Task 4)
begin;
select plan(47);

-- 테스트 사용자: u1·u2 pending, u3·u4 approved, u5 rejected, adm admin(approved)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'u1@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'u2@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'u3@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'u4@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'u5@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.com');

-- trigger_creates_pending_profile
select is(
  (select count(*)::int from public.profiles where status = 'pending' and handle is null and is_admin = false),
  6, 'trigger_creates_pending_profile: every auth.users insert creates a pending profile with null handle');
select is(
  (select status::text from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  'pending', 'trigger_creates_pending_profile: status defaults to pending');

-- 대시보드에서 하는 일(초기 상태)을 superuser로 흉내낸다
update public.profiles set status = 'approved', approved_at = now(), handle = 'three'
  where id = '00000000-0000-0000-0000-000000000003';
update public.profiles set status = 'approved', approved_at = now(), handle = 'four'
  where id = '00000000-0000-0000-0000-000000000004';
update public.profiles set status = 'rejected', handle = 'five'
  where id = '00000000-0000-0000-0000-000000000005';
update public.profiles set status = 'approved', approved_at = now(), is_admin = true, handle = 'boss'
  where id = '00000000-0000-0000-0000-0000000000ad';

-- ---------------------------------------------------------------- u1 (pending)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- set_handle_normalizes_case_and_trim
select is(public.set_handle(' Kane '), 'kane', 'set_handle_normalizes_case_and_trim: trims and lowercases');
select is((public.my_profile()).handle::text, 'kane', 'set_handle_normalizes_case_and_trim: stored lowercase');

-- set_handle_only_once
select throws_ok($$select public.set_handle('other')$$, 'P0001', 'handle_already_set',
  'set_handle_only_once: second call is rejected');

-- profiles_direct_update_denied
select throws_ok($$update public.profiles set status = 'approved' where id = auth.uid()$$, '42501', null,
  'profiles_direct_update_denied: own UPDATE is denied');
select throws_ok($$update public.profiles set handle = 'zzz' where id = auth.uid()$$, '42501', null,
  'profiles_direct_update_denied: UPDATE of a public column is denied too');
select throws_ok($$insert into public.profiles (id) values (gen_random_uuid())$$, '42501', null,
  'profiles_direct_update_denied: INSERT is denied');
select throws_ok($$delete from public.profiles where id = auth.uid()$$, '42501', null,
  'profiles_direct_update_denied: DELETE is denied');

-- helper flags
select is(public.is_approved(), false, 'is_approved() is false for a pending user');
select is(public.is_admin(), false, 'is_admin() is false for a non-admin');

-- pending_cannot_read_others
select is((select count(*)::int from (select id, handle, created_at from public.profiles) p), 1,
  'pending_cannot_read_others: pending user sees only own row');
select is((select id from (select id, handle, created_at from public.profiles) p),
  '00000000-0000-0000-0000-000000000001'::uuid, 'pending_cannot_read_others: the visible row is own');
select is((public.my_profile()).status::text, 'pending', 'my_profile() returns own full row (status)');

-- ---------------------------------------------------------------- u2 (pending)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok($$select public.set_handle('KANE')$$, 'P0001', 'handle_taken',
  'set_handle_normalizes_case_and_trim: KANE collides with kane');
select throws_ok($$select public.set_handle('  kane')$$, 'P0001', 'handle_taken',
  'set_handle_normalizes_case_and_trim: padded kane collides with kane');

-- set_handle_rejects_invalid
select throws_ok($$select public.set_handle('ab')$$, 'P0001', 'handle_invalid', 'set_handle_rejects_invalid: too short');
select throws_ok($$select public.set_handle('한글')$$, 'P0001', 'handle_invalid', 'set_handle_rejects_invalid: hangul');
select throws_ok($$select public.set_handle('a b')$$, 'P0001', 'handle_invalid', 'set_handle_rejects_invalid: inner space');
select throws_ok($$select public.set_handle('abcdefghijklmnopq')$$, 'P0001', 'handle_invalid', 'set_handle_rejects_invalid: 17 chars');
select throws_ok($$select public.set_handle(null)$$, 'P0001', 'handle_invalid', 'set_handle_rejects_invalid: null');
select is((public.my_profile()).handle, null, 'set_handle_rejects_invalid: handle still null after failures');

-- ---------------------------------------------------------------- u3 (approved)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- approved_reads_only_public_columns_of_approved
select is(public.is_approved(), true, 'is_approved() is true for an approved user');
select set_eq(
  $$select id from public.profiles$$,
  $$values ('00000000-0000-0000-0000-000000000003'::uuid), ('00000000-0000-0000-0000-000000000004'::uuid),
           ('00000000-0000-0000-0000-0000000000ad'::uuid)$$,
  'approved_reads_only_public_columns_of_approved: sees approved users only (not pending/rejected)');
select is((select handle::text from public.profiles where id = '00000000-0000-0000-0000-000000000004'), 'four',
  'approved_reads_only_public_columns_of_approved: handle is readable');
select throws_ok($$select status from public.profiles$$, '42501', null,
  'approved_reads_only_public_columns_of_approved: status is not readable');
select throws_ok($$select is_admin from public.profiles$$, '42501', null,
  'approved_reads_only_public_columns_of_approved: is_admin is not readable');
select throws_ok($$select * from public.profiles$$, '42501', null,
  'approved_reads_only_public_columns_of_approved: select * is denied');

-- admin_functions_forbidden_for_non_admin
select throws_ok($$select * from public.admin_list_users('pending')$$, 'P0001', 'forbidden',
  'admin_functions_forbidden_for_non_admin: admin_list_users');
select throws_ok($$select public.admin_set_status('00000000-0000-0000-0000-000000000002', 'approved')$$, 'P0001', 'forbidden',
  'admin_functions_forbidden_for_non_admin: admin_set_status');
select throws_ok($$select public.admin_set_handle('00000000-0000-0000-0000-000000000002', 'hacked')$$, 'P0001', 'forbidden',
  'admin_functions_forbidden_for_non_admin: admin_set_handle');

-- ---------------------------------------------------------------- adm (admin)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';

select is(public.is_admin(), true, 'is_admin() is true for an admin');

-- admin_list_users_returns_email
select set_eq(
  $$select id, email from public.admin_list_users('pending')$$,
  $$values ('00000000-0000-0000-0000-000000000001'::uuid, 'u1@example.com'),
           ('00000000-0000-0000-0000-000000000002'::uuid, 'u2@example.com')$$,
  'admin_list_users_returns_email: pending users with email');
select is((select handle::text from public.admin_list_users('pending') where id = '00000000-0000-0000-0000-000000000001'),
  'kane', 'admin_list_users_returns_email: handle included');

-- admin_cannot_change_self
select throws_ok($$select public.admin_set_status('00000000-0000-0000-0000-0000000000ad', 'rejected')$$, 'P0001', 'cannot_change_self',
  'admin_cannot_change_self: admin_set_status on self is rejected');

-- admin_approve_sets_approved_at_and_by
select lives_ok($$select public.admin_set_status('00000000-0000-0000-0000-000000000002', 'approved')$$,
  'admin_approve_sets_approved_at_and_by: approve call succeeds');

-- admin_set_handle normalizes and checks
select lives_ok($$select public.admin_set_handle('00000000-0000-0000-0000-000000000004', ' Four_New ')$$,
  'admin_set_handle: succeeds with normalization');
select throws_ok($$select public.admin_set_handle('00000000-0000-0000-0000-000000000003', 'KANE')$$, 'P0001', 'handle_taken',
  'admin_set_handle: duplicate is handle_taken');
select throws_ok($$select public.admin_set_handle('00000000-0000-0000-0000-000000000003', 'x')$$, 'P0001', 'handle_invalid',
  'admin_set_handle: invalid is handle_invalid');

-- ---------------------------------------------------------------- anon
reset role;
set local request.jwt.claims = '';
set local role anon;
select throws_ok($$select id from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select public.set_handle('anonymous')$$, '42501', null, 'anon cannot execute set_handle');

-- ---------------------------------------------------------------- verify as superuser
reset role;
select ok(
  (select approved_at is not null and approved_by = '00000000-0000-0000-0000-0000000000ad'::uuid and status = 'approved'
     from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
  'admin_approve_sets_approved_at_and_by: status, approved_at, approved_by recorded');
select is((select handle::text from public.profiles where id = '00000000-0000-0000-0000-000000000004'), 'four_new',
  'admin_set_handle: stored lowercase and trimmed');
select is((select status::text from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'pending',
  'profiles_direct_update_denied: own status unchanged');


-- rejected_admin_loses_admin: is_admin=true라도 승인 상태가 아니면 관리자가 아니다
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ae', 'exadmin@example.com');
update public.profiles set status = 'rejected', is_admin = true, handle = 'exboss'
  where id = '00000000-0000-0000-0000-0000000000ae';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ae","role":"authenticated"}';
select is(public.is_admin(), false, 'rejected_admin_loses_admin: is_admin() is false');
select throws_ok($$select * from public.admin_list_users('pending')$$, 'P0001', 'forbidden',
  'rejected_admin_loses_admin: admin_list_users forbidden');
select throws_ok($$select public.admin_set_status('00000000-0000-0000-0000-000000000002', 'rejected')$$, 'P0001', 'forbidden',
  'rejected_admin_loses_admin: admin_set_status forbidden');
reset role;

select * from finish();
rollback;
