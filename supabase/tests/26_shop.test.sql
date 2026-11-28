-- 플랫폼 상점: shop_items·user_items, buy_item·equip_item·my_items (네온 라이더 차 설계 §7.2, §10)
-- 승인 사용자 역할로 RPC를 부르고, 잔액·장부·보유 행은 슈퍼유저로 확인한다.
-- 같은 품목을 동시에 두 번 사는 경우는 pgTAP(한 세션)로 재현할 수 없어 supabase/functions/play/shop.test.ts가 본다.
begin;
select plan(55);

\set a '00000000-0000-0000-0000-0000000009a1'
\set b '00000000-0000-0000-0000-0000000009a2'
\set c '00000000-0000-0000-0000-0000000009a3'
\set p '00000000-0000-0000-0000-0000000009af'
\set A '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}'
\set B '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}'
\set C '{"sub":"00000000-0000-0000-0000-0000000009a3","role":"authenticated"}'
\set P '{"sub":"00000000-0000-0000-0000-0000000009af","role":"authenticated"}'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  (:'a', 'shopa@example.com'), (:'b', 'shopb@example.com'), (:'c', 'shopc@example.com'), (:'p', 'shopp@example.com');
update public.profiles set status = 'approved', handle = 'shopone'   where id = :'a';
update public.profiles set status = 'approved', handle = 'shoptwo'   where id = :'b';
update public.profiles set status = 'approved', handle = 'shopthree' where id = :'c';
update public.profiles set handle = 'shoppend' where id = :'p';

-- 숨김 게임의 품목 (테스트 전용)
insert into public.game_modes (game_id, daily, contest, free) values ('g-shophid', false, false, true);
insert into public.hidden_games (game_id) values ('g-shophid');
insert into public.shop_items (game_id, item_id, price) values ('g-shophid', 'hat', 100);

select public._gold_move(:'a', 70000,  'admin', 'shop-seed-a');
select public._gold_move(:'b', 100000, 'admin', 'shop-seed-b');
select public._gold_move(:'c', 100000, 'admin', 'shop-seed-c');
select public._gold_move(:'p', 100000, 'admin', 'shop-seed-p');

-- ---------------------------------------------------------------- 마이그레이션의 품목 행 (설계 §5 차 표)
select results_eq(
  $$select item_id, price from public.shop_items where game_id = 'neon-rider' order by price$$,
  $$values ('coupe'::text, 0::bigint), ('pickup', 5000), ('buggy', 15000), ('sports', 30000), ('f1', 60000), ('skate', 100000)$$,
  '네온 라이더 품목 6개와 가격');
select throws_ok($$insert into public.shop_items (game_id, item_id, price) values ('neon-rider', 'neg', -1)$$,
  '23514', null, '가격은 0 이상');
select throws_ok($$insert into public.shop_items (game_id, item_id, price) values ('no-such-game', 'x', 1)$$,
  '23503', null, '품목의 게임은 game_modes에 있어야 한다');
select throws_ok(format('insert into public.user_items (user_id, game_id, item_id) values (%L, %L, %L)', :'a', 'neon-rider', 'nope'),
  '23503', null, '보유 행은 있는 품목만');
select throws_ok($$insert into public.gold_ledger (user_id, delta, balance_after, reason, ref) values
  ('00000000-0000-0000-0000-0000000009a1', 1, 1, 'nope', 'x')$$, '23514', null, '장부 reason 검사는 그대로 모르는 값을 막는다');

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.buy_item(text, text, bigint)', 'execute'), 'anon은 buy_item 불가');
select ok(not has_function_privilege('anon', 'public.equip_item(text, text)', 'execute'), 'anon은 equip_item 불가');
select ok(not has_function_privilege('anon', 'public.my_items(text)', 'execute'), 'anon은 my_items 불가');
select ok(has_function_privilege('authenticated', 'public.buy_item(text, text, bigint)', 'execute'), 'authenticated는 buy_item');
select ok(has_function_privilege('authenticated', 'public.equip_item(text, text)', 'execute'), 'authenticated는 equip_item');
select ok(has_function_privilege('authenticated', 'public.my_items(text)', 'execute'), 'authenticated는 my_items');

-- ---------------------------------------------------------------- 지갑 꺼짐 → wallet_off
create or replace function public._wallet_enabled() returns boolean
language sql immutable security definer set search_path = public as $$ select false $$;
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok($$select public.buy_item('neon-rider', 'pickup', 5000)$$, 'P0001', 'wallet_off', '_wallet_enabled() false → wallet_off');
reset role;
create or replace function public._wallet_enabled() returns boolean
language sql immutable security definer set search_path = public as $$ select true $$;

-- ---------------------------------------------------------------- 구매 성공 (A, 잔액 70,000)
set local role authenticated;
set local request.jwt.claims = :'A';
select is(public.buy_item('neon-rider', 'f1', 60000), '{"balance": 10000}'::jsonb, 'F1 구매 → { balance: 10000 }');
reset role;
select is((select balance from public.wallets where user_id = :'a'), 10000::bigint, '잔액 −60,000');
select results_eq(
  format($$select delta, reason, ref, game_id from public.gold_ledger where user_id = %L and reason = 'shop'$$, :'a'),
  $$values (-60000::bigint, 'shop'::text, 'neon-rider:f1'::text, 'neon-rider'::text)$$,
  '장부 한 줄: reason shop, ref neon-rider:f1, delta −60,000');
select results_eq(
  format($$select item_id, equipped from public.user_items where user_id = %L and game_id = 'neon-rider'$$, :'a'),
  $$values ('f1'::text, false)$$, '보유 행이 생기고 장착은 하지 않는다');
select is(public._earned_today(:'a'), 0::bigint,
  '상점 지출은 오늘 들어온 합계에 세지 않는다');

-- 같은 품목 다시 → already_owned, 잔액·장부 그대로
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok($$select public.buy_item('neon-rider', 'f1', 60000)$$, 'P0001', 'already_owned', '이미 가진 품목 → already_owned');
reset role;
select is((select balance from public.wallets where user_id = :'a'), 10000::bigint, 'already_owned 뒤 잔액 그대로');
select is((select count(*)::int from public.gold_ledger where user_id = :'a' and reason = 'shop'), 1, 'already_owned 뒤 장부 그대로');

-- 픽업(5,000) → 5,000 남음, 버기(15,000)는 잔액 부족
set local role authenticated;
set local request.jwt.claims = :'A';
select is(public.buy_item('neon-rider', 'pickup', 5000), '{"balance": 5000}'::jsonb, '픽업 구매 → 5000');
select throws_ok($$select public.buy_item('neon-rider', 'buggy', 15000)$$, 'P0001', 'not_enough_gold', '잔액 부족 → not_enough_gold');
reset role;
select is((select balance from public.wallets where user_id = :'a'), 5000::bigint, 'not_enough_gold 뒤 잔액 그대로');
select is((select count(*)::int from public.user_items where user_id = :'a' and item_id = 'buggy'), 0,
  'not_enough_gold 뒤 보유 행 없음(함께 되돌림)');

-- ---------------------------------------------------------------- 오류 (B, 잔액 100,000)
set local role authenticated;
set local request.jwt.claims = :'B';
select throws_ok($$select public.buy_item('neon-rider', 'f1', 50000)$$, 'P0001', 'price_mismatch', '화면이 본 가격이 다름 → price_mismatch');
select throws_ok($$select public.buy_item('neon-rider', 'f1', null)$$, 'P0001', 'price_mismatch', '가격 없음 → price_mismatch');
select throws_ok($$select public.buy_item('neon-rider', 'coupe', 0)$$, 'P0001', 'free_item', '가격 0 품목 → free_item');
select throws_ok($$select public.buy_item('neon-rider', 'tank', 1000)$$, 'P0001', 'unknown_item', '없는 품목 → unknown_item');
select throws_ok($$select public.buy_item('no-such-game', 'f1', 60000)$$, 'P0001', 'unknown_item', '없는 게임 → unknown_item');
select throws_ok($$select public.buy_item('g-shophid', 'hat', 100)$$, 'P0001', 'hidden_game', '숨김 게임 품목 → hidden_game');
reset role;
select is((select balance from public.wallets where user_id = :'b'), 100000::bigint, '오류 뒤 B 잔액 그대로');
select is((select count(*)::int from public.gold_ledger where user_id = :'b' and reason = 'shop'), 0, '오류 뒤 B 장부 그대로');
select is((select count(*)::int from public.user_items where user_id = :'b'), 0, '오류 뒤 B 보유 행 없음');

-- 대기 사용자 → not_approved
set local role authenticated;
set local request.jwt.claims = :'P';
select throws_ok($$select public.buy_item('neon-rider', 'pickup', 5000)$$, 'P0001', 'not_approved', '대기 사용자 → not_approved');
select throws_ok($$select public.equip_item('neon-rider', 'coupe')$$, 'P0001', 'not_approved', '대기 사용자 장착 → not_approved');
reset role;

-- ---------------------------------------------------------------- 장착 (A: f1·pickup 보유)
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok($$select public.equip_item('neon-rider', 'buggy')$$, 'P0001', 'not_owned', '안 가진 품목 장착 → not_owned');
select throws_ok($$select public.equip_item('neon-rider', 'tank')$$, 'P0001', 'not_owned', '없는 품목 장착 → not_owned');
select lives_ok($$select public.equip_item('neon-rider', 'f1')$$, 'F1 장착');
select results_eq($$select item_id, equipped from public.my_items('neon-rider')$$,
  $$values ('f1'::text, true), ('pickup', false)$$, 'my_items: F1만 장착');
select lives_ok($$select public.equip_item('neon-rider', 'pickup')$$, '픽업 장착');
select results_eq($$select item_id, equipped from public.my_items('neon-rider')$$,
  $$values ('f1'::text, false), ('pickup', true)$$, '차례로 장착하면 마지막 하나만 equipped');
select lives_ok($$select public.equip_item('neon-rider', 'coupe')$$, '가격 0 품목(쿠페) 장착');
select results_eq($$select item_id, equipped from public.my_items('neon-rider')$$,
  $$values ('f1'::text, false), ('pickup', false)$$, '쿠페 장착 → 모두 false(기본)');
select is((select count(*)::int from public.my_items('g-shophid')), 0, 'my_items는 요청한 게임만');
reset role;
select throws_ok(format($$update public.user_items set equipped = true where user_id = %L$$, :'a'),
  '23505', null, '한 게임에 equipped는 하나만 (부분 유일 색인)');

-- 가격이 0이 된 품목을 이미 가진 사람은 그 행을 장착할 수 있다 (§10 가격 변경)
update public.shop_items set price = 0 where game_id = 'neon-rider' and item_id = 'pickup';
set local role authenticated;
set local request.jwt.claims = :'A';
select lives_ok($$select public.equip_item('neon-rider', 'pickup')$$, '가격 0이 된 보유 품목 장착');
select results_eq($$select item_id, equipped from public.my_items('neon-rider')$$,
  $$values ('f1'::text, false), ('pickup', true)$$, '가격 0이 된 보유 품목도 행으로 장착된다');
reset role;
update public.shop_items set price = 5000 where game_id = 'neon-rider' and item_id = 'pickup';

-- ---------------------------------------------------------------- RLS·my_items 본인만
set local role authenticated;
set local request.jwt.claims = :'C';
select is(public.buy_item('neon-rider', 'skate', 100000), '{"balance": 0}'::jsonb, 'C가 스케이트보드 구매 (잔액 전부)');
select results_eq($$select item_id from public.user_items order by item_id$$, $$values ('skate'::text)$$,
  'user_items select는 본인 행만 (A의 f1·pickup 안 보임)');
select results_eq($$select item_id, equipped from public.my_items('neon-rider')$$, $$values ('skate'::text, false)$$,
  'my_items는 본인 것만');
select throws_ok(format($$insert into public.user_items (user_id, game_id, item_id) values (%L, 'neon-rider', 'f1')$$, :'c'),
  '42501', null, '직접 insert는 권한 오류');
select throws_ok($$update public.user_items set equipped = true$$, '42501', null, '직접 update는 권한 오류');
select is((select count(*)::int from public.shop_items where game_id = 'neon-rider'), 6, 'shop_items는 클라이언트가 읽는다(가격 표시)');
select throws_ok($$update public.shop_items set price = 1$$, '42501', null, 'shop_items 직접 update는 권한 오류');
reset role;

set local role authenticated;
set local request.jwt.claims = :'B';
select is((select count(*)::int from public.my_items('neon-rider')), 0, '아무것도 안 산 사용자의 my_items는 비었다');
reset role;

select * from finish();
rollback;
