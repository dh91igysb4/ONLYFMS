-- 축구 CSV 적재 (scripts/football/load.sh가 CSV 폴더에서 psql -v version=… 으로 실행한다).
-- 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §7.2:
--   한 트랜잭션. 엔터티(국가·대회·팀·선수)는 upsert하고 CSV에 없는 행은 retired = true(지우지 않음).
--   관계(시즌 참가팀·별칭·외부 ID·경력·국가대표·우승)는 지우고 다시 넣는다. 어디서든 실패하면 전부 롤백.
--   CSV 열 이름이 다르면 header match로 실패한다 (열 정의: scripts/football/schema.ts FILES).
\set ON_ERROR_STOP 1
begin;

create temp table s_nations (id text, name_ko text, name_en text, iso2 text, confederation text) on commit drop;
create temp table s_competitions (id text, name_ko text, name_en text, kind text, nation_id text, tier text) on commit drop;
create temp table s_teams (id text, kind text, name_ko text, name_en text, short_name text, nation_id text, colors text, founded text, retired text) on commit drop;
create temp table s_team_competitions (team_id text, competition_id text, season text) on commit drop;
create temp table s_players (id text, name_ko text, name_en text, birth_date text, birth_precision text, nation_id text, position text,
  position_detail text, foot text, height_cm text, shirt_number text, popularity text, retired text) on commit drop;
create temp table s_aliases (entity_id text, alias text, lang text) on commit drop;
create temp table s_external_ids (entity_id text, source text, external_id text) on commit drop;
create temp table s_spells (player_id text, team_id text, start_date text, end_date text, date_precision text, loan text,
  apps text, goals text, source_ref text) on commit drop;
create temp table s_caps (player_id text, team_id text, caps text, goals text, first_year text, last_year text) on commit drop;
create temp table s_honours (honour text, season text, team_id text, player_id text) on commit drop;

\copy s_nations from 'nations.csv' with (format csv, header match)
\copy s_competitions from 'competitions.csv' with (format csv, header match)
\copy s_teams from 'teams.csv' with (format csv, header match)
\copy s_team_competitions from 'team_competitions.csv' with (format csv, header match)
\copy s_players from 'players.csv' with (format csv, header match)
\copy s_aliases from 'aliases.csv' with (format csv, header match)
\copy s_external_ids from 'external_ids.csv' with (format csv, header match)
\copy s_spells from 'spells.csv' with (format csv, header match)
\copy s_caps from 'caps.csv' with (format csv, header match)
\copy s_honours from 'honours.csv' with (format csv, header match)

-- ---------------------------------------------------------------- 엔터티: upsert 후 사라진 행 폐기
-- 빈 칸은 null. 필수 열(name_en 등)이 비면 not null 제약으로 실패한다.

insert into public.football_nations (id, name_ko, name_en, iso2, confederation, retired)
select id, nullif(name_ko, ''), nullif(name_en, ''), nullif(iso2, ''), nullif(confederation, ''), false from s_nations
on conflict (id) do update set name_ko = excluded.name_ko, name_en = excluded.name_en, iso2 = excluded.iso2,
  confederation = excluded.confederation, retired = false;

insert into public.football_competitions (id, name_ko, name_en, kind, nation_id, tier, retired)
select id, nullif(name_ko, ''), nullif(name_en, ''), kind, nullif(nation_id, ''), nullif(tier, '')::int, false from s_competitions
on conflict (id) do update set name_ko = excluded.name_ko, name_en = excluded.name_en, kind = excluded.kind,
  nation_id = excluded.nation_id, tier = excluded.tier, retired = false;

insert into public.football_teams (id, kind, name_ko, name_en, short_name, nation_id, colors, founded, retired)
select id, kind, nullif(name_ko, ''), nullif(name_en, ''), nullif(short_name, ''), nullif(nation_id, ''),
  nullif(colors, '')::jsonb, nullif(founded, '')::int, coalesce(nullif(retired, '')::boolean, false) from s_teams
on conflict (id) do update set kind = excluded.kind, name_ko = excluded.name_ko, name_en = excluded.name_en,
  short_name = excluded.short_name, nation_id = excluded.nation_id, colors = excluded.colors, founded = excluded.founded,
  retired = excluded.retired;

insert into public.football_players (id, name_ko, name_en, birth_date, birth_precision, nation_id, position, position_detail,
  foot, height_cm, shirt_number, popularity, retired)
select id, nullif(name_ko, ''), nullif(name_en, ''), nullif(birth_date, ''), nullif(birth_precision, ''), nullif(nation_id, ''),
  nullif(position, ''), nullif(position_detail, ''), nullif(foot, ''), nullif(height_cm, '')::int, nullif(shirt_number, '')::int,
  coalesce(nullif(popularity, '')::int, 0), coalesce(nullif(retired, '')::boolean, false) from s_players
on conflict (id) do update set name_ko = excluded.name_ko, name_en = excluded.name_en, birth_date = excluded.birth_date,
  birth_precision = excluded.birth_precision, nation_id = excluded.nation_id, position = excluded.position,
  position_detail = excluded.position_detail, foot = excluded.foot, height_cm = excluded.height_cm,
  shirt_number = excluded.shirt_number, popularity = excluded.popularity, retired = excluded.retired;

create temp table s_retired (t text, n int) on commit drop;
with r as (update public.football_nations x set retired = true
  where not x.retired and not exists (select 1 from s_nations s where s.id = x.id) returning 1)
insert into s_retired select 'nations', count(*) from r;
with r as (update public.football_competitions x set retired = true
  where not x.retired and not exists (select 1 from s_competitions s where s.id = x.id) returning 1)
insert into s_retired select 'competitions', count(*) from r;
with r as (update public.football_teams x set retired = true
  where not x.retired and not exists (select 1 from s_teams s where s.id = x.id) returning 1)
insert into s_retired select 'teams', count(*) from r;
with r as (update public.football_players x set retired = true
  where not x.retired and not exists (select 1 from s_players s where s.id = x.id) returning 1)
insert into s_retired select 'players', count(*) from r;

-- ---------------------------------------------------------------- 관계: 통째 교체

delete from public.football_honours;
delete from public.football_caps;
delete from public.football_spells;
delete from public.football_external_ids;
delete from public.football_aliases;
delete from public.football_team_competitions;

insert into public.football_team_competitions (team_id, competition_id, season)
select team_id, competition_id, season::int from s_team_competitions;

insert into public.football_aliases (entity_id, alias, lang)
select entity_id, alias, nullif(lang, '') from s_aliases;

insert into public.football_external_ids (entity_id, source, external_id)
select entity_id, source, external_id from s_external_ids;

insert into public.football_spells (source_ref, player_id, team_id, start_date, end_date, date_precision, loan, apps, goals)
select source_ref, player_id, team_id, start_date, nullif(end_date, ''), date_precision, loan::boolean,
  nullif(apps, '')::int, nullif(goals, '')::int from s_spells;

insert into public.football_caps (player_id, team_id, caps, goals, first_year, last_year)
select player_id, team_id, nullif(caps, '')::int, nullif(goals, '')::int, nullif(first_year, '')::int, nullif(last_year, '')::int from s_caps;

insert into public.football_honours (honour, season, team_id, player_id)
select honour, season::int, nullif(team_id, ''), nullif(player_id, '') from s_honours;

-- ---------------------------------------------------------------- 메타

insert into public.football_meta (key, value) values ('dataset_version', :'version'), ('loaded_at', now()::text)
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------- 결과 (커밋 전에 출력)
select t as "테이블", total as "행 수", coalesce(r.n, 0) as "이번에 폐기"
from (
  select 'nations' t, 1 o, count(*) total from public.football_nations
  union all select 'competitions', 2, count(*) from public.football_competitions
  union all select 'teams', 3, count(*) from public.football_teams
  union all select 'players', 4, count(*) from public.football_players
  union all select 'team_competitions', 5, count(*) from public.football_team_competitions
  union all select 'aliases', 6, count(*) from public.football_aliases
  union all select 'external_ids', 7, count(*) from public.football_external_ids
  union all select 'spells', 8, count(*) from public.football_spells
  union all select 'caps', 9, count(*) from public.football_caps
  union all select 'honours', 10, count(*) from public.football_honours
) c left join s_retired r using (t)
order by o;

commit;

-- 검색 인덱스 통계 갱신 (트랜잭션 밖)
analyze public.football_aliases, public.football_players, public.football_teams, public.football_spells;
