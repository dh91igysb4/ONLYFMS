-- 홈 대시보드 블록 배치 저장 (설계 docs/superpowers/specs/2026-11-01-home-dashboard-design.md §4.1)

alter table public.profiles add column home_layout jsonb;

-- 직접 쓰기는 막혀 있다(0001). 본인 홈 배치만 이 함수로 바꾼다. null이면 기본 배치로 되돌린다.
create function public.set_home_layout(p_layout jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_el  jsonb;
  v_ids text[] := '{}';
  v_id  text;
begin
  perform public._require_approved();

  if p_layout is not null then
    if jsonb_typeof(p_layout) <> 'array'
       or jsonb_array_length(p_layout) not between 1 and 32 then
      raise exception using errcode = 'P0001', message = 'home_layout_invalid';
    end if;

    for v_el in select value from jsonb_array_elements(p_layout) loop
      if jsonb_typeof(v_el) <> 'object'
         or (select count(*) from jsonb_object_keys(v_el)) <> 2
         or not (v_el ? 'id' and v_el ? 'on')
         or jsonb_typeof(v_el -> 'id') <> 'string'
         or jsonb_typeof(v_el -> 'on') <> 'boolean' then
        raise exception using errcode = 'P0001', message = 'home_layout_invalid';
      end if;
      v_id := v_el ->> 'id';
      if v_id !~ '^[a-z0-9-]{1,32}$' or v_id = any (v_ids) then
        raise exception using errcode = 'P0001', message = 'home_layout_invalid';
      end if;
      v_ids := v_ids || v_id;
    end loop;
  end if;

  update public.profiles set home_layout = p_layout where id = v_uid;
end
$$;

revoke execute on function public.set_home_layout(jsonb) from public, anon, authenticated;
grant execute on function public.set_home_layout(jsonb) to authenticated;
