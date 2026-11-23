-- 사이트 하루 상한 2단 (설계 §5.6, 2026-11-24 개정): 들어간 합계 30,750까지 다, 41,000까지 20%, 그 위 4%.
-- 금액은 src/games/economy.test.ts의 softCap 경우와 같다. 슈퍼유저로 _gold_move를 부른다.
begin;
select plan(12);

\set t1 '00000000-0000-0000-0000-0000000000a1'
\set t2 '00000000-0000-0000-0000-0000000000a2'
\set t3 '00000000-0000-0000-0000-0000000000a3'
\set t4 '00000000-0000-0000-0000-0000000000a4'

insert into auth.users (id, email) values
  (:'t1', 't1@example.com'), (:'t2', 't2@example.com'), (:'t3', 't3@example.com'), (:'t4', 't4@example.com');
update public.profiles set status = 'approved' where id in (:'t1', :'t2', :'t3', :'t4');

-- t1: 한 번에 세 칸을 다 지나감 → 30,750 + 10,250(원래 51,250) + 18,000 × 0.04 = 41,720
select is(public._gold_move(:'t1', 100000, 'world', 'a', 'g1'), 41720::bigint, 'tier2: world +100,000 → 41,720');
select is((select row(delta, raw_delta)::text from public.gold_ledger where user_id = :'t1' and ref = 'a'),
  row(41720::bigint, 100000::bigint)::text, 'tier2: 장부 delta 41,720 · raw_delta 100,000');
select is(public._gold_move(:'t1', 1000, 'free', 'b', 'g2'), 41760::bigint, 'tier2: 41,000을 넘은 뒤 free +1,000 → 40');
select is(public._gold_move(:'t1', 24, 'free', 'c', 'g2'), 41760::bigint, 'tier2: +24 → floor(0.96) = 0');
select is((select count(*)::int from public.gold_ledger where user_id = :'t1' and ref = 'c'), 0, 'tier2: got 0 → 장부 줄 없음');
select is(public._gold_move(:'t1', 25, 'free', 'd', 'g2'), 41761::bigint, 'tier2: +25 → 1');

-- t2: 40,900에서 +1,000 → 20% 칸 남은 100(원래 500) + 남은 500 × 0.04 = 20 → 120
select is(public._gold_move(:'t2', 30750, 'world', 'a'), 30750::bigint, 'tier2: world +30,750 다 들어감');
select is(public._gold_move(:'t2', 50750, 'world', 'b'), 40900::bigint, 'tier2: world +50,750 → 10,150 (20%)');
select is(public._gold_move(:'t2', 1000, 'world', 'c'), 41020::bigint, 'tier2: 40,900에서 +1,000 → 120');

-- t3: 상금(줄이지 않음)으로 41,000을 넘긴 뒤 수입은 4%
select is(public._gold_move(:'t3', 30000, 'world', 'a'), 30000::bigint, 'tier2: world +30,000');
select is(public._gold_move(:'t3', 20000, 'daily_prize', 'k', 'g1'), 50000::bigint, 'tier2: daily_prize +20,000 그대로');
select is(public._gold_move(:'t3', 1000, 'free', 'b', 'g1'), 50040::bigint, 'tier2: 상금 뒤 free +1,000 → 40');

select * from finish();
rollback;
