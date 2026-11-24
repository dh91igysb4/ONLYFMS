-- 자유 플레이 골드 지급 (지갑 2단계 Task 9, 설계 §7.2)
-- 테스트 게임: g-free(10/50/120), g-free2(같은 수치), g-nofree(free=false), g-hidden(숨김), g-zero(설정 0).
-- 승인 사용자 역할로 free_plays에 넣고, 장부·지갑은 슈퍼유저로 확인한다.
begin;
select plan(40);

\set f1 '00000000-0000-0000-0000-0000000000b1'
\set f2 '00000000-0000-0000-0000-0000000000b2'
\set f3 '00000000-0000-0000-0000-0000000000b3'
\set f4 '00000000-0000-0000-0000-0000000000b4'
\set f5 '00000000-0000-0000-0000-0000000000b5'
\set f6 '00000000-0000-0000-0000-0000000000b6'
\set F1 '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'
\set F2 '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}'
\set F3 '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}'
\set F4 '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}'
\set F5 '{"sub":"00000000-0000-0000-0000-0000000000b5","role":"authenticated"}'
\set F6 '{"sub":"00000000-0000-0000-0000-0000000000b6","role":"authenticated"}'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  (:'f1', 'f1@example.com'), (:'f2', 'f2@example.com'), (:'f3', 'f3@example.com'),
  (:'f4', 'f4@example.com'), (:'f5', 'f5@example.com'), (:'f6', 'f6@example.com');
update public.profiles set status = 'approved' where id in (:'f1', :'f2', :'f3', :'f4', :'f5', :'f6');

insert into public.game_modes (game_id, daily, contest, free) values
  ('g-free', false, false, true), ('g-free2', false, false, true), ('g-nofree', false, false, false),
  ('g-hidden', false, false, true), ('g-zero', false, false, true);
update public.game_modes set gold_per_point = 10, gold_play_cap = 50, gold_daily_cap = 120
 where game_id in ('g-free', 'g-free2', 'g-nofree', 'g-hidden');
insert into public.hidden_games (game_id) values ('g-hidden');

select has_column('public', 'game_modes', 'gold_per_point', 'game_modes.gold_per_point');
select col_type_is('public', 'game_modes', 'gold_per_point', 'numeric(10,4)', 'gold_per_point numeric(10,4)');
select has_column('public', 'game_modes', 'gold_play_cap', 'game_modes.gold_play_cap');
select has_column('public', 'game_modes', 'gold_daily_cap', 'game_modes.gold_daily_cap');
select is((select row(gold_per_point, gold_play_cap, gold_daily_cap)::text from public.game_modes where game_id = 'g-zero'),
  row(0::numeric(10,4), 0, 0)::text, 'gold_* 기본값 0');
select throws_ok($$update public.game_modes set gold_play_cap = -1 where game_id = 'g-zero'$$, '23514', null, 'gold_play_cap 음수 거절');
select has_function('public', '_free_plays_gold', 'has _free_plays_gold');

-- 운영 게임 수치 (manifest gold와 같다: registry.test.ts)
select is((select count(*)::int from public.game_modes where gold_per_point > 0 and gold_daily_cap <> 2050 and game_id not like 'g-%'), 0,
  '운영: 모든 지급 게임 gold_daily_cap = 2,050');
select is((select count(*)::int from public.game_modes
            where game_id in ('toothbrush', 'sneak-exam', 'ball-run', 'neon-rider', 'who-are-ya') and gold_per_point > 0), 5,
  '운영: 다섯 게임에 수치가 있다');

-- 잠금 순서와 상한 위치 (Review Focus 3, 6)
select ok(position('_wallet_lock(' in pg_get_functiondef('public._free_plays_gold()'::regprocedure)) > 0
      and position('_wallet_lock(' in pg_get_functiondef('public._free_plays_gold()'::regprocedure))
        < position('sum(' in pg_get_functiondef('public._free_plays_gold()'::regprocedure)),
  '트리거: _wallet_lock 뒤에 합계를 읽는다');
select ok(position('_economy' in pg_get_functiondef('public._free_plays_gold()'::regprocedure)) = 0
      and position('soft_cap' in pg_get_functiondef('public._free_plays_gold()'::regprocedure)) = 0,
  '트리거: 사이트 상한 계산 없음(_gold_move 한 곳)');

-- ---------------------------------------------------------------- f1: 기본 지급·판당 상한
set local role authenticated;
set local request.jwt.claims = :'F1';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('11111111-0000-0000-0000-000000000001', :'f1', 'g-free', 1, false, 3.75, 3);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('11111111-0000-0000-0000-000000000002', :'f1', 'g-free', 1, false, 9, 3);
-- 재전송: on conflict로 행이 안 들어가 지급도 없다
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('11111111-0000-0000-0000-000000000002', :'f1', 'g-free', 1, false, 9, 3)
on conflict (client_id) do nothing;
select is(public.my_wallet()->'today', '{"g-free":87}'::jsonb, 'f1 my_wallet.today: 37 + 50');
reset role;

select is((select row(delta, reason, ref, game_id)::text from public.gold_ledger
            where user_id = :'f1' and ref = '11111111-0000-0000-0000-000000000001'),
  row(37::bigint, 'free'::text, '11111111-0000-0000-0000-000000000001'::text, 'g-free'::text)::text,
  'f1: 점수 3.75 → floor(37.5) = 37, reason free · ref client_id · game_id');
select is((select delta from public.gold_ledger where user_id = :'f1' and ref = '11111111-0000-0000-0000-000000000002'),
  50::bigint, 'f1: 점수 9 → 90이지만 판당 50');
select is((select count(*)::int from public.gold_ledger where user_id = :'f1'), 2, 'f1: 같은 client_id 재전송은 지급 없음');
select is((select balance from public.wallets where user_id = :'f1'), 87::bigint, 'f1: 잔액 87');

-- ---------------------------------------------------------------- f2: 게임별 하루 상한·다른 게임은 따로
set local role authenticated;
set local request.jwt.claims = :'F2';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f2', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f2', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f2', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f2', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f2', 'g-free2', 1, false, 9, 1);
reset role;
select is((select array_agg(delta order by id)::text from public.gold_ledger where user_id = :'f2' and game_id = 'g-free'),
  '{50,50,20}', 'f2: 50 + 50 + 20(120까지), 그다음 판은 장부 줄 없음');
select is((select delta from public.gold_ledger where user_id = :'f2' and game_id = 'g-free2'), 50::bigint,
  'f2: 다른 게임의 오늘 합계는 섞이지 않음');
select is((select count(*)::int from public.free_plays where user_id = :'f2'), 5, 'f2: 상한 뒤에도 기록은 들어간다');

-- ---------------------------------------------------------------- f3: 어제 줄은 세지 않음, 점수 0, 지급 안 하는 게임
insert into public.gold_ledger (user_id, delta, balance_after, reason, ref, game_id, created_at) values
  (:'f3', 100, 100, 'free', 'yday', 'g-free', public._kst_today_start() - interval '1 second');
set local role authenticated;
set local request.jwt.claims = :'F3';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f3', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f3', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  (gen_random_uuid(), :'f3', 'g-free', 1, false, 9, 1);
reset role;
select is((select array_agg(delta order by id)::text from public.gold_ledger
            where user_id = :'f3' and created_at >= public._kst_today_start()),
  '{50,50,20}', 'f3: 어제(KST) free 100은 오늘 상한에 안 셈');

set local role authenticated;
set local request.jwt.claims = :'F6';
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b6', 'g-free', 1, false, 0, 0)$$, 'f6: 점수 0 insert 성공');
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b6', 'g-free', 1, false, 0.09, 0)$$, 'f6: 점수 0.09(→ 0 G) insert 성공');
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b6', 'g-nofree', 1, false, 9, 0)$$, 'f6: g-nofree insert');
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b6', 'g-hidden', 1, false, 9, 0)$$, 'f6: g-hidden insert');
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b6', 'g-zero', 1, false, 9, 0)$$, 'f6: g-zero insert');
select lives_ok($$insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b6', 'g-unknown', 1, false, 9, 0)$$, 'f6: game_modes 없는 게임 insert');
reset role;
select is((select count(*)::int from public.gold_ledger where user_id = :'f6'), 0,
  'f6: 점수 0·free=false·숨김·설정 0·설정 없음 → 지급 없음');
select is((select count(*)::int from public.wallets where user_id = :'f6' and balance <> 0), 0, 'f6: 잔액 없음');

-- ---------------------------------------------------------------- f4: 사이트 하루 상한과 함께 (Review Focus 6)
select public._gold_move(:'f4', 30750, 'world', 'w1', 'fishing');
set local role authenticated;
set local request.jwt.claims = :'F4';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('44444444-0000-0000-0000-000000000001', :'f4', 'g-free', 1, false, 3.75, 1);
select is(public.my_wallet()->'today', '{"g-free":37}'::jsonb, 'f4 my_wallet.today: 줄기 전 37');
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('44444444-0000-0000-0000-000000000002', :'f4', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('44444444-0000-0000-0000-000000000003', :'f4', 'g-free', 1, false, 9, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('44444444-0000-0000-0000-000000000004', :'f4', 'g-free', 1, false, 9, 1);
select is(public.my_wallet()->'today', '{"g-free":120}'::jsonb, 'f4 my_wallet.today: 37 + 50 + 33 = 120 (줄기 전)');
reset role;
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'f4' and ref = '44444444-0000-0000-0000-000000000001'),
  row(7::bigint, 37::bigint)::text, 'f4: 상한 뒤 37 → floor(7.4) = 7, raw_delta 37');
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'f4' and ref = '44444444-0000-0000-0000-000000000002'),
  row(10::bigint, 50::bigint)::text, 'f4: 판당 50 → 10');
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'f4' and ref = '44444444-0000-0000-0000-000000000003'),
  row(6::bigint, 33::bigint)::text, 'f4: 게임별 남은 몫 120 − 87 = 33(줄기 전으로 셈) → 6');
select is((select count(*)::int from public.gold_ledger where user_id = :'f4' and ref = '44444444-0000-0000-0000-000000000004'), 0,
  'f4: 그다음 판은 장부 줄 없음');
select is((select balance from public.wallets where user_id = :'f4'), (30750 + 7 + 10 + 6)::bigint, 'f4: 잔액');

-- ---------------------------------------------------------------- f6: 한 문장 여러 행 (행마다 트리거가 앞 행의 장부를 본다)
set local role authenticated;
set local request.jwt.claims = :'F6';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
select gen_random_uuid(), :'f6', 'g-free2', 1, false, 9, 1 from generate_series(1, 5);
reset role;
select is((select array_agg(delta order by id)::text from public.gold_ledger where user_id = :'f6' and game_id = 'g-free2'),
  '{50,50,20}', 'f6: 한 문장 5행 → 50 + 50 + 20, 게임별 상한 120 그대로');
select is((select count(*)::int from public.free_plays where user_id = :'f6' and game_id = 'g-free2'), 5, 'f6: 5행 모두 들어감');

-- ---------------------------------------------------------------- f5: 운영 게임 수치
set local role authenticated;
set local request.jwt.claims = :'F5';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('55555555-0000-0000-0000-000000000001', :'f5', 'toothbrush', 1, false, 7.5, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('55555555-0000-0000-0000-000000000002', :'f5', 'ball-run', 1, false, 1000, 1);
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count) values
  ('55555555-0000-0000-0000-000000000003', :'f5', 'sneak-exam', 1, false, 921, 1);
reset role;
select is((select delta from public.gold_ledger where user_id = :'f5' and ref = '55555555-0000-0000-0000-000000000001'),
  48::bigint, '운영: toothbrush 7.5 → 48');
select is((select delta from public.gold_ledger where user_id = :'f5' and ref = '55555555-0000-0000-0000-000000000002'),
  100::bigint, '운영: ball-run 1000 → 판당 100');
select is((select delta from public.gold_ledger where user_id = :'f5' and ref = '55555555-0000-0000-0000-000000000003'),
  57::bigint, '운영: sneak-exam 921 → floor(57.102) = 57');

select * from finish();
rollback;
