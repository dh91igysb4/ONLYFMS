-- 축구 데이터 테이블·RLS·이름 정규화 (football-data-layer Task 3, 설계 2026-11-01 §6)
-- 테스트용 행은 x-t3-* ID로 슈퍼유저(= 적재 스크립트의 소유자 연결)가 직접 넣는다.
-- 픽스처 적재(Task 4) 뒤에도 깨지지 않도록 전체 행 수가 아니라 이 ID들로 확인한다.
begin;
select plan(46);

\set AP '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
\set PE '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'fb-approved@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'fb-pending@example.com');
update public.profiles set status = 'approved', handle = 'fbappr' where id = '00000000-0000-0000-0000-0000000000f1';

-- ---------------------------------------------------------------- 구조
select has_extension('pg_trgm', 'pg_trgm extension');
select has_extension('unaccent', 'unaccent extension');
select has_table('public', 'football_nations', 'tables_exist: football_nations');
select has_table('public', 'football_competitions', 'tables_exist: football_competitions');
select has_table('public', 'football_teams', 'tables_exist: football_teams');
select has_table('public', 'football_team_competitions', 'tables_exist: football_team_competitions');
select has_table('public', 'football_players', 'tables_exist: football_players');
select has_table('public', 'football_aliases', 'tables_exist: football_aliases');
select has_table('public', 'football_external_ids', 'tables_exist: football_external_ids');
select has_table('public', 'football_spells', 'tables_exist: football_spells');
select has_table('public', 'football_caps', 'tables_exist: football_caps');
select has_table('public', 'football_honours', 'tables_exist: football_honours');
select has_table('public', 'football_meta', 'tables_exist: football_meta');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'football\_%' and c.relrowsecurity),
  11, 'rls_enabled: all 11 football tables');
select col_is_pk('public', 'football_spells', 'source_ref', 'spells pk is source_ref');
select has_index('public', 'football_aliases', 'football_aliases_alias_norm_trgm', 'alias_norm trigram index');

-- ---------------------------------------------------------------- 이름 정규화
select is(public.football_norm('Son Heung-min'), 'sonheungmin', 'norm_examples: hyphen, space, case');
select is(public.football_norm('Mbappé'), 'mbappe', 'norm_examples: accent');
select is(public.football_norm('손 흥민'), '손흥민', 'norm_examples: korean space');
select is(public.football_norm('Ødegaard'), 'odegaard', 'norm_examples: Ø');
select is(public.football_norm('O''Shea'), 'oshea', 'norm_examples: apostrophe');
select is(public.football_norm('N’Golo Kanté · Jr.'), 'ngolokantejr', 'norm_examples: curly apostrophe, middle dot, period');
select is(public.football_norm(null), null, 'norm_examples: null');
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'public.football_norm(text)'::regprocedure),
  'i', 'football_norm is immutable');

-- ---------------------------------------------------------------- 행 넣기 (소유자)
insert into public.football_nations (id, name_ko, name_en, iso2) values ('x-t3-nat', '테스트국', 'Testland', 'tt');
insert into public.football_competitions (id, name_ko, name_en, kind, nation_id, tier) values ('x-t3-league', '테스트리그', 'Test League', 'league', 'x-t3-nat', 1);
insert into public.football_teams (id, kind, name_en, nation_id) values ('x-t3-club', 'club', 'Test FC', 'x-t3-nat'), ('x-t3-nt', 'national', 'Testland NT', 'x-t3-nat');
insert into public.football_players (id, name_ko, name_en, birth_date, birth_precision, nation_id, position, popularity)
  values ('x-t3-p', '테스트 선수', 'Test Plàyer', '1990-01-02', 'day', 'x-t3-nat', 'MF', 50),
         ('x-t3-q', null, 'Year Only', '1985', 'year', null, null, 0);
insert into public.football_aliases (entity_id, alias, lang) values ('x-t3-p', 'Test Plàyer', 'en');
insert into public.football_spells (source_ref, player_id, team_id, start_date, end_date, date_precision, loan)
  values ('x-t3-s1', 'x-t3-p', 'x-t3-club', '2010-07-01', null, 'day', false),
         ('x-t3-s2', 'x-t3-q', 'x-t3-club', '2003', '2005', 'year', true);
insert into public.football_honours (honour, season, team_id) values ('x-t3-league', 2020, 'x-t3-club');
insert into public.football_meta (key, value) values ('x-t3-key', 'v');

select is((select alias_norm from public.football_aliases where entity_id = 'x-t3-p'), 'testplayer', 'alias_norm_generated');

-- ---------------------------------------------------------------- 제약
select throws_ok($$insert into public.football_players (id, name_en, birth_date, birth_precision) values ('x-t3-bad1', 'B', '1992-07-08', 'year')$$,
  '23514', null, 'date_checks: year precision with full date');
select throws_ok($$insert into public.football_players (id, name_en, birth_date, birth_precision) values ('x-t3-bad2', 'B', '1992', 'day')$$,
  '23514', null, 'date_checks: day precision with year only');
select throws_ok($$insert into public.football_players (id, name_en, birth_date) values ('x-t3-bad3', 'B', '1992-07-08')$$,
  '23514', null, 'date_checks: date without precision');
select throws_ok($$insert into public.football_spells (source_ref, player_id, team_id, start_date, end_date, date_precision, loan)
  values ('x-t3-bad', 'x-t3-p', 'x-t3-club', '2010', '2011-06-30', 'year', false)$$,
  '23514', null, 'date_checks: spell end date precision');
select throws_ok($$insert into public.football_honours (honour, season, team_id) values ('x-t3-league', 2020, 'x-t3-club')$$,
  '23505', null, 'honours unique nulls not distinct');
select throws_ok($$insert into public.football_teams (id, kind, name_en) values ('x-t3-bad', 'other', 'B')$$,
  '23514', null, 'team kind check');
select throws_ok($$insert into public.football_players (id, name_en, popularity) values ('x-t3-bad4', 'B', 101)$$,
  '23514', null, 'popularity check');
select throws_ok($$insert into public.football_players (id, name_en, position) values ('x-t3-bad5', 'B', 'ST')$$,
  '23514', null, 'position check');
select throws_ok($$insert into public.football_spells (source_ref, player_id, team_id, start_date, date_precision, loan)
  values ('x-t3-bad6', 'x-nobody', 'x-t3-club', '2010', 'year', false)$$,
  '23503', null, 'spells player fk');

-- ---------------------------------------------------------------- 승인 사용자: 읽기만
set local role authenticated;
set local request.jwt.claims = :'AP';
select is((select count(*)::int from public.football_players where id in ('x-t3-p', 'x-t3-q')), 2, 'approved_reads: players');
select is((select count(*)::int from public.football_spells where player_id = 'x-t3-p'), 1, 'approved_reads: spells');
select is((select value from public.football_meta where key = 'x-t3-key'), 'v', 'approved_reads: meta');
select is(public.football_norm('Ab-c'), 'abc', 'approved can execute football_norm');
select throws_ok($$insert into public.football_nations (id, name_en) values ('x-t3-w', 'W')$$, '42501', null, 'no_writes: insert nations');
select throws_ok($$update public.football_players set popularity = 100 where id = 'x-t3-p'$$, '42501', null, 'no_writes: update players');
select throws_ok($$delete from public.football_aliases$$, '42501', null, 'no_writes: delete aliases');
select throws_ok($$insert into public.football_meta (key, value) values ('k', 'v')$$, '42501', null, 'no_writes: insert meta');

-- ---------------------------------------------------------------- 승인 대기 사용자: 0행
set local request.jwt.claims = :'PE';
select is((select count(*)::int from public.football_players), 0, 'pending sees no players');
select is((select count(*)::int from public.football_nations), 0, 'pending sees no nations');

-- ---------------------------------------------------------------- 익명: 권한 없음
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.football_players$$, '42501', null, 'anon_denied: players');
select throws_ok($$select * from public.football_aliases$$, '42501', null, 'anon_denied: aliases');

reset role;
select * from finish();
rollback;
