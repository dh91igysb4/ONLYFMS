-- 0002_contests: 대회·문제·참가·기록·문제 은행·자유 플레이·숨김 게임과 RLS (설계 §5, §6, §7)
--
-- 원칙
--   * 정답(contest_items.puzzle/puzzle_key, 끝낸 attempts.state)은 대회 종료(now() >= ends_at) 전에는
--     다른 사람에게 절대 보이지 않는다. contest_items 원본 표와 attempts.state 컬럼은 authenticated에
--     select를 주지 않고, 가림 처리를 하는 security definer 함수 위의 security_invoker 뷰로만 노출한다.
--   * 클라이언트의 직접 쓰기는 free_plays INSERT(승인된 본인)뿐이다. 나머지는 RPC 함수(Task 6)와
--     Edge Function(소유자/서비스 연결)만 쓴다.

-- ------------------------------------------------------------------ types
create type public.contest_kind as enum ('daily', 'official', 'friendly');
create type public.contest_visibility as enum ('public', 'invite');

-- ------------------------------------------------------------------ tables
create table public.contests (
  id           uuid primary key default gen_random_uuid(),
  kind         public.contest_kind not null,
  title        text not null,
  created_by   uuid references auth.users (id) on delete set null,
  visibility   public.contest_visibility not null default 'public',
  invite_code  text unique,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  cancelled_at timestamptz,
  daily_key    text unique,
  created_at   timestamptz not null default now(),
  constraint contests_title_len check (char_length(title) between 1 and 40),
  constraint contests_time_order check (ends_at > starts_at),
  -- 초대 코드는 초대 대회에만, 10자
  constraint contests_invite_code check (
    (visibility = 'invite' and invite_code is not null and char_length(invite_code) = 10)
    or (visibility = 'public' and invite_code is null)),
  -- daily_key는 데일리에만, 데일리는 공개
  constraint contests_daily_key check (
    (kind = 'daily' and daily_key is not null and visibility = 'public')
    or (kind <> 'daily' and daily_key is null))
);

create table public.contest_items (
  id            uuid primary key default gen_random_uuid(),
  contest_id    uuid not null references public.contests (id) on delete cascade,
  position      int not null,
  game_id       text not null,
  options       jsonb not null default '{}'::jsonb,
  puzzle        jsonb,
  puzzle_key    text,
  logic_version int,
  generated_at  timestamptz,
  constraint contest_items_position unique (contest_id, position),
  constraint contest_items_position_range check (position between 1 and 10),
  constraint contest_items_game_id check (game_id ~ '^[a-z0-9-]+$')
);

create table public.contest_entries (
  contest_id uuid not null references public.contests (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (contest_id, user_id)
);

create table public.attempts (
  item_id        uuid not null references public.contest_items (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  state          jsonb not null,
  logic_version  int not null,
  finished       boolean not null default false,
  score          numeric(3,1) not null default 0,
  action_count   int not null default 0,
  started_at     timestamptz not null default now(),
  last_action_at timestamptz,
  finished_at    timestamptz,
  primary key (item_id, user_id),
  constraint attempts_score_range check (score between 0 and 10),
  constraint attempts_action_count check (action_count >= 0)
);

create table public.puzzle_bank (
  id           bigint generated always as identity primary key,
  game_id      text not null,
  puzzle       jsonb not null,
  puzzle_key   text not null,
  used_item_id uuid references public.contest_items (id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  constraint puzzle_bank_key unique (game_id, puzzle_key),
  constraint puzzle_bank_game_id check (game_id ~ '^[a-z0-9-]+$')
);

create table public.free_plays (
  id            bigint generated always as identity primary key,
  -- 오프라인 대기열 재전송 중복 방지(계획 Review Focus 4, §6에 없는 컬럼)
  client_id     uuid not null unique,
  user_id       uuid not null references auth.users (id) on delete cascade,
  game_id       text not null,
  options       jsonb not null default '{}'::jsonb,
  logic_version int not null,
  solved        boolean not null,
  score         numeric(3,1) not null,
  action_count  int not null,
  played_at     timestamptz not null default now(),
  constraint free_plays_score_range check (score between 0 and 10),
  constraint free_plays_action_count check (action_count >= 0),
  constraint free_plays_game_id check (game_id ~ '^[a-z0-9-]+$')
);

-- 등록부에서 hidden인 게임. src/games/registry.test.ts가 이 시드와 등록부가 같은지 검사한다.
create table public.hidden_games (
  game_id text primary key
);
insert into hidden_games (game_id) values ('number-guess');

-- ------------------------------------------------------------------ indexes
create index attempts_user_idx         on public.attempts (user_id);
create index contest_items_contest_idx on public.contest_items (contest_id);
create index contest_items_game_idx    on public.contest_items (game_id, generated_at);
create index contests_starts_idx       on public.contests (starts_at);
create index contests_ends_idx         on public.contests (ends_at);
create index contest_entries_user_idx  on public.contest_entries (user_id);
create index free_plays_user_game_idx  on public.free_plays (user_id, game_id, played_at);

-- ------------------------------------------------------------------ RLS on
alter table public.contests        enable row level security;
alter table public.contest_items   enable row level security;
alter table public.contest_entries enable row level security;
alter table public.attempts        enable row level security;
alter table public.puzzle_bank     enable row level security;
alter table public.free_plays      enable row level security;
alter table public.hidden_games    enable row level security;

-- ------------------------------------------------------------------ helpers
create function public._is_hidden_game(p_game text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hidden_games where game_id = p_game)
$$;

-- 문제가 하나 이상이고 모두 숨김 게임인 대회
create function public._contest_hidden_only(p_contest uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contest_items where contest_id = p_contest)
     and not exists (
       select 1 from public.contest_items i
        where i.contest_id = p_contest
          and not exists (select 1 from public.hidden_games h where h.game_id = i.game_id))
$$;

-- §7: 승인 사용자이면서 (관리자) 또는 (숨김 전용 대회가 아니고, 공개 대회이거나 참가자이거나 개설자)
create function public.can_see_contest(p_contest uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.contests c
     where c.id = p_contest
       and (public.is_admin()
            or (not public._contest_hidden_only(c.id)
                and (c.visibility = 'public'
                     or c.created_by = auth.uid()
                     or exists (select 1 from public.contest_entries e
                                 where e.contest_id = c.id and e.user_id = auth.uid())))))
$$;

-- 다른 사람의 기록: 대회 종료 후, can_see_contest, 숨김 게임이면 관리자만
create function public._others_attempt_readable(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contest_items i join public.contests c on c.id = i.contest_id
     where i.id = p_item
       and now() >= c.ends_at
       and public.can_see_contest(c.id)
       and (public.is_admin() or not public._is_hidden_game(i.game_id)))
$$;

-- 초대 코드: 개설자(승인 상태)와 관리자에게만, 아니면 null
create function public.contest_invite_code(p_contest uuid) returns text
language sql stable security definer set search_path = public as $$
  select c.invite_code from public.contests c
   where c.id = p_contest
     and public.is_approved()
     and (c.created_by = auth.uid() or public.is_admin())
$$;

-- 문제 목록: can_see_contest, 숨김 게임 문제는 관리자만, puzzle·puzzle_key는 종료 후에만(관리자 포함)
create function public._contest_items_public()
returns table (
  id uuid, contest_id uuid, "position" int, game_id text, options jsonb,
  puzzle jsonb, puzzle_key text, logic_version int, generated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.contest_id, i.position, i.game_id, i.options,
         case when now() >= c.ends_at then i.puzzle end,
         case when now() >= c.ends_at then i.puzzle_key end,
         i.logic_version, i.generated_at
    from public.contest_items i
    join public.contests c on c.id = i.contest_id
   where public.can_see_contest(c.id)
     and (public.is_admin() or not public._is_hidden_game(i.game_id))
$$;

-- 기록 목록: attempts RLS와 같은 행. state는 대회 종료 후이거나 본인이 끝낸 기록일 때만
-- (게임의 State에는 정답이 들어 있을 수 있다 — 진행 중 상태는 Edge Function의 publicState로만 본다)
create function public._attempts_public()
returns table (
  item_id uuid, user_id uuid, state jsonb, logic_version int, finished boolean, score numeric,
  action_count int, started_at timestamptz, last_action_at timestamptz, finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.item_id, a.user_id,
         case when now() >= c.ends_at or (a.user_id = auth.uid() and a.finished) then a.state end,
         a.logic_version, a.finished, a.score, a.action_count, a.started_at, a.last_action_at, a.finished_at
    from public.attempts a
    join public.contest_items i on i.id = a.item_id
    join public.contests c on c.id = i.contest_id
   where auth.uid() is not null
     and (a.user_id = auth.uid() or public._others_attempt_readable(a.item_id))
$$;

-- ------------------------------------------------------------------ views
create view public.contest_items_public with (security_invoker = true) as
  select * from public._contest_items_public();

create view public.attempts_public with (security_invoker = true) as
  select * from public._attempts_public();

-- ------------------------------------------------------------------ policies
create policy contests_select on public.contests
  for select to authenticated using (public.can_see_contest(id));

create policy contest_entries_select on public.contest_entries
  for select to authenticated using (public.can_see_contest(contest_id));

create policy attempts_select on public.attempts
  for select to authenticated
  using (user_id = auth.uid() or public._others_attempt_readable(item_id));

create policy puzzle_bank_select on public.puzzle_bank
  for select to authenticated using (public.is_admin());

create policy free_plays_select on public.free_plays
  for select to authenticated
  using (public.is_approved() and (public.is_admin() or not public._is_hidden_game(game_id)));

create policy free_plays_insert on public.free_plays
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

-- contest_items, hidden_games: 정책 없음 = authenticated에게 행이 보이지 않는다(정의자 함수로만 접근)

-- ------------------------------------------------------------------ table grants
-- Supabase 기본 권한(ALL)을 먼저 걷어내고 필요한 것만 연다.
revoke all on table
  public.contests, public.contest_items, public.contest_entries, public.attempts,
  public.puzzle_bank, public.free_plays, public.hidden_games,
  public.contest_items_public, public.attempts_public
from public, anon, authenticated;
revoke all on sequence public.puzzle_bank_id_seq, public.free_plays_id_seq from public, anon, authenticated;

-- invite_code는 컬럼 권한에서 뺀다 → contest_invite_code()로만
grant select (id, kind, title, created_by, visibility, starts_at, ends_at, cancelled_at, daily_key, created_at)
  on table public.contests to authenticated;
grant select on table public.contest_entries to authenticated;
-- state는 뺀다 → attempts_public 뷰로만
grant select (item_id, user_id, logic_version, finished, score, action_count, started_at, last_action_at, finished_at)
  on table public.attempts to authenticated;
grant select on table public.puzzle_bank to authenticated;
grant select on table public.free_plays to authenticated;
-- id(identity)와 played_at(기본값 now())은 클라이언트가 정하지 못한다
grant insert (client_id, user_id, game_id, options, logic_version, solved, score, action_count)
  on table public.free_plays to authenticated;
grant select on table public.contest_items_public, public.attempts_public to authenticated;

-- ------------------------------------------------------------------ execute grants
revoke execute on function
  public._is_hidden_game(text),
  public._contest_hidden_only(uuid),
  public.can_see_contest(uuid),
  public._others_attempt_readable(uuid),
  public.contest_invite_code(uuid),
  public._contest_items_public(),
  public._attempts_public()
from public, anon, authenticated;

-- 정책·뷰가 invoker 권한으로 부르므로 authenticated에 연다. 각 함수는 auth.uid()로 스스로 거른다.
grant execute on function
  public._is_hidden_game(text),
  public._contest_hidden_only(uuid),
  public.can_see_contest(uuid),
  public._others_attempt_readable(uuid),
  public.contest_invite_code(uuid),
  public._contest_items_public(),
  public._attempts_public()
to authenticated;
