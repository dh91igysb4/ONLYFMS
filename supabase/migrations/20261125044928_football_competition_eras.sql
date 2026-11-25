-- 대회 시기별 나라·단계 (설계 docs/superpowers/specs/2026-11-25-football-history-clubs-design.md §3.7).
-- 한 위키데이터 대회 QID가 시기에 따라 단계가 다를 수 있어(풋볼리그 1부: 1991년까지 1부, 1992~2004 2부)
-- football_competitions.tier 하나로는 "나라 N부"를 묶을 수 없다. CSV는 data/football/competition_eras.csv, 적재는 통째 교체.
create table public.football_competition_eras (
  competition_id text not null references public.football_competitions,
  from_season int not null,
  to_season int,
  nation_id text references public.football_nations,
  tier int not null,
  primary key (competition_id, from_season),
  check (to_season is null or to_season >= from_season)
);

alter table public.football_competition_eras enable row level security;
revoke all on table public.football_competition_eras from public, anon, authenticated;
grant select on table public.football_competition_eras to authenticated;
create policy football_competition_eras_select on public.football_competition_eras for select to authenticated using ((select public.is_approved()));
