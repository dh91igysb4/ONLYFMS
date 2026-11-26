-- 티키타카토 판의 예시 정답 이름을 영어로만 (선수 이름은 영어로 보인다). 나머지는 20261125184055와 같다.
create or replace function public.ttt_pick_puzzle(p_options jsonb) returns jsonb
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
          select p.id, p.popularity, p.name_en as name
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
