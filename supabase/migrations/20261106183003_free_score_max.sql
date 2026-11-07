-- 자유 플레이 점수 상한을 게임별로 (docs/superpowers/specs/2026-11-07-ball-run-design.md §5).
--   * game_modes.score_max: 게임별 자유 플레이 점수 상한. 기본 10(기존 게임은 그대로).
--   * free_plays.score: numeric(4,2) → numeric(9,2). 하한 0은 free_plays_score_min이 지킨다.
--   * free_plays_score_range(0~10 고정)를 없애고, 상한은 트리거가 game_modes.score_max로 검사한다.
--     authenticated는 game_modes를 읽을 수 없으므로 트리거 함수는 security definer다.
--   * 데일리·대회 점수(attempts.score)는 0~10 그대로다.
alter table public.game_modes add column score_max numeric(9,2) not null default 10;

alter table public.free_plays alter column score type numeric(9,2);

alter table public.free_plays drop constraint free_plays_score_range;
alter table public.free_plays add constraint free_plays_score_min check (score >= 0);

create function public._free_plays_score_max() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.score > coalesce((select g.score_max from public.game_modes g where g.game_id = new.game_id), 10) then
    raise exception 'score above max' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public._free_plays_score_max() from public, anon, authenticated;

create trigger free_plays_score_max
  before insert or update on public.free_plays
  for each row execute function public._free_plays_score_max();
