-- 대회 시기 테이블 football_competition_eras (설계 2026-11-25 §3.7). 테스트 행은 x-t22-* ID.
begin;
select plan(7);

\set AP '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'
\set PE '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'eras-approved@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'eras-pending@example.com');
update public.profiles set status = 'approved', handle = 'erasappr' where id = '00000000-0000-0000-0000-0000000000e1';

select has_table('public', 'football_competition_eras', 'table exists');
select col_is_pk('public', 'football_competition_eras', array['competition_id', 'from_season'], 'pk (competition_id, from_season)');

insert into public.football_nations (id, name_ko, name_en) values ('x-t22-n', '잉글랜드', 'England');
insert into public.football_competitions (id, name_ko, name_en, kind, nation_id, tier) values ('x-t22-c', '옛 1부', 'Old First', 'league', 'x-t22-n', 2);
select lives_ok($$insert into public.football_competition_eras (competition_id, from_season, to_season, nation_id, tier) values
  ('x-t22-c', 1888, 1991, 'x-t22-n', 1), ('x-t22-c', 1992, 2003, 'x-t22-n', 2)$$, 'same competition, two tiers');
select throws_ok($$insert into public.football_competition_eras (competition_id, from_season, nation_id, tier) values ('x-t22-none', 1990, 'x-t22-n', 1)$$,
  '23503', null, 'competition must exist');

set local role authenticated;
select set_config('request.jwt.claims', :'AP', true);
select is((select count(*)::int from public.football_competition_eras where competition_id = 'x-t22-c'), 2, 'approved user reads');
select throws_ok($$insert into public.football_competition_eras (competition_id, from_season, nation_id, tier) values ('x-t22-c', 2004, 'x-t22-n', 1)$$,
  '42501', null, 'approved user cannot write');
select set_config('request.jwt.claims', :'PE', true);
select is((select count(*)::int from public.football_competition_eras where competition_id = 'x-t22-c'), 0, 'pending user reads nothing');
reset role;

select * from finish();
rollback;
