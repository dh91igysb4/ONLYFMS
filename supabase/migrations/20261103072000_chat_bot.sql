-- 채팅 봇: 데일리 채팅에 말투를 흉내 내는 AI 친구(예: 재원봇)를 넣는다 (설계 2026-11-03-chat-bot)
--
-- 원칙
--   * 봇의 성격(system_prompt)과 말투 예시(chat_bot_examples)는 실제 단톡방 대화에서 왔다.
--     저장소는 공개이므로 내용은 저장소에 두지 않고 restricted/(gitignore)에서 만든 seed SQL로 DB에만 넣는다.
--   * 두 표는 브라우저 권한이 전혀 없다. chat-bot Edge Function(소유자 연결)만 읽는다.
--   * 봇 글은 daily_chat에 user_id = null, bot_id = 봇 id로 들어간다. 볼 수 있는 사람(can_chat)은 그대로다.
--   * chat_list는 반환 형태를 바꾸지 않고, 봇 글의 handle만 봇 이름으로 채운다.

-- ------------------------------------------------------------------ tables
create table public.chat_bots (
  id            text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  -- 화면에 보이는 이름(profiles.handle과 겹쳐도 된다: 봇 글은 user_id가 없어 구분된다)
  handle        text not null check (char_length(handle) between 1 and 16),
  -- 이 말이 들어간 글에만 답한다(소문자 비교, 부분 일치)
  trigger_words text[] not null default '{}',
  system_prompt text not null,
  model         text not null default 'claude-sonnet-5-5',
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.chat_bot_examples (
  id      bigserial primary key,
  bot_id  text not null references public.chat_bots (id) on delete cascade,
  -- 앞 대화("이름: 말" 줄들)와 봇이 실제로 한 말(줄마다 말풍선 하나)
  context text not null,
  reply   text not null
);
create index chat_bot_examples_bot_idx on public.chat_bot_examples (bot_id);

-- 봇 호출 기록: 도배·비용 제한용 (누가 어느 문항에서 불렀나)
create table public.chat_bot_calls (
  id         bigserial primary key,
  bot_id     text not null references public.chat_bots (id) on delete cascade,
  item_id    uuid not null references public.contest_items (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index chat_bot_calls_item_idx on public.chat_bot_calls (item_id, created_at);
create index chat_bot_calls_user_idx on public.chat_bot_calls (user_id, created_at);

alter table public.chat_bots enable row level security;
alter table public.chat_bot_examples enable row level security;
alter table public.chat_bot_calls enable row level security;
-- 정책 없음 + 권한 회수 = 브라우저에서 읽기·쓰기 불가
revoke all on table public.chat_bots, public.chat_bot_examples, public.chat_bot_calls
  from public, anon, authenticated;
revoke all on sequence public.chat_bot_examples_id_seq, public.chat_bot_calls_id_seq
  from public, anon, authenticated;

-- ------------------------------------------------------------------ daily_chat
alter table public.daily_chat
  add column bot_id text references public.chat_bots (id) on delete set null;
-- 봇 글은 사용자 없이, 사진 없이
alter table public.daily_chat
  add constraint daily_chat_bot_row check (bot_id is null or (user_id is null and image_path is null));

-- 브라우저 select 권한에 bot_id를 더한다(Realtime 페이로드에도 실린다)
grant select (bot_id) on table public.daily_chat to authenticated;

-- ------------------------------------------------------------------ chat_list (형태 그대로, handle만 봇 이름 보충)
create or replace function public.chat_list(p_item uuid, p_before timestamptz default null, p_limit int default 100)
returns table (id uuid, user_id uuid, handle text, body text, image_path text,
               created_at timestamptz, deleted boolean, mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_chat(p_item) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select m.id, m.user_id, coalesce(p.handle::text, b.handle),
           case when m.deleted_at is null then m.body end,
           case when m.deleted_at is null then m.image_path end,
           m.created_at, m.deleted_at is not null, m.user_id is not distinct from auth.uid()
      from public.daily_chat m
      left join public.profiles p on p.id = m.user_id
      left join public.chat_bots b on b.id = m.bot_id
     where m.item_id = p_item
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 100));
end
$$;
