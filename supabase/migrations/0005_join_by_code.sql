-- 0005_join_by_code: 초대 링크(/join/<code>)로 참가, 서버 시각 조회 (Task 11)
--
--   * 초대 코드는 contests.invite_code 컬럼 권한에서 빠져 있어 브라우저가 대회 id를 코드로 찾을 수 없다.
--     그래서 코드로 참가하는 함수를 따로 둔다. 코드가 맞으면 대회 id를 돌려준다.
--   * server_now(): 브라우저 시각과의 차이를 맞추는 데 쓰는 서버 시각(밀리초). PlayView가 없는 화면용.

create function public.join_by_invite_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_c    public.contests%rowtype;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_code = '' then
    raise exception using errcode = 'P0001', message = 'invite_required';
  end if;
  select * into v_c from public.contests where lower(invite_code) = v_code;
  -- 숨김 전용 대회는 관리자만. 존재 여부를 드러내지 않도록 모르는 코드와 같은 오류를 준다.
  if not found or (public._contest_hidden_only(v_c.id) and not public.is_admin()) then
    raise exception using errcode = 'P0001', message = 'invite_required';
  end if;
  if v_c.cancelled_at is not null or now() >= v_c.ends_at then
    raise exception using errcode = 'P0001', message = 'contest_closed';
  end if;
  insert into public.contest_entries (contest_id, user_id) values (v_c.id, v_uid)
  on conflict do nothing;
  return v_c.id;
end
$$;

create function public.server_now() returns double precision
language sql stable as $$
  select extract(epoch from now()) * 1000
$$;

revoke execute on function public.join_by_invite_code(text), public.server_now() from public, anon;
grant execute on function public.join_by_invite_code(text), public.server_now() to authenticated;
