-- 홈 레이아웃: profiles.home_layout 컬럼과 set_home_layout RPC
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@example.com');
update public.profiles set status = 'approved' where id in
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2');

select is(
  (select home_layout from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  null::jsonb, 'default: new profile has null home_layout');

-- ---------------------------------------------------------------- A (approved)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$select public.set_home_layout('[{"id":"daily","on":true},{"id":"elo","on":false}]')$$,
  'set_home_layout: valid layout succeeds');
select is(
  (select home_layout from public.my_profile()),
  '[{"id":"daily","on":true},{"id":"elo","on":false}]'::jsonb,
  'my_profile() returns the saved layout');

select throws_ok($$select public.set_home_layout('{}')$$, 'P0001', 'home_layout_invalid', 'invalid: object');
select throws_ok($$select public.set_home_layout('[]')$$, 'P0001', 'home_layout_invalid', 'invalid: empty array');
select throws_ok(
  $$select public.set_home_layout((select jsonb_agg(jsonb_build_object('id', 'b' || i, 'on', true)) from generate_series(1, 33) i))$$,
  'P0001', 'home_layout_invalid', 'invalid: 33 elements');
select throws_ok($$select public.set_home_layout('[{"id":"daily"}]')$$, 'P0001', 'home_layout_invalid', 'invalid: missing on');
select throws_ok($$select public.set_home_layout('[{"id":"daily","on":true,"x":1}]')$$, 'P0001', 'home_layout_invalid', 'invalid: extra key');
select throws_ok($$select public.set_home_layout('[{"id":"Daily","on":true}]')$$, 'P0001', 'home_layout_invalid', 'invalid: uppercase id');
select throws_ok($$select public.set_home_layout('[{"id":"daily","on":"yes"}]')$$, 'P0001', 'home_layout_invalid', 'invalid: non-boolean on');
select throws_ok($$select public.set_home_layout('[{"id":"daily","on":true},{"id":"daily","on":false}]')$$, 'P0001', 'home_layout_invalid', 'invalid: duplicate id');

select is(
  (select home_layout from public.my_profile()),
  '[{"id":"daily","on":true},{"id":"elo","on":false}]'::jsonb,
  'rejected calls leave the saved layout unchanged');

select throws_ok($$update public.profiles set home_layout = '[]' where id = auth.uid()$$, '42501', null,
  'direct UPDATE of home_layout is denied');

-- ---------------------------------------------------------------- B untouched, verified as superuser
reset role;
select is(
  (select home_layout from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  null::jsonb, 'B row untouched');

-- ---------------------------------------------------------------- A reset to null
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_home_layout(null)$$, 'set_home_layout(null) succeeds');
select is((select home_layout from public.my_profile()), null::jsonb, 'null resets to default');

-- ---------------------------------------------------------------- pending
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok($$select public.set_home_layout('[{"id":"daily","on":true}]')$$, 'P0001', 'forbidden',
  'pending user is forbidden');

-- ---------------------------------------------------------------- no jwt
set local request.jwt.claims = '';
select throws_ok($$select public.set_home_layout('[{"id":"daily","on":true}]')$$, 'P0001', 'forbidden',
  'no uid is forbidden');

-- ---------------------------------------------------------------- anon role
reset role;
set local role anon;
select throws_ok($$select public.set_home_layout('[{"id":"daily","on":true}]')$$, '42501', null,
  'anon role has no execute privilege');
reset role;

select * from finish();
rollback;
