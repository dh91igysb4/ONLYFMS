-- 사이트 하루 상한 2단 (설계 §5.6): 들어간 합계 30,750까지 다, 41,000까지 75%, 그 위 50% (2026-11-24 개정, PR #96).
-- 2026-11-25부터 상한은 미니게임(free) 수입에만 걸리고, 낚시(world)는 줄지 않으며 합계에도 들지 않는다
-- (설계 2026-11-25-fishing-sell-decay-design.md). 금액은 src/games/economy.test.ts의 softCap 경우와 같다.
begin;
select plan(16);

\set t1 '00000000-0000-0000-0000-0000000000a1'
\set t2 '00000000-0000-0000-0000-0000000000a2'
\set t3 '00000000-0000-0000-0000-0000000000a3'
\set t4 '00000000-0000-0000-0000-0000000000a4'

insert into auth.users (id, email) values
  (:'t1', 't1@example.com'), (:'t2', 't2@example.com'), (:'t3', 't3@example.com'), (:'t4', 't4@example.com');
update public.profiles set status = 'approved' where id in (:'t1', :'t2', :'t3', :'t4');

-- t1: 한 번에 세 칸을 다 지나감 → 30,750 + 10,250(원래 13,666.7) + (100,000 − 44,416.7) × 0.5 = 68,791
select is(public._gold_move(:'t1', 100000, 'free', 'a', 'g1'), 68791::bigint, 'tier2: free +100,000 → 68,791');
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'t1' and ref = 'a'),
  row(68791::bigint, 100000::bigint)::text, 'tier2: 장부 delta 68,791 · raw_delta 100,000');
select is(public._gold_move(:'t1', 1000, 'free', 'b', 'g2'), 69291::bigint, 'tier2: 41,000을 넘은 뒤 free +1,000 → 500');
select is(public._gold_move(:'t1', 1, 'free', 'c', 'g2'), 69291::bigint, 'tier2: +1 → floor(0.5) = 0');
select is((select count(*)::int from public.gold_ledger where user_id = :'t1' and ref = 'c'), 0, 'tier2: got 0 → 장부 줄 없음');
select is(public._gold_move(:'t1', 2, 'free', 'd', 'g2'), 69292::bigint, 'tier2: +2 → 1');

-- t2: 40,500에서 +1,000 → 75% 칸 남은 500(원래 666.7) + 남은 333.3 × 0.5 = 166 → 666
select is(public._gold_move(:'t2', 30750, 'free', 'a'), 30750::bigint, 'tier2: free +30,750 다 들어감');
select is(public._gold_move(:'t2', 13000, 'free', 'b'), 40500::bigint, 'tier2: free +13,000 → 9,750 (75%)');
select is(public._gold_move(:'t2', 1000, 'free', 'c'), 41166::bigint, 'tier2: 40,500에서 +1,000 → 666');

-- t3: 낚시는 줄지 않고 합계에도 들지 않는다. 상금은 합계에 든다
select is(public._gold_move(:'t3', 30000, 'world', 'a'), 30000::bigint, 'tier2: world +30,000 그대로');
select is(public._gold_move(:'t3', 20000, 'daily_prize', 'k', 'g1'), 50000::bigint, 'tier2: daily_prize +20,000 그대로');
select is(public._earned_today(:'t3'), 20000::bigint, 'tier2: _earned_today는 상금만(world 제외)');
select is(public._gold_move(:'t3', 20000, 'free', 'b', 'g1'), 67687::bigint, 'tier2: 상금 20,000 뒤 free +20,000 → 10,750 + 6,937');
select is(public._gold_move(:'t3', 100000, 'world', 'c'), 167687::bigint, 'tier2: 합계가 41,000을 넘어도 world +100,000 그대로');
select is((select raw_delta from public.gold_ledger where user_id = :'t3' and ref = 'c'), null::bigint, 'tier2: world 줄은 raw_delta 없음');

-- t4: world를 많이 번 뒤에도 free는 첫 칸부터
select public._gold_move(:'t4', 50000, 'world', 'a');
select is(public._gold_move(:'t4', 1000, 'free', 'b', 'g1'), 51000::bigint, 'tier2: world 50,000 뒤 free +1,000 다 들어감');

select * from finish();
rollback;
