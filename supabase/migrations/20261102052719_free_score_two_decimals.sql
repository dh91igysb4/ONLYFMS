-- 자유 플레이 점수를 소수 둘째 자리까지 저장·집계한다 (양치 시뮬레이터 v3 점수는 0.01점 단위).
--   * free_plays.score: numeric(3,1) → numeric(4,2). 값 범위(0~10)와 열 단위 insert 권한은 그대로다.
--     이 열을 쓰는 뷰는 없다(0002의 뷰는 contest_items·attempts만 본다).
--   * _free_stats: 평균·최고를 소수 둘째 자리로 반올림한다. 반환 형식이 같으므로 create or replace로
--     바꾸고 권한(0004·20261101161044의 revoke)은 그대로 유지된다. lb_free·user_stats는 다시 만들지 않는다.
--   * 데일리·대회 점수(attempts.score)는 numeric(3,1) 그대로다.
alter table public.free_plays alter column score type numeric(4,2);

create or replace function public._free_stats(p_game text, p_admin boolean)
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
         round(avg(f.score), 2),
         round(max(f.score), 2)
    from f
    left join streaks s on s.user_id = f.user_id and s.game_id = f.game_id and p_game is not null
   group by f.user_id, f.handle
$$;
