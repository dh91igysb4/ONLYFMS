-- 선수·팀 검색 RPC football_search (football-data-layer Task 5, 설계 2026-11-01 §8)
-- scripts/db-test.sh가 미리 적재한 픽스처(supabase/tests/fixtures/football)를 쓴다.
begin;
select plan(37);

\set AP '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}'
\set PE '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f3', 'fs-approved@example.com'),
  ('00000000-0000-0000-0000-0000000000f4', 'fs-pending@example.com');
update public.profiles set status = 'approved', handle = 'fsappr' where id = '00000000-0000-0000-0000-0000000000f3';

-- 개수 제한 확인용: 별칭이 겹치는 선수 25명 (소유자)
insert into public.football_players (id, name_en, popularity)
  select 'x-clamp-' || i, 'Zzclamp ' || i, i from generate_series(1, 25) i;
insert into public.football_aliases (entity_id, alias, lang)
  select 'x-clamp-' || i, 'Zzclamp ' || i, 'en' from generate_series(1, 25) i;

-- 반환 열: 동명이인 구분에 필요한 것만 (경력·소속·생일 전체 없음)
select is(
  (select array_to_string(proargnames, ',') from pg_proc where oid = 'public.football_search(text, text, int)'::regprocedure),
  'p_q,p_kind,p_lim,id,kind,name_ko,name_en,nation_id,position,birth_year,team_kind',
  'search_columns: arguments and result columns');

select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public._football_match_long(text, text)'::regprocedure),
  'search_path=public, extensions,enable_seqscan=off', 'long input matcher forces trigram index');
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public._football_match_short(text, text)'::regprocedure),
  'search_path=public, extensions', 'short input matcher uses default planner');

set local role authenticated;
set local request.jwt.claims = :'AP';

-- ---------------------------------------------------------------- 선수
select is((select count(*)::int from public.football_search('손', 'player') where id = 'Q439722'), 1, 'short input: one korean char');
select is((select id from public.football_search('손흥민', 'player') limit 1), 'Q439722', 'search_ko_full: 손흥민 first');
select is((select count(*)::int from public.football_search('흥민', 'player') where id = 'Q439722'), 1, 'search_ko_partial: 흥민');
select is((select id from public.football_search('son heung min', 'player') limit 1), 'Q439722', 'search_en_variants: son heung min');
select is((select id from public.football_search('Son Heung-min', 'player') limit 1), 'Q439722', 'search_en_variants: Son Heung-min');
select is((select id from public.football_search('SONNY', 'player') limit 1), 'Q439722', 'search_en_variants: alias Sonny');
select is((select name_en from public.football_search('mbappe', 'player') limit 1), 'Kylian Mbappé', 'search_accent: mbappe');
select is((select name_en from public.football_search('MBAPPÉ', 'player') limit 1), 'Kylian Mbappé', 'search_accent: MBAPPÉ');
select results_eq(
  $$select id, birth_year from public.football_search('김민수', 'player')$$,
  $$values ('x-kim-minsu-1990'::text, 1990), ('x-kim-minsu-1995'::text, 1995)$$,
  'search_homonyms: both, popularity order, birth_year (year precision too)');
select results_eq(
  $$select id, kind, name_ko, nation_id, position, team_kind from public.football_search('손흥민', 'player') limit 1$$,
  $$values ('Q439722'::text, 'player'::text, '손흥민'::text, 'Q884'::text, 'FW'::text, null::text)$$,
  'player row fields');
select is((select coalesce(name_ko, 'NULL') from public.football_search('john doe', 'player') limit 1), 'NULL', 'player without korean name');
select is((select count(*)::int from public.football_search('tottenham', 'player')), 0, 'team names not in player search');

-- 부분 일치가 정확·앞부분 일치보다 뒤: 'kim'은 두 김민수(앞부분), 'minsu'는 부분
select is((select count(*)::int from public.football_search('kimmin', 'player')), 2, 'prefix match');

-- 오타: 부분 일치는 아니지만 trigram 유사도로 찾음
select is((select id from public.football_search('tottenham hotspurs', 'team') limit 1), 'Q18741', 'search_fuzzy: trigram similarity');

-- ---------------------------------------------------------------- 팀
select results_eq(
  $$select id, kind, team_kind, position, birth_year from public.football_search('tottenham', 'team')$$,
  $$values ('Q18741'::text, 'team'::text, 'club'::text, null::text, null::int)$$,
  'search_team: club row');
select is((select team_kind from public.football_search('대한민국', 'team') limit 1), 'national', 'search_team: national team');
select is((select count(*)::int from public.football_search('손흥민', 'team')), 0, 'player names not in team search');
select is((select count(*)::int from public.football_search('old fc', 'team')), 1, 'old fc found before retire');
select is(
  (select prosecdef from pg_proc where oid = 'public.football_search(text, text, int)'::regprocedure), true,
  'football_search is security definer (index usable under RLS)');

-- ---------------------------------------------------------------- 개수 제한·빈 입력·이스케이프
select is((select count(*)::int from public.football_search('zzclamp', 'player', 100)), 20, 'search_lim: max 20');
select is((select count(*)::int from public.football_search('zzclamp', 'player', 0)), 1, 'search_lim: min 1');
select is((select count(*)::int from public.football_search('zzclamp', 'player')), 10, 'search_lim: default 10');
select is((select count(*)::int from public.football_search('zzclamp', 'player', null)), 10, 'search_lim: null → 10');
-- 같은 점수(앞부분 일치)에서는 유사도가 먼저: 이름이 짧은 한 자리 번호가 앞, 그 안에서는 유사도가 같아 popularity 순
select results_eq($$select id from public.football_search('zzclamp', 'player', 2)$$, $$values ('x-clamp-9'::text), ('x-clamp-8'::text)$$,
  'same score: similarity, then popularity desc');
select is((select count(*)::int from public.football_search('  - ', 'player')), 0, 'search_empty: only separators');
select is((select count(*)::int from public.football_search(null, 'player')), 0, 'search_empty: null');
select is((select count(*)::int from public.football_search('%', 'player')), 0, 'search_like_escape: %');
select is((select count(*)::int from public.football_search('_', 'team')), 0, 'search_like_escape: _');
select throws_ok($$select * from public.football_search('son', 'coach')$$, 'P0001', 'bad_kind', 'search_bad_kind');

-- ---------------------------------------------------------------- 폐기·권한
reset role;
update public.football_teams set retired = true where id = 'x-old-fc';
set local role authenticated;
set local request.jwt.claims = :'AP';
select is((select count(*)::int from public.football_search('old fc', 'team')), 0, 'search_retired_excluded');

set local request.jwt.claims = :'PE';
select throws_ok($$select * from public.football_search('손흥민', 'player')$$, 'P0001', 'forbidden', 'search_forbidden: pending');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.football_search('손흥민', 'player')$$, '42501', null, 'search_anon_denied');

-- 내부 후보 함수는 정의자 함수 안에서만: 사용자가 직접 불러 RLS를 우회할 수 없다
reset role;
set local role authenticated;
set local request.jwt.claims = :'PE';
select throws_ok($$select * from public._football_match_long('sonheungmin', 'sonheungmin')$$, '42501', null, 'matcher_long not callable');
select throws_ok($$select * from public._football_match_short('손', '손')$$, '42501', null, 'matcher_short not callable');

reset role;
select * from finish();
rollback;
