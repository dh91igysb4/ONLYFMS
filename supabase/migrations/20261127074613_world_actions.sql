-- world 행동 중복 방지(낚시 경제 설계 2026-11-27-fishing-economy-design.md §4.1).
-- 화면이 act마다 action_id(UUID)를 보내면 world Edge Function이 세이브 행을 잠근 뒤 여기서 찾는다.
--   같은 id·같은 payload → 저장한 응답을 그대로 돌려준다(세이브·지갑·기록을 다시 쓰지 않는다)
--   같은 id·다른 payload → 409 action_id_reused
--   처음 보는 id → 처리하고 200 응답을 같은 트랜잭션에서 여기에 쓴다
-- world_saves처럼 브라우저는 읽지도 쓰지도 못한다(RLS만 켜고 정책·권한 없음). 하루 지난 행은 함수가 그 사용자의 다음 기록 때 지운다.

create table public.world_actions (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  game_id      text not null check (game_id ~ '^[a-z0-9-]+$'),
  action_id    uuid not null,
  payload_hash text not null,
  response     jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, game_id, action_id)
);

create index world_actions_user_created on public.world_actions (user_id, created_at);

alter table public.world_actions enable row level security;
revoke all on table public.world_actions from public, anon, authenticated;
