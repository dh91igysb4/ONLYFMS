-- 도전과제 보너스 (지갑 설계 §7.5): game_records 'free_bonus' → _free_bonus_pct → 자유 플레이 판당·게임별 하루 상한 × (100 + %)/100.
-- 테스트 게임: g-fb(10/50/120, free), 월드 기록 원천 w-a·w-b(공개), w-hid(숨김).
begin;
select plan(28);

\set u1 '00000000-0000-0000-0000-0000000000e1'
\set u2 '00000000-0000-0000-0000-0000000000e2'
\set u3 '00000000-0000-0000-0000-0000000000e3'
\set u4 '00000000-0000-0000-0000-0000000000e4'
\set up '00000000-0000-0000-0000-0000000000e5'
\set U1 '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'
\set U2 '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}'
\set U3 '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}'
\set U4 '{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}'

insert into auth.users (id, email) values
  (:'u1', 'fb1@example.com'), (:'u2', 'fb2@example.com'), (:'u3', 'fb3@example.com'), (:'u4', 'fb4@example.com'), (:'up', 'fbp@example.com');
update public.profiles set status = 'approved', handle = 'fbone' where id = :'u1';
update public.profiles set status = 'approved', handle = 'fbtwo' where id = :'u2';
update public.profiles set status = 'approved', handle = 'fbthree' where id = :'u3';
update public.profiles set status = 'approved', handle = 'fbfour' where id = :'u4';
update public.profiles set handle = 'fbpend' where id = :'up';

insert into public.game_modes (game_id, daily, contest, free) values ('g-fb', false, false, true), ('g-fbbig', false, false, true);
update public.game_modes set gold_per_point = 10, gold_play_cap = 50, gold_daily_cap = 120 where game_id = 'g-fb';
update public.game_modes set gold_per_point = 1000, gold_play_cap = 20000, gold_daily_cap = 100000 where game_id = 'g-fbbig';
insert into public.hidden_games (game_id) values ('w-hid');

-- ---------------------------------------------------------------- 함수·권한
select has_function('public', '_free_bonus_pct', array['uuid'], 'has _free_bonus_pct');
select has_function('public', 'user_free_bonus', array['text'], 'has user_free_bonus');
select ok(not has_function_privilege('authenticated', 'public._free_bonus_pct(uuid)', 'execute'), '_free_bonus_pct: authenticated 실행 불가');
select ok(not has_function_privilege('anon', 'public.user_free_bonus(text)', 'execute'), 'user_free_bonus: anon 실행 불가');
select ok(has_function_privilege('authenticated', 'public.user_free_bonus(text)', 'execute'), 'user_free_bonus: authenticated 실행 가능');
select is((public._economy() ->> 'free_bonus_max_pct')::int, 400, '_economy free_bonus_max_pct 400');
select ok(position('_free_bonus_pct(' in pg_get_functiondef('public._free_plays_gold()'::regprocedure))
        > position('_wallet_lock(' in pg_get_functiondef('public._free_plays_gold()'::regprocedure)),
  '트리거: 지갑을 잠근 뒤 보너스를 읽는다');

-- ---------------------------------------------------------------- 원천 규칙
select is(public._free_bonus_pct(:'u1'), 0, '기록 없음 → 0');
insert into public.game_records (user_id, game_id, key, value) values
  (:'u1', 'w-a', 'free_bonus', 140),
  (:'u1', 'w-a', 'total_earned', 999999),        -- 다른 키는 무관
  (:'u2', 'w-a', 'free_bonus', 300), (:'u2', 'w-b', 'free_bonus', 300),
  (:'u3', 'w-hid', 'free_bonus', 200), (:'u3', 'w-a', 'free_bonus', -50),
  (:'u4', 'w-a', 'free_bonus', 400), (:'up', 'w-a', 'free_bonus', 100);
select is(public._free_bonus_pct(:'u1'), 140, 'w-a free_bonus 140 → 140');
select is(public._free_bonus_pct(:'u2'), 400, '두 게임 합 600 → 상한 400');
select is(public._free_bonus_pct(:'u3'), 0, '숨김 게임 기록은 빼고, 음수는 0');

-- ---------------------------------------------------------------- 브라우저는 원천을 쓸 수 없다
set local role authenticated;
set local request.jwt.claims = :'U1';
select throws_ok($$insert into public.game_records (user_id, game_id, key, value) values (auth.uid(), 'w-b', 'free_bonus', 400)$$,
  '42501', null, 'authenticated: game_records insert 거부');
select is((public.my_wallet() ->> 'free_bonus_pct')::int, 140, 'my_wallet.free_bonus_pct = 140');
select is(public.user_free_bonus('fbtwo'), 400, 'user_free_bonus: 다른 사람 400');
select is(public.user_free_bonus(' FbOne '), 140, 'user_free_bonus: handle 정규화');
select is(public.user_free_bonus('fbpend'), null::int, 'user_free_bonus: 대기 사용자 → null');
select is(public.user_free_bonus('nobody'), null::int, 'user_free_bonus: 없는 사람 → null');

-- ---------------------------------------------------------------- u1 (×2.4): 판당·판당 상한·게임별 하루 상한
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('22222222-0000-0000-0000-000000000001', :'u1', 'g-fb', 1, false, 3, 3);   -- floor(30) → 30 × 2.4 = 72
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('22222222-0000-0000-0000-000000000002', :'u1', 'g-fb', 1, false, 9, 3);   -- 판당 상한 50 → 120
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('22222222-0000-0000-0000-000000000003', :'u1', 'g-fb', 1, false, 9, 3);   -- 하루 상한 120 × 2.4 = 288 − 192 → 96
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('22222222-0000-0000-0000-000000000004', :'u1', 'g-fb', 1, false, 9, 3);   -- 0
select is(public.my_wallet()->'today', '{"g-fb":288}'::jsonb, 'u1 today: 72 + 120 + 96 = 288 (= 120 × 2.4)');
reset role;
select is((select delta from public.gold_ledger where ref = '22222222-0000-0000-0000-000000000001'), 72::bigint, 'u1: 30 × 2.4 = 72');
select is((select delta from public.gold_ledger where ref = '22222222-0000-0000-0000-000000000002'), 120::bigint, 'u1: 판당 상한 50 × 2.4 = 120');
select is((select delta from public.gold_ledger where ref = '22222222-0000-0000-0000-000000000003'), 96::bigint, 'u1: 하루 상한 288의 남은 96');
select is((select count(*)::int from public.gold_ledger where ref = '22222222-0000-0000-0000-000000000004'), 0, 'u1: 하루 상한에 닿으면 지급 없음');

-- ---------------------------------------------------------------- u3: 보너스 0이면 지금과 같다
set local role authenticated;
set local request.jwt.claims = :'U3';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('22222222-0000-0000-0000-000000000031', :'u3', 'g-fb', 1, false, 3.75, 3);
reset role;
select is((select delta from public.gold_ledger where ref = '22222222-0000-0000-0000-000000000031'), 37::bigint, 'u3 (보너스 0): floor(37.5) = 37 그대로');

-- ---------------------------------------------------------------- u4 (×5): 사이트 하루 상한은 그대로
set local role authenticated;
set local request.jwt.claims = :'U4';
insert into public.free_plays (client_id, user_id, game_id, logic_version, solved, score, action_count)
values ('22222222-0000-0000-0000-000000000041', :'u4', 'g-fbbig', 1, false, 10, 3);   -- 10,000 × 5 = 50,000
reset role;
select is((select row(delta, raw_delta)::text from public.gold_ledger where ref = '22222222-0000-0000-0000-000000000041'),
  row(34600::bigint, 50000::bigint)::text, 'u4: 보너스 뒤 50,000 → 사이트 2단 상한으로 34,600 (raw_delta 50,000)');

-- ---------------------------------------------------------------- 다른 골드에는 곱하지 않는다
select is(public._gold_move(:'u1', 100, 'world', 'fb-w1', 'w-a'), 388::bigint,
  'world 골드는 보너스 없이 그대로 (잔액 288 + 100)');
select is((select delta from public.gold_ledger where ref = 'fb-w1'), 100::bigint, 'world +100 → 장부 +100');
select ok(position('_free_bonus_pct' in pg_get_functiondef('public._gold_move(uuid,bigint,text,text,text,text)'::regprocedure)) = 0,
  '_gold_move(상금·판돈·참가비·world가 쓰는 길)에는 보너스가 없다');
select ok(not exists (select 1 from pg_proc p where p.proname in ('_contest_payouts', '_contest_enter', 'settle_due')
            and position('_free_bonus_pct' in pg_get_functiondef(p.oid)) > 0),
  '데일리 상금·참가비 함수에 보너스 없음');

select * from finish();
rollback;
