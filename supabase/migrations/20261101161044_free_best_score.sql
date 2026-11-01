-- 자유 플레이 리더보드에 best_score(최고 점수) 열 추가 (툴칫솔 설계 §5.1).
-- 반환 형식이 바뀌므로 drop 후 0004 정의 그대로 다시 만들고 맨 끝에 열만 더한다.
-- user_stats는 st.*에서 이름으로 키를 뽑으므로 다시 만들지 않는다.
drop function public.lb_free(text);
drop function public._free_stats(text, boolean);

create function public._free_stats(p_game text, p_admin boolean)
returns table (user_id uuid, game_id text, handle citext, plays int, wins int, win_rate numeric,
               current_streak int, best_streak int, avg_score numeric, best_score numeric)
language sql stable security definer set search_path = public as $$
  with f as (
    select fp.id, fp.user_id, fp.game_id, fp.solved, fp.score, fp.played_at, p.handle
      from public.free_plays fp
      join public.profiles p on p.id = fp.user_id and p.status = 'approved'
     where (p_game is null or fp.game_id = p_game)
       and (p_admin or not public._is_hidden_game(fp.game_id))
  ), g as (
    select f.user_id, f.game_id, f.solved,
           sum(case when f.solved then 0 else 1 end)
             over (partition by f.user_id, f.game_id order by f.played_at, f.id) as grp
      from f
  ), runs as (
    select g.user_id, g.game_id, g.grp, (count(*) filter (where g.solved))::int as n
      from g group by g.user_id, g.game_id, g.grp
  ), streaks as (
    select r.user_id, r.game_id, max(r.n) as best, (array_agg(r.n order by r.grp desc))[1] as cur
      from runs r group by r.user_id, r.game_id
  )
  select f.user_id, max(f.game_id) filter (where p_game is not null), f.handle,
         count(*)::int,
         (count(*) filter (where f.solved))::int,
         round((count(*) filter (where f.solved))::numeric / count(*), 3),
         case when p_game is null then null else max(s.cur) end,
         case when p_game is null then null else max(s.best) end,
         round(avg(f.score), 1),
         round(max(f.score), 1)
    from f
    left join streaks s on s.user_id = f.user_id and s.game_id = f.game_id and p_game is not null
   group by f.user_id, f.handle
$$;

-- 자유 플레이 탭. 정렬: 정답 수 desc → 정답률 desc → 플레이 수 desc → handle
create function public.lb_free(p_game text default null)
returns table (user_id uuid, handle citext, plays int, wins int, win_rate numeric,
               current_streak int, best_streak int, avg_score numeric, best_score numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  return query
    select s.user_id, s.handle, s.plays, s.wins, s.win_rate, s.current_streak, s.best_streak, s.avg_score, s.best_score
      from public._free_stats(p_game, public.is_admin()) s
     order by s.wins desc, s.win_rate desc, s.plays desc, s.handle asc nulls last, s.user_id;
end
$$;

-- 새 함수에는 PUBLIC 실행 권한이 기본으로 붙으므로 revoke가 필수다.
revoke execute on function
  public._free_stats(text, boolean),
  public.lb_free(text)
from public, anon, authenticated;

grant execute on function public.lb_free(text) to authenticated;
