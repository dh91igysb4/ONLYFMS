-- 우승·수상·감독 (설계 docs/superpowers/specs/2026-11-25-football-honours-design.md §3.4).
-- 카탈로그: 수집 단위 목록이자 화면 이름표(대회 우승·개인상·대표팀 대회·감독). 감독 재임은 시즌 범위.
-- football_honours에는 선수 단위 우승, squad:<대회>(대표팀 엔트리), final_goal:<대회>(월드컵 결승 득점) 행이 더해진다(열은 그대로).

create table public.football_honour_catalog (
  id text primary key,
  kind text not null check (kind in ('league', 'cup', 'continental', 'international', 'award', 'manager')),
  name_en text not null,
  name_ko text not null,
  nation_id text references public.football_nations,
  source text not null check (source in ('existing', 'wikidata', 'wikipedia', 'manual')),
  page text,
  from_season int not null
);

create table public.football_managers (
  id text primary key,
  name_en text not null
);

create table public.football_manager_spells (
  manager_id text not null references public.football_managers,
  team_id text not null references public.football_teams,
  from_season int not null,
  to_season int not null,
  source_url text,
  primary key (manager_id, team_id, from_season),
  constraint football_manager_spells_order check (from_season <= to_season)
);

create index football_manager_spells_team on public.football_manager_spells (team_id, from_season);

do $$
declare t text;
begin
  foreach t in array array['honour_catalog', 'managers', 'manager_spells'] loop
    execute format('alter table public.football_%s enable row level security', t);
    execute format('revoke all on table public.football_%s from public, anon, authenticated', t);
    execute format('grant select on table public.football_%s to authenticated', t);
    execute format('create policy football_%1$s_select on public.football_%1$s for select to authenticated using ((select public.is_approved()))', t);
  end loop;
end
$$;
