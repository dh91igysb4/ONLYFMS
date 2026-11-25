-- 명예의 전당 (마을회관 설계 docs/superpowers/specs/2026-11-25-village-hall-design.md §4).
-- hall_of_fame(p_avatar_game) → { records, free, duel }. 승인된 사용자만, 관리자가 아니면 숨김 게임 제외.
--   records: game_records의 (game_id, key)마다 value 상위 3. 화면용이 아닌 키(avatar·free_bonus·areas)는 뺀다.
--   free:    free_plays를 (game_id, 사람)으로 묶어 by='wins'(맞힌 수 → 정답률) 상위 3과 by='best'(최고 점수 → 평균 → 판 수) 상위 3.
--   duel:    duel_ratings rated_games > 0, rating → rated_games 상위 3 (lb_duel과 같은 순서).
--   avatar:  같은 사람의 game_records(game_id = p_avatar_game, key = 'avatar').detail, 없으면 null.
-- 어느 게임의 기록을 어떻게 보여 줄지는 화면(src/platform/world/hallOfFame.ts)이 등록부로 정한다.

create function public.hall_of_fame(p_avatar_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean;
begin
  perform public._require_approved();
  v_admin := public.is_admin();

  return jsonb_build_object(
    'records', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'game_id', r.game_id, 'key', r.key, 'handle', r.handle, 'value', r.value, 'detail', r.detail, 'avatar', r.avatar)
             order by r.game_id, r.key, r.rn), '[]'::jsonb)
        from (
          select g.game_id, g.key, p.handle::text as handle, g.value, g.detail, av.detail as avatar,
                 row_number() over (partition by g.game_id, g.key order by g.value desc, g.updated_at, p.handle) as rn
            from public.game_records g
            join public.profiles p on p.id = g.user_id and p.status = 'approved'
            left join public.game_records av on av.user_id = g.user_id and av.game_id = p_avatar_game and av.key = 'avatar'
           where g.key not in ('avatar', 'free_bonus', 'areas')
             and (v_admin or not public._is_hidden_game(g.game_id))
        ) r
       where r.rn <= 3
    ),
    'free', (
      with s as (
        select f.game_id, f.user_id, p.handle::text as handle,
               (count(*) filter (where f.solved))::int as wins,
               count(*)::int as plays,
               (count(*) filter (where f.solved))::numeric / count(*) as rate,
               round(max(f.score), 2) as best_score,
               avg(f.score) as avg_score
          from public.free_plays f
          join public.profiles p on p.id = f.user_id and p.status = 'approved'
         where v_admin or not public._is_hidden_game(f.game_id)
         group by f.game_id, f.user_id, p.handle
      ), ranked as (
        select 'wins' as by, s.*, row_number() over (partition by s.game_id order by s.wins desc, s.rate desc, s.handle) as rn from s
        union all
        select 'best', s.*, row_number() over (partition by s.game_id order by s.best_score desc, s.avg_score desc, s.plays desc, s.handle) from s
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'game_id', x.game_id, 'by', x.by, 'handle', x.handle, 'wins', x.wins, 'plays', x.plays,
               'best_score', x.best_score, 'avatar', av.detail)
             order by x.game_id, x.by desc, x.rn), '[]'::jsonb)
        from ranked x
        left join public.game_records av on av.user_id = x.user_id and av.game_id = p_avatar_game and av.key = 'avatar'
       where x.rn <= 3
    ),
    'duel', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'game_id', d.game_id, 'handle', d.handle, 'rating', d.rating, 'rated_games', d.rated_games, 'avatar', d.avatar)
             order by d.game_id, d.rn), '[]'::jsonb)
        from (
          select r.game_id, p.handle::text as handle, r.rating, r.rated_games, av.detail as avatar,
                 row_number() over (partition by r.game_id order by r.rating desc, r.rated_games desc, p.handle) as rn
            from public.duel_ratings r
            join public.profiles p on p.id = r.user_id and p.status = 'approved'
            left join public.game_records av on av.user_id = r.user_id and av.game_id = p_avatar_game and av.key = 'avatar'
           where r.rated_games > 0
             and (v_admin or not public._is_hidden_game(r.game_id))
        ) d
       where d.rn <= 3
    )
  );
end
$$;

revoke execute on function public.hall_of_fame(text) from public, anon, authenticated;
grant execute on function public.hall_of_fame(text) to authenticated;
