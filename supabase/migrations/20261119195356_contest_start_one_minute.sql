-- 대회 시작 시각 하한을 "지금부터 5분 뒤"에서 "다음 분(지금 분 + 1분)"으로 낮춘다.
-- 화면 입력이 분 단위라서 기준을 분으로 자른 현재 시각에 둔다: 04:53:30에 04:54를 고를 수 있다.
-- 나머지 검사는 0003과 같다. create_contest·update_contest가 이 함수를 쓴다.
create or replace function public._validate_contest_input(
  p_title text, p_starts_at timestamptz, p_duration_min int, p_items jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_title text := btrim(p_title);
  v_item  jsonb;
  v_count numeric;
  v_total int := 0;
begin
  if v_title is null or char_length(v_title) not between 1 and 40 then
    raise exception using errcode = 'P0001', message = 'title_invalid';
  end if;
  if p_starts_at is null or p_starts_at < date_trunc('minute', now()) + interval '1 minute' then
    raise exception using errcode = 'P0001', message = 'start_too_soon';
  end if;
  if p_starts_at > now() + interval '30 days' then
    raise exception using errcode = 'P0001', message = 'start_too_far';
  end if;
  if p_duration_min is null or p_duration_min not between 5 and 180 then
    raise exception using errcode = 'P0001', message = 'duration_invalid';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'items_invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'game_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'options') is distinct from 'object'
       or jsonb_typeof(v_item -> 'count') is distinct from 'number' then
      raise exception using errcode = 'P0001', message = 'items_invalid';
    end if;
    v_count := (v_item ->> 'count')::numeric;
    if v_count < 1 or v_count > 10 or v_count <> trunc(v_count) then
      raise exception using errcode = 'P0001', message = 'items_invalid';
    end if;
    v_total := v_total + v_count::int;
  end loop;
  if v_total not between 1 and 10 then
    raise exception using errcode = 'P0001', message = 'items_invalid';
  end if;

  if not public.contest_games_allowed(p_items) then
    raise exception using errcode = 'P0001', message = 'game_not_allowed';
  end if;
  return v_title;
end
$$;
