-- 축구 공통 데이터 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §6)
-- 원본은 data/football/*.csv. 적재는 scripts/football/load.sh가 소유자 연결(RLS 우회)로만 한다.
-- 승인 사용자는 읽기만, 쓰기 정책은 없다. 엔터티 ID는 위키데이터 QID 또는 x-… (영구 고정).

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- 이름 정규화
-- 소문자 + 악센트 제거 + 공백·마침표·아포스트로피·가운뎃점·하이픈 제거. 생성 열과 인덱스에 쓰려고 immutable로 둔다
-- (unaccent()는 사전 조회 때문에 stable이므로 사전을 명시한 2인자 형식을 감싼다).
create function public.football_norm(x text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, x)), '[[:space:].''’·-]', '', 'g')
$$;

-- 이름을 단어로 나눠 각각 정규화한 배열. 성만으로 찾기('kane' → Harry Kane)에 쓴다(football_search의 앞부분 일치)
create function public.football_words(x text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array_agg(public.football_norm(w)) filter (where public.football_norm(w) <> ''), '{}')
  from unnest(regexp_split_to_array(x, '[[:space:]-]+')) w
$$;

-- ---------------------------------------------------------------- 엔터티 (폐기: retired)

create table public.football_nations (
  id text primary key,
  name_ko text,
  name_en text not null,
  iso2 text,
  confederation text,
  retired boolean not null default false
);

create table public.football_competitions (
  id text primary key,
  name_ko text not null,
  name_en text not null,
  kind text not null check (kind in ('league', 'cup', 'continental', 'international')),
  nation_id text references public.football_nations,
  tier int,
  retired boolean not null default false
);

create table public.football_teams (
  id text primary key,
  kind text not null check (kind in ('club', 'national')),
  name_ko text,
  name_en text not null,
  short_name text,
  nation_id text references public.football_nations,
  colors jsonb check (colors is null or jsonb_typeof(colors) = 'array'),
  founded int,
  retired boolean not null default false
);

create table public.football_players (
  id text primary key,
  name_ko text,
  name_en text not null,
  -- 정밀도가 year면 'YYYY', day면 'YYYY-MM-DD'
  birth_date text,
  birth_precision text check (birth_precision in ('day', 'year')),
  nation_id text references public.football_nations,
  position text check (position in ('GK', 'DF', 'MF', 'FW')),
  position_detail text,
  foot text check (foot in ('left', 'right', 'both')),
  height_cm int,
  shirt_number int,
  popularity int not null default 0 check (popularity between 0 and 100),
  retired boolean not null default false,
  constraint football_players_birth_check check (
    (birth_date is null and birth_precision is null)
    or (birth_date is not null and birth_precision is not null and (
      (birth_precision = 'day' and birth_date ~ '^\d{4}-\d{2}-\d{2}$')
      or (birth_precision = 'year' and birth_date ~ '^\d{4}$')))
  )
);

-- ---------------------------------------------------------------- 관계 (적재 때 통째 교체)

create table public.football_team_competitions (
  team_id text not null references public.football_teams,
  competition_id text not null references public.football_competitions,
  season int not null,
  primary key (team_id, competition_id, season)
);

-- entity_id는 선수·팀 어느 쪽이든 되므로 FK 없음 (CSV 검사가 존재를 확인한다)
create table public.football_aliases (
  entity_id text not null,
  alias text not null,
  lang text,
  alias_norm text generated always as (public.football_norm(alias)) stored,
  alias_words text[] generated always as (public.football_words(alias)) stored,
  primary key (entity_id, alias)
);

create table public.football_external_ids (
  entity_id text not null,
  source text not null,
  external_id text not null,
  primary key (source, external_id)
);

-- source_ref = 위키데이터 경력 진술 ID (직접 입력은 manual:…)
create table public.football_spells (
  source_ref text primary key,
  player_id text not null references public.football_players,
  team_id text not null references public.football_teams,
  start_date text not null,
  end_date text,
  date_precision text not null check (date_precision in ('day', 'year')),
  loan boolean not null,
  apps int,
  goals int,
  constraint football_spells_date_check check (
    (date_precision = 'day' and start_date ~ '^\d{4}-\d{2}-\d{2}$' and (end_date is null or end_date ~ '^\d{4}-\d{2}-\d{2}$'))
    or (date_precision = 'year' and start_date ~ '^\d{4}$' and (end_date is null or end_date ~ '^\d{4}$'))
  )
);

create table public.football_caps (
  player_id text not null references public.football_players,
  team_id text not null references public.football_teams,
  caps int,
  goals int,
  first_year int,
  last_year int,
  primary key (player_id, team_id)
);

-- honour: 대회 우승이면 대회 id(team_id), 개인상이면 award:<QID>(player_id)
create table public.football_honours (
  id bigint generated always as identity primary key,
  honour text not null,
  season int not null,
  team_id text references public.football_teams,
  player_id text references public.football_players,
  constraint football_honours_unique unique nulls not distinct (honour, season, team_id, player_id)
);

-- dataset_version, loaded_at
create table public.football_meta (
  key text primary key,
  value text not null
);

-- ---------------------------------------------------------------- 인덱스

create index football_aliases_alias_norm_trgm on public.football_aliases using gin (alias_norm extensions.gin_trgm_ops);
create index football_spells_player on public.football_spells (player_id);
create index football_spells_team on public.football_spells (team_id);
create index football_team_competitions_comp on public.football_team_competitions (competition_id, season);
create index football_honours_player on public.football_honours (player_id);
create index football_honours_team on public.football_honours (team_id);

-- ---------------------------------------------------------------- 권한: 승인 사용자 읽기만

do $$
declare t text;
begin
  foreach t in array array['nations', 'competitions', 'teams', 'players', 'team_competitions', 'aliases',
                           'external_ids', 'spells', 'caps', 'honours', 'meta'] loop
    execute format('alter table public.football_%s enable row level security', t);
    execute format('revoke all on table public.football_%s from public, anon, authenticated', t);
    execute format('grant select on table public.football_%s to authenticated', t);
    -- (select …)로 감싸 쿼리당 한 번만 계산한다(행마다 부르면 별칭 6만 행 검색이 수백 ms)
    execute format('create policy football_%1$s_select on public.football_%1$s for select to authenticated using ((select public.is_approved()))', t);
  end loop;
end
$$;

revoke all on sequence public.football_honours_id_seq from public, anon, authenticated;
revoke execute on function public.football_norm(text) from public, anon;
grant execute on function public.football_norm(text) to authenticated;
revoke execute on function public.football_words(text) from public, anon;
grant execute on function public.football_words(text) to authenticated;
