-- 0004_leaderboards: 리더보드·통계 함수 (설계 §5.1, §9)
--
-- 원칙
--   * 모두 security definer + 승인 사용자만(아니면 P0001 forbidden). 별도 집계 테이블은 없다.
--   * 취소된 대회는 빼고, 관리자가 아니면 숨김 게임(hidden_games)의 기록은 문제 단위로 뺀다.
--   * 순위에는 승인 상태 사용자만 나온다.
--   * 날짜는 KST: 데일리는 daily_key('게임:YYYY-MM-DD')의 날짜, 공식 대회는 (ends_at at time zone 'Asia/Seoul')::date.
--   * 어느 기록이 세어지나(§5.1):
--       daily     — 오늘·주간·전체. 대회가 끝났거나(now() >= ends_at) 본인이 끝낸 기록만(진행 중 데일리는 순위 밖).
--       official  — 주간·전체·대회 탭. 종료된 대회의 모든 기록(못 끝낸 문제는 마지막 행동 때 점수, §5.3).
--       friendly  — 누적 순위에 넣지 않는다. lb_contest(대회 페이지)와 user_stats(프로필)에만.
--   * 정렬(§9): 점수 합계 desc → 총 행동 수 asc → 마지막 완료 시각 asc → handle → user_id.
--     못 끝낸 기록의 "완료 시각"은 coalesce(finished_at, last_action_at, started_at).
--   * 진행 중 대회의 다른 사람 기록은 lb_contest의 점수·끝낸 문제 수·행동 수로만 보인다(state는 절대 내보내지 않는다).

-- ------------------------------------------------------------------ indexes
-- 데일리 날짜(daily_key 끝 10자) 범위 조회
create index contests_daily_day_idx on public.contests ((right(daily_key, 10))) where kind = 'daily';
create index free_plays_game_idx    on public.free_plays (game_id, user_id, played_at);

-- ------------------------------------------------------------------ internal helpers
create function public._require_approved() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
end
$$;

-- 누적 리더보드에 들어가는 기록(문제 단위). 날짜는 KST.
--   p_daily: 데일리 포함, p_official: 종료된 공식 대회 포함, p_admin: 숨김 게임 포함
create function public._lb_attempt_rows(
  p_from date, p_to date, p_game text, p_daily boolean, p_official boolean, p_admin boolean)
returns table (user_id uuid, handle citext, score numeric, action_count int, at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.user_id, p.handle, a.score, a.action_count,
         coalesce(a.finished_at, a.last_action_at, a.started_at)
    from public.attempts a
    join public.contest_items i on i.id = a.item_id
    join public.contests c      on c.id = i.contest_id
    join public.profiles p      on p.id = a.user_id and p.status = 'approved'
   where c.cancelled_at is null
     and (p_game is null or i.game_id = p_game)
     and (p_admin or not public._is_hidden_game(i.game_id))
     and (   (p_daily and c.kind = 'daily'
              and right(c.daily_key, 10) between to_char(p_from, 'YYYY-MM-DD') and to_char(p_to, 'YYYY-MM-DD')
              and (a.finished or now() >= c.ends_at))
          or (p_official and c.kind = 'official'
              and now() >= c.ends_at
              and c.ends_at >= (p_from::timestamp at time zone 'Asia/Seoul')
              and c.ends_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')))
$$;

-- 위 기록을 사용자별로 합산해 §9 순서로 순위를 매긴다
create function public._lb_ranked(
  p_from date, p_to date, p_game text, p_daily boolean, p_official boolean, p_admin boolean)
returns table (rank int, user_id uuid, handle citext, score numeric, action_count int, finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  select (row_number() over (order by sum(r.score) desc, sum(r.action_count) asc, max(r.at) asc,
                                      r.handle asc nulls last, r.user_id))::int,
         r.user_id, r.handle, sum(r.score), sum(r.action_count)::int, max(r.at)
    from public._lb_attempt_rows(p_from, p_to, p_game, p_daily, p_official, p_admin) r
   group by r.user_id, r.handle
   order by 1
$$;

-- 한 대회의 순위(진행 중이어도). 취소된 대회는 빈 결과. 권한 확인은 호출하는 쪽에서 한다.
create function public._lb_contest_rows(p_contest uuid, p_admin boolean)
returns table (rank int, user_id uuid, handle citext, score numeric, solved_items int,
               action_count int, last_finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  select (row_number() over (order by sum(a.score) desc, sum(a.action_count) asc,
                                      max(coalesce(a.finished_at, a.last_action_at, a.started_at)) asc,
                                      p.handle asc nulls last, a.user_id))::int,
         a.user_id, p.handle, sum(a.score),
         (count(*) filter (where a.finished))::int,
         sum(a.action_count)::int,
         max(coalesce(a.finished_at, a.last_action_at, a.started_at))
    from public.attempts a
    join public.contest_items i on i.id = a.item_id and i.contest_id = p_contest
    join public.contests c      on c.id = i.contest_id and c.cancelled_at is null
    join public.profiles p      on p.id = a.user_id and p.status = 'approved'
   where p_admin or not public._is_hidden_game(i.game_id)
   group by a.user_id, p.handle
   order by 1
$$;

-- 자유 플레이 사용자별 통계. 연속 정답은 (사용자, 게임)별 played_at 순서에서
-- 실패 누적 합으로 묶은 구간의 정답 수: 마지막 구간 = 현재, 최대 구간 = 최고.
-- p_game이 null이면 모든 게임 합계이고 streak은 null.
create function public._free_stats(p_game text, p_admin boolean)
returns table (user_id uuid, game_id text, handle citext, plays int, wins int, win_rate numeric,
               current_streak int, best_streak int, avg_score numeric)
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
         round(avg(f.score), 1)
    from f
    left join streaks s on s.user_id = f.user_id and s.game_id = f.game_id and p_game is not null
   group by f.user_id, f.handle
$$;

-- ------------------------------------------------------------------ public RPCs
create function public.lb_daily(p_day date, p_game text default null)
returns table (rank int, user_id uuid, handle citext, score numeric, action_count int, finished_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  return query select * from public._lb_ranked(p_day, p_day, p_game, true, false, public.is_admin());
end
$$;

create function public.lb_range(p_from date, p_to date, p_game text default null)
returns table (rank int, user_id uuid, handle citext, score numeric, action_count int, finished_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  return query select * from public._lb_ranked(p_from, p_to, p_game, true, true, public.is_admin());
end
$$;

create function public.lb_contest(p_contest uuid)
returns table (rank int, user_id uuid, handle citext, score numeric, solved_items int,
               action_count int, last_finished_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  if not public.can_see_contest(p_contest) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query select * from public._lb_contest_rows(p_contest, public.is_admin());
end
$$;

-- 대회 탭: 종료된 공식 대회별 1~3위(호출자가 볼 수 있는 대회만)와 사용자별 공식 대회 점수 합계.
-- 합계는 lb_range의 공식 대회 몫과 같다(초대 대회도 누적 순위에는 들어간다).
create function public.lb_contests(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
  v_contests jsonb;
  v_totals jsonb;
begin
  perform public._require_approved();

  select coalesce(jsonb_agg(jsonb_build_object(
           'contest_id', c.id,
           'title', c.title,
           'ends_at', c.ends_at,
           'podium', (select coalesce(jsonb_agg(jsonb_build_object('handle', r.handle, 'score', r.score)
                                                order by r.rank), '[]'::jsonb)
                        from public._lb_contest_rows(c.id, v_admin) r
                       where r.rank <= 3))
         order by c.ends_at desc, c.id), '[]'::jsonb)
    into v_contests
    from public.contests c
   where c.kind = 'official'
     and c.cancelled_at is null
     and now() >= c.ends_at
     and c.ends_at >= (p_from::timestamp at time zone 'Asia/Seoul')
     and c.ends_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
     and public.can_see_contest(c.id);

  select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'handle', r.handle, 'total', r.score)
                            order by r.rank), '[]'::jsonb)
    into v_totals
    from public._lb_ranked(p_from, p_to, null, false, true, v_admin) r;

  return jsonb_build_object('contests', v_contests, 'totals', v_totals);
end
$$;

-- 자유 플레이 탭. 정렬: 정답 수 desc → 정답률 desc → 플레이 수 desc → handle
create function public.lb_free(p_game text default null)
returns table (user_id uuid, handle citext, plays int, wins int, win_rate numeric,
               current_streak int, best_streak int, avg_score numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  return query
    select s.user_id, s.handle, s.plays, s.wins, s.win_rate, s.current_streak, s.best_streak, s.avg_score
      from public._free_stats(p_game, public.is_admin()) s
     order by s.wins desc, s.win_rate desc, s.plays desc, s.handle asc nulls last, s.user_id;
end
$$;

-- 프로필 통계. 대상이 없거나 승인 상태가 아니면 null.
--   daily_by_game: [{game_id, days, avg_score}]               (세어지는 데일리 기록)
--   contests:      [{contest_id, title, kind, ends_at, rank, score}]  (종료·미취소, 호출자가 볼 수 있는 공식·친선)
--   free_by_game:  [{game_id, plays, wins, win_rate, best_streak}]
--   recent:        최근 30개 [{type: daily|contest|free, game_id, score, at}]
--                  (기록은 끝냈거나 대회가 끝난 것만, 호출자가 볼 수 있는 대회만)
create function public.user_stats(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin  boolean;
  v_target uuid;
  v_daily  jsonb;
  v_contests jsonb;
  v_free   jsonb;
  v_recent jsonb;
begin
  perform public._require_approved();
  v_admin := public.is_admin();

  select p.id into v_target
    from public.profiles p
   where p.handle::text = lower(btrim(p_handle)) and p.status = 'approved';
  if v_target is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', d.game_id, 'days', d.days, 'avg_score', d.avg_score)
                            order by d.game_id), '[]'::jsonb)
    into v_daily
    from (select i.game_id, count(distinct c.id)::int as days, round(avg(a.score), 1) as avg_score
            from public.attempts a
            join public.contest_items i on i.id = a.item_id
            join public.contests c      on c.id = i.contest_id
           where a.user_id = v_target
             and c.kind = 'daily'
             and c.cancelled_at is null
             and (a.finished or now() >= c.ends_at)
             and (v_admin or not public._is_hidden_game(i.game_id))
           group by i.game_id) d;

  select coalesce(jsonb_agg(jsonb_build_object(
           'contest_id', c.id, 'title', c.title, 'kind', c.kind, 'ends_at', c.ends_at,
           'rank', r.rank, 'score', r.score)
         order by c.ends_at desc, c.id), '[]'::jsonb)
    into v_contests
    from public.contests c
    cross join lateral public._lb_contest_rows(c.id, v_admin) r
   where c.kind in ('official', 'friendly')
     and c.cancelled_at is null
     and now() >= c.ends_at
     and r.user_id = v_target
     and exists (select 1 from public.contest_items i
                   join public.attempts a on a.item_id = i.id and a.user_id = v_target
                  where i.contest_id = c.id)
     and public.can_see_contest(c.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'game_id', s.game_id, 'plays', s.plays, 'wins', s.wins,
           'win_rate', s.win_rate, 'best_streak', s.best_streak)
         order by s.game_id), '[]'::jsonb)
    into v_free
    from (select st.*
            from (select distinct fp.game_id from public.free_plays fp where fp.user_id = v_target) g
            cross join lateral public._free_stats(g.game_id, v_admin) st
           where st.user_id = v_target) s;

  select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'game_id', x.game_id, 'score', x.score, 'at', x.at)
                            order by x.at desc, x.ord), '[]'::jsonb)
    into v_recent
    from (select * from (
            select case when c.kind = 'daily' then 'daily' else 'contest' end as type,
                   i.game_id, a.score,
                   coalesce(a.finished_at, a.last_action_at, a.started_at) as at,
                   0 as ord
              from public.attempts a
              join public.contest_items i on i.id = a.item_id
              join public.contests c      on c.id = i.contest_id
             where a.user_id = v_target
               and c.cancelled_at is null
               and (a.finished or now() >= c.ends_at)
               and (v_admin or not public._is_hidden_game(i.game_id))
               and (c.kind = 'daily' or public.can_see_contest(c.id))
            union all
            select 'free', fp.game_id, fp.score, fp.played_at, 1
              from public.free_plays fp
             where fp.user_id = v_target
               and (v_admin or not public._is_hidden_game(fp.game_id))
          ) u
          order by u.at desc, u.ord
          limit 30) x;

  return jsonb_build_object('daily_by_game', v_daily, 'contests', v_contests,
                            'free_by_game', v_free, 'recent', v_recent);
end
$$;

-- ------------------------------------------------------------------ execute grants
revoke execute on function
  public._require_approved(),
  public._lb_attempt_rows(date, date, text, boolean, boolean, boolean),
  public._lb_ranked(date, date, text, boolean, boolean, boolean),
  public._lb_contest_rows(uuid, boolean),
  public._free_stats(text, boolean),
  public.lb_daily(date, text),
  public.lb_range(date, date, text),
  public.lb_contest(uuid),
  public.lb_contests(date, date),
  public.lb_free(text),
  public.user_stats(text)
from public, anon, authenticated;

-- 내부 함수(_require_approved, _lb_*, _free_stats)는 열지 않는다.
grant execute on function
  public.lb_daily(date, text),
  public.lb_range(date, date, text),
  public.lb_contest(uuid),
  public.lb_contests(date, date),
  public.lb_free(text),
  public.user_stats(text)
to authenticated;
