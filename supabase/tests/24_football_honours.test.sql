-- 우승·수상·감독 테이블과 적재 (설계 2026-11-25-football-honours-design.md §3.4). db-test.sh가 픽스처를 먼저 적재해 둔다.
begin;
select plan(11);

\set AP '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
\set PE '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'honours-approved@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'honours-pending@example.com');
update public.profiles set status = 'approved', handle = 'honappr' where id = '00000000-0000-0000-0000-0000000000f1';

select has_table('public', 'football_honour_catalog', 'catalog table');
select has_table('public', 'football_managers', 'managers table');
select col_is_pk('public', 'football_manager_spells', array['manager_id', 'team_id', 'from_season'], 'manager spells pk');

select is((select count(*)::int from public.football_honour_catalog), 4, 'catalog loaded');
select is((select count(*)::int from public.football_manager_spells), 1, 'manager spells loaded');
-- 카탈로그 상은 새 수집 행만: honours.csv의 2021 행은 버리고 honours_extra.csv의 2022 행만
select is((select array_agg(season order by season) from public.football_honours where honour = 'award:x-pl-golden-boot'), array[2022], 'catalog award replaced by extra rows');
select is((select count(*)::int from public.football_honours where honour = 'squad:x-wc'), 1, 'squad rows loaded');
select is((select count(*)::int from public.football_honours where honour = 'Q324867'), 2, 'team and player league titles both present');

select throws_ok($$insert into public.football_manager_spells (manager_id, team_id, from_season, to_season) values ('x-wenger', 'Q18741', 2019, 2018)$$,
  '23514', null, 'from_season <= to_season');

set local role authenticated;
select set_config('request.jwt.claims', :'AP', true);
select is((select count(*)::int from public.football_honour_catalog), 4, 'approved user reads catalog');
select set_config('request.jwt.claims', :'PE', true);
select is((select count(*)::int from public.football_managers), 0, 'pending user reads nothing');
reset role;

select * from finish();
rollback;
