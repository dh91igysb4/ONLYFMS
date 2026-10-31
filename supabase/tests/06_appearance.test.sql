-- 계정별 화면 설정: palette/appearance 컬럼과 set_appearance RPC
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.com');

select is(
  (select palette || '/' || appearance from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'classic/dark', 'defaults: new profile is classic/dark');

-- ---------------------------------------------------------------- A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$select public.set_appearance('navy', 'light')$$, 'set_appearance: valid values succeed');

select throws_ok($$select public.set_appearance('neon', 'dark')$$, 'P0001', 'appearance_invalid',
  'set_appearance: unknown palette is rejected');
select throws_ok($$select public.set_appearance('navy', 'dim')$$, 'P0001', 'appearance_invalid',
  'set_appearance: unknown appearance is rejected');
select throws_ok($$select public.set_appearance(null, 'dark')$$, 'P0001', 'appearance_invalid',
  'set_appearance: null palette is rejected');
select throws_ok($$select public.set_appearance('navy', null)$$, 'P0001', 'appearance_invalid',
  'set_appearance: null appearance is rejected');

select throws_ok($$update public.profiles set palette = 'mono' where id = auth.uid()$$, '42501', null,
  'direct UPDATE of palette is denied');

-- ---------------------------------------------------------------- anonymous (no jwt)
set local request.jwt.claims = '';
select throws_ok($$select public.set_appearance('navy', 'dark')$$, 'P0001', 'forbidden',
  'set_appearance: no uid is forbidden');

-- ---------------------------------------------------------------- verify as superuser
reset role;
select is(
  (select palette || '/' || appearance from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'navy/light', 'set_appearance: A row updated');
select is(
  (select palette || '/' || appearance from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'classic/dark', 'set_appearance: B row untouched');

-- 프로필 행이 없는 uid
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}';
select throws_ok($$select public.set_appearance('navy', 'dark')$$, 'P0001', 'forbidden',
  'set_appearance: no profile row is forbidden');
reset role;

select * from finish();
rollback;
