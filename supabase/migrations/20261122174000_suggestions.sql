-- 제안 게시판: 승인 사용자가 사이트·게임별로 제안을 쓰고 공감한다 (설계 2026-11-23 suggestion-board)
--
-- 원칙
--   * 브라우저는 표를 select만 한다(RLS = can_see_suggestion_target). 쓰기는 모두 RPC로만.
--   * 분류 결과(suggestion_triage)는 관리자만 읽는다. 분류는 Edge Function `suggest`가 소유자 연결로 쓴다.
--   * 지우면 body를 null로 바꾸고 행은 남긴다(soft delete) → Realtime·목록에 지운 내용이 남지 않는다.
--     지운 글도 하루 5개 제한에는 센다.
--   * 대상(target)은 'site' 또는 game_modes의 game_id. 숨김 게임의 제안은 관리자만 본다.
--   * 오류는 raise exception using errcode = 'P0001', message = '<code>'.

-- ------------------------------------------------------------------ types
create type public.suggestion_status  as enum ('open', 'planned', 'design', 'shipped', 'rejected');
create type public.suggestion_verdict as enum ('recommend', 'hold', 'reject', 'duplicate');

-- ------------------------------------------------------------------ tables
create table public.suggestions (
  id           uuid primary key default gen_random_uuid(),
  target       text not null,
  user_id      uuid references public.profiles (id) on delete set null,
  body         text,
  status       public.suggestion_status not null default 'open',
  public_reason text,
  duplicate_of uuid references public.suggestions (id) on delete set null,
  pr_url       text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  shipped_at   timestamptz,
  deleted_at   timestamptz,
  constraint suggestions_content check (deleted_at is not null or body is not null),
  constraint suggestions_body_len check (
    body is null or char_length(regexp_replace(body, '^\s+|\s+$', '', 'g')) between 5 and 500),
  constraint suggestions_reason_len check (public_reason is null or char_length(public_reason) <= 200),
  constraint suggestions_pr_url check (
    pr_url is null or pr_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+$'),
  constraint suggestions_not_self_duplicate check (duplicate_of is null or duplicate_of <> id)
);

create index suggestions_target_created_idx on public.suggestions (target, created_at desc);
-- 하루 5개 제한 검사용
create index suggestions_user_created_idx on public.suggestions (user_id, created_at);
create index suggestions_status_idx on public.suggestions (status);

create table public.suggestion_triage (
  suggestion_id uuid primary key references public.suggestions (id) on delete cascade,
  verdict       public.suggestion_verdict not null,
  summary       text not null,
  note          text,
  triaged_at    timestamptz not null default now(),
  constraint suggestion_triage_summary_len check (char_length(summary) between 1 and 1000),
  constraint suggestion_triage_note_len check (note is null or char_length(note) <= 500)
);

create table public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

alter table public.suggestions       enable row level security;
alter table public.suggestion_triage enable row level security;
alter table public.suggestion_votes  enable row level security;

-- ------------------------------------------------------------------ helper
create function public.can_see_suggestion_target(p_target text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved()
     and (p_target = 'site' or public.is_admin() or not public._is_hidden_game(p_target))
$$;

-- ------------------------------------------------------------------ policies
create policy suggestions_select on public.suggestions
  for select to authenticated using (public.can_see_suggestion_target(target));

-- 제안이 보일 때만(제안 표의 RLS가 호출자 권한으로 적용된다)
create policy suggestion_votes_select on public.suggestion_votes
  for select to authenticated
  using (exists (select 1 from public.suggestions s where s.id = suggestion_id));

create policy suggestion_triage_select on public.suggestion_triage
  for select to authenticated using (public.is_admin());
-- insert/update/delete 정책 없음 = 브라우저 직접 쓰기 불가

-- ------------------------------------------------------------------ RPC: user
create function public.suggestion_list(p_target text default null)
returns table (id uuid, target text, handle text, body text, status public.suggestion_status,
               public_reason text, duplicate_of uuid, pr_url text, created_at timestamptz,
               votes int, voted boolean, mine boolean, can_delete boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_admin();
begin
  if not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select s.id, s.target, p.handle::text, s.body, s.status, s.public_reason,
           -- 원 제안이 지워졌거나 호출자에게 안 보이면 null
           case when o.id is not null then s.duplicate_of end,
           s.pr_url, s.created_at,
           (select count(*)::int from public.suggestion_votes v where v.suggestion_id = s.id),
           exists (select 1 from public.suggestion_votes v where v.suggestion_id = s.id and v.user_id = v_uid),
           s.user_id is not distinct from v_uid,
           v_admin or (s.user_id is not distinct from v_uid
                       and s.status = 'open'
                       and not exists (select 1 from public.suggestion_triage t where t.suggestion_id = s.id))
      from public.suggestions s
      left join public.profiles p on p.id = s.user_id
      left join public.suggestions o
             on o.id = s.duplicate_of
            and o.deleted_at is null
            and public.can_see_suggestion_target(o.target)
     where s.deleted_at is null
       and public.can_see_suggestion_target(s.target)
       and (p_target is null or s.target = p_target)
     order by s.created_at desc, s.id desc
     limit 200;
end
$$;

create function public.suggestion_post(p_target text, p_body text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_body text := nullif(regexp_replace(p_body, '^\s+|\s+$', '', 'g'), '');
  v_id   uuid;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_target is null
     or not (p_target = 'site' or exists (select 1 from public.game_modes g where g.game_id = p_target)) then
    raise exception using errcode = 'P0001', message = 'invalid_target';
  end if;
  if not public.can_see_suggestion_target(p_target) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_body is null or char_length(v_body) not between 5 and 500 then
    raise exception using errcode = 'P0001', message = 'invalid_body';
  end if;

  -- 같은 사용자의 동시 요청이 개수 검사를 함께 통과하지 않게 사용자별로 줄 세운다. 지운 글도 센다.
  perform pg_advisory_xact_lock(hashtextextended('suggestions:' || v_uid::text, 0));
  if (select count(*) from public.suggestions s
       where s.user_id = v_uid and s.created_at > now() - interval '24 hours') >= 5 then
    raise exception using errcode = 'P0001', message = 'too_many';
  end if;

  insert into public.suggestions (target, user_id, body)
  values (p_target, v_uid, v_body)
  returning suggestions.id into v_id;
  return v_id;
end
$$;

-- 본인(열려 있고 분류 전) 또는 관리자. 이미 지운 글은 조용히 성공한다.
create function public.suggestion_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_row   public.suggestions%rowtype;
  v_admin boolean := public.is_admin();
begin
  if not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_row from public.suggestions where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if v_row.user_id is distinct from auth.uid() and not v_admin then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if v_row.deleted_at is not null then
    return;
  end if;
  if not v_admin and (v_row.status <> 'open'
      or exists (select 1 from public.suggestion_triage t where t.suggestion_id = p_id)) then
    raise exception using errcode = 'P0001', message = 'not_deletable';
  end if;
  update public.suggestions set deleted_at = now(), body = null where id = p_id;
end
$$;

-- 새 공감 수를 돌려준다. 멱등.
create function public.suggestion_vote(p_id uuid, p_on boolean) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  -- 없음·삭제됨·안 보임은 모두 not_found. 공감하는 동안 지워지지 않게 잠근다.
  perform 1 from public.suggestions s
   where s.id = p_id and s.deleted_at is null and public.can_see_suggestion_target(s.target)
     for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if coalesce(p_on, false) then
    insert into public.suggestion_votes (suggestion_id, user_id) values (p_id, v_uid)
    on conflict do nothing;
  else
    delete from public.suggestion_votes where suggestion_id = p_id and user_id = v_uid;
  end if;
  return (select count(*)::int from public.suggestion_votes v where v.suggestion_id = p_id);
end
$$;

-- ------------------------------------------------------------------ RPC: admin
create function public.admin_suggestion_list()
returns table (id uuid, target text, handle text, body text, status public.suggestion_status,
               public_reason text, duplicate_of uuid, pr_url text, created_at timestamptz,
               votes int, verdict public.suggestion_verdict, summary text, note text, triaged_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return query
    select s.id, s.target, p.handle::text, s.body, s.status, s.public_reason, s.duplicate_of, s.pr_url,
           s.created_at,
           (select count(*)::int from public.suggestion_votes v where v.suggestion_id = s.id),
           t.verdict, t.summary, t.note, t.triaged_at
      from public.suggestions s
      left join public.profiles p on p.id = s.user_id
      left join public.suggestion_triage t on t.suggestion_id = s.id
     where s.deleted_at is null and s.status <> 'shipped'
     order by s.created_at desc, s.id desc
     limit 300;
end
$$;

create function public.admin_suggestion_decide(p_id uuid, p_approve boolean, p_reason text default null)
returns public.suggestion_status
language plpgsql volatile security definer set search_path = public as $$
declare
  v_row     public.suggestions%rowtype;
  v_verdict public.suggestion_verdict;
  v_reason  text := nullif(regexp_replace(p_reason, '^\s+|\s+$', '', 'g'), '');
  v_status  public.suggestion_status;
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select * into v_row from public.suggestions where id = p_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  select t.verdict into v_verdict from public.suggestion_triage t where t.suggestion_id = p_id;
  if v_verdict is null then
    raise exception using errcode = 'P0001', message = 'not_triaged';
  end if;
  -- 반영된 글은 결정할 수 없다. PR이 달린 글은 승인만 막는다(닫힌 PR 정리를 위해 거절은 허용).
  if v_row.status = 'shipped' or (v_row.pr_url is not null and coalesce(p_approve, false)) then
    raise exception using errcode = 'P0001', message = 'not_editable';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_reason';
  end if;

  if coalesce(p_approve, false) then
    v_status := case when v_verdict = 'hold' then 'design' else 'planned' end;
    update public.suggestions
       set status = v_status,
           duplicate_of = null,
           public_reason = case
             when v_reason is not null then v_reason
             when v_row.status = 'rejected' then null
             else public_reason end,
           decided_at = now()
     where id = p_id;
  else
    v_status := 'rejected';
    update public.suggestions
       set status = v_status,
           public_reason = coalesce(v_reason, public_reason),
           decided_at = now()
     where id = p_id;
  end if;
  return v_status;
end
$$;

create function public.admin_suggestion_shipped(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_status public.suggestion_status;
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  select s.status into v_status from public.suggestions s where s.id = p_id and s.deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if v_status <> 'design' then
    raise exception using errcode = 'P0001', message = 'not_editable';
  end if;
  update public.suggestions set status = 'shipped', shipped_at = now() where id = p_id;
end
$$;

create function public.admin_suggestion_pending_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  return (select count(*)::int
            from public.suggestions s
            join public.suggestion_triage t on t.suggestion_id = s.id
           where s.status = 'open' and s.deleted_at is null and t.verdict in ('recommend', 'hold'));
end
$$;

-- ------------------------------------------------------------------ table grants
revoke all on table public.suggestions, public.suggestion_triage, public.suggestion_votes
  from public, anon, authenticated;
grant select on table public.suggestions, public.suggestion_triage, public.suggestion_votes to authenticated;

-- ------------------------------------------------------------------ execute grants
revoke execute on function
  public.can_see_suggestion_target(text),
  public.suggestion_list(text),
  public.suggestion_post(text, text),
  public.suggestion_delete(uuid),
  public.suggestion_vote(uuid, boolean),
  public.admin_suggestion_list(),
  public.admin_suggestion_decide(uuid, boolean, text),
  public.admin_suggestion_shipped(uuid),
  public.admin_suggestion_pending_count()
from public, anon, authenticated;

-- can_see_suggestion_target은 RLS 정책이 invoker 권한으로 부르므로 authenticated에 연다(auth.uid()로 스스로 거른다).
grant execute on function
  public.can_see_suggestion_target(text),
  public.suggestion_list(text),
  public.suggestion_post(text, text),
  public.suggestion_delete(uuid),
  public.suggestion_vote(uuid, boolean),
  public.admin_suggestion_list(),
  public.admin_suggestion_decide(uuid, boolean, text),
  public.admin_suggestion_shipped(uuid),
  public.admin_suggestion_pending_count()
to authenticated;
