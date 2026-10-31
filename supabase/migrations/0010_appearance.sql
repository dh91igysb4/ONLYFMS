-- 0010_appearance: 계정별 화면 팔레트 (설계 docs/superpowers/specs/2026-11-01-appearance-palettes-design.md)

alter table public.profiles
  add column palette    text not null default 'classic',
  add column appearance text not null default 'dark';

alter table public.profiles
  add constraint profiles_palette_check check (palette in ('classic', 'navy', 'claret', 'stadium', 'graphite', 'indigo', 'slate', 'mono', 'sand', 'ice')),
  add constraint profiles_appearance_check check (appearance in ('dark', 'light', 'system'));

-- 직접 쓰기는 막혀 있다(0001). 본인 화면 설정만 이 함수로 바꾼다.
create function public.set_appearance(p_palette text, p_appearance text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_palette is null or p_appearance is null
     or p_palette not in ('classic', 'navy', 'claret', 'stadium', 'graphite', 'indigo', 'slate', 'mono', 'sand', 'ice')
     or p_appearance not in ('dark', 'light', 'system') then
    raise exception using errcode = 'P0001', message = 'appearance_invalid';
  end if;

  update public.profiles set palette = p_palette, appearance = p_appearance where id = v_uid;
end
$$;

revoke execute on function public.set_appearance(text, text) from public, anon, authenticated;
grant execute on function public.set_appearance(text, text) to authenticated;
