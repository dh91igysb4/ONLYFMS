-- 0012_duel: 1대1 대전 테이블·권한·Elo·목록·순위·전적 함수 (대전 설계 §4~§7)
--
-- 원칙
--   * 쓰기는 브라우저에 모두 열지 않는다. duel Edge Function이 DB 소유자 연결로 직접 쓰고
--     _duel_apply_elo를 부른다(authenticated에는 실행 권한 없음).
--   * duel_matches.state(게임 상태)는 브라우저가 어떤 경로로도 읽을 수 없다: 컬럼 권한에서 빼고,
--     아래 함수들도 state를 내보내지 않는다. invite_code도 컬럼 권한에서 빼고 duel_invite_code()로만 준다.
--   * 숨김 게임(hidden_games)은 관리자가 아니면 목록·순위·통계에서 뺀다.
--   * Elo: 시작 1000, E = 1/(1+10^((Rb−Ra)/400)), Δ = round(K × (S − E)),
--     K = rated_games < 10이면 40 아니면 20. 랭크 대국이 finished일 때만, 한 대국에 한 번만.
--   * 전적(승·무·패)은 finished 대국에서 계산한다. 친선은 전적에 들어가고 Elo에는 안 들어간다. void는 둘 다 빠진다.
--   * 대전 전용 게임(솔로 모드가 모두 false)은 문제 은행(admin_bank_status, admin_upload_puzzles) 대상에서 뺀다.

-- ------------------------------------------------------------------ types
create type public.duel_status as enum ('waiting', 'active', 'finished', 'void');
create type public.duel_end_reason as enum ('normal', 'resign', 'timeout', 'void');
create type public.duel_visibility as enum ('public', 'invite');

-- ------------------------------------------------------------------ tables
create table public.duel_matches (
  id            uuid primary key default gen_random_uuid(),
  game_id       text not null,
  options       jsonb not null default '{}'::jsonb,
  logic_version int not null,
  rated         boolean not null,
  visibility    public.duel_visibility not null,
  -- 대회 초대 코드와 같은 방식(_new_invite_code). 초대 대국에는 반드시 있다.
  invite_code   text unique,
  status        public.duel_status not null default 'waiting',
  -- 계정이 지워져도 대국·상대 전적은 남긴다(contests.created_by와 같이 null로)
  created_by    uuid references public.profiles (id) on delete set null,
  players       uuid[],                       -- [선공, 후공]. 참가 때 확정
  state         jsonb,                        -- 브라우저 읽기 불가(컬럼 권한 없음)
  action_no     int not null default 0,
  turn_no       int not null default 0,
  turn_seconds  int not null,
  turn_deadline timestamptz,
  timeouts      int[] not null default '{0,0}',
  moved         boolean[] not null default '{false,false}',
  winner        smallint,
  end_reason    public.duel_end_reason,
  final_scores  int[],
  parent_type   text,
  parent_id     uuid,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  ended_at      timestamptz,
  constraint duel_matches_game_id check (game_id ~ '^[a-z0-9-]+$'),
  constraint duel_matches_invite_code check (invite_code is null or invite_code ~ '^[a-z0-9]{10}$'),
  constraint duel_matches_invite_has_code check (visibility <> 'invite' or invite_code is not null),
  constraint duel_matches_players check (
    players is null
    or (array_ndims(players) = 1 and cardinality(players) = 2
        and players[1] is not null and players[2] is not null and players[1] <> players[2])),
  constraint duel_matches_players_when_started check (status not in ('active', 'finished') or players is not null),
  constraint duel_matches_counters check (action_no >= 0 and turn_no >= 0 and turn_seconds > 0),
  constraint duel_matches_timeouts check (cardinality(timeouts) = 2),
  constraint duel_matches_moved check (cardinality(moved) = 2),
  constraint duel_matches_winner check (winner is null or (winner in (0, 1) and status = 'finished')),
  constraint duel_matches_end_reason check ((status in ('finished', 'void')) = (end_reason is not null)),
  constraint duel_matches_void_reason check (end_reason <> 'void' or status = 'void'),
  constraint duel_matches_final_scores check (final_scores is null or cardinality(final_scores) = 2)
);

create table public.duel_moves (
  match_id   uuid not null references public.duel_matches (id) on delete cascade,
  action_no  int not null,
  seat       smallint not null,
  action     jsonb not null,
  auto       boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, action_no),
  constraint duel_moves_seat check (seat in (0, 1)),
  constraint duel_moves_action_no check (action_no >= 0)
);

create table public.duel_ratings (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  game_id     text not null,
  rating      int not null default 1000,
  rated_games int not null default 0,
  wins        int not null default 0,
  draws       int not null default 0,
  losses      int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, game_id),
  constraint duel_ratings_game_id check (game_id ~ '^[a-z0-9-]+$'),
  constraint duel_ratings_counts check (rated_games >= 0 and wins >= 0 and draws >= 0 and losses >= 0)
);

create table public.duel_rating_changes (
  match_id   uuid not null references public.duel_matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  before     int not null,
  after      int not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- ------------------------------------------------------------------ indexes
create index duel_matches_waiting_idx    on public.duel_matches (created_at) where status = 'waiting';
create index duel_matches_players_idx    on public.duel_matches using gin (players);
create index duel_matches_created_by_idx on public.duel_matches (created_by, status);
create index duel_matches_ended_idx      on public.duel_matches (game_id, ended_at) where status = 'finished';
create index duel_ratings_game_idx       on public.duel_ratings (game_id, rating desc);
create index duel_rating_changes_user_idx on public.duel_rating_changes (user_id);

-- ------------------------------------------------------------------ RLS on
alter table public.duel_matches        enable row level security;
alter table public.duel_moves          enable row level security;
alter table public.duel_ratings        enable row level security;
alter table public.duel_rating_changes enable row level security;

-- ------------------------------------------------------------------ policy helpers
-- 수 기록: 대국이 끝난 뒤(finished/void) 참가자만
create function public._duel_moves_readable(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.duel_matches m
     where m.id = p_match
       and m.status in ('finished', 'void')
       and m.players @> array[auth.uid()])
$$;

-- 레이팅 변화: 승인 사용자, 숨김 게임 대국이면 관리자만
create function public._duel_change_readable(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.duel_matches m
     where m.id = p_match
       and (public.is_admin() or not public._is_hidden_game(m.game_id)))
$$;

-- ------------------------------------------------------------------ policies
-- 참가자, 만든 사람, 또는 공개 waiting(숨김 게임이면 관리자만)
create policy duel_matches_select on public.duel_matches
  for select to authenticated
  using (public.is_approved()
         and (players @> array[auth.uid()]
              or created_by = auth.uid()
              or (status = 'waiting' and visibility = 'public'
                  and (public.is_admin() or not public._is_hidden_game(game_id)))));

create policy duel_moves_select on public.duel_moves
  for select to authenticated using (public._duel_moves_readable(match_id));

create policy duel_ratings_select on public.duel_ratings
  for select to authenticated
  using (public.is_approved() and (public.is_admin() or not public._is_hidden_game(game_id)));

create policy duel_rating_changes_select on public.duel_rating_changes
  for select to authenticated using (public._duel_change_readable(match_id));

-- ------------------------------------------------------------------ table grants
revoke all on table public.duel_matches, public.duel_moves, public.duel_ratings, public.duel_rating_changes
from public, anon, authenticated;

-- state·invite_code는 뺀다
grant select (id, game_id, options, logic_version, rated, visibility, status, created_by, players,
              action_no, turn_no, turn_seconds, turn_deadline, timeouts, moved, winner, end_reason,
              final_scores, parent_type, parent_id, created_at, started_at, ended_at)
  on table public.duel_matches to authenticated;
grant select on table public.duel_moves, public.duel_ratings, public.duel_rating_changes to authenticated;

-- ------------------------------------------------------------------ Elo
-- 랭크·finished 대국의 두 사람 레이팅을 갱신한다(없으면 1000에서 시작). 무승부는 winner null.
-- 친선·무효·진행 중이면 아무것도 안 한다. duel_rating_changes가 이미 있으면 다시 반영하지 않는다.
create function public._duel_apply_elo(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m  public.duel_matches%rowtype;
  r0 public.duel_ratings%rowtype;
  r1 public.duel_ratings%rowtype;
  s0 numeric;
  e0 numeric;
  e1 numeric;
  d0 int;
  d1 int;
begin
  select * into m from public.duel_matches where id = p_match for update;
  if not found or m.status <> 'finished' or not m.rated or m.players is null then
    return;
  end if;
  if exists (select 1 from public.duel_rating_changes where match_id = p_match) then
    return;
  end if;

  -- 좌석 순서가 아니라 user_id 순서로 넣고 잠근다(좌석이 뒤바뀐 두 대국이 동시에 끝나도 교착 없음)
  insert into public.duel_ratings (user_id, game_id)
  select u.uid, m.game_id from unnest(m.players) as u(uid) order by u.uid
  on conflict do nothing;
  -- 두 행을 같은 순서로 잠근다
  perform 1 from public.duel_ratings
   where game_id = m.game_id and user_id = any (m.players)
   order by user_id
     for update;
  select * into r0 from public.duel_ratings where user_id = m.players[1] and game_id = m.game_id;
  select * into r1 from public.duel_ratings where user_id = m.players[2] and game_id = m.game_id;

  s0 := case m.winner when 0 then 1 when 1 then 0 else 0.5 end;
  e0 := 1 / (1 + power(10::numeric, (r1.rating - r0.rating) / 400.0));
  e1 := 1 / (1 + power(10::numeric, (r0.rating - r1.rating) / 400.0));
  d0 := round((case when r0.rated_games < 10 then 40 else 20 end) * (s0 - e0));
  d1 := round((case when r1.rated_games < 10 then 40 else 20 end) * ((1 - s0) - e1));

  update public.duel_ratings
     set rating      = rating + d0,
         rated_games = rated_games + 1,
         wins        = wins   + (s0 = 1)::int,
         draws       = draws  + (s0 = 0.5)::int,
         losses      = losses + (s0 = 0)::int,
         updated_at  = now()
   where user_id = m.players[1] and game_id = m.game_id;
  update public.duel_ratings
     set rating      = rating + d1,
         rated_games = rated_games + 1,
         wins        = wins   + (s0 = 0)::int,
         draws       = draws  + (s0 = 0.5)::int,
         losses      = losses + (s0 = 1)::int,
         updated_at  = now()
   where user_id = m.players[2] and game_id = m.game_id;

  insert into public.duel_rating_changes (match_id, user_id, before, after) values
    (p_match, m.players[1], r0.rating, r0.rating + d0),
    (p_match, m.players[2], r1.rating, r1.rating + d1);
end
$$;

-- ------------------------------------------------------------------ internal helpers
create function public._duel_rating(p_user uuid, p_game text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select r.rating from public.duel_ratings r where r.user_id = p_user and r.game_id = p_game), 1000)
$$;

-- 목록 항목. state·invite_code는 넣지 않는다. waiting이면 players = [만든 사람](지워졌으면 []).
create function public._duel_item(m public.duel_matches) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id,
    'game_id', m.game_id,
    'rated', m.rated,
    'visibility', m.visibility,
    'turn_seconds', m.turn_seconds,
    'status', m.status,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', u.uid, 'handle', p.handle::text, 'rating', public._duel_rating(u.uid, m.game_id))
                        order by u.ord), '[]'::jsonb)
                  from unnest(coalesce(m.players, array_remove(array[m.created_by], null))) with ordinality as u(uid, ord)
                  left join public.profiles p on p.id = u.uid),
    'created_by_handle', (select p.handle::text from public.profiles p where p.id = m.created_by),
    'created_at', m.created_at,
    'winner', m.winner,
    'end_reason', m.end_reason,
    'final_scores', m.final_scores)
$$;

-- 한 사람의 finished 대국(무효 제외) 결과. 관리자가 아니면 숨김 게임 제외.
create function public._duel_results(p_user uuid, p_admin boolean)
returns table (id uuid, game_id text, rated boolean, ended_at timestamptz, opponent uuid,
               opponent_handle text, result text, my_score int, opp_score int)
language sql stable security definer set search_path = public as $$
  select m.id, m.game_id, m.rated, m.ended_at,
         m.players[3 - s.seat], p.handle::text,
         case when m.winner is null then 'draw' when m.winner + 1 = s.seat then 'win' else 'loss' end,
         m.final_scores[s.seat], m.final_scores[3 - s.seat]
    from public.duel_matches m
   cross join lateral (select array_position(m.players, p_user) as seat) s
    left join public.profiles p on p.id = m.players[3 - s.seat]
   where m.status = 'finished'
     and m.players @> array[p_user]
     and (p_admin or not public._is_hidden_game(m.game_id))
$$;

-- 한 게임의 통계: {game_id, rating, rated:{w,d,l,rate}, all:{w,d,l,rate}, recent:[최근 20판]}
create function public._duel_game_stats(p_user uuid, p_game text, p_admin boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select * from public._duel_results(p_user, p_admin) x where x.game_id = p_game
  ), wdl as (
    select k.rated_only,
           jsonb_build_object(
             'w', count(r.id) filter (where r.result = 'win'),
             'd', count(r.id) filter (where r.result = 'draw'),
             'l', count(r.id) filter (where r.result = 'loss'),
             'rate', case when count(r.id) = 0 then null
                          else round((count(r.id) filter (where r.result = 'win'))::numeric / count(r.id), 3) end) as v
      from (values (true), (false)) as k(rated_only)
      left join r on (r.rated or not k.rated_only)
     group by k.rated_only
  )
  select jsonb_build_object(
    'game_id', p_game,
    'rating', public._duel_rating(p_user, p_game),
    'rated', (select v from wdl where rated_only),
    'all',   (select v from wdl where not rated_only),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', t.id, 'opponent_handle', t.opponent_handle, 'result', t.result, 'rated', t.rated,
                         'ended_at', t.ended_at, 'my_score', t.my_score, 'opp_score', t.opp_score)
                       order by t.ended_at desc, t.id), '[]'::jsonb)
                 from (select * from r order by r.ended_at desc, r.id limit 20) t))
$$;

-- 승인 사용자의 아이디 → id. 없거나 승인 상태가 아니면 null.
-- 정규화는 _normalize_handle(0009)과 같다(앞뒤 공백 제거 → NFC → 소문자). 단, 형식이 틀린 입력도
-- 예외 없이 null(없는 사용자)로 돌려준다 — 조회 함수라서.
create function public._duel_user_by_handle(p_handle text) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.handle::text = lower(normalize(btrim(p_handle), NFC)) and p.status = 'approved'
$$;

-- ------------------------------------------------------------------ public RPCs
-- 대전 탭 목록. 호출할 때 10분 지난 waiting을 void로 정리한다.
--   lobby:  공개 waiting(내가 만든 것 제외 — mine에 있다. 만든 사람이 지워진 것도 제외)
--   mine:   내 waiting/active
--   recent: 내 최근 종료 10개(finished, 시작된 뒤 무효가 된 void)
--   due:    내가 참가자이고 active이며 마감이 지난 대국 id. 화면이 각각에 tick을 보낸다.
create function public.duel_list() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_lobby jsonb;
  v_mine  jsonb;
  v_recent jsonb;
  v_due   jsonb;
begin
  perform public._require_approved();
  v_admin := public.is_admin();

  update public.duel_matches
     set status = 'void', end_reason = 'void', ended_at = now()
   where status = 'waiting' and created_at < now() - interval '10 minutes';

  select coalesce(jsonb_agg(public._duel_item(m) order by m.created_at desc, m.id), '[]'::jsonb)
    into v_lobby
    from public.duel_matches m
   where m.status = 'waiting' and m.visibility = 'public'
     and m.created_by is not null and m.created_by <> v_uid
     and (v_admin or not public._is_hidden_game(m.game_id));

  select coalesce(jsonb_agg(public._duel_item(m) order by m.created_at desc, m.id), '[]'::jsonb)
    into v_mine
    from public.duel_matches m
   where m.status in ('waiting', 'active')
     and (m.players @> array[v_uid] or m.created_by = v_uid)
     and (v_admin or not public._is_hidden_game(m.game_id));

  select coalesce(jsonb_agg(public._duel_item(m) order by m.ended_at desc nulls last, m.id), '[]'::jsonb)
    into v_recent
    from public.duel_matches m
   where m.id in (
     select x.id from public.duel_matches x
      where x.status in ('finished', 'void')
        and x.players @> array[v_uid]
        and (v_admin or not public._is_hidden_game(x.game_id))
      order by x.ended_at desc nulls last, x.id
      limit 10);

  select coalesce(jsonb_agg(m.id order by m.turn_deadline, m.id), '[]'::jsonb)
    into v_due
    from public.duel_matches m
   where m.status = 'active'
     and m.players @> array[v_uid]
     and m.turn_deadline < now()
     and (v_admin or not public._is_hidden_game(m.game_id));

  return jsonb_build_object('lobby', v_lobby, 'mine', v_mine, 'recent', v_recent, 'due', v_due);
end
$$;

-- 초대 코드: 만든 사람(승인 상태)에게만, 아니면 null
create function public.duel_invite_code(p_match uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.invite_code from public.duel_matches m
   where m.id = p_match
     and public.is_approved()
     and m.created_by = auth.uid()
$$;

-- 레이팅 순위. placed = 랭크 5판 이상(미만은 화면에서 "배치 중"으로 따로). rating 내림차순.
create function public.lb_duel(p_game text)
returns table (handle text, rating int, rated_games int, wins int, draws int, losses int, placed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_approved();
  if not public.is_admin() and public._is_hidden_game(p_game) then
    return;
  end if;
  return query
    select p.handle::text, r.rating, r.rated_games, r.wins, r.draws, r.losses, r.rated_games >= 5
      from public.duel_ratings r
      join public.profiles p on p.id = r.user_id and p.status = 'approved'
     where r.game_id = p_game and r.rated_games > 0
     order by r.rating desc, r.rated_games desc, p.handle asc nulls last, r.user_id;
end
$$;

-- 한 사람의 전적. 대상이 없거나 승인 상태가 아니면 null.
--   p_game 지정: {game_id, rating, rated:{w,d,l,rate}, all:{w,d,l,rate}, recent:[...]}
--                (숨김 게임이고 관리자가 아니면 null)
--   p_game null: 위 객체의 게임별 배열(레이팅 행이나 끝난 대국이 있는 게임, game_id 순)
--   recent 항목: {id, opponent_handle, result: win|draw|loss, rated, ended_at, my_score, opp_score}
create function public.duel_stats(p_handle text, p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin  boolean;
  v_target uuid;
begin
  perform public._require_approved();
  v_admin := public.is_admin();
  v_target := public._duel_user_by_handle(p_handle);
  if v_target is null then
    return null;
  end if;

  if p_game is not null then
    if not v_admin and public._is_hidden_game(p_game) then
      return null;
    end if;
    return public._duel_game_stats(v_target, p_game, v_admin);
  end if;

  return (select coalesce(jsonb_agg(public._duel_game_stats(v_target, g.game_id, v_admin) order by g.game_id), '[]'::jsonb)
            from (select r.game_id from public.duel_ratings r where r.user_id = v_target
                  union
                  select x.game_id from public._duel_results(v_target, v_admin) x) g
           where v_admin or not public._is_hidden_game(g.game_id));
end
$$;

-- 상대 전적(a 관점). 어느 쪽이든 없거나 승인 상태가 아니면 null. p_game null이면 모든 게임.
--   games:  [{game_id, a_wins, draws, b_wins}] (game_id 순)
--   recent: 최근 20판 [{id, game_id, result(a 관점), rated, ended_at, a_score, b_score}]
create function public.duel_h2h(p_handle_a text, p_handle_b text, p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean;
  v_a     uuid;
  v_b     uuid;
  v_games jsonb;
  v_recent jsonb;
begin
  perform public._require_approved();
  v_admin := public.is_admin();
  v_a := public._duel_user_by_handle(p_handle_a);
  v_b := public._duel_user_by_handle(p_handle_b);
  if v_a is null or v_b is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'a_wins', g.a_wins, 'draws', g.draws, 'b_wins', g.b_wins)
                            order by g.game_id), '[]'::jsonb)
    into v_games
    from (select r.game_id,
                 count(*) filter (where r.result = 'win')  as a_wins,
                 count(*) filter (where r.result = 'draw') as draws,
                 count(*) filter (where r.result = 'loss') as b_wins
            from public._duel_results(v_a, v_admin) r
           where r.opponent = v_b and (p_game is null or r.game_id = p_game)
           group by r.game_id) g;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'game_id', t.game_id, 'result', t.result, 'rated', t.rated,
           'ended_at', t.ended_at, 'a_score', t.my_score, 'b_score', t.opp_score)
         order by t.ended_at desc, t.id), '[]'::jsonb)
    into v_recent
    from (select * from public._duel_results(v_a, v_admin) r
           where r.opponent = v_b and (p_game is null or r.game_id = p_game)
           order by r.ended_at desc, r.id
           limit 20) t;

  return jsonb_build_object('games', v_games, 'recent', v_recent);
end
$$;

-- ------------------------------------------------------------------ puzzle bank: 대전 전용 게임 제외
-- 0003과 같은 함수에서 "솔로 모드(daily·contest·free)가 하나라도 있는 게임"만 대상으로 바꾼다.
-- 시그니처·권한·나머지 동작은 그대로(create or replace는 기존 grant를 유지한다).
create or replace function public.admin_upload_puzzles(p_game text, p_puzzles jsonb)
returns table (added int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_added int;
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if not exists (select 1 from public.game_modes g
                  where g.game_id = p_game and (g.daily or g.contest or g.free)) then
    raise exception using errcode = 'P0001', message = 'game_not_allowed';
  end if;
  if p_puzzles is null or jsonb_typeof(p_puzzles) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_puzzles) e
        where jsonb_typeof(e.value) <> 'object'
           or jsonb_typeof(e.value -> 'puzzle_key') is distinct from 'string'
           or btrim(e.value ->> 'puzzle_key') = ''
           or jsonb_typeof(e.value -> 'puzzle') is distinct from 'object') then
    raise exception using errcode = 'P0001', message = 'items_invalid';
  end if;

  v_total := jsonb_array_length(p_puzzles);
  insert into public.puzzle_bank (game_id, puzzle_key, puzzle)
  select p_game, e.value ->> 'puzzle_key', e.value -> 'puzzle'
    from jsonb_array_elements(p_puzzles) with ordinality as e(value, ord)
   order by e.ord
  on conflict (game_id, puzzle_key) do nothing;
  get diagnostics v_added = row_count;

  return query select v_added, v_total - v_added;
end
$$;

create or replace function public.admin_bank_status()
returns table (game_id text, remaining int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select g.game_id,
           (select count(*)::int from public.puzzle_bank b
             where b.game_id = g.game_id and b.used_item_id is null)
      from public.game_modes g
     where g.daily or g.contest or g.free
     order by g.game_id;
end
$$;

-- ------------------------------------------------------------------ execute grants
revoke execute on function
  public._duel_moves_readable(uuid),
  public._duel_change_readable(uuid),
  public._duel_apply_elo(uuid),
  public._duel_rating(uuid, text),
  public._duel_item(public.duel_matches),
  public._duel_results(uuid, boolean),
  public._duel_game_stats(uuid, text, boolean),
  public._duel_user_by_handle(text),
  public.duel_list(),
  public.duel_invite_code(uuid),
  public.lb_duel(text),
  public.duel_stats(text, text),
  public.duel_h2h(text, text, text)
from public, anon, authenticated;

-- 정책이 invoker 권한으로 부르는 도우미(_duel_moves_readable, _duel_change_readable)와 공개 RPC만 연다.
-- _duel_apply_elo와 나머지 내부 함수는 소유자(Edge Function 연결)만 쓴다.
grant execute on function
  public._duel_moves_readable(uuid),
  public._duel_change_readable(uuid),
  public.duel_list(),
  public.duel_invite_code(uuid),
  public.lb_duel(text),
  public.duel_stats(text, text),
  public.duel_h2h(text, text, text)
to authenticated;
