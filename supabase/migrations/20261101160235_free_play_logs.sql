-- 자유 플레이 행동 로그 (설계 toothbrush §5.3)
-- 출제 시드와 행동 열을 저장해 재현할 수 있게 한다. 검증 수단이 아니라 리플레이·디버깅·밸런스 분석용이다.

create table public.free_play_logs (
  client_id  uuid primary key references public.free_plays (client_id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  seed       text not null,
  actions    jsonb not null,
  created_at timestamptz not null default now(),
  constraint free_play_logs_seed check (seed ~ '^[0-9a-f]{32}$'),
  constraint free_play_logs_actions_array check (jsonb_typeof(actions) = 'array'),
  -- 256KB. jsonb::text는 공백이 붙어 원문보다 약 25% 크다
  constraint free_play_logs_actions_size check (octet_length(actions::text) <= 262144)
);

alter table public.free_play_logs enable row level security;

-- 본인 점수 행인지. 호출자 RLS를 거치지 않으므로 숨김 게임이 되어도 본인 기록 확인이 막히지 않는다.
create function public._owns_free_play(p_client uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.free_plays
     where client_id = p_client and user_id = auth.uid()
  );
$$;

create policy free_play_logs_select on public.free_play_logs
  for select to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

create policy free_play_logs_insert on public.free_play_logs
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved() and public._owns_free_play(client_id));

-- UPDATE·DELETE 정책 없음

revoke all on table public.free_play_logs from public, anon, authenticated;
grant select on table public.free_play_logs to authenticated;
-- created_at은 기본값 now()
grant insert (client_id, user_id, seed, actions) on table public.free_play_logs to authenticated;

revoke execute on function public._owns_free_play(uuid) from public, anon, authenticated;
-- 정책이 invoker 권한으로 부르므로 authenticated에 연다. 함수가 auth.uid()로 스스로 거른다.
grant execute on function public._owns_free_play(uuid) to authenticated;
