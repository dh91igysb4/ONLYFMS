-- 지갑·골드 장부·사이트 하루 상한 (지갑 1단계 Task 1, 설계 §5)
-- 장부·지갑 변경은 슈퍼유저(= Edge Function의 소유자 연결)로 _gold_move를 부른다.
-- 사이트 상한 경우마다 새 사용자(c1~c9)로 시작한다. cap 30,750 · rate 0.2 기준.
begin;
select plan(104);

\set PU  '{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}'
\set UA  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
\set UB  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}'
\set ADM '{"sub":"00000000-0000-0000-0000-0000000000fd","role":"authenticated"}'
\set pu  '00000000-0000-0000-0000-0000000000f0'
\set ua  '00000000-0000-0000-0000-0000000000f1'
\set ub  '00000000-0000-0000-0000-0000000000f2'
\set adm '00000000-0000-0000-0000-0000000000fd'
\set c1 '00000000-0000-0000-0000-0000000000c1'
\set c2 '00000000-0000-0000-0000-0000000000c2'
\set c3 '00000000-0000-0000-0000-0000000000c3'
\set c4 '00000000-0000-0000-0000-0000000000c4'
\set c5 '00000000-0000-0000-0000-0000000000c5'
\set c6 '00000000-0000-0000-0000-0000000000c6'
\set c7 '00000000-0000-0000-0000-0000000000c7'
\set c8 '00000000-0000-0000-0000-0000000000c8'
\set c9 '00000000-0000-0000-0000-0000000000c9'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  (:'pu',  'gp@example.com'),
  (:'ua',  'ga@example.com'),
  (:'ub',  'gb@example.com'),
  (:'adm', 'gadm@example.com'),
  (:'c1', 'c1@example.com'), (:'c2', 'c2@example.com'), (:'c3', 'c3@example.com'),
  (:'c4', 'c4@example.com'), (:'c5', 'c5@example.com'), (:'c6', 'c6@example.com'),
  (:'c7', 'c7@example.com'), (:'c8', 'c8@example.com'), (:'c9', 'c9@example.com');
update public.profiles set handle = 'goldp' where id = :'pu';
update public.profiles set status = 'approved', handle = 'golda' where id = :'ua';
update public.profiles set status = 'approved', handle = 'goldb' where id = :'ub';
update public.profiles set status = 'approved', handle = 'gboss', is_admin = true where id = :'adm';
update public.profiles set status = 'approved' where id in (:'c1', :'c2', :'c3', :'c4', :'c5', :'c6', :'c7', :'c8', :'c9');

select has_table('public', 'wallets', 'wallets exists');
select has_table('public', 'gold_ledger', 'gold_ledger exists');
select has_function('public', '_economy', 'has _economy');
select has_function('public', '_wallet_lock', array['uuid'], 'has _wallet_lock');
select has_function('public', '_gold_move', array['uuid', 'bigint', 'text', 'text', 'text', 'text'], 'has _gold_move');
select has_function('public', 'my_wallet', 'has my_wallet');
select has_function('public', 'user_wallet', array['text'], 'has user_wallet');
select has_function('public', 'admin_gold_adjust', array['text', 'bigint', 'text'], 'has admin_gold_adjust');
select has_function('public', 'admin_gold_ledger', array['integer'], 'has admin_gold_ledger');
select ok(public._economy() @> '{"daily_soft_cap":30750,"soft_cap_rate":0.2,"daily_soft_cap_2":41000,"soft_cap_rate_2":0.04}'::jsonb,
  '_economy: economy.ts 사본 상한 키 (2단 상한은 16_soft_cap_tier2, 상금·판돈·참가비는 18_settle_daily)');

-- ---------------------------------------------------------------- _gold_move 기본 (Review Focus 2)
select is(public._gold_move(:'ua', 100, 'admin', 'r1', 'g-x', '메모'), 100::bigint, 'move: 지갑 없던 사람 +100 → 100');
select is((select balance from public.wallets where user_id = :'ua'), 100::bigint, 'move: wallets 100');
select is((select count(*)::int from public.gold_ledger where user_id = :'ua'), 1, 'move: 장부 1줄');
select is((select row(balance_after, game_id, note, raw_delta)::text from public.gold_ledger where user_id = :'ua'),
  row(100::bigint, 'g-x'::text, '메모'::text, null::bigint)::text, 'move: balance_after·game_id·note 그대로, raw_delta null');
select is(public._gold_move(:'ua', 100, 'admin', 'r1'), 100::bigint, 'move: 같은 (user,reason,ref) → 무시');
select is((select count(*)::int from public.gold_ledger where user_id = :'ua'), 1, 'move: 중복 뒤 장부 1줄');
select is(public._gold_move(:'ua', 100, 'world', 'r1'), 200::bigint, 'move: 같은 ref라도 reason이 다르면 반영');

savepoint s_neg;
select throws_ok($$select public._gold_move('00000000-0000-0000-0000-0000000000f1', -250, 'world', 'neg1')$$,
  'P0001', 'not_enough_gold', 'move: 음수 결과 → not_enough_gold');
rollback to savepoint s_neg;
select is((select balance from public.wallets where user_id = :'ua'), 200::bigint, 'move: 거절 뒤 잔액 불변');
select is((select count(*)::int from public.gold_ledger where user_id = :'ua'), 2, 'move: 거절 뒤 장부 불변');
select is(public._gold_move(:'ua', -200, 'world', 'spend1'), 0::bigint, 'move: −200 → 0');
select is(public._gold_move(:'ua', 0, 'world', 'zero1'), 0::bigint, 'move: delta 0 → 잔액만');
select is((select count(*)::int from public.gold_ledger where user_id = :'ua' and ref = 'zero1'), 0, 'move: delta 0 → 장부 줄 없음');
select is(public._wallet_lock(:'ub'), 0::bigint, '_wallet_lock: 없으면 0으로 만든다');
select is((select count(*)::int from public.wallets where user_id = :'ub'), 1, '_wallet_lock: 지갑 행 생김');

-- ---------------------------------------------------------------- 제약
savepoint s_c1;
select throws_ok($$update public.wallets set balance = -1 where user_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '23514', null, 'check: 음수 잔액 거절');
rollback to savepoint s_c1;
savepoint s_c2;
select throws_ok($$insert into public.gold_ledger (user_id, delta, balance_after, reason, ref)
  values ('00000000-0000-0000-0000-0000000000f1', 1, 1, 'zzz', 'x')$$, '23514', null, 'check: 모르는 reason 거절');
rollback to savepoint s_c2;
savepoint s_c3;
select throws_ok($$insert into public.gold_ledger (user_id, delta, balance_after, reason, ref, raw_delta)
  values ('00000000-0000-0000-0000-0000000000f1', 10, 10, 'free', 'x', 10)$$, '23514', null, 'check: raw_delta <= delta 거절');
rollback to savepoint s_c3;
savepoint s_c4;
select throws_ok($$insert into public.gold_ledger (user_id, delta, balance_after, reason, ref)
  values ('00000000-0000-0000-0000-0000000000f1', 0, 1, 'free', 'x')$$, '23514', null, 'check: delta 0 거절');
rollback to savepoint s_c4;

-- ---------------------------------------------------------------- 사이트 하루 상한 (Review Focus 6)
-- c1: free 20,000 → 20,000; free 20,000 → 12,600; world 100 → 20; free 4 → 0
select is(public._gold_move(:'c1', 20000, 'free', 'a', 'g1'), 20000::bigint, 'cap: free +20,000 다 들어감');
select is((select raw_delta from public.gold_ledger where user_id = :'c1' and ref = 'a'), null::bigint, 'cap: 안 줄면 raw_delta null');
select is(public._gold_move(:'c1', 20000, 'free', 'b', 'g1'), 32600::bigint, 'cap: free +20,000 → 12,600 (10,750 + 1,850)');
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'c1' and ref = 'b'),
  row(12600::bigint, 20000::bigint)::text, 'cap: 장부 delta 12,600 · raw_delta 20,000');
select is(public._gold_move(:'c1', 100, 'world', 'c', 'g2'), 32620::bigint, 'cap: world +100 → 20 (world·free 합계 공유)');
select is(public._gold_move(:'c1', 4, 'free', 'd', 'g1'), 32620::bigint, 'cap: free +4 → 0, 잔액 그대로');
select is((select count(*)::int from public.gold_ledger where user_id = :'c1' and ref = 'd'), 0, 'cap: got 0 → 장부 줄 없음');

-- c2: 지출은 합계를 줄이지 않는다
select is(public._gold_move(:'c2', 30000, 'world', 'a'), 30000::bigint, 'cap: world +30,000');
select is(public._gold_move(:'c2', -10000, 'world', 'b'), 20000::bigint, 'cap: world −10,000');
select is(public._gold_move(:'c2', 1000, 'free', 'c', 'g1'), 20800::bigint, 'cap: free +1,000 → 800 (지출은 합계를 줄이지 않음)');

-- c3: daily_prize는 세되 줄이지 않는다
select is(public._gold_move(:'c3', 30000, 'world', 'a'), 30000::bigint, 'cap: world +30,000');
select is(public._gold_move(:'c3', 6150, 'daily_prize', 'k1', 'g1'), 36150::bigint, 'cap: daily_prize +6,150 그대로');
select is((select raw_delta from public.gold_ledger where user_id = :'c3' and ref = 'k1'), null::bigint, 'cap: daily_prize raw_delta null');
select is(public._gold_move(:'c3', 100, 'free', 'b', 'g1'), 36170::bigint, 'cap: 상금 뒤 free +100 → 20 (상금도 합계에 듦)');

-- c4: migrate·admin·duel_payout·contest_prize는 세지 않는다
select is(public._gold_move(:'c4', 100000, 'migrate', 'fishing', 'fishing'), 100000::bigint, 'cap: migrate 그대로');
select is(public._gold_move(:'c4', 100000, 'admin', 'x1'), 200000::bigint, 'cap: admin 그대로');
select is(public._gold_move(:'c4', 50000, 'duel_payout', 'm1', 'g1'), 250000::bigint, 'cap: duel_payout 그대로');
select is(public._gold_move(:'c4', 50000, 'contest_prize', 'k1'), 300000::bigint, 'cap: contest_prize 그대로');
select is(public._gold_move(:'c4', 100, 'free', 'a', 'g1'), 300100::bigint, 'cap: 옮기는 돈 뒤 free +100 → 100');

-- c5: 합계가 넘은 상태에서도 옮기는 돈은 줄이지 않는다
select is(public._gold_move(:'c5', 40000, 'world', 'a'), 32600::bigint, 'cap: world +40,000 → 32,600');
select is(public._gold_move(:'c5', 500, 'duel_refund', 'm1'), 33100::bigint, 'cap: duel_refund 그대로');
select is(public._gold_move(:'c5', 500, 'contest_refund', 'k1'), 33600::bigint, 'cap: contest_refund 그대로');
select is(public._gold_move(:'c5', 500, 'duel_payout', 'm2'), 34100::bigint, 'cap: duel_payout 그대로');

-- c6·c7: KST 자정 경계
insert into public.gold_ledger (user_id, delta, balance_after, reason, ref, game_id, created_at) values
  (:'c6', 30750, 30750, 'free', 'old', 'g1',
   ((date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul') - interval '1 second'),
  (:'c7', 30750, 30750, 'free', 'old', 'g1',
   ((date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul'));
select is(public._gold_move(:'c6', 100, 'free', 'a', 'g1'), 100::bigint, 'cap: 어제(KST 0시 − 1초) 줄은 세지 않음');
select is(public._gold_move(:'c7', 100, 'free', 'a', 'g1'), 20::bigint, 'cap: 오늘 KST 0시 정각 줄은 셈');

-- c8: 중복은 상한 계산보다 먼저
select is(public._gold_move(:'c8', 1000, 'free', 'a', 'g1'), 1000::bigint, 'dup: free +1,000');
select is(public._gold_move(:'c8', 5000, 'free', 'a', 'g1'), 1000::bigint, 'dup: 같은 ref 금액 바꿔도 무시');
select is((select count(*)::int from public.gold_ledger where user_id = :'c8'), 1, 'dup: 장부 1줄');

-- 잠금 순서: 지갑을 잠근 뒤 합계를 읽는다 (동시성 자체는 world 함수 테스트의 두 게임 동시 요청이 확인)
select ok(position('public._wallet_lock(' in pg_get_functiondef('public._gold_move(uuid,bigint,text,text,text,text)'::regprocedure))
        < position('public._earned_today(' in pg_get_functiondef('public._gold_move(uuid,bigint,text,text,text,text)'::regprocedure))
      and position('public._wallet_lock(' in pg_get_functiondef('public._gold_move(uuid,bigint,text,text,text,text)'::regprocedure)) > 0,
  'cap: _wallet_lock이 합계(_earned_today)보다 먼저');

-- c9: my_wallet earned_today·today (어제 줄과 world 줄 today에서 빠짐)
insert into public.gold_ledger (user_id, delta, balance_after, reason, ref, game_id, created_at) values
  (:'c9', 999, 999, 'free', 'yday', 'g1', now() - interval '1 day');
select public._gold_move(:'c9', 20000, 'free', 'a', 'g1');
select public._gold_move(:'c9', 20000, 'free', 'b', 'g1');
select public._gold_move(:'c9', 300, 'free', 'c', 'g2');
select public._gold_move(:'c9', 500, 'world', 'd', 'g3');

-- ---------------------------------------------------------------- 권한·읽기 (승인 사용자 A)
set local role authenticated;
set local request.jwt.claims = :'UA';

select ok((select count(*)::int from public.wallets) >= 11, 'wallets: 승인 사용자는 모든 행을 읽음');
select is((select count(*)::int from public.gold_ledger where user_id <> auth.uid()), 0, 'gold_ledger: 남의 줄 안 보임');
select is((select count(*)::int from public.gold_ledger), 3, 'gold_ledger: 본인 줄만');
select throws_ok($$insert into public.wallets (user_id, balance) values (auth.uid(), 1)$$, '42501', null, 'wallets: insert 불가');
select throws_ok($$update public.wallets set balance = 1000000$$, '42501', null, 'wallets: update 불가');
select throws_ok($$delete from public.wallets$$, '42501', null, 'wallets: delete 불가');
select throws_ok($$insert into public.gold_ledger (user_id, delta, balance_after, reason, ref) values (auth.uid(), 1, 1, 'admin', 'x')$$,
  '42501', null, 'gold_ledger: insert 불가');
select throws_ok($$update public.gold_ledger set delta = 1$$, '42501', null, 'gold_ledger: update 불가');
select throws_ok($$delete from public.gold_ledger$$, '42501', null, 'gold_ledger: delete 불가');
select throws_ok($$select public._gold_move(auth.uid(), 100, 'admin', 'hack')$$, '42501', null, '_gold_move: authenticated 실행 불가');
select throws_ok($$select public._wallet_lock(auth.uid())$$, '42501', null, '_wallet_lock: authenticated 실행 불가');
select throws_ok($$select public._economy()$$, '42501', null, '_economy: authenticated 실행 불가');
select throws_ok($$select public._kst_today_start()$$, '42501', null, '_kst_today_start: authenticated 실행 불가');
select throws_ok($$select public._earned_today(auth.uid())$$, '42501', null, '_earned_today: authenticated 실행 불가');

select is(public.my_wallet() - 'prizes' - 'free_bonus_pct', '{"balance":0,"today":{},"earned_today":100}'::jsonb, 'my_wallet: free 없음, earned_today는 world +100만 (admin 제외)');
select is(public.user_wallet('goldb'), 0::bigint, 'user_wallet: 지갑 0');
select is(public.user_wallet(' GoldB '), 0::bigint, 'user_wallet: handle 정규화');
select is(public.user_wallet('goldp'), null::bigint, 'user_wallet: 대기 사용자 → null');
select is(public.user_wallet('없는사람'), null::bigint, 'user_wallet: 없는 handle → null');
select throws_ok($$select public.admin_gold_adjust('goldb', 100, '메모')$$, 'P0001', 'forbidden', 'admin_gold_adjust: 비관리자 forbidden');
select throws_ok($$select * from public.admin_gold_ledger(5)$$, 'P0001', 'forbidden', 'admin_gold_ledger: 비관리자 forbidden');

-- c9 본인
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c9","role":"authenticated"}';
select is(public.my_wallet()->'today', '{"g1":40000,"g2":300}'::jsonb, 'my_wallet.today: 오늘 free 게임별 줄기 전 합계 (어제·world 제외)');
select is((public.my_wallet()->>'earned_today')::bigint, 32760::bigint,
  'my_wallet.earned_today: 실제 들어간 수입 합계');
select is((public.my_wallet()->>'balance')::bigint, (select balance from public.wallets where user_id = auth.uid()), 'my_wallet.balance');

-- c1 본인: today는 raw 기준 40,004가 아니라 장부에 남은 줄 기준 40,000
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(public.my_wallet()->'today', '{"g1":40000}'::jsonb, 'my_wallet.today: c1 free 40,000');
select is((public.my_wallet()->>'earned_today')::bigint, 32620::bigint, 'my_wallet.earned_today: c1 32,620');

-- ---------------------------------------------------------------- 대기 사용자
set local request.jwt.claims = :'PU';
select is((select count(*)::int from public.wallets), 0, 'pending: wallets 0행');
select throws_ok($$select public.my_wallet()$$, 'P0001', 'forbidden', 'pending: my_wallet forbidden');
select throws_ok($$select public.user_wallet('golda')$$, 'P0001', 'forbidden', 'pending: user_wallet forbidden');

-- ---------------------------------------------------------------- 관리자
set local request.jwt.claims = :'ADM';
select ok((select count(*)::int from public.gold_ledger) >= 20, 'admin: 모든 장부 읽음');
select is(public.admin_gold_adjust('goldb', 500, '보상'), 500::bigint, 'admin_gold_adjust: +500');
select is(public.admin_gold_adjust(' GOLDB ', 500, '보상'), 1000::bigint, 'admin_gold_adjust: 두 번 다 반영');
select is((select count(*)::int from public.gold_ledger where user_id = '00000000-0000-0000-0000-0000000000f2' and reason = 'admin' and note = '보상'),
  2, 'admin_gold_adjust: reason admin·note, ref가 매번 다름');
select throws_ok($$select public.admin_gold_adjust('goldb', -5000, '회수')$$, 'P0001', 'not_enough_gold', 'admin_gold_adjust: 잔액보다 큰 음수');
select throws_ok($$select public.admin_gold_adjust('goldb', 10, '  ')$$, 'P0001', 'note_invalid', 'admin_gold_adjust: 빈 메모');
select throws_ok($$select public.admin_gold_adjust('goldb', 10, repeat('가', 101))$$, 'P0001', 'note_invalid', 'admin_gold_adjust: 101자 메모');
select throws_ok($$select public.admin_gold_adjust('nobody_x', 10, '메모')$$, 'P0001', 'not_found', 'admin_gold_adjust: 없는 handle');
select is((select count(*)::int from public.admin_gold_ledger(2)), 2, 'admin_gold_ledger(2): 2줄');
select is((select handle::text from public.admin_gold_ledger(1)), 'goldb', 'admin_gold_ledger: 최신 줄 handle');
select is((select count(*)::int from public.admin_gold_ledger(1000)), least(200, (select count(*)::int from public.gold_ledger)),
  'admin_gold_ledger: 최대 200줄');
select is(public.user_wallet('goldb'), 1000::bigint, 'user_wallet: 조정 뒤 1,000');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.my_wallet()$$, '42501', null, 'anon: my_wallet 실행 불가');
select throws_ok($$select public.user_wallet('golda')$$, '42501', null, 'anon: user_wallet 실행 불가');
select throws_ok($$select public.admin_gold_adjust('golda', 1, 'x')$$, '42501', null, 'anon: admin_gold_adjust 실행 불가');
select throws_ok($$select * from public.admin_gold_ledger(1)$$, '42501', null, 'anon: admin_gold_ledger 실행 불가');
select throws_ok($$select public._gold_move('00000000-0000-0000-0000-0000000000f1', 1, 'admin', 'anon')$$, '42501', null, 'anon: _gold_move 실행 불가');
reset role;

select * from finish();
rollback;
