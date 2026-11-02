-- 데일리 채팅: 그 데일리 문항을 끝낸 승인 사용자만 읽고 쓰는 채팅 (설계 2026-11-02-daily-chat §3)
--
-- 원칙
--   * 볼 수 있는 사람 = can_chat(item): 승인 사용자 + 데일리 대회 문항 + 취소 안 됨 + (숨김 게임이면 관리자)
--     + 본인 attempts.finished. 날이 지나도 같다.
--   * 브라우저는 표를 select만 한다(RLS = can_chat). 쓰기는 chat_post / chat_delete RPC로만.
--   * 지우면 body·image_path를 null로 바꾼다 → Realtime 페이로드에도 지운 내용이 남지 않는다.
--   * 사진은 비공개 버킷 daily-chat, 경로 <item_id>/<user_id>/<13자리 epoch_ms>.jpg.
--     storage 스키마·storage.foldername·supabase_realtime publication은 Supabase가 제공한다
--     (로컬 테스트는 supabase/tests/shim.sql이 흉내 낸다). 여기서는 버킷 행과 정책만 만든다.

-- ------------------------------------------------------------------ table
create table public.daily_chat (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.contest_items (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  body       text,
  image_path text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint daily_chat_content check (deleted_at is not null or body is not null or image_path is not null),
  constraint daily_chat_body_len check (
    body is null or char_length(regexp_replace(body, '^\s+|\s+$', '', 'g')) between 1 and 300),
  -- 작성자 본인 폴더·해당 문항만 (탈퇴로 user_id가 null이 되면 식이 null → 통과)
  constraint daily_chat_image_path check (
    image_path is null or image_path ~ ('^' || item_id || '/' || user_id || '/[0-9]{13}\.jpg$'))
);

create index daily_chat_item_created_idx on public.daily_chat (item_id, created_at);
-- 도배 검사(본인 최근 글)용
create index daily_chat_user_created_idx on public.daily_chat (user_id, created_at);

alter table public.daily_chat enable row level security;

-- ------------------------------------------------------------------ can_chat
create function public.can_chat(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1
      from public.contest_items i
      join public.contests c on c.id = i.contest_id
      join public.attempts a on a.item_id = i.id and a.user_id = auth.uid() and a.finished
     where i.id = p_item
       and c.kind = 'daily'
       and c.cancelled_at is null
       and (public.is_admin() or not public._is_hidden_game(i.game_id)))
$$;

-- Storage 경로용: 첫 폴더가 uuid 형식이 아니면 오류 없이 false (정책에서 ::uuid 형 변환이 터지지 않게)
create function public.can_chat_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.can_chat(((storage.foldername(p_name))[1])::uuid)
    else false
  end
$$;

-- ------------------------------------------------------------------ policies
create policy daily_chat_select on public.daily_chat
  for select to authenticated using (public.can_chat(item_id));
-- insert/update/delete 정책 없음 = 브라우저 직접 쓰기 불가

-- ------------------------------------------------------------------ RPC
-- 최신순, p_before보다 이전, 최대 100개
create function public.chat_list(p_item uuid, p_before timestamptz default null, p_limit int default 100)
returns table (id uuid, user_id uuid, handle text, body text, image_path text,
               created_at timestamptz, deleted boolean, mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_chat(p_item) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select m.id, m.user_id, p.handle::text,
           case when m.deleted_at is null then m.body end,
           case when m.deleted_at is null then m.image_path end,
           m.created_at, m.deleted_at is not null, m.user_id is not distinct from auth.uid()
      from public.daily_chat m
      left join public.profiles p on p.id = m.user_id
     where m.item_id = p_item
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 100));
end
$$;

create function public.chat_post(p_item uuid, p_body text, p_image_path text default null)
returns table (id uuid, created_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  -- 앞뒤 공백(스페이스·탭·줄바꿈·CR 등)을 모두 걷어낸다. 공백만이면 null
  v_body text := nullif(regexp_replace(p_body, '^\s+|\s+$', '', 'g'), '');
begin
  if v_uid is null or not public.can_chat(p_item) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if (v_body is null and p_image_path is null)
     or (v_body is not null and char_length(v_body) > 300)
     or (p_image_path is not null
         and p_image_path !~ ('^' || p_item::text || '/' || v_uid::text || '/[0-9]{13}\.jpg$')) then
    raise exception using errcode = 'P0001', message = 'invalid_message';
  end if;

  -- 같은 사용자의 동시 요청이 도배 검사를 함께 통과하지 않게 사용자별로 줄 세운다
  perform pg_advisory_xact_lock(hashtextextended('daily_chat:' || v_uid::text, 0));
  if exists (select 1 from public.daily_chat m
              where m.user_id = v_uid and m.created_at > now() - interval '2 seconds') then
    raise exception using errcode = 'P0001', message = 'too_fast';
  end if;
  if (select count(*) from public.daily_chat m
       where m.user_id = v_uid and m.created_at > now() - interval '1 hour') >= 60 then
    raise exception using errcode = 'P0001', message = 'too_many';
  end if;

  return query
    insert into public.daily_chat as m (item_id, user_id, body, image_path)
    values (p_item, v_uid, v_body, p_image_path)
    returning m.id, m.created_at;
end
$$;

-- 본인 또는 관리자. 지우기 전 image_path(없으면 null)를 돌려준다 → 화면이 Storage 파일을 지운다.
create function public.chat_delete(p_id uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_row public.daily_chat%rowtype;
begin
  if not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_row from public.daily_chat where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if v_row.user_id is distinct from auth.uid() and not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  update public.daily_chat
     set deleted_at = coalesce(deleted_at, now()), body = null, image_path = null
   where id = p_id;
  return v_row.image_path;
end
$$;

-- ------------------------------------------------------------------ table grants
revoke all on table public.daily_chat from public, anon, authenticated;
grant select (id, item_id, user_id, body, image_path, created_at, deleted_at)
  on table public.daily_chat to authenticated;

-- ------------------------------------------------------------------ execute grants
revoke execute on function
  public.can_chat(uuid),
  public.can_chat_path(text),
  public.chat_list(uuid, timestamptz, int),
  public.chat_post(uuid, text, text),
  public.chat_delete(uuid)
from public, anon, authenticated;

-- can_chat·can_chat_path는 RLS·Storage 정책이 invoker 권한으로 부르므로 authenticated에 연다(auth.uid()로 스스로 거른다).
grant execute on function
  public.can_chat(uuid),
  public.can_chat_path(text),
  public.chat_list(uuid, timestamptz, int),
  public.chat_post(uuid, text, text),
  public.chat_delete(uuid)
to authenticated;

-- ------------------------------------------------------------------ Realtime
-- postgres_changes는 구독자별로 select RLS(can_chat)를 적용한다. 대전 테이블은 넣지 않는다.
alter publication supabase_realtime add table public.daily_chat;

-- ------------------------------------------------------------------ Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('daily-chat', 'daily-chat', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy daily_chat_objects_select on storage.objects
  for select to authenticated
  -- 관리자도 보인다: Storage API의 삭제는 select 정책도 통과해야 하므로, 관리자가 끝내지 않은 문항의 사진도 지울 수 있게
  using (bucket_id = 'daily-chat'
         and (public.can_chat_path(name) or public.is_admin()));

create policy daily_chat_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'daily-chat'
              and public.can_chat_path(name)
              and (storage.foldername(name))[2] = auth.uid()::text);

create policy daily_chat_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'daily-chat'
         and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin()));
