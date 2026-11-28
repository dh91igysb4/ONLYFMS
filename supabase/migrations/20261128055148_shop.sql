-- 플랫폼 상점: 게임 품목·보유·구매 (네온 라이더 차 설계 docs/superpowers/specs/2026-11-24-neon-rider-cars-design.md §7.2, §10)
--
-- 원칙
--   * shop_items가 가격의 원본이다. 품목 행은 고정 형식 문장으로만 쓰고 src/games/registry.test.ts가 마이그레이션의
--     최종 상태를 manifest shop.items와 비교한다. 가격을 바꾸려면 새 마이그레이션에 고정 형식 update 한 줄을 쓰고
--     manifest도 함께 바꾼다(형식은 registry.test.ts의 shopItemsFromMigrations 주석). 품목 삭제는 다루지 않는다.
--   * 가격 0 품목은 모두가 가진 것으로 친다: 사지 않고(free_item), user_items 행도 없다. 이미 산 품목이 나중에 0이 되면
--     그 행은 그대로 둔다(화면은 가격 0이거나 행이 있으면 가진 것으로 본다).
--   * 쓰기는 RPC(buy_item·equip_item)만. user_items는 본인 행 select만 연다.
--   * 차감은 _gold_move(reason shop, ref '<게임>:<품목>', game_id 게임) 한 번. 지출이라 사이트 하루 상한과 무관하고
--     _earned_today(수입 reason만 셈)도 그대로다.
--   * 잠금 순서: 게임 쪽 행(user_items 삽입) 먼저, 지갑 나중. 같은 품목을 동시에 두 번 사면 둘째 삽입이 첫째 트랜잭션을
--     기다렸다가 already_owned로 끝난다(첫째가 잔액 부족으로 되돌려지면 둘째가 이어서 산다).
--   * 숨김 게임 품목은 사지 못한다(hidden_game). 지갑이 보이기 전(_wallet_enabled() false)에는 wallet_off.

-- ------------------------------------------------------------------ 장부 reason에 shop
alter table public.gold_ledger drop constraint gold_ledger_reason_check;
alter table public.gold_ledger add constraint gold_ledger_reason_check
  check (reason in ('migrate', 'world', 'free', 'daily_prize', 'duel_stake', 'duel_payout',
                    'duel_refund', 'contest_fee', 'contest_prize', 'contest_refund', 'admin', 'shop'));

-- ------------------------------------------------------------------ 품목·보유
create table public.shop_items (
  game_id text not null references public.game_modes(game_id) on delete cascade,
  item_id text not null,
  price   bigint not null check (price >= 0),
  primary key (game_id, item_id)
);

create table public.user_items (
  user_id   uuid not null references auth.users(id) on delete cascade,
  game_id   text not null,
  item_id   text not null,
  equipped  boolean not null default false,
  bought_at timestamptz not null default now(),
  primary key (user_id, game_id, item_id),
  foreign key (game_id, item_id) references public.shop_items (game_id, item_id) on delete cascade
);

-- 한 게임에 장착은 하나
create unique index user_items_one_equipped on public.user_items (user_id, game_id) where equipped;

alter table public.shop_items enable row level security;
alter table public.user_items enable row level security;

-- 가격은 누구나(로그인) 본다. 보유는 본인만.
create policy shop_items_select on public.shop_items
  for select to authenticated using (true);
create policy user_items_select on public.user_items
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.shop_items, public.user_items from public, anon, authenticated;
grant select on table public.shop_items, public.user_items to authenticated;

insert into public.shop_items (game_id, item_id, price) values ('neon-rider', 'coupe', 0), ('neon-rider', 'pickup', 5000), ('neon-rider', 'buggy', 15000), ('neon-rider', 'sports', 30000), ('neon-rider', 'f1', 60000), ('neon-rider', 'skate', 100000);

-- ------------------------------------------------------------------ buy_item
-- p_price는 화면이 본 가격이다. 표 가격과 다르면 price_mismatch(DETAIL = 지금 가격, 대회 참가비 fee_mismatch와 같은 방식).
-- 돌려주는 값: {"balance": 산 뒤 잔액}
create function public.buy_item(p_game text, p_item text, p_price bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_price bigint;
  v_old   bigint;
  v_bal   bigint;
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'not_approved';
  end if;
  if not public._wallet_enabled() then
    raise exception using errcode = 'P0001', message = 'wallet_off';
  end if;
  if public._is_hidden_game(p_game) then
    raise exception using errcode = 'P0001', message = 'hidden_game';
  end if;
  select s.price into v_price from public.shop_items s where s.game_id = p_game and s.item_id = p_item;
  if not found then
    raise exception using errcode = 'P0001', message = 'unknown_item';
  end if;
  if exists (select 1 from public.user_items u
              where u.user_id = v_uid and u.game_id = p_game and u.item_id = p_item) then
    raise exception using errcode = 'P0001', message = 'already_owned';
  end if;
  if p_price is distinct from v_price then
    raise exception using errcode = 'P0001', message = 'price_mismatch', detail = v_price::text;
  end if;
  if v_price = 0 then
    raise exception using errcode = 'P0001', message = 'free_item';
  end if;

  -- 게임 쪽 행 먼저: 동시에 같은 품목을 사는 둘째 요청은 여기서 첫째를 기다린 뒤 아무것도 넣지 못한다
  insert into public.user_items (user_id, game_id, item_id) values (v_uid, p_game, p_item)
  on conflict (user_id, game_id, item_id) do nothing;
  if not found then
    raise exception using errcode = 'P0001', message = 'already_owned';
  end if;

  -- 지갑 나중. 잔액이 모자라면 _gold_move가 not_enough_gold로 위 삽입까지 되돌린다
  v_old := public._wallet_lock(v_uid);
  v_bal := public._gold_move(v_uid, -v_price, 'shop', p_game || ':' || p_item, p_game);
  -- 같은 ref의 옛 장부 줄이 있으면 _gold_move는 빼지 않고 돌아온다. 공짜로 주지 않게 막는다
  if v_bal <> v_old - v_price then
    raise exception using errcode = 'P0001', message = 'already_owned';
  end if;
  return jsonb_build_object('balance', v_bal);
end
$$;

-- ------------------------------------------------------------------ equip_item
-- 가진 품목(행)이면 그 행만 equipped. 행이 없고 가격 0 품목이면 모두 false(= 기본). 그 밖에는 not_owned.
create function public.equip_item(p_game text, p_item text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_approved() then
    raise exception using errcode = 'P0001', message = 'not_approved';
  end if;
  -- 이 게임의 내 행을 먼저 잠근다: 동시 장착 둘이 서로 다른 행을 true로 만들어 유일 색인에 걸리지 않게
  perform 1 from public.user_items u where u.user_id = v_uid and u.game_id = p_game for update;
  if not exists (select 1 from public.user_items u
                  where u.user_id = v_uid and u.game_id = p_game and u.item_id = p_item)
     and not exists (select 1 from public.shop_items s
                      where s.game_id = p_game and s.item_id = p_item and s.price = 0) then
    raise exception using errcode = 'P0001', message = 'not_owned';
  end if;
  -- 끄기 먼저, 켜기 나중 (유일 색인은 행마다 바로 검사한다)
  update public.user_items set equipped = false
   where user_id = v_uid and game_id = p_game and equipped and item_id <> p_item;
  update public.user_items set equipped = true
   where user_id = v_uid and game_id = p_game and item_id = p_item and not equipped;
end
$$;

-- ------------------------------------------------------------------ my_items
-- 본인 보유 목록(가격 0 품목은 행이 있을 때만. 화면이 manifest로 채운다)
create function public.my_items(p_game text) returns table (item_id text, equipped boolean)
language sql stable security definer set search_path = public as $$
  select u.item_id, u.equipped from public.user_items u
   where u.user_id = auth.uid() and u.game_id = p_game
   order by u.item_id
$$;

-- ------------------------------------------------------------------ 권한
revoke execute on function
  public.buy_item(text, text, bigint),
  public.equip_item(text, text),
  public.my_items(text)
from public, anon, authenticated;
grant execute on function
  public.buy_item(text, text, bigint),
  public.equip_item(text, text),
  public.my_items(text)
to authenticated;
