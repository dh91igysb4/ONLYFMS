-- 선수·팀 검색 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §8)
-- 별칭(대표 이름 포함)의 정규화 열 alias_norm을 정규화한 입력과 비교한다.
--   점수 3 완전 일치, 2 앞부분 일치(전체 또는 이름의 한 단어: 'kane' → Harry Kane), 1 부분 일치, 0 trigram 유사도(pg_trgm.similarity_threshold, 기본 0.3) 이상
--   한글 두세 글자 이름은 trigram 유사도가 낮아(손흥민·흥민 0.17) 부분 일치를 함께 쓴다.
-- 정렬: 점수 → (선수, 일치 점수 1 이상) popularity → 유사도 → 선수는 popularity, 팀은 name_en → id. 폐기(retired) 제외.
-- 반환은 동명이인을 구분할 최소 정보만(생년, 포지션, 국적). 경력·소속은 주지 않는다.
-- 인자는 p_ 접두사: RETURNS TABLE의 kind 열과 이름이 겹치면 함수를 만들 수 없다.
--
-- 후보 찾기는 입력 길이로 나눈다 (별칭 6만 행 측정, 계획 Task 5 Step 4):
--   3글자 이상: trigram 인덱스(BitmapOr)가 7ms, 순차 스캔은 행마다 similarity를 계산해 110ms.
--     플래너가 GIN 비용을 비관적으로 잡아 순차 스캔을 고르므로 그 함수 안에서만 enable_seqscan = off.
--   1~2글자: 완전한 trigram이 없어 인덱스가 전 행을 후보로 돌려준다(1.9초). 순차 스캔 + LIKE만(5ms).
-- security definer: RLS가 걸린 채로는 LIKE·%(leakproof 아님)를 인덱스 조건으로 쓸 수 없어 늘 전 행을 훑는다(110ms).
--   그래서 다른 RPC처럼 정의자 권한으로 실행하고 승인 여부는 함수 첫머리에서 직접 확인한다.
--   내부 후보 함수(_football_match_*)는 누구에게도 실행 권한을 주지 않는다(직접 불러 RLS를 우회하지 못하게).

-- 후보 별칭 → 엔터티별 점수. 3글자 이상 (인덱스)
create function public._football_match_long(n text, pat text)
returns table(entity_id text, score int, sim real)
language sql stable set search_path = public, extensions set enable_seqscan = off as $$
  select a.entity_id,
    max(case when a.alias_norm = n then 3
             when a.alias_norm like pat || '%' or exists (select 1 from unnest(a.alias_words) w where w like pat || '%') then 2
             when a.alias_norm like '%' || pat || '%' then 1
             else 0 end),
    max(similarity(a.alias_norm, n))
  from public.football_aliases a
  where a.alias_norm like '%' || pat || '%' or a.alias_norm % n
  group by a.entity_id
$$;

-- 1~2글자 (순차 스캔, 부분 일치만)
create function public._football_match_short(n text, pat text)
returns table(entity_id text, score int, sim real)
language sql stable set search_path = public, extensions as $$
  select a.entity_id,
    max(case when a.alias_norm = n then 3
             when a.alias_norm like pat || '%' or exists (select 1 from unnest(a.alias_words) w where w like pat || '%') then 2
             else 1 end),
    max(similarity(a.alias_norm, n))
  from public.football_aliases a
  where a.alias_norm like '%' || pat || '%'
  group by a.entity_id
$$;

create function public.football_search(p_q text, p_kind text, p_lim int default 10)
returns table(id text, kind text, name_ko text, name_en text, nation_id text, "position" text, birth_year int, team_kind text)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  n text;
  pat text;
  k int;
begin
  if not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_kind is null or p_kind not in ('player', 'team') then
    raise exception using errcode = 'P0001', message = 'bad_kind';
  end if;
  n := public.football_norm(coalesce(p_q, ''));
  if n = '' then
    return;
  end if;
  k := greatest(1, least(coalesce(p_lim, 10), 20));
  -- LIKE 특수 문자 이스케이프 (기본 이스케이프 문자 \)
  pat := replace(replace(replace(n, '\', '\\'), '%', '\%'), '_', '\_');

  if p_kind = 'player' then
    return query
    with m as (
      -- 길이 조건이 거짓인 쪽은 One-Time Filter로 실행되지 않는다
      select * from public._football_match_long(n, pat) where char_length(n) >= 3
      union all
      select * from public._football_match_short(n, pat) where char_length(n) < 3
    )
    select p.id, 'player'::text, p.name_ko, p.name_en, p.nation_id, p.position, left(p.birth_date, 4)::int, null::text
    from m join public.football_players p on p.id = m.entity_id
    where not p.retired
    -- 같은 점수면 인지도 먼저(유사도는 짧은 이름이 높게 나와 'xavi'에 사비 에르난데스보다 사비 시몬스가 앞섰다).
    -- 유사도로만 걸린 결과(점수 0)는 유사도 먼저
    order by m.score desc, case when m.score > 0 then p.popularity end desc nulls last, m.sim desc, p.popularity desc, p.id
    limit k;
  else
    return query
    with m as (
      -- 길이 조건이 거짓인 쪽은 One-Time Filter로 실행되지 않는다
      select * from public._football_match_long(n, pat) where char_length(n) >= 3
      union all
      select * from public._football_match_short(n, pat) where char_length(n) < 3
    )
    select t.id, 'team'::text, t.name_ko, t.name_en, t.nation_id, null::text, null::int, t.kind
    from m join public.football_teams t on t.id = m.entity_id
    where not t.retired
    order by m.score desc, m.sim desc, t.name_en, t.id
    limit k;
  end if;
end
$$;

revoke all on function public._football_match_long(text, text) from public, anon, authenticated;
revoke all on function public._football_match_short(text, text) from public, anon, authenticated;
revoke all on function public.football_search(text, text, int) from public, anon, authenticated;
grant execute on function public.football_search(text, text, int) to authenticated;
