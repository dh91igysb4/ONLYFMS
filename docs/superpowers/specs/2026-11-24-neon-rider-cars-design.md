# 네온 라이더 자동차 — 골드로 사서 고르기 (설계)

상태: 구현 완료(`feat/neon-rider-cars`, `logic.version` 6). 날짜 2026-11-24. 아래는 만든 것 기준이고, 처음 제안과 달라진 값은 본문에 표시했다.

## 1. 의도

사이트 공용 골드로 네온 라이더 자동차를 사서 골라 탄다(사용자 요청 "골드로 자동차 살 수 있게"). 원작 Rider처럼 차마다 모양이 다르고, **모양이 판정에 영향을 준다**(사용자 결정: 낮은 차가 선풍기·창 밑을 더 쉽게 빠진다). 원작 나무위키: "차들은 모두 속도, 가속도, 회전 관성 등이 같고 … 주행의 영향을 주는 것은 오직 모양과 무게뿐 … 보통 차체가 낮은 게 운용하기 편리하다."

## 2. 목표 · 비목표 · 반목표

- 목표: 차 6대, 골드로 사고 고르기, 고른 차의 모양대로 그리고 판정한다. 자유 플레이 기록으로 어느 차로 달렸는지 재현된다.
- 비목표: 무게·바퀴 크기·축거 차이(사용자 결정: **차체 모양만** 다르다. 바퀴 반지름 180 mm·축거·질량·가속·회전은 모든 차가 같다), 되팔기, 뽑기, 차별 리더보드.
- 반목표: 산 차가 지형 주행 자체를 바꿔 47개 템플릿 통과 여부가 차마다 달라지는 것(바퀴가 같으므로 지형 접촉은 같다. 달라지는 것은 지붕이 땅·위험물에 닿는지와 차대가 위험물·블록에 닿는지뿐). 클라이언트가 가격을 정하는 것.

## 3. 사용자가 정한 것

- 판정은 모양을 따른다(산 차가 점수에 유리할 수 있음을 받아들임).
- 다른 것은 차체 모양만.
- 플랫폼 공용 "보유 품목" 구조로 만든다(나중에 다른 게임·밸리 품목도 같은 구조).
- 차 목록·가격(아래 표, 내 제안을 사용자가 "ㄱㄱ").

## 4. 접근

| | 방법 | 판단 |
|---|---|---|
| **A** | **플랫폼 공용 품목: manifest `shop` 선언 + DB `shop_items`·`user_items` + RPC `buy_item`/`equip_item`. 차 선택은 manifest 옵션으로 퍼즐에 들어간다** | **선택.** 게임별 분기 없이 다른 게임도 쓴다. 가격은 서버 표가 정한다 |
| B | 네온 라이더 전용 열·함수 | 빠르지만 품목이 생길 때마다 복제 |

## 5. 차 목록

지붕 높이 = 축선(두 바퀴 중심을 잇는 선) 위 `headOffset + headR`. 차대 캡슐은 축 선분을 차의 윗방향으로 `bodyDY` 올린 선분, 반지름 `bodyR`(지금의 `BODY_DY`·`BODY_R`을 차별 값으로). 아래 수치는 구현된 값(`cars.ts`)이다. 처음 제안에서 버기·스포츠카·F1·스케이트보드의 지붕 원만 고쳤다(아래 설명). 지붕 높이 순서와 가격은 그대로.

| id | 이름 | 지붕 높이 | headOffset / headR | bodyDY / bodyR | 가격 |
|---|---|---|---|---|---|
| `coupe` | 쿠페 (노란 차) | 580 mm | 300 / 280 | 170 / 190 | 0 (기본) |
| `pickup` | 픽업 | 700 mm | 360 / 340 | 210 / 190 | 5,000 JWD |
| `buggy` | 버기 | 520 mm | 270 / 250 | 130 / 170 | 15,000 JWD |
| `sports` | 스포츠카 | 480 mm | 250 / 230 | 150 / 150 | 30,000 JWD |
| `f1` | F1 | 340 mm | 180 / 160 | 60 / 130 | 60,000 JWD |
| `skate` | 스케이트보드 | 200 mm | 110 / 90 | 40 / 120 | 100,000 JWD |

**v7 (2026-11-28) 실제 차 비율:** 사용자 결정으로 차를 실제 차 비율(땅에서 지붕까지 ≈ 바퀴 지름의 배수)로 높이고 판정도 함께 키웠다(스케이트보드 제외). 지붕 원 아래 끝은 모두 축선 위 20 mm(지형 긁힘 검사). 쿠페가 커져 이전 버전과 같은 결과가 아니므로 `logic.version` 7, 시뮬 고정값 시험은 v7 결과로 다시 고정했다. 그림은 차마다 네온 단색 + 같은 색 빛 번짐(반투명 테두리 두 겹) + 흰 데칼 + 검은 타이어·흰 휠·차 색 허브(`render.ts` `CAR_COLOR`·`CAR_DECAL`). 같은 때 `blocks` 템플릿은 막대 간격 3.5 m·높이 1.6~2.0 m로 바꾸고 끝 구덩이를 없앴다(커진 차가 쌓인 막대에 올라타 멈춤).

- 지붕 원 조정(구현 중 발견): 처음 값은 지붕 바닥(`headOffset − headR`)이 쿠페(20 mm)보다 낮아(버기 −10, 스포츠카 −20, F1 −30, 스케이트보드 −40) 쿠페가 지나는 마루에 걸렸다. 그래서 지붕 높이(`headOffset + headR`)는 그대로 두고 중심을 올려 반지름을 줄여, 쿠페·버기·스포츠카·F1·스케이트보드의 지붕 바닥을 모두 20 mm로 맞췄다(픽업은 90 mm). 차대 값(`bodyDY`/`bodyR`)은 제안 그대로다.
- 전부 사면 210,000 JWD ≈ `REF` × 10(약 10시간), 낚시 장비 전체(약 136,000 JWD)의 1.5배. 지갑 설계 §15의 "되팔기 없음"을 따른다.
- 쿠페의 값은 지금 상수와 같다(`HEAD_OFFSET` 200·`HEAD_R` 180·`BODY_DY` 150·`BODY_R` 190) → 쿠페로 달리면 v5와 같은 결과.
- 모든 차: 차대 캡슐 아래 끝(`bodyDY − bodyR`)이 바퀴 바닥(−180 mm)보다 위, 캡슐 위 끝(`bodyDY + bodyR`)이 지붕 높이 이하.
- 그림: 차마다 `render.ts`의 차 다각형(지금 `BODY`)을 따로 둔다. 노란 차 계열 색(캔버스 내부 색 예외 범위). 지금 쿠페 그림 검사(`render.test.ts`: 그림 가장자리 표본이 판정 합집합 40 mm 안)를 모든 차에 돌린다. 원작 차의 모양을 베끼지 않고 이름처럼 일반적인 실루엣으로 그린다.

## 6. 시뮬레이션

- `src/games/neon-rider/cars.ts`(순수, Deno 호환): `CARS: readonly CarDef[]`(`id`, `label`, `price`, `headOffset`, `headR`, `bodyDY`, `bodyR`), `DEFAULT_CAR = 'coupe'`, `carById(id): CarDef`(모르는 id는 기본 차).
- `SimState`에 `car: string`을 끝 필드로 더한다. `initSim(course, car?)`/`initSimAt(course, x, vx, car?)`는 생략하면 `DEFAULT_CAR`. 지붕 판정(지형·위험물), 차대 캡슐(`chassisOf`, 위험물·블록 밀기), 보석 줍기의 차체 판정원이 모두 `carById(s.car)` 값을 쓴다. 상수 `HEAD_OFFSET`·`HEAD_R`·`BODY_DY`·`BODY_R`은 쿠페 값의 출처로만 남긴다.
- `logic.version` 5 → 6. 퍼즐 `{ seed, car? }`. `pickPuzzle(rng, options)`는 `options.car`를 `carById`로 거른 id를 넣는다. 옛 퍼즐 `{ seed }`는 쿠페로 읽는다(로직 버전 규칙: 새 버전은 옛 퍼즐을 읽는다).
- 검사(봇 아님, 기하): 모든 템플릿의 지형 위에 두 바퀴를 길에 붙여 차를 놓아 가며(템플릿 x를 100 mm 간격으로 훑어 두 바퀴가 다 길 위에 놓이는 자리마다) 차마다 지붕 원이 길에 닿지 않는다 — 낮은 차가 봉우리에서 바닥을 긁어 죽는 일이 없게. 닿는 템플릿이 있으면 그 차의 값을 고친다. 구현은 쿠페 기준 비교다(`cars.test.ts`): 지붕 바닥이 쿠페 이상이면 쿠페가 지나는 자리를 모두 지나므로, 쿠페가 닿지 않는 자리에서 다른 차의 지붕이 닿지 않는다는 것을 지붕 바닥 비교로 확인하고, 훑기는 쿠페 기준(지붕 바닥 20 mm)으로 한다. 이 때문에 위 '지붕 원 조정'이 필요했다.
- 기존 골든 테스트(이 기능 전과 같은 결과)는 상태 끝에 `"car":"coupe"`만 늘어난다.

## 7. 플랫폼: 상점과 보유 품목

### 7.1 manifest

- `ManifestOption`에 `shop?: true`. 이 옵션의 `choices`는 상점 품목이고 `value`가 품목 id다.
- `Manifest.shop?: { option: string; items: { id: string; price: number }[] }` — `option`은 `shop: true`인 옵션 key, `items`는 그 옵션의 choices와 같은 id 집합. 가격 0인 품목은 모두가 가진 것으로 친다. 이름은 옵션 choices의 `label`.
- 네온 라이더: `options: [{ key: 'car', label: '차', shop: true, choices: CARS의 id·이름, default: 'coupe' }]`, `shop: { option: 'car', items: CARS의 id·price }`. manifest는 `cars.ts`에서 만든다.

### 7.2 DB (새 마이그레이션 하나)

- `shop_items(game_id text references game_modes, item_id text, price bigint check (price >= 0), primary key (game_id, item_id))`. 클라이언트 읽기 허용(가격 표시). 마이그레이션의 행은 고정 형식 `insert into public.shop_items (game_id, item_id, price) values ('neon-rider', 'pickup', 5000), …;` 한 문장으로 쓰고 `registry.test.ts`가 manifest `shop.items`와 비교한다(지금 gold 줄 비교와 같은 방식).
- `user_items(user_id uuid references auth.users, game_id text, item_id text, equipped boolean not null default false, bought_at timestamptz default now(), primary key (user_id, game_id, item_id), foreign key (game_id, item_id) references shop_items)`. 부분 유일 색인 `(user_id, game_id) where equipped`. RLS: 본인 행 select만, 쓰기는 RPC만.
- `gold_ledger.reason` 검사에 `'shop'`을 더한다. `shop`은 지출이라 사이트 하루 상한과 무관(상한은 수입만 셈).
- RPC `buy_item(p_game text, p_item text, p_price bigint) returns jsonb` (security definer): 승인 사용자, 숨김 게임 거절, 품목 없음 → `unknown_item`, 이미 가짐 → `already_owned`, `p_price`가 표 가격과 다르면 `price_mismatch`(화면이 본 가격 확인, 대회 참가비 `fee_mismatch`와 같은 방식), 가격 0 → `free_item`, 잔액 부족 → `not_enough_gold`. 통과하면 `_gold_move(uid, -price, 'shop', ref = game || ':' || item, game)` 후 `user_items` insert. 돌려주는 값: `{ balance }`. 같은 품목을 두 번 동시에 사도 `unique (user_id, reason, ref)`와 기본 키가 한 번만 받는다.
- RPC `equip_item(p_game text, p_item text)`: 가진 품목(또는 가격 0)만. 그 게임의 다른 행 `equipped = false`, 이 행 true(가격 0 품목이면 행이 없으므로 모두 false로만 만든다 = 기본).
- RPC `my_items(p_game text) returns table (item_id text, equipped boolean)`: 본인 보유 목록(가격 0 품목은 포함하지 않는다. 화면이 manifest로 채운다).
- `_wallet_enabled()`가 false면 `buy_item`은 `wallet_off`.

### 7.3 화면

- 자유 플레이 화면(`FreePage`)의 옵션 줄: `shop` 옵션의 선택 상자에는 가진 품목(가격 0 포함)만 나온다. 처음 값은 `equipped` 품목(없으면 manifest `default`). 바꾸면 `equip_item`을 부른다(실패해도 이번 판 선택은 그대로).
- 그 옆에 "상점" 버튼 → 품목 목록(이름·가격·보유/선택 표시, 산 품목은 "고르기", 안 산 품목은 "사기 (N JWD)"). 사기 전에 "N JWD로 살까요?" 확인. 결과는 지갑 저장소(`walletStore`)의 잔액을 바꾼다. 오류 코드는 한국어 문구로.
- 품목 미리보기: 게임이 `src/games/ui.ts`에 `getShopPreview(gameId)`(품목 id → 작은 그림 컴포넌트)를 등록하면 목록에 그린다. 네온 라이더는 차 그림을 캔버스로 그린다. 등록이 없으면 이름만.
- 금액은 `formatGold`(JWD 표기)로 쓴다. 표의 "JWD"는 코드·DB의 골드와 같은 단위다.
- 모든 문구 한국어, 모바일 우선, 색은 토큰(미리보기 캔버스 내부는 네온 라이더 예외).

### 7.4 기록

- 자유 플레이의 옵션은 이미 `free_plays.options`(jsonb)에 저장되고, `free_play_logs`는 같은 `client_id`로 이어진다. 그래서 어느 차로 달렸는지는 새 열 없이 재현된다: `free_plays.options` + `free_play_logs.seed`로 `pickPuzzle(rngFromSeed(seed), options)`. 옵션이 비어 있는 옛 기록은 기본값(쿠페). (설계 처음에는 `free_play_logs.options` 열을 더하려 했으나, 계획을 쓰며 이미 있는 열을 찾아 뺐다.)

## 8. 신뢰 모델

자유 플레이 점수는 브라우저가 계산한다(볼 런·네온 라이더 설계와 같음). 사지 않은 차를 옵션으로 넣어 달리는 조작은 점수 조작과 같은 수준으로 막지 못한다(받아들임). 골드 쪽은 서버가 지킨다: 가격은 `shop_items`, 차감은 `_gold_move`.

## 9. 테스트

- `cars.test.ts`: 표의 값, 지붕 높이 순서, 캡슐 아래·위 끝 조건, 쿠페 = 지금 상수.
- `sim.test.ts`: 차별 지붕 높이로 같은 높이의 위험물 막대가 낮은 차는 지나가고 높은 차는 죽는다. 골든 테스트에 `"car":"coupe"`. 지형 훑기 지붕 검사(§6).
- `render.test.ts`: 모든 차 그림 ↔ 판정.
- `logic.test.ts`: 버전 6, `options.car` 반영, 모르는 차 → 쿠페, 옛 퍼즐 `{ seed }`.
- `registry.test.ts`: manifest `shop` ↔ 마이그레이션 `shop_items` 행, `shop.option`이 `shop: true` 옵션이고 id 집합이 같다.
- DB 테스트(`supabase/tests/`): `buy_item` 성공·각 오류·동시 두 번·잔액 차감과 장부 행, `equip_item` 소유 검사·하나만 equipped, RLS(남의 `user_items` 안 보임, 직접 insert 불가).
- 화면 테스트: FreePage 선택 상자가 가진 품목만, 상점에서 사기 → 잔액 갱신·선택 상자에 추가.

## 10. 정해 둔 세부 (설계 검토 질문에 대한 답, 표시 없는 것은 내 판단)

- **통과 게이트·봇**: 봇 검증은 사용자 결정으로 꺼져 있다(`describe.skip`). 켜게 되면 쿠페 기준으로 둔다. 위험물·블록 결과가 차마다 다른 것은 의도다(사용자 결정 "판정은 모양을 따른다"). 픽업이 더 어려운 것도 받아들인다(원작도 높은 차가 불리).
- **골드**: 자유 플레이 골드는 점수 비례이므로 낮은 차가 조금 더 벌 수 있다. `gold.test.ts` 기준은 쿠페로 둔다. 판당 상한 140·게임별 하루 상한 2,050이 그대로 묶으므로 수치는 바꾸지 않는다.
- **데일리·대회·대전**: 네온 라이더는 자유 플레이 전용이다. 플랫폼은 자유 플레이가 아닌 모드에서 `shop` 옵션을 manifest `default`로 고정해 `pickPuzzle`에 넘긴다(산 품목이 경쟁 모드에 들어가지 않게).
- **첫 판과 로그인 상태**: `FreePage`는 `shop` 옵션이 있는 게임이면 `my_items`를 받은 뒤 첫 판을 시작한다(받는 동안 "불러오는 중"). 실패하면 기본값으로 시작한다. 비로그인·미승인 사용자와 `_wallet_enabled()`가 false일 때는 가격 0 품목만 고를 수 있고 "상점" 버튼을 숨긴다.
- **선택의 저장**: 선택 상자에서 바꾸면 매번 `equip_item`을 부른다. "장착" = 마지막으로 고른 것. 기기가 여럿이면 마지막에 저장한 것이 이긴다.
- **가격·품목 변경**: 가격을 바꾸려면 새 마이그레이션에서 `update public.shop_items set price = …`로 바꾸고 manifest도 함께 바꾼다(`registry.test.ts`는 마이그레이션의 최종 상태와 비교한다: 처음 insert 문장 뒤의 update 문장도 고정 형식 `update public.shop_items set price = N where game_id = '…' and item_id = '…';`로 읽는다). 이미 산 사람은 그대로 가진다. 품목 삭제는 다루지 않는다(비목표). 가격이 0이 된 품목의 기존 `user_items` 행은 그대로 두고, 화면은 가격 0이거나 행이 있으면 가진 것으로 본다.
- **기록의 옵션**: §7.4대로 `free_plays.options`를 쓴다. 옛 기록(빈 옵션)은 기본값(쿠페).
- **장부 표시**: 지갑·관리자 장부의 reason 목록·한국어 표기에 `shop`("상점")을 더한다. 지출이므로 "오늘 들어온 골드" 합계에는 들어가지 않는다(지금 `earned_today`가 수입 reason만 세는 것과 같다).
- **차를 쓰는 모든 곳**: 지붕·차대·보석 판정과 렌더러는 `carById(s.car)`를 쓴다. 넓은 범위 상수(`REACH` 등 판정 후보를 거르는 여유값)는 `CARS` 전체의 최댓값으로 잡는다. 시험: 쿠페가 아닌 차 하나(픽업)로 위험물·블록·보석이 있는 짧은 코스를 끝까지 달려 차의 값이 쓰였는지(같은 입력에서 쿠페와 다른 판정이 나는 막대 하나) 확인한다.
- **숨김 게임**: 네온 라이더는 공개(`hidden: false`)라 바로 살 수 있다. 숨김 게임의 품목은 사지 못한다.

## 11. 빌더에게 남긴 것

차 그림의 세부 모양, 상점 목록의 배치, 오류 문구의 표현, 미리보기 크기, 마이그레이션 이름.
