-- 정산과 데일리 상금 (지갑 3단계 Task 14, 설계 §8, §8.1)
-- 슈퍼유저로 대회·문제·기록을 직접 넣고, 승인 사용자 역할로 settle_due()·my_wallet()을 부른다.
-- 끝난 대회: starts_at = now() − 2일, ends_at = now() − 1일.
begin;
select plan(45);

\set d1 '00000000-0000-0000-0000-0000000005d1'
\set d2 '00000000-0000-0000-0000-0000000005d2'
\set d3 '00000000-0000-0000-0000-0000000005d3'
\set d4 '00000000-0000-0000-0000-0000000005d4'
\set d5 '00000000-0000-0000-0000-0000000005d5'
\set d6 '00000000-0000-0000-0000-0000000005d6'
\set d7 '00000000-0000-0000-0000-0000000005d7'
\set d8 '00000000-0000-0000-0000-0000000005d8'
\set dp '00000000-0000-0000-0000-0000000005df'
\set D1 '{"sub":"00000000-0000-0000-0000-0000000005d1","role":"authenticated"}'
\set D2 '{"sub":"00000000-0000-0000-0000-0000000005d2","role":"authenticated"}'
\set D3 '{"sub":"00000000-0000-0000-0000-0000000005d3","role":"authenticated"}'
\set DP '{"sub":"00000000-0000-0000-0000-0000000005df","role":"authenticated"}'
-- 대회: k1 본 데일리, k2 혼자, k3 숨김 게임 데일리, k4 친선, k5 진행 중, k6 이미 정산 표시(소급 없음 흉내), k7 취소된 데일리
\set k1 '00000000-0000-0000-0000-000000000d01'
\set k2 '00000000-0000-0000-0000-000000000d02'
\set k3 '00000000-0000-0000-0000-000000000d03'
\set k4 '00000000-0000-0000-0000-000000000d04'
\set k5 '00000000-0000-0000-0000-000000000d05'
\set k6 '00000000-0000-0000-0000-000000000d06'
\set k7 '00000000-0000-0000-0000-000000000d07'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  (:'d1', 'sd1@example.com'), (:'d2', 'sd2@example.com'), (:'d3', 'sd3@example.com'), (:'d4', 'sd4@example.com'),
  (:'d5', 'sd5@example.com'), (:'d6', 'sd6@example.com'), (:'d7', 'sd7@example.com'), (:'d8', 'sd8@example.com'),
  (:'dp', 'sdp@example.com');
update public.profiles set status = 'approved', handle = 'sdone' where id = :'d1';
update public.profiles set status = 'approved', handle = 'sdtwo' where id = :'d2';
update public.profiles set status = 'approved' where id in (:'d3', :'d4', :'d5', :'d6', :'d7', :'d8');
update public.profiles set handle = 'sdpend' where id = :'dp';

insert into public.game_modes (game_id, daily, contest, free) values
  ('g-daily', true, false, false), ('g-dhidden', true, false, false);
insert into public.hidden_games (game_id) values ('g-dhidden');

insert into public.contests (id, kind, title, visibility, starts_at, ends_at, daily_key, cancelled_at, settled_at) values
  (:'k1', 'daily', 'd1', 'public', now() - interval '2 days', now() - interval '1 day', 'g-daily:2000-01-01', null, null),
  (:'k2', 'daily', 'd2', 'public', now() - interval '2 days', now() - interval '1 day', 'g-daily:2000-01-02', null, null),
  (:'k3', 'daily', 'd3', 'public', now() - interval '2 days', now() - interval '1 day', 'g-dhidden:2000-01-01', null, null),
  (:'k5', 'daily', 'd5', 'public', now() - interval '1 hour', now() + interval '1 hour', 'g-daily:2000-01-05', null, null),
  (:'k6', 'daily', 'd6', 'public', now() - interval '2 days', now() - interval '1 day', 'g-daily:2000-01-06', null, now()),
  (:'k7', 'daily', 'd7', 'public', now() - interval '2 days', now() - interval '1 day', 'g-daily:2000-01-07', now() - interval '36 hours', null);
insert into public.contests (id, kind, title, created_by, visibility, starts_at, ends_at) values
  (:'k4', 'friendly', 'f4', :'d1', 'public', now() - interval '2 days', now() - interval '1 day');
insert into public.contest_items (id, contest_id, position, game_id) values
  ('00000000-0000-0000-0000-00000000e001', :'k1', 1, 'g-daily'),
  ('00000000-0000-0000-0000-00000000e002', :'k2', 1, 'g-daily'),
  ('00000000-0000-0000-0000-00000000e003', :'k3', 1, 'g-dhidden'),
  ('00000000-0000-0000-0000-00000000e004', :'k4', 1, 'g-daily'),
  ('00000000-0000-0000-0000-00000000e005', :'k5', 1, 'g-daily'),
  ('00000000-0000-0000-0000-00000000e006', :'k6', 1, 'g-daily'),
  ('00000000-0000-0000-0000-00000000e007', :'k7', 1, 'g-daily');

-- k1 기록: 점수 9·7(행동 2)·7(행동 4)·3·0(행동 2)·0(행동 0, 열기만)·0(행동 6)·0(행동 9) + 대기 사용자 10점
insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count, started_at, last_action_at) values
  ('00000000-0000-0000-0000-00000000e001', :'d1', '{}', 1, true,  9, 3, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'d2', '{}', 1, true,  7, 2, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'d3', '{}', 1, true,  7, 4, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'d4', '{}', 1, true,  3, 5, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'d5', '{}', 1, false, 0, 2, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'d6', '{}', 1, false, 0, 0, now() - interval '30 hours', null),
  ('00000000-0000-0000-0000-00000000e001', :'d7', '{}', 1, true,  0, 6, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'d8', '{}', 1, true,  0, 9, now() - interval '30 hours', now() - interval '30 hours'),
  ('00000000-0000-0000-0000-00000000e001', :'dp', '{}', 1, true, 10, 1, now() - interval '30 hours', now() - interval '30 hours');
insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count) values
  ('00000000-0000-0000-0000-00000000e002', :'d1', '{}', 1, true, 2, 1),
  ('00000000-0000-0000-0000-00000000e003', :'d1', '{}', 1, true, 9, 1),
  ('00000000-0000-0000-0000-00000000e004', :'d1', '{}', 1, true, 9, 1),
  ('00000000-0000-0000-0000-00000000e005', :'d1', '{}', 1, true, 9, 1),
  ('00000000-0000-0000-0000-00000000e006', :'d2', '{}', 1, true, 9, 1),
  ('00000000-0000-0000-0000-00000000e007', :'d2', '{}', 1, true, 9, 1);

-- d1은 오늘 이미 사이트 상한을 넘었다: world +100,000 → 41,720 들어감
select public._gold_move(:'d1', 100000, 'world', 'sd-world', 'fishing');
-- d2의 4일 전 상금 줄(prizes에서 빠져야 한다)
insert into public.gold_ledger (user_id, delta, balance_after, reason, ref, game_id, note, created_at)
values (:'d2', 100, 100, 'daily_prize', 'old-contest', 'g-daily', '1등', now() - interval '4 days');

-- ---------------------------------------------------------------- 스키마·권한
select has_column('public', 'contests', 'settled_at', 'contests.settled_at');
select ok(exists (select 1 from pg_indexes where indexname = 'contests_unsettled_idx'
                   and indexdef like '%WHERE (settled_at IS NULL)%'), '부분 인덱스 contests_unsettled_idx');
select has_function('public', '_contest_payouts', array['uuid'], 'has _contest_payouts');
select has_function('public', 'settle_due', 'has settle_due');
select has_function('public', 'contest_prizes', array['uuid'], 'has contest_prizes');
select has_function('public', 'user_prize_total', array['text'], 'has user_prize_total');
select is(public._economy() -> 'daily_prizes', '[6150, 5120, 4100, 3070, 2460, 2050]'::jsonb, '_economy daily_prizes');
select ok(position('for update skip locked' in pg_get_functiondef('public.settle_due()'::regprocedure)) > 0,
  'settle_due: for update skip locked (다른 정산이 잡은 대회는 건너뛴다)');
select ok(position('order by p.user_id' in pg_get_functiondef('public.settle_due()'::regprocedure)) > 0,
  'settle_due: 지급은 트랜잭션 전체 user_id 오름차순');
select ok(position('soft_cap' in pg_get_functiondef('public.settle_due()'::regprocedure)) = 0
      and position('soft_cap' in pg_get_functiondef('public._contest_payouts(uuid)'::regprocedure)) = 0,
  '정산: 사이트 상한 계산 없음(_gold_move 한 곳)');

set local role authenticated;
set local request.jwt.claims = :'D3';
select is((select settled_at from public.contests where id = :'k5'), null::timestamptz, 'authenticated가 settled_at을 읽는다');
select throws_ok($$select * from public._contest_payouts('00000000-0000-0000-0000-000000000d01')$$, '42501', null,
  '_contest_payouts는 authenticated에 실행 권한 없음');
reset role;

-- ---------------------------------------------------------------- _contest_payouts (계산만)
select results_eq(
  $$select user_id, amount, reason, game_id, note from public._contest_payouts('00000000-0000-0000-0000-000000000d01')$$,
  $$values ('00000000-0000-0000-0000-0000000005d1'::uuid, 6150::bigint, 'daily_prize'::text, 'g-daily'::text, '1등'::text),
           ('00000000-0000-0000-0000-0000000005d2'::uuid, 5120::bigint, 'daily_prize'::text, 'g-daily'::text, '2등'::text),
           ('00000000-0000-0000-0000-0000000005d3'::uuid, 4100::bigint, 'daily_prize'::text, 'g-daily'::text, '3등'::text),
           ('00000000-0000-0000-0000-0000000005d4'::uuid, 3070::bigint, 'daily_prize'::text, 'g-daily'::text, '4등'::text),
           ('00000000-0000-0000-0000-0000000005d5'::uuid, 2460::bigint, 'daily_prize'::text, 'g-daily'::text, '5등'::text),
           ('00000000-0000-0000-0000-0000000005d7'::uuid, 2050::bigint, 'daily_prize'::text, 'g-daily'::text, '6등'::text),
           ('00000000-0000-0000-0000-0000000005d8'::uuid, 2050::bigint, 'daily_prize'::text, 'g-daily'::text, '7등'::text)$$,
  'k1: 행동 0(열기만)·대기 사용자 빼고 다시 센 등수, 7등도 2,050');
select results_eq($$select amount, note from public._contest_payouts('00000000-0000-0000-0000-000000000d02')$$,
  $$values (6150::bigint, '1등'::text)$$, 'k2: 혼자 해도 1등 상금');
select is((select count(*)::int from public._contest_payouts(:'k3')), 0, 'k3: 숨김 게임 데일리는 상금 없음');
select is((select count(*)::int from public._contest_payouts(:'k4')), 0, 'k4: 친선 대회는 3단계에서 지급 없음');
select is((select count(*)::int from public._contest_payouts(:'k7')), 0, 'k7: 취소된 대회는 지급 없음');

-- ---------------------------------------------------------------- my_wallet()이 정산한다
set local role authenticated;
set local request.jwt.claims = :'D2';
select is((public.my_wallet() ->> 'balance')::bigint, 5120::bigint, 'd2: my_wallet()이 처음에 정산 → 5,120 (장부를 직접 넣은 옛 줄은 잔액에 없음)');
select is(jsonb_array_length(public.my_wallet() -> 'prizes'), 1, 'd2 prizes: 4일 전 상금은 빠지고 하나');
select is((public.my_wallet() -> 'prizes' -> 0) - 'id' - 'at',
  jsonb_build_object('reason', 'daily_prize', 'contest_id', :'k1', 'game_id', 'g-daily', 'amount', 5120, 'note', '2등'),
  'd2 prizes[0]: k1 2등 5,120');
reset role;

select is((select count(*)::int from public.gold_ledger where reason = 'daily_prize' and ref = :'k1'), 7, 'k1: 장부 7줄');
select is((select count(*)::int from public.gold_ledger where reason = 'daily_prize' and ref = :'k2'), 1, 'k2: 장부 1줄');
select is((select count(*)::int from public.gold_ledger where reason = 'daily_prize'
            and ref in (:'k3', :'k4', :'k5', :'k6', :'k7')), 0, '숨김·친선·진행 중·이미 표시·취소 대회는 장부 없음');
select ok((select bool_and(settled_at is not null) from public.contests where id in (:'k1', :'k2', :'k3', :'k4', :'k7')),
  '끝난 대회는 모두 settled_at이 찍힘(지급 없는 대회 포함)');
select is((select settled_at from public.contests where id = :'k5'), null::timestamptz, '진행 중 대회는 그대로 null');
select is((select balance from public.wallets where user_id = :'d6'), null::bigint, 'd6(열기만): 지갑도 없음');
select is((select balance from public.wallets where user_id = :'dp'), null::bigint, '대기 사용자: 지급 없음');

-- 상한과의 관계: 이미 상한을 넘은 d1도 상금 전액, raw_delta null
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'d1' and reason = 'daily_prize' and ref = :'k1'),
  row(6150::bigint, null::bigint)::text, 'd1: 상한을 넘은 날에도 상금 전액(raw_delta null)');
select is((select balance from public.wallets where user_id = :'d1'), (41720 + 6150 * 2)::bigint, 'd1: 41,720 + 6,150 × 2');
select is(public._gold_move(:'d1', 100, 'free', 'sd-free', 'g-daily'), (41720 + 12300 + 4)::bigint,
  'd1: 상금 뒤 free 100 → 4 (상금이 합계에 들어감, 4% 구간)');

-- ---------------------------------------------------------------- 두 번째 정산·되돌린 뒤 다시
set local role authenticated;
set local request.jwt.claims = :'D3';
select is(public.settle_due(), 0, '두 번째 settle_due() → 0');
reset role;
update public.contests set settled_at = null where id in (:'k1', :'k2');
set local role authenticated;
set local request.jwt.claims = :'D3';
select is(public.settle_due(), 2, 'settled_at을 지우면 다시 잡지만');
reset role;
select is((select count(*)::int from public.gold_ledger where reason = 'daily_prize' and ref in (:'k1', :'k2')), 8,
  '장부는 그대로 8줄(unique)');
select is((select balance from public.wallets where user_id = :'d2'), 5120::bigint, 'd2 잔액 그대로');

set local role authenticated;
set local request.jwt.claims = :'DP';
select throws_ok($$select public.settle_due()$$, 'P0001', 'forbidden', '대기 사용자 settle_due → forbidden');
reset role;

-- ---------------------------------------------------------------- 받은 상금 읽기
set local role authenticated;
set local request.jwt.claims = :'D3';
select is((select count(*)::int from public.contest_prizes(:'k1')), 7, 'contest_prizes(k1): 7줄');
select is((select row(handle, amount, note)::text from public.contest_prizes(:'k1') limit 1),
  row('sdone'::citext, 6150::bigint, '1등'::text)::text, 'contest_prizes: 금액 큰 순, handle 포함');
select is(public.user_prize_total('SDONE '), 12300::bigint, 'user_prize_total: d1 데일리 상금 누적');
select is(public.user_prize_total('sdpend'), null::bigint, 'user_prize_total: 대기 대상 null');
select is(public.user_prize_total('nobody-x'), null::bigint, 'user_prize_total: 없는 대상 null');
reset role;
set local role authenticated;
set local request.jwt.claims = :'DP';
select throws_ok($$select * from public.contest_prizes('00000000-0000-0000-0000-000000000d01')$$, 'P0001', 'forbidden',
  '대기 사용자 contest_prizes → forbidden');
reset role;

-- ---------------------------------------------------------------- 한 번에 최대 20개
insert into public.contests (kind, title, visibility, starts_at, ends_at, daily_key)
select 'daily', 'bulk', 'public', now() - interval '2 days', now() - interval '1 day', 'g-daily:1999-' || lpad(g::text, 5, '0')
  from generate_series(1, 21) g;
set local role authenticated;
set local request.jwt.claims = :'D3';
select is(public.settle_due(), 20, '끝난 대회 21개 → 첫 호출 20');
select is(public.settle_due(), 1, '둘째 호출 1');
reset role;

-- ---------------------------------------------------------------- 정산이 실패해도 my_wallet은 잔액을 돌려준다
create or replace function public._contest_payouts(p_contest uuid)
returns table (user_id uuid, amount bigint, reason text, game_id text, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  raise exception 'boom';
end
$$;
insert into public.contests (id, kind, title, visibility, starts_at, ends_at, daily_key) values
  ('00000000-0000-0000-0000-000000000d09', 'daily', 'fail', 'public', now() - interval '2 days', now() - interval '1 day', 'g-daily:2000-01-09');
set local role authenticated;
set local request.jwt.claims = :'D2';
select is((public.my_wallet() ->> 'balance')::bigint, 5120::bigint, '정산이 오류를 내도 my_wallet은 잔액을 돌려준다');
reset role;
select is((select settled_at from public.contests where id = '00000000-0000-0000-0000-000000000d09'), null::timestamptz,
  '실패한 정산은 되돌려져 다음에 다시 시도된다');

select * from finish();
rollback;
