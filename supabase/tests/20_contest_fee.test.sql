-- 대회 참가비 차감·취소 환불·60/30/10 분배 (지갑 5단계 Task 23, 설계 §10, §14)
-- 승인 사용자 역할로 create_contest·join_contest·join_by_invite_code·cancel_contest를 부르고, 정산을 흉내 내려면
-- 슈퍼유저가 대회 시각을 과거로 옮기고 기록(attempts)을 직접 넣은 뒤 settle_due()를 부른다.
begin;
select plan(104);

\set f1 '00000000-0000-0000-0000-0000000008f1'
\set f2 '00000000-0000-0000-0000-0000000008f2'
\set f3 '00000000-0000-0000-0000-0000000008f3'
\set f4 '00000000-0000-0000-0000-0000000008f4'
\set f5 '00000000-0000-0000-0000-0000000008f5'
\set f6 '00000000-0000-0000-0000-0000000008f6'
\set fa '00000000-0000-0000-0000-0000000008fa'
\set fp '00000000-0000-0000-0000-0000000008ff'
\set F1 '{"sub":"00000000-0000-0000-0000-0000000008f1","role":"authenticated"}'
\set F2 '{"sub":"00000000-0000-0000-0000-0000000008f2","role":"authenticated"}'
\set F3 '{"sub":"00000000-0000-0000-0000-0000000008f3","role":"authenticated"}'
\set F4 '{"sub":"00000000-0000-0000-0000-0000000008f4","role":"authenticated"}'
\set F5 '{"sub":"00000000-0000-0000-0000-0000000008f5","role":"authenticated"}'
\set F6 '{"sub":"00000000-0000-0000-0000-0000000008f6","role":"authenticated"}'
\set FA '{"sub":"00000000-0000-0000-0000-0000000008fa","role":"authenticated"}'
\set FP '{"sub":"00000000-0000-0000-0000-0000000008ff","role":"authenticated"}'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  (:'f1', 'cf1@example.com'), (:'f2', 'cf2@example.com'), (:'f3', 'cf3@example.com'), (:'f4', 'cf4@example.com'),
  (:'f5', 'cf5@example.com'), (:'f6', 'cf6@example.com'), (:'fa', 'cfa@example.com'), (:'fp', 'cfp@example.com');
update public.profiles set status = 'approved', handle = 'feeone'   where id = :'f1';
update public.profiles set status = 'approved', handle = 'feetwo'   where id = :'f2';
update public.profiles set status = 'approved', handle = 'feethree' where id = :'f3';
update public.profiles set status = 'approved', handle = 'feefour'  where id = :'f4';
update public.profiles set status = 'approved', handle = 'feefive'  where id = :'f5';
update public.profiles set status = 'approved', handle = 'feesix'   where id = :'f6';
update public.profiles set status = 'approved', handle = 'feeboss', is_admin = true where id = :'fa';
update public.profiles set handle = 'feepend' where id = :'fp';

insert into public.game_modes (game_id, daily, contest, free) values
  ('g-fee', false, true, false), ('g-fhidden', false, true, false);
insert into public.hidden_games (game_id) values ('g-fhidden');

select public._gold_move(:'f1', 100000, 'admin', 'cf-seed-f1');
select public._gold_move(:'f2', 100000, 'admin', 'cf-seed-f2');
select public._gold_move(:'f3', 100000, 'admin', 'cf-seed-f3');
select public._gold_move(:'f4', 100000, 'admin', 'cf-seed-f4');
select public._gold_move(:'f5', 100000, 'admin', 'cf-seed-f5');
select public._gold_move(:'f6', 500,    'admin', 'cf-seed-f6');
select public._gold_move(:'fa', 100000, 'admin', 'cf-seed-fa');

-- 테스트 도우미: 오류의 DETAIL
create function pg_temp.err_detail(q text) returns text language plpgsql as $$
declare d text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;

-- 대회 만들기 도우미(f1 등 현재 사용자로). 시작 10분 뒤, 30분
create function pg_temp.mk(p_title text, p_fee int, p_vis text default 'public', p_game text default 'g-fee')
returns uuid language sql as $$
  select id from public.create_contest(p_title, now() + interval '10 minutes', 30, p_vis::public.contest_visibility,
    jsonb_build_array(jsonb_build_object('game_id', p_game, 'options', '{}'::jsonb, 'count', 1)), false, p_fee)
$$;
grant execute on function pg_temp.mk(text, int, text, text) to authenticated;
grant execute on function pg_temp.err_detail(text) to authenticated;

-- 끝난 대회로 옮기고 기록을 넣는 도우미(슈퍼유저). scores: user → (점수, 행동 수)
create function pg_temp.finish(p_contest uuid, p_rows jsonb) returns void language plpgsql as $$
declare
  v_item uuid;
  r record;
begin
  update public.contests set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = p_contest;
  select i.id into v_item from public.contest_items i where i.contest_id = p_contest order by i.position limit 1;
  for r in select * from jsonb_to_recordset(p_rows) as x(uid uuid, score numeric, acts int, mins int) loop
    insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count, started_at, last_action_at, finished_at)
    values (v_item, r.uid, '{}', 1, true, r.score, r.acts, now() - interval '30 hours',
            now() - interval '30 hours' + make_interval(mins => coalesce(r.mins, 0)),
            now() - interval '30 hours' + make_interval(mins => coalesce(r.mins, 0)));
  end loop;
end $$;

create function pg_temp.bal(p_uid uuid) returns bigint language sql as $$
  select coalesce((select balance from public.wallets where user_id = p_uid), 0)
$$;
grant execute on function pg_temp.bal(uuid) to authenticated;

-- 대회 하나의 장부 합(모인 돈 = 나간 돈이면 0)
create function pg_temp.net(p_contest uuid) returns bigint language sql as $$
  select coalesce(sum(delta), 0)::bigint from public.gold_ledger
   where reason in ('contest_fee', 'contest_prize', 'contest_refund') and ref = p_contest::text
$$;

create function pg_temp.paid(p_contest uuid, p_reason text) returns text language sql as $$
  select coalesce(string_agg(p.handle || ':' || l.delta || coalesce(':' || l.note, ''), ',' order by l.delta desc, p.handle), '')
    from public.gold_ledger l join public.profiles p on p.id = l.user_id
   where l.reason = p_reason and l.ref = p_contest::text
$$;

-- ---------------------------------------------------------------- 스키마·제약
select has_column('public', 'contests', 'entry_fee', 'contests.entry_fee');
select col_default_is('public', 'contests', 'entry_fee', '0', 'entry_fee 기본 0');
select throws_ok($$insert into public.contests (kind, title, visibility, starts_at, ends_at, entry_fee)
  values ('friendly', 'x', 'public', now() + interval '1 hour', now() + interval '2 hours', -1)$$, '23514', null, '참가비 −1 거절');
select throws_ok($$insert into public.contests (kind, title, visibility, starts_at, ends_at, entry_fee)
  values ('friendly', 'x', 'public', now() + interval '1 hour', now() + interval '2 hours', 41001)$$, '23514', null, '참가비 41,001 거절');
select lives_ok($$insert into public.contests (kind, title, visibility, starts_at, ends_at, entry_fee)
  values ('friendly', 'cf-max', 'public', now() + interval '1 hour', now() + interval '2 hours', 41000)$$, '참가비 41,000은 허용');
select throws_ok($$insert into public.contests (kind, title, visibility, starts_at, ends_at, daily_key, entry_fee)
  values ('daily', 'x', 'public', now() + interval '1 hour', now() + interval '2 hours', 'g-fee:2001-01-01', 100)$$,
  '23514', null, '데일리는 참가비 0만(check)');
select is((select c.oid::regclass::text from pg_constraint k join pg_class c on c.oid = k.conrelid
            where k.conname = 'contests_entry_fee' and pg_get_constraintdef(k.oid) like '%41000%'), 'contests',
  '상한 41,000 = FEE_MAX');
select is((public._economy() ->> 'fee_max')::int, 41000, '_economy() fee_max 41,000');
select ok(has_column_privilege('authenticated', 'public.contests', 'entry_fee', 'select'), 'authenticated가 entry_fee를 읽음');
select ok(not has_function_privilege('authenticated', 'public._contest_enter(uuid, uuid, int)', 'execute'),
  '_contest_enter는 authenticated에 실행 권한 없음');
select ok(not has_function_privilege('authenticated', 'public._contest_refunds(uuid)', 'execute'),
  '_contest_refunds는 authenticated에 실행 권한 없음');
select ok(not exists (select 1 from pg_proc where proname = 'create_contest' and pronargs = 6), '옛 6인자 create_contest는 지움');

-- 잠금: 대회 행 for no key update, profiles를 잠그지 않음, 환불은 user_id 오름차순, 상한 계산 없음
select ok(position('for no key update' in pg_get_functiondef('public.join_contest(uuid,text,int)'::regprocedure)) > 0
      and position('for no key update' in pg_get_functiondef('public.join_by_invite_code(text,int)'::regprocedure)) > 0
      and position('for no key update' in pg_get_functiondef('public.cancel_contest(uuid)'::regprocedure)) > 0,
  '참가·초대 참가·취소는 대회 행을 for no key update로 잡는다');
select ok(not exists (select 1 from pg_proc p where p.proname in
            ('create_contest', 'join_contest', 'join_by_invite_code', 'cancel_contest', '_contest_enter', '_contest_payouts')
            and pg_get_functiondef(p.oid) ~* 'profiles[^;]*for\s+(no\s+key\s+)?update'),
  '참가비 함수는 profiles를 잠그지 않는다');
select ok(pg_get_functiondef('public.cancel_contest(uuid)'::regprocedure) ~ 'order by\s+f\.user_id',
  '취소 환불은 user_id 오름차순');
select ok(position('soft_cap' in pg_get_functiondef('public._contest_payouts(uuid)'::regprocedure)) = 0
      and position('soft_cap' in pg_get_functiondef('public._contest_enter(uuid,uuid,int)'::regprocedure)) = 0,
  '참가비·분배 함수에 사이트 상한 계산이 없다');

-- ---------------------------------------------------------------- 지갑이 보이기 전: 참가비 0만
select ok(not has_function_privilege('authenticated', 'public._wallet_enabled()', 'execute'),
  '_wallet_enabled는 authenticated에 실행 권한 없음');
select is(public._wallet_enabled(), true, '_wallet_enabled()는 true (낚시 wallet: true, 마이그레이션 20261124030000_wallet_on)');
-- 꺼진 동안의 규칙은 지갑을 켜기 전 배포(옛 DB)를 위해 그대로 지킨다: 트랜잭션 안에서만 끈다(롤백됨)
create or replace function public._wallet_enabled() returns boolean
language sql immutable security definer set search_path = public as $$ select false $$;
set local role authenticated;
set local request.jwt.claims = :'F1';
select throws_ok($$select pg_temp.mk('cf-off', 1000)$$, 'P0001', 'fee_invalid',
  '지갑이 꺼져 있으면 잔액이 있어도 참가비 대회를 만들 수 없다(fee_invalid)');
select lives_ok($$select pg_temp.mk('cf-off0', 0)$$, '지갑이 꺼져 있어도 참가비 0 대회는 만든다');
reset role;
select is(pg_temp.bal(:'f1'), 100000::bigint, '꺼진 동안 잔액 그대로');
-- 이 아래는 지갑이 켜진 상태(트랜잭션 안에서만, 롤백됨)
create or replace function public._wallet_enabled() returns boolean
language sql immutable security definer set search_path = public as $$ select true $$;

-- ---------------------------------------------------------------- 만들기
set local role authenticated;
set local request.jwt.claims = :'F1';
-- 옛 화면: 인자 6개
select lives_ok($$select * from public.create_contest('cf-old', now() + interval '10 minutes', 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb, false)$$, '옛 인자 6개로 만들기');
reset role;
select is((select entry_fee from public.contests where title = 'cf-old'), 0, '옛 인자: 참가비 0');
select is((select count(*)::int from public.gold_ledger l join public.contests c on l.ref = c.id::text where c.title = 'cf-old'), 0,
  '옛 인자: 장부 없음');
select ok(exists (select 1 from public.contest_entries e join public.contests c on c.id = e.contest_id
                   where c.title = 'cf-old' and e.user_id = :'f1'), '옛 인자: 만든 사람 자동 참가');

set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-a', 1000) as ca \gset
reset role;
select is(pg_temp.bal(:'f1'), 99000::bigint, '참가비 1,000 대회 만들기 → 만든 사람 −1,000');
select is((select row(delta, game_id, note)::text from public.gold_ledger where user_id = :'f1' and reason = 'contest_fee' and ref = :'ca'),
  row(-1000::bigint, null::text, null::text)::text, 'contest_fee 줄: ref = 대회 id, game_id null');
select is((select entry_fee from public.contests where id = :'ca'), 1000, 'entry_fee 1,000');

set local role authenticated;
set local request.jwt.claims = :'F6';
select throws_ok($$select pg_temp.mk('cf-poor', 1000)$$, 'P0001', 'not_enough_gold', '잔액 500으로 참가비 1,000 대회 → not_enough_gold');
select throws_ok($$select pg_temp.mk('cf-bad', 41001)$$, 'P0001', 'fee_invalid', '참가비 41,001 → fee_invalid');
select throws_ok($$select pg_temp.mk('cf-bad', -1)$$, 'P0001', 'fee_invalid', '참가비 −1 → fee_invalid');
reset role;
select is((select count(*)::int from public.contests where created_by = :'f6'), 0, '실패한 만들기는 대회 행도 없다');
select is(pg_temp.bal(:'f6'), 500::bigint, 'f6 잔액 그대로');

set local role authenticated;
set local request.jwt.claims = :'F1';
select lives_ok($$select * from public.create_contest('cf-null', now() + interval '10 minutes', 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb, false, null)$$, '참가비 null = 0');
reset role;

set local role authenticated;
set local request.jwt.claims = :'FA';
select throws_ok($$select pg_temp.mk('cf-hid', 1000, 'public', 'g-fhidden')$$, 'P0001', 'fee_not_allowed',
  '숨김 게임이 든 대회 + 참가비 → fee_not_allowed');
select lives_ok($$select pg_temp.mk('cf-hid0', 0, 'public', 'g-fhidden')$$, '숨김 게임 대회 참가비 0은 가능');
select pg_temp.mk('cf-admin', 500) as cadm \gset
select throws_ok(format($q$select public.update_contest(%L, 'cf-admin', now() + interval '20 minutes', 30, 'public',
  '[{"game_id":"g-fhidden","options":{},"count":1}]'::jsonb)$q$, :'cadm'), 'P0001', 'fee_not_allowed',
  '참가비 대회를 고쳐 숨김 게임을 넣으면 fee_not_allowed');
select lives_ok(format($q$select public.update_contest(%L, 'cf-admin2', now() + interval '20 minutes', 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":2}]'::jsonb)$q$, :'cadm'), '참가비 대회의 다른 고치기는 그대로');
reset role;
select is((select entry_fee from public.contests where id = :'cadm'), 500, '고쳐도 참가비는 그대로');
select throws_ok(format('update public.contests set entry_fee = 0 where id = %L', :'cadm'), 'P0001', 'fee_immutable',
  '참가비는 바꿀 수 없다(fee_immutable)');

set local role authenticated;
set local request.jwt.claims = :'FP';
select throws_ok($$select pg_temp.mk('cf-pend', 0)$$, 'P0001', 'forbidden', '대기 사용자 만들기 → forbidden');
reset role;

-- ---------------------------------------------------------------- 참가
set local role authenticated;
set local request.jwt.claims = :'F2';
select throws_ok(format('select public.join_contest(%L)', :'ca'), 'P0001', 'fee_mismatch',
  '참가비를 모르는 참가(옛 화면·자동 참가) → fee_mismatch');
select is(pg_temp.err_detail(format('select public.join_contest(%L)', :'ca')), '1000', 'fee_mismatch DETAIL = 지금 참가비');
select throws_ok(format('select public.join_contest(%L, null, 500)', :'ca'), 'P0001', 'fee_mismatch', '다른 금액 → fee_mismatch');
reset role;
select is((select count(*)::int from public.contest_entries where contest_id = :'ca' and user_id = :'f2'), 0,
  'fee_mismatch: 참가 행 없음');
select is(pg_temp.bal(:'f2'), 100000::bigint, 'fee_mismatch: 돈 그대로');

set local role authenticated;
set local request.jwt.claims = :'F2';
select lives_ok(format('select public.join_contest(%L, null, 1000)', :'ca'), '참가비 1,000을 알고 참가');
select lives_ok(format('select public.join_contest(%L, null, 1000)', :'ca'), '다시 참가 → 아무 일 없음');
select lives_ok(format('select public.join_contest(%L)', :'ca'), '이미 참가했으면 참가비를 몰라도 멱등');
reset role;
select is(pg_temp.bal(:'f2'), 99000::bigint, '여러 번 참가해도 한 번만 −1,000');
select is((select count(*)::int from public.gold_ledger where user_id = :'f2' and reason = 'contest_fee' and ref = :'ca'), 1,
  'f2 contest_fee 한 줄');

set local role authenticated;
set local request.jwt.claims = :'F6';
select throws_ok(format('select public.join_contest(%L, null, 1000)', :'ca'), 'P0001', 'not_enough_gold', '잔액 부족 참가 → not_enough_gold');
reset role;
select is((select count(*)::int from public.contest_entries where contest_id = :'ca' and user_id = :'f6'), 0,
  '잔액 부족: 참가 행 없음');

set local role authenticated;
set local request.jwt.claims = :'FP';
select throws_ok(format('select public.join_contest(%L, null, 1000)', :'ca'), 'P0001', 'forbidden', '대기 사용자 참가 → forbidden');
reset role;

-- 초대 대회
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-inv', 700, 'invite') as cinv \gset
reset role;
select invite_code as cinvcode from public.contests where id = :'cinv' \gset
set local role authenticated;
set local request.jwt.claims = :'F3';
select throws_ok(format('select public.join_by_invite_code(%L)', :'cinvcode'), 'P0001', 'fee_mismatch',
  '초대 링크 첫 시도(참가비 0) → fee_mismatch');
select is(pg_temp.err_detail(format('select public.join_by_invite_code(%L)', :'cinvcode')), '700', '초대 fee_mismatch DETAIL 700');
select is(public.join_by_invite_code(upper(:'cinvcode'), 700), :'cinv'::uuid, '참가비를 알고 초대 참가 → 대회 id');
select lives_ok(format('select public.join_contest(%L, %L, 700)', :'cinv', :'cinvcode'), '초대 참가 뒤 join_contest → 멱등');
select is(public.join_by_invite_code(:'cinvcode'), :'cinv'::uuid, '이미 참가했으면 초대 링크 다시 → 멱등');
reset role;
select is(pg_temp.bal(:'f3'), 99300::bigint, '초대 참가비 한 번만 −700');

-- 정산된 대회에는 참가·취소가 닿지 않는다 (행 잠금을 오래 기다린 트랜잭션 흉내: 시각은 열려 있어도 settled_at)
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-settled', 100) as cset \gset
reset role;
update public.contests set settled_at = now() where id = :'cset';
set local role authenticated;
set local request.jwt.claims = :'F2';
select throws_ok(format('select public.join_contest(%L, null, 100)', :'cset'), 'P0001', 'contest_closed', '정산된 대회 참가 → contest_closed');
set local request.jwt.claims = :'F1';
select throws_ok(format('select public.cancel_contest(%L)', :'cset'), 'P0001', 'not_editable', '정산된 대회 취소 → not_editable');
reset role;

-- 남이 낸 뒤에는 시작 시각·제한 시간·문제를 바꿀 수 없다(제목·공개 범위는 가능)
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-frz', 100) as cfrz \gset
reset role;
select starts_at as cfrzstart from public.contests where id = :'cfrz' \gset
set local role authenticated;
set local request.jwt.claims = :'F1';
select lives_ok(format($q$select public.update_contest(%L, 'cf-frz2', %L::timestamptz + interval '1 minute', 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb)$q$, :'cfrz', :'cfrzstart'),
  '만든 사람만 낸 동안은 시작 시각을 고칠 수 있다');
select lives_ok(format($q$select public.update_contest(%L, 'cf-frz', %L::timestamptz, 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb)$q$, :'cfrz', :'cfrzstart'), '되돌리기');
set local request.jwt.claims = :'F2';
select public.join_contest(:'cfrz', null, 100);
set local request.jwt.claims = :'F1';
select throws_ok(format($q$select public.update_contest(%L, 'cf-frz', %L::timestamptz + interval '1 minute', 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb)$q$, :'cfrz', :'cfrzstart'), 'P0001', 'not_editable',
  '남이 낸 뒤 시작 시각 변경 → not_editable');
select throws_ok(format($q$select public.update_contest(%L, 'cf-frz', %L::timestamptz, 45, 'public',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb)$q$, :'cfrz', :'cfrzstart'), 'P0001', 'not_editable',
  '남이 낸 뒤 제한 시간 변경 → not_editable');
select throws_ok(format($q$select public.update_contest(%L, 'cf-frz', %L::timestamptz, 30, 'public',
  '[{"game_id":"g-fee","options":{},"count":2}]'::jsonb)$q$, :'cfrz', :'cfrzstart'), 'P0001', 'not_editable',
  '남이 낸 뒤 문제 구성 변경 → not_editable');
select lives_ok(format($q$select public.update_contest(%L, '새 제목', %L::timestamptz, 30, 'invite',
  '[{"game_id":"g-fee","options":{},"count":1}]'::jsonb)$q$, :'cfrz', :'cfrzstart'),
  '남이 낸 뒤에도 제목·공개 범위는 고칠 수 있다');
reset role;
select is((select title from public.contests where id = :'cfrz'), '새 제목', '제목이 바뀌었다');

-- 참가비 0 대회는 지금과 같다
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-zero', 0) as czero \gset
set local request.jwt.claims = :'F2';
select lives_ok(format('select public.join_contest(%L)', :'czero'), '참가비 0 대회는 그냥 참가');
reset role;
select is((select count(*)::int from public.gold_ledger where ref = :'czero'), 0, '참가비 0 대회: 장부 없음');

-- ---------------------------------------------------------------- 취소
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-cancel', 2000) as ccan \gset
set local request.jwt.claims = :'F2';
select public.join_contest(:'ccan', null, 2000);
set local request.jwt.claims = :'F3';
select public.join_contest(:'ccan', null, 2000);
set local request.jwt.claims = :'F1';
select lives_ok(format('select public.cancel_contest(%L)', :'ccan'), '만든 사람이 시작 전 취소');
reset role;
select is(pg_temp.paid(:'ccan', 'contest_refund'), 'feeone:2000,feethree:2000,feetwo:2000', '취소 → 전원 환불');
select is(pg_temp.net(:'ccan'), 0::bigint, '취소: 모인 돈 = 돌려준 돈');
select is(pg_temp.bal(:'f2'), 98900::bigint, 'f2 잔액: 취소 대회 참가비 돌려받음 (a 1,000·frz 100은 낸 채)');
-- 끝난 뒤 정산이 잡아도 더 주지 않는다
update public.contests set settled_at = now() where settled_at is null and ends_at <= now() and id <> :'ccan';
update public.contests set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = :'ccan';
set local role authenticated;
set local request.jwt.claims = :'F4';
select is(public.settle_due(), 1, '취소 대회 정산 표시');
reset role;
select is((select count(*)::int from public.gold_ledger where ref = :'ccan' and reason = 'contest_refund'), 3,
  '정산이 취소 대회를 잡아도 환불은 그대로 3줄');

-- 관리자가 진행 중 취소
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-live', 300) as clive \gset
set local request.jwt.claims = :'F4';
select public.join_contest(:'clive', null, 300);
reset role;
update public.contests set starts_at = now() - interval '5 minutes' where id = :'clive';
set local role authenticated;
set local request.jwt.claims = :'F1';
select throws_ok(format('select public.cancel_contest(%L)', :'clive'), 'P0001', 'not_editable', '만든 사람은 시작 뒤 취소 못 함');
set local request.jwt.claims = :'FA';
select lives_ok(format('select public.cancel_contest(%L)', :'clive'), '관리자 진행 중 취소');
reset role;
select is(pg_temp.paid(:'clive', 'contest_refund'), 'feefour:300,feeone:300', '관리자 취소 → 전원 환불');

-- 정산이 놓친 환불을 마저 한다(취소 뒤 환불 줄을 지운 흉내)
delete from public.gold_ledger where ref = :'clive' and reason = 'contest_refund' and user_id = :'f4';
select is((select count(*)::int from public._contest_payouts(:'clive') where reason = 'contest_refund'), 2,
  '_contest_payouts: 취소 대회는 낸 사람 모두에게 환불 목록');

-- ---------------------------------------------------------------- 분배 (인원별)
-- 대회마다 f1이 만들고 나머지가 참가한다. 그 뒤 슈퍼유저가 끝난 대회로 옮기고 기록을 넣는다.
set local role authenticated;
set local request.jwt.claims = :'F1';
select pg_temp.mk('cf-z', 1000) as cz \gset
select pg_temp.mk('cf-o', 1000) as co \gset
select pg_temp.mk('cf-t', 1000) as ct \gset
select pg_temp.mk('cf-h', 1000) as ch \gset
select pg_temp.mk('cf-f', 1000) as cfv \gset
select pg_temp.mk('cf-r', 1001) as cr \gset
select pg_temp.mk('cf-s', 7) as cs \gset
select pg_temp.mk('cf-tie', 100) as ctie \gset
set local request.jwt.claims = :'F2';
select public.join_contest(:'cz', null, 1000), public.join_contest(:'co', null, 1000), public.join_contest(:'ct', null, 1000),
       public.join_contest(:'ch', null, 1000), public.join_contest(:'cfv', null, 1000), public.join_contest(:'cr', null, 1001),
       public.join_contest(:'cs', null, 7), public.join_contest(:'ctie', null, 100);
set local request.jwt.claims = :'F3';
select public.join_contest(:'ct', null, 1000), public.join_contest(:'ch', null, 1000), public.join_contest(:'cfv', null, 1000),
       public.join_contest(:'cr', null, 1001), public.join_contest(:'cs', null, 7), public.join_contest(:'ctie', null, 100);
set local request.jwt.claims = :'F4';
select public.join_contest(:'ch', null, 1000), public.join_contest(:'cfv', null, 1000);
set local request.jwt.claims = :'F5';
select public.join_contest(:'cfv', null, 1000);
reset role;

-- z: 기록 없음(f2는 열기만) → 전원 환불
select pg_temp.finish(:'cz', jsonb_build_array(jsonb_build_object('uid', :'f2', 'score', 0, 'acts', 0)));
-- o: f2만 행동 → 1등 독식 2,000
select pg_temp.finish(:'co', jsonb_build_array(jsonb_build_object('uid', :'f2', 'score', 3, 'acts', 2)));
-- t: f2·f1 행동, f3 열기만 → 2명 → 1등 독식 3,000
select pg_temp.finish(:'ct', jsonb_build_array(
  jsonb_build_object('uid', :'f2', 'score', 5, 'acts', 2), jsonb_build_object('uid', :'f1', 'score', 4, 'acts', 2),
  jsonb_build_object('uid', :'f3', 'score', 0, 'acts', 0)));
-- h: f3 > f1 > f2 (f4 열기만) → pool 4,000: 2,400 + 0 우수리 / 1,200 / 400
select pg_temp.finish(:'ch', jsonb_build_array(
  jsonb_build_object('uid', :'f3', 'score', 9, 'acts', 2), jsonb_build_object('uid', :'f1', 'score', 7, 'acts', 2),
  jsonb_build_object('uid', :'f2', 'score', 5, 'acts', 2), jsonb_build_object('uid', :'f4', 'score', 0, 'acts', 0)));
-- f: 5명 → pool 5,000: 3,000 / 1,500 / 500, 4·5등 0
select pg_temp.finish(:'cfv', jsonb_build_array(
  jsonb_build_object('uid', :'f5', 'score', 9, 'acts', 1), jsonb_build_object('uid', :'f4', 'score', 8, 'acts', 1),
  jsonb_build_object('uid', :'f3', 'score', 7, 'acts', 1), jsonb_build_object('uid', :'f2', 'score', 6, 'acts', 1),
  jsonb_build_object('uid', :'f1', 'score', 5, 'acts', 1)));
-- r: 1,001 × 3 = 3,003 → 900 / 300, 1등 1,803 (60% 내림 1,801 + 우수리 2)
select pg_temp.finish(:'cr', jsonb_build_array(
  jsonb_build_object('uid', :'f1', 'score', 9, 'acts', 1), jsonb_build_object('uid', :'f2', 'score', 8, 'acts', 1),
  jsonb_build_object('uid', :'f3', 'score', 7, 'acts', 1)));
-- s: 7 × 3 = 21 → 6 / 2, 1등 13
select pg_temp.finish(:'cs', jsonb_build_array(
  jsonb_build_object('uid', :'f1', 'score', 9, 'acts', 1), jsonb_build_object('uid', :'f2', 'score', 8, 'acts', 1),
  jsonb_build_object('uid', :'f3', 'score', 7, 'acts', 1)));
-- tie: 점수·행동 같음 → 먼저 끝낸 f3이 1등(리더보드 정렬), 나눠 갖지 않음. pool 300 → 180 / 90 / 30
select pg_temp.finish(:'ctie', jsonb_build_array(
  jsonb_build_object('uid', :'f1', 'score', 5, 'acts', 2, 'mins', 10), jsonb_build_object('uid', :'f2', 'score', 5, 'acts', 2, 'mins', 5),
  jsonb_build_object('uid', :'f3', 'score', 5, 'acts', 2, 'mins', 1)));
-- 참가비 0 대회도 끝낸다
select pg_temp.finish(:'czero', jsonb_build_array(jsonb_build_object('uid', :'f2', 'score', 3, 'acts', 1)));

-- 계산만 (지급 전)
select is((select string_agg(amount || ':' || note, ',' order by amount desc) from public._contest_payouts(:'ch')),
  '2400:1등,1200:2등,400:3등', '_contest_payouts(h): 2,400 / 1,200 / 400');
select is((select count(*)::int from public._contest_payouts(:'czero')), 0, '_contest_payouts: 참가비 0 대회는 빈 목록');

set local role authenticated;
set local request.jwt.claims = :'F4';
select is(public.settle_due(), 9, '끝난 참가비 대회 8개 + 참가비 0 대회 정산');
reset role;

select is(pg_temp.paid(:'cz', 'contest_refund'), 'feeone:1000,feetwo:1000', '0명(열기만) → 전원 환불');
select is(pg_temp.paid(:'cz', 'contest_prize'), '', '0명: 상금 없음');
select is(pg_temp.paid(:'co', 'contest_prize'), 'feetwo:2000:1등', '1명 → 1등이 전부');
select is(pg_temp.paid(:'ct', 'contest_prize'), 'feetwo:3000:1등', '2명(열기만 한 사람 제외) → 1등이 전부');
select is(pg_temp.paid(:'ch', 'contest_prize'), 'feethree:2400:1등,feeone:1200:2등,feetwo:400:3등', '3명 → 60/30/10, 열기만 한 f4는 없음');
select is(pg_temp.paid(:'cfv', 'contest_prize'), 'feefive:3000:1등,feefour:1500:2등,feethree:500:3등', '5명 → 3,000/1,500/500, 4·5등 0');
select is(pg_temp.paid(:'cr', 'contest_prize'), 'feeone:1803:1등,feetwo:900:2등,feethree:300:3등', '우수리는 1등 (3,003 → 1,803/900/300)');
select is(pg_temp.paid(:'cs', 'contest_prize'), 'feeone:13:1등,feetwo:6:2등,feethree:2:3등', '작은 돈 21 → 13/6/2');
select is(pg_temp.paid(:'ctie', 'contest_prize'), 'feethree:180:1등,feetwo:90:2등,feeone:30:3등', '동점은 리더보드 정렬(먼저 끝낸 쪽)');
select is((select count(*)::int from public.gold_ledger where ref = :'czero'), 0, '참가비 0 대회 정산 → 장부 없음');
select ok((select settled_at is not null from public.contests where id = :'czero'), '참가비 0 대회 settled_at');
select is((select sum(abs(pg_temp.net(x)))::bigint from unnest(array[:'cz', :'co', :'ct', :'ch', :'cfv', :'cr', :'cs', :'ctie']::uuid[]) x),
  0::bigint, '모든 대회: 모인 돈 = 나간 돈');
select is((select count(*)::int from public.gold_ledger where reason in ('contest_prize', 'contest_refund') and raw_delta is not null), 0,
  '상금·환불은 사이트 상한으로 줄지 않는다');
select is((select count(*)::int from public.gold_ledger where reason = 'contest_prize' and game_id is not null), 0, 'contest_prize game_id null');

-- 두 번째 정산·되돌린 뒤 다시 → 그대로
update public.contests set settled_at = null where id in (:'ch', :'cz');
set local role authenticated;
set local request.jwt.claims = :'F4';
select is(public.settle_due(), 2, 'settled_at을 지우면 다시 잡지만');
reset role;
select is((select count(*)::int from public.gold_ledger where ref in (:'ch', :'cz') and reason in ('contest_prize', 'contest_refund')), 5,
  '장부는 그대로(unique)');

-- 받은 상금 읽기·알림 목록에 대회 상금
set local role authenticated;
set local request.jwt.claims = :'F3';
select is((select string_agg(handle || ':' || amount, ',' order by amount desc) from public.contest_prizes(:'ch')),
  'feethree:2400,feeone:1200,feetwo:400', 'contest_prizes(h)');
select ok(exists (select 1 from jsonb_array_elements(public.my_wallet() -> 'prizes') p
                   where p ->> 'reason' = 'contest_prize' and p ->> 'contest_id' = :'ch'), 'my_wallet prizes에 대회 상금');
reset role;

-- 잔액 검사(f2): 100,000 − (a 1,000 + frz 100 + z·o·t·h·f 5,000 + r 1,001 + s 7 + tie 100) + (z 환불 1,000 + o 2,000 + t 3,000 + h 400 + r 900 + s 6 + tie 90)
select is(pg_temp.bal(:'f2'), (100000 - 1000 - 100 - 5000 - 1001 - 7 - 100 + 1000 + 2000 + 3000 + 400 + 900 + 6 + 90)::bigint,
  'f2 잔액 = 낸 것과 받은 것의 합');

-- 데일리는 3단계 그대로(참가비 경로를 타지 않음): 데일리 _contest_payouts는 daily_prize만
insert into public.game_modes (game_id, daily, contest, free) values ('g-fdaily', true, false, false);
insert into public.contests (id, kind, title, visibility, starts_at, ends_at, daily_key) values
  ('00000000-0000-0000-0000-00000000fd01', 'daily', 'fd', 'public', now() - interval '2 days', now() - interval '1 day', 'g-fdaily:2000-01-01');
insert into public.contest_items (id, contest_id, position, game_id) values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-00000000fd01', 1, 'g-fdaily');
insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count) values
  ('00000000-0000-0000-0000-00000000fe01', :'f1', '{}', 1, true, 9, 1);
select is((select string_agg(reason || ':' || amount, ',') from public._contest_payouts('00000000-0000-0000-0000-00000000fd01')),
  'daily_prize:6150', '데일리는 서버 상금(daily_prize)만, 참가비 분배와 섞이지 않는다');

select * from finish();
rollback;
