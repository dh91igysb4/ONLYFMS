-- 지속형 게임 플레이어 목록 (내 섬 설계 docs/superpowers/specs/2026-11-25-my-island-design.md §5.4).
-- world_players(p_game, p_key) → 그 게임에 기록 키 p_key 행이 있는 승인 사용자(본인 제외), 핸들 순.
--   avatar: 같은 게임의 game_records(key = 'avatar').detail, 없으면 null.
-- 승인된 사용자만 부를 수 있고, 관리자가 아니면 숨김 게임은 빈 결과.

create function public.world_players(p_game text, p_key text)
returns table (id uuid, handle text, avatar text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_approved();
  if not public.is_admin() and public._is_hidden_game(p_game) then
    return;
  end if;
  return query
    select p.id, p.handle::text, av.detail
      from public.game_records g
      join public.profiles p on p.id = g.user_id and p.status = 'approved'
      left join public.game_records av on av.user_id = g.user_id and av.game_id = p_game and av.key = 'avatar'
     where g.game_id = p_game and g.key = p_key and g.user_id <> auth.uid()
     order by p.handle;
end
$$;

revoke execute on function public.world_players(text, text) from public, anon, authenticated;
grant execute on function public.world_players(text, text) to authenticated;
