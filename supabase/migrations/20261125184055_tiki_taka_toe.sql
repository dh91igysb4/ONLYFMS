-- 티키타카토(tiki-taka-toe) 대전 게임: 머리칸 조건·조건별 선수·판 테이블과 판 고르기 RPC
-- (설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §5.2, §5.3, §8).
--
--   * 데이터는 scripts/tiki-taka-toe/load.sh가 data/tiki-taka-toe/*.csv를 한 트랜잭션으로 통째 교체한다.
--     축구 데이터를 다시 적재하면 생성(npm run ttt:generate) → 적재를 다시 한다. 축구 적재는 CSV에서 빠진 선수를
--     지우지 않고 retired로 표시하므로 FK는 실패하지 않는다. 다시 생성하기 전까지 그 선수는 계속 정답으로 남는다.
--   * 세 테이블은 클라이언트가 직접 읽지 못한다(RLS on, 정책·권한 없음). 판은 ttt_pick_puzzle로만 나간다.
--   * game_modes: 솔로 모드는 모두 끔. hidden_games: 처음에는 숨김(관리자 확인 뒤 새 마이그레이션으로 공개).
--     src/games/registry.test.ts가 이 시드와 등록부(duels)가 같은지 검사한다.

create table public.ttt_conditions (
  id text primary key,
  kind text not null check (kind in ('club', 'nation', 'continent', 'league', 'teammate', 'title', 'squad', 'award', 'manager', 'final_goal')),
  label_ko text not null,
  label_en text not null,
  ref text not null
);

create table public.ttt_condition_players (
  condition_id text not null references public.ttt_conditions,
  player_id text not null references public.football_players,
  primary key (condition_id, player_id)
);

-- 선수별 조회·FK 검사용
create index ttt_condition_players_player on public.ttt_condition_players (player_id);

create table public.ttt_puzzles (
  id text primary key,
  theme text not null check (theme in ('eng', 'esp', 'ita', 'ger', 'eur')),
  r1 text not null references public.ttt_conditions,
  r2 text not null references public.ttt_conditions,
  r3 text not null references public.ttt_conditions,
  c1 text not null references public.ttt_conditions,
  c2 text not null references public.ttt_conditions,
  c3 text not null references public.ttt_conditions
);

create index ttt_puzzles_theme on public.ttt_puzzles (theme);

do $$
declare t text;
begin
  foreach t in array array['conditions', 'condition_players', 'puzzles'] loop
    execute format('alter table public.ttt_%s enable row level security', t);
    execute format('revoke all on table public.ttt_%s from public, anon, authenticated', t);
  end loop;
end
$$;

-- 판 하나를 무작위로 골라 src/games/tiki-taka-toe/logic.ts의 Prepared 모양으로 돌려준다:
--   { puzzle_id, theme, rows: [{id,kind,label}]×3, cols: [...]×3, answers: [[player_id…]×9], examples: [[이름…]×9] }
--   칸 순서는 행 우선(칸 i = 행 i/3 × 열 i%3). answers는 두 조건 선수 교집합(player_id 순),
--   examples는 그 칸 정답의 인지도 순 상위 5명 coalesce(name_ko, name_en). 테마가 없거나 판이 없으면 null.
-- 호출자:
--   * 한 화면 대전: 브라우저가 supabase.rpc('ttt_pick_puzzle', { p_options }) → authenticated, 승인 사용자만.
--   * duel Edge Function: 대국 시작 트랜잭션에서 소유자 연결(SUPABASE_DB_URL, JWT 없음)로 위치 인자 호출.
--     auth.uid()가 null이므로 is_approved()로는 못 거른다. 그래서 JWT 클레임이 아예 없거나 role이 service_role이면
--     서버 호출로 보고 통과시킨다(그 Edge Function이 이미 승인 사용자만 대국을 시작하게 한다).
--     anon·public에는 실행 권한이 없으므로 JWT 없는 클라이언트 호출은 권한 단계에서 막힌다.
create function public.ttt_pick_puzzle(p_options jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  pz public.ttt_puzzles;
  result jsonb;
begin
  if auth.uid() is null then
    if claims is not null and coalesce(claims ->> 'role', '') <> 'service_role' then
      raise exception 'not_approved' using errcode = '42501';
    end if;
  elsif not public.is_approved() then
    raise exception 'not_approved' using errcode = '42501';
  end if;

  select * into pz from public.ttt_puzzles where theme = p_options ->> 'theme' order by random() limit 1;
  if not found then
    return null;
  end if;

  with
  heads as (
    select h.ord, h.cid, h.ord <= 3 as is_row, jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label_ko) as obj
    from unnest(array[pz.r1, pz.r2, pz.r3, pz.c1, pz.c2, pz.c3]) with ordinality as h(cid, ord)
    join public.ttt_conditions c on c.id = h.cid
  ),
  cells as (
    select (r.ord - 1) * 3 + (c.ord - 4) as i, r.cid as rc, c.cid as cc
    from heads r cross join heads c
    where r.is_row and not c.is_row
  ),
  filled as (
    select g.i,
      (select coalesce(jsonb_agg(a.player_id order by a.player_id), '[]'::jsonb)
        from public.ttt_condition_players a
        join public.ttt_condition_players b on b.player_id = a.player_id and b.condition_id = g.cc
        where a.condition_id = g.rc) as answers,
      (select coalesce(jsonb_agg(x.name order by x.popularity desc, x.id), '[]'::jsonb)
        from (
          select p.id, p.popularity, coalesce(p.name_ko, p.name_en) as name
          from public.ttt_condition_players a
          join public.ttt_condition_players b on b.player_id = a.player_id and b.condition_id = g.cc
          join public.football_players p on p.id = a.player_id
          where a.condition_id = g.rc
          order by p.popularity desc, p.id
          limit 5
        ) x) as examples
    from cells g
  )
  select jsonb_build_object(
    'puzzle_id', pz.id,
    'theme', pz.theme,
    'rows', (select jsonb_agg(obj order by ord) from heads where is_row),
    'cols', (select jsonb_agg(obj order by ord) from heads where not is_row),
    'answers', (select jsonb_agg(answers order by i) from filled),
    'examples', (select jsonb_agg(examples order by i) from filled)
  ) into result;
  return result;
end
$$;

revoke execute on function public.ttt_pick_puzzle(jsonb) from public, anon;
grant execute on function public.ttt_pick_puzzle(jsonb) to authenticated;

insert into game_modes (game_id, daily, contest, free) values ('tiki-taka-toe', false, false, false);
insert into hidden_games (game_id) values ('tiki-taka-toe');
