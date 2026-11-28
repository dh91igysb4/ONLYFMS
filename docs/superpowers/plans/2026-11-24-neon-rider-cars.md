# 네온 라이더 자동차 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 골드로 네온 라이더 차 6대를 사고 골라 타며, 고른 차의 차체 모양대로 그리고 판정한다.

**Architecture:** 차 정의(`cars.ts`)를 시뮬이 상태의 `car`로 읽어 지붕·차대·보석 판정에 쓴다. 플랫폼은 manifest `shop` 선언 + DB `shop_items`·`user_items` + RPC `buy_item`/`equip_item`/`my_items`로 게임 구분 없이 품목을 팔고, 고른 품목은 manifest 옵션으로 퍼즐에 들어간다.

**Tech Stack:** TypeScript, React, Vitest, Supabase(Postgres, plpgsql), Deno Edge Functions.

**Spec:** `docs/superpowers/specs/2026-11-24-neon-rider-cars-design.md`

## Global Constraints

- 시뮬 코드는 정수만 쓴다. 허용: `+ - *`, `Math.floor(a / b)`, 비교, `Math.abs/min/max`, `trig.ts` 함수. 부동소수 리터럴·`Math.sqrt` 등 금지. 단위 u(1 mm = 16 u, `MM`).
- 차는 차체 모양만 다르다: 바퀴 반지름 180 mm·축거·질량·가속·회전은 모든 차가 같다.
- 차 표(설계 §5): `coupe` 쿠페 0 G (200/180, 150/190) · `pickup` 픽업 5,000 G (270/180, 150/190) · `buggy` 버기 15,000 G (160/170, 120/170) · `sports` 스포츠카 30,000 G (130/150, 90/150) · `f1` F1 60,000 G (100/130, 60/130) · `skate` 스케이트보드 100,000 G (80/120, 40/120). 괄호는 headOffset/headR, bodyDY/bodyR(mm). 값은 그림에 맞춰 ±30 mm 안에서만 고치고 지붕 높이 순서(pickup > coupe > buggy > sports > f1 > skate)와 가격은 그대로.
- 쿠페로 달리면 v5와 같은 결과(상태 끝에 `car` 필드만 늘어난다).
- `logic.ts`는 순수 함수, 외부 의존 없음, 상대 import에 `.ts`. `src/games/index.ts`·`cars.ts`는 React를 import하지 않는다.
- 플랫폼 코드에 게임별 분기 금지(manifest·등록부로 푼다). 골드는 `_gold_move`로만 바꾼다.
- 새 마이그레이션은 `npx supabase@2 migration new <이름>`으로 만든다. DB 변경은 마이그레이션으로만.
- 금액 표기는 `formatGold(n)`(`src/platform/wallet/format.ts`, "1,234 JWD")만 쓴다. 화면에 "G"를 쓰지 않는다.
- 화면 문구 한국어, 모바일 우선, 색은 `theme.css`·`palettes.ts` 토큰(네온 라이더 캔버스 내부 색 예외: 차 그림 노란 계열).
- 봇 기반 테스트(`balance.test.ts`, `gate/*.gate.test.ts`)는 `describe.skip` 그대로. 새 봇 테스트 금지.
- 커밋: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, 메시지 `type: 내용`, 끝에 두 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01T7oyVpUh2JAiP5VbZHGE6T`. `git add`는 경로로. 푸시하지 않는다. git stash는 건드리지 않는다.

## Review Focus

1. 사기 버튼을 두 번 누름(동시 요청 두 개) → 골드는 한 번만 빠지고 품목은 한 번만 생긴다 (Task 5 DB 테스트).
2. 비로그인·미승인 사용자가 자유 플레이를 연다 → `my_items`를 기다리다 멈추지 않고 쿠페로 바로 시작, 상점 버튼 없음 (Task 6 화면 테스트).
3. 화면이 본 가격과 서버 가격이 다르다(배포 사이 가격 변경) → `price_mismatch`, 골드 그대로 (Task 5 DB 테스트).
4. 옵션의 차 id가 없는 값이거나 옛 퍼즐 `{ seed }` → 쿠페로 달린다, 오류 없음 (Task 3 logic 테스트).
5. 낮은 차가 봉우리·급한 꺾임에서 지붕이 길을 긁어 그냥 죽는다 → 모든 템플릿 지형에서 두 바퀴를 붙인 자세로 지붕이 길에 닿지 않는다 (Task 2 기하 테스트).

---

### Task 1: 차 정의와 차별 판정

**Files:**
- Create: `src/games/neon-rider/cars.ts`, `src/games/neon-rider/cars.test.ts`
- Modify: `src/games/neon-rider/sim.ts`, `collide.ts`, `blocks.ts`, `hazards.ts`(주석), `constants.ts`(주석)
- Test: `src/games/neon-rider/sim.test.ts`, `blocks.test.ts`, `hazards.test.ts`

**Interfaces:**
- Produces:
  - `type CarDef = { id: string; label: string; price: number; headOffset: number; headR: number; bodyDY: number; bodyR: number }` (길이는 u)
  - `CARS: readonly CarDef[]`(위 표 순서: coupe, pickup, buggy, sports, f1, skate), `DEFAULT_CAR = 'coupe'`, `carById(id: string | undefined): CarDef`(모르는 id·undefined → 쿠페)
  - `CAR_REACH_MAX: number` = `CARS` 전체의 `max(headOffset + headR, bodyDY + bodyR)`
  - `SimState.car: string`(마지막 필드), `initSim(course: Course, car?: string)`, `initSimAt(course, x, vx, car?: string)` — 생략하면 `DEFAULT_CAR`, 모르는 id는 `carById(...).id`로 정규화
  - `chassisOf(r, f, dy: number): Box`
  - `pushCar(r, f, headAt, bws, car: CarDef): void`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `cars.test.ts`: 표의 6대 값(`MM` 곱)과 순서; 지붕 높이 순서; 모든 차 `bodyDY − bodyR > −WHEEL_R` 이고 `bodyDY + bodyR ≤ headOffset + headR`; `carById('coupe')`의 값이 `HEAD_OFFSET/HEAD_R/BODY_DY/BODY_R`와 같다; `carById('zzz').id === 'coupe'`, `carById(undefined).id === 'coupe'`; `CAR_REACH_MAX === 450 * MM`(픽업 지붕).
  - `sim.test.ts` "차마다 지붕 높이대로 막대에 걸린다": 평지에 축선 위 300 mm 높이(차 진행 방향 수평, 정지 위험물 bar, 반지름 20 mm)의 막대를 둔 코스를 `V_MAX`로 계속 누르며 달린다 → `f1`·`skate`는 `dead === null`로 막대를 지나고, `coupe`·`pickup`은 `'crash'`. (높이는 차대 캡슐 위 끝과 지붕을 모두 고려해 `f1` 지붕 230 + 허용 45 mm 아래 쪽 여유가 생기는 값으로, 구현자가 300 mm에서 ±30 mm로 조정 가능. 쿠페는 캡슐 위 끝 340 mm라 걸린다.)
  - `sim.test.ts` "픽업으로 달린 상태의 car는 'pickup'이고 쿠페와 같은 입력에서 결과가 다르다": 위 코스에서 같은 입력으로 `pickup`과 `skate`의 최종 `dead`가 다르다.
  - 골든 테스트(이 기능 전과 같은 결과)의 꼬리 문자열을 `...,"gemFloor":-1,"car":"coupe"}`로 바꾼다(기대값 자체는 그대로).
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/games/neon-rider/cars.test.ts src/games/neon-rider/sim.test.ts` → `cars.ts` 없음 / `car` 필드 없음으로 실패.
- [ ] **Step 3: 구현**
  - `cars.ts`(순수). `sim.ts`의 `REACH`는 `V_TERMINAL + CAR_REACH_MAX + 2 * WHEEL_R`; 지붕 중심 계산(지금 `HEAD_OFFSET`), 지붕 지형 판정·위험물 probe의 지붕 원·차대 캡슐·보석 줍기의 지붕 원·`blocksNearCar` 여유값을 모두 `carById(s.car)` 값으로. `collide.ts` `chassisOf`에 `dy` 인자. `blocks.ts` `pushCar`가 `car.headR`·`car.bodyR`·`chassisOf(r, f, car.bodyDY)`를 쓴다. `constants.ts`의 네 상수는 "쿠페 값" 주석으로 남기고 `cars.ts`가 이를 써서 쿠페를 정의한다.
- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run src/games/neon-rider/` 전부 통과(골든 포함), `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat: 네온 라이더 차 정의와 차별 지붕·차대 판정`

### Task 2: 낮은 차가 지형에 긁히지 않는지 (기하 검사)

**Files:**
- Test: `src/games/neon-rider/cars.test.ts`
- Modify(필요할 때만): `src/games/neon-rider/cars.ts`(값)

**Interfaces:**
- Consumes: `CARS`, `carById` (Task 1), `TEMPLATES`(pieces.ts), `courseOf`(course.ts)

- [ ] **Step 1: 테스트 작성** — "모든 차·모든 템플릿: 두 바퀴를 길에 붙인 자세에서 지붕 원이 길에 닿지 않는다": 템플릿마다 `courseOf([id])`의 구간 0을 x 100 mm 간격으로 훑어, 뒷바퀴 접점 x에서 뒷바퀴 중심을 길 위 `WHEEL_R`에 두고 앞바퀴 중심을 축거 거리의 길 위 점(바퀴가 길에 닿는 자리)으로 찾을 수 있는 자리마다(찾지 못하면, 즉 틈·절벽이면 건너뜀) 차마다 지붕 원 중심(축 중점 + 윗방향 `headOffset`)과 길 선분의 최단 거리가 `headR`보다 크다. 위험물·움직이는 길·블록은 보지 않는다(지형 선분만). 실패하면 메시지에 차 id·템플릿 id·x를 넣는다.
- [ ] **Step 2: 실행** — `npx vitest run src/games/neon-rider/cars.test.ts`. 실패하면 그 차의 `headOffset`/`headR`를 ±30 mm 안에서 고쳐 통과시킨다(지붕 높이 순서·가격 유지). ±30 mm로 안 되면 멈추고 보고한다(어느 차·템플릿·x).
- [ ] **Step 3: 커밋** — `test: 네온 라이더 차마다 지붕이 지형에 닿지 않는지 검사`

### Task 3: 퍼즐·로직 v6과 manifest 상점 선언

**Files:**
- Modify: `src/games/types.ts`, `src/games/neon-rider/logic.ts`, `logic.test.ts`, `manifest.ts`, `src/games/registry.test.ts`(manifest 쪽 검사만)
- Create: `src/games/options.ts`, `src/games/options.test.ts`
- Modify: `supabase/functions/play/engine.ts`, 대전 함수의 `init(rng, options)` 호출부(`supabase/functions/duel/`)

**Interfaces:**
- Produces:
  - `ManifestOption.shop?: true`; `Manifest.shop?: { option: string; items: { id: string; price: number }[] }`
  - `Puzzle = { seed: string; car?: string }`; `logic.version === 6`
  - `pinShopOptions(manifest: Manifest, options: Record<string, string>): Record<string, string>` in `src/games/options.ts` — `shop: true` 옵션 값을 manifest `default`로 바꾼 사본
  - 네온 라이더 manifest: `options: [{ key: 'car', label: '차', shop: true, choices: CARS → { value: id, label }, default: 'coupe' }]`, `shop: { option: 'car', items: CARS → { id, price } }`

- [ ] **Step 1: 실패하는 테스트**
  - `logic.test.ts`: 버전 6; `pickPuzzle(rng, { car: 'f1' }).car === 'f1'`; `pickPuzzle(rng, { car: 'zzz' }).car === 'coupe'`; `pickPuzzle(rng, {}).car === 'coupe'`; 같은 rng면 `seed`는 car와 무관하게 같다; `initState({ seed })`(옛 형식)의 `sim.car === 'coupe'`; `initState({ seed, car: 'skate' })`의 `sim.car === 'skate'`.
  - `options.test.ts`: `pinShopOptions`가 `shop` 옵션만 기본값으로 바꾸고 다른 옵션은 그대로.
  - `registry.test.ts`(manifest 쪽): `shop`이 있으면 `shop.option`은 `shop: true` 옵션의 key이고 그 choices의 value 집합 = `shop.items`의 id 집합, 가격은 0 이상 정수, `default` 품목 가격은 0; `shop: true` 옵션이 있는데 `shop` 선언이 없으면 실패.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/games/neon-rider/logic.test.ts src/games/options.test.ts src/games/registry.test.ts`.
- [ ] **Step 3: 구현** — `logic.ts`가 `carById(options.car).id`를 퍼즐에, `initState`가 `initSim(course, puzzle.car)`. `engine.ts`(데일리·대회 출제)와 대전 함수의 옵션을 `pinShopOptions`로 거쳐 넘긴다.
- [ ] **Step 4: 실행해 통과 확인** — 위 명령 + `npm run typecheck` + `npm run fn:test`(play·duel 함수 테스트).
- [ ] **Step 5: 커밋** — `feat: 네온 라이더 퍼즐에 차, manifest 상점 선언, 경쟁 모드는 기본 품목`

### Task 4: 차 그림과 상점 미리보기

**Files:**
- Modify: `src/games/neon-rider/render.ts`, `render.test.ts`, `src/games/ui.ts`
- Create: `src/games/neon-rider/CarPreview.tsx`

**Interfaces:**
- Consumes: `CARS`, `carById`, `SimState.car` (Task 1)
- Produces: `CAR_ART: Record<string, readonly (readonly [number, number])[]>`(차 id → 다각형, 지금 `BODY`는 `CAR_ART.coupe`), `getShopPreview(gameId: string): ComponentType<{ itemId: string; size: number }> | undefined` in `src/games/ui.ts`, 네온 라이더 등록

- [ ] **Step 1: 실패하는 테스트** — `render.test.ts`: 차마다 그림 가장자리를 변마다 51점 표본으로 훑어 모든 점이 그 차의 판정 합집합(두 바퀴 + 지붕 원 + 차대 캡슐) 40 mm 안(지금 쿠페 검사를 `CARS` 전체로); 차대 캡슐 아래 끝 검사도 차마다; `CAR_ART`의 키 집합 = `CARS` id 집합.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/games/neon-rider/render.test.ts`.
- [ ] **Step 3: 구현** — 렌더러가 `s.car`의 그림으로 차를 그린다. 그림은 이름처럼 일반적인 실루엣(원작 차를 베끼지 않음), 노란 계열. `CarPreview`는 작은 캔버스에 바퀴 둘과 그 차 그림을 그린다(배경 투명).
- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run src/games/neon-rider/`, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat: 네온 라이더 차마다 그림과 상점 미리보기`

### Task 5: DB — 상점 품목·보유·구매

**Files:**
- Create: 마이그레이션 `npx supabase@2 migration new shop` → `supabase/migrations/<ts>_shop.sql`; `supabase/tests/22_shop.test.sql`
- Modify: `src/games/registry.test.ts`(마이그레이션 `shop_items` 행 ↔ manifest), `src/platform/wallet/api.ts`(`LedgerReason`에 `'shop'`), `src/platform/wallet/AdminGoldSection.tsx`(`REASON_LABEL.shop = '상점'`) 및 reason 목록을 가진 테스트

**Interfaces:**
- Produces (SQL, 설계 §7.2 그대로):
  - 테이블 `shop_items(game_id, item_id, price)`, `user_items(user_id, game_id, item_id, equipped, bought_at)`, 부분 유일 색인 `(user_id, game_id) where equipped`
  - `gold_ledger.reason` 검사에 `'shop'`
  - `buy_item(p_game text, p_item text, p_price bigint) returns jsonb` → `{ "balance": n }`; 오류는 `raise exception` 메시지 `unknown_item | already_owned | price_mismatch | free_item | not_enough_gold | wallet_off | hidden_game | not_approved`(기존 RPC의 오류 전달 방식을 따른다)
  - `equip_item(p_game text, p_item text) returns void`(오류 `not_owned`)
  - `my_items(p_game text) returns table (item_id text, equipped boolean)`
  - 품목 행은 고정 형식 한 문장: `insert into public.shop_items (game_id, item_id, price) values ('neon-rider', 'coupe', 0), ('neon-rider', 'pickup', 5000), ('neon-rider', 'buggy', 15000), ('neon-rider', 'sports', 30000), ('neon-rider', 'f1', 60000), ('neon-rider', 'skate', 100000);` 가격 변경은 `update public.shop_items set price = N where game_id = '…' and item_id = '…';`

- [ ] **Step 1: 실패하는 테스트**
  - `22_shop.test.sql`: 잔액 충분한 승인 사용자 `buy_item('neon-rider','f1',60000)` → 잔액 −60000, 장부 행 1개(reason `shop`, ref `neon-rider:f1`, delta −60000), `user_items` 행; 두 번째 같은 구매 → `already_owned`, 잔액 그대로; `p_price` 50000 → `price_mismatch`, 잔액·장부 그대로 (Review Focus 3); `coupe` → `free_item`; 잔액 부족 → `not_enough_gold`; 없는 품목 → `unknown_item`; 같은 사용자 같은 품목을 두 세션에서 동시에 사도 장부 1행·보유 1행(Review Focus 1, 다른 지갑 테스트의 동시성 검사 방식을 따른다); `equip_item` 안 가진 품목 → `not_owned`, 두 품목을 차례로 equip하면 equipped는 하나, `equip_item(…,'coupe')` → 모두 false; RLS: 다른 사용자의 `user_items`가 select로 안 보이고 직접 insert는 권한 오류; `my_items`는 본인 것만.
  - `registry.test.ts`: 마이그레이션을 이름순으로 읽어 `shop_items` insert·update의 최종 상태가 각 게임 manifest `shop.items`와 같다(지금 `gold_per_point` 줄 비교와 같은 정규식 방식, 형식이 다른 문장은 실패).
- [ ] **Step 2: 실행해 실패 확인** — `npm run db:test`, `npx vitest run src/games/registry.test.ts`.
- [ ] **Step 3: 구현** — 마이그레이션. 승인 검사·숨김 게임 검사·`_wallet_enabled()`는 기존 RPC(`_contest_enter` 등)의 방식을 따른다. 차감은 `_gold_move(uid, -price, 'shop', p_game || ':' || p_item, p_game, null)`(시그니처는 마지막 정의를 따른다). 지갑 행 잠금 순서 규칙(CLAUDE.md "잠금 순서")을 지킨다.
- [ ] **Step 4: 실행해 통과 확인** — `npm run db:test`, `npx vitest run src/games/registry.test.ts src/platform/wallet/`.
- [ ] **Step 5: 커밋** — `feat: 상점 품목·보유 테이블과 buy_item·equip_item·my_items`

### Task 6: 자유 플레이 화면 — 가진 품목 고르기와 상점

**Files:**
- Create: `src/platform/shop/api.ts`, `src/platform/shop/api.test.ts`, `src/platform/shop/ShopPanel.tsx`, `src/platform/shop/ShopPanel.test.tsx`, `src/platform/shop/useOwnedItems.ts`
- Modify: `src/platform/games/FreePage.tsx`, `src/platform/games/pages.test.tsx`(또는 FreePage 테스트가 있는 곳), `src/app/theme.css`(필요한 클래스만)

**Interfaces:**
- Consumes: `Manifest.shop`, `ManifestOption.shop` (Task 3), `getShopPreview` (Task 4), RPC들 (Task 5), `walletStore.setBalance`, `walletEnabled()`(`src/platform/wallet/enabled.ts`)
- Produces:
  - `fetchMyItems(gameId: string): Promise<{ owned: string[]; equipped: string | null }>`
  - `buyItem(gameId: string, itemId: string, price: number): Promise<{ balance: number }>` — 실패하면 `Error`의 `message`가 오류 코드
  - `equipItem(gameId: string, itemId: string): Promise<void>`
  - `useOwnedItems(gameId: string, manifest: Manifest): { ready: boolean; owned: Set<string>; equipped: string | null; refresh(): void; canShop: boolean }` — `manifest.shop`이 없으면 바로 `ready`; 비로그인·미승인·`walletEnabled()` false면 `owned` = 가격 0 품목, `canShop` false, 바로 `ready`
  - `ShopPanel` props: `{ gameId: string; manifest: Manifest; owned: Set<string>; selected: string; onBought(itemId: string): void; onSelect(itemId: string): void; onClose(): void }`

- [ ] **Step 1: 실패하는 테스트**
  - `api.test.ts`: 각 함수가 맞는 RPC 이름·인자를 부르고 결과를 바꾼다, 오류 코드를 `message`로 던진다.
  - FreePage 테스트(테스트 게임에 `shop` 옵션을 단 픽스처로, `withTestGame` 방식): 승인 사용자 → `my_items` 응답 전에는 판이 시작되지 않고 "불러오는 중", 응답 뒤 선택 상자에 가진 품목 + 가격 0 품목만, 처음 값 = equipped; 선택을 바꾸면 `equip_item` 호출 + 새 판; `my_items` 실패 → 기본값으로 시작. 비로그인·미승인 → 바로 시작, 가격 0 품목만, "상점" 버튼 없음 (Review Focus 2).
  - `ShopPanel.test.tsx`: 안 산 품목 "사기 (`formatGold(N)`)" → 확인("`formatGold(N)`로 살까요?") → `buyItem` → `setBalance(balance)`·`onBought`; 산 품목 "고르기"; 오류 코드별 한국어 문구(`not_enough_gold` → "JWD가 부족해요", `price_mismatch` → "가격이 바뀌었어요. 다시 열어 주세요", `already_owned` → "이미 가진 품목이에요", 그 밖 → "사지 못했어요"); 미리보기 컴포넌트가 등록돼 있으면 그린다.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/platform/shop src/platform/games`.
- [ ] **Step 3: 구현** — FreePage가 `shop` 옵션을 위해 `useOwnedItems`를 쓰고, 그 옵션의 선택 상자에는 가진 것만, 옆에 "상점" 버튼(`canShop`일 때)으로 `ShopPanel`을 연다. 구매 성공 → `refresh()`, 산 품목을 고르면 `onSelect`와 같은 경로(선택 + `equip_item` + 새 판). 게임 id·옵션 key로만 동작하고 게임별 분기 없음.
- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run src/platform`, `npm run typecheck`, `npm run build`.
- [ ] **Step 5: 커밋** — `feat: 자유 플레이에서 가진 품목 고르기와 상점`

### Task 7: 문서와 전체 확인

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-neon-rider-design.md`(차·상점 반영, 현재 상태로), `CLAUDE.md`(폴더 규칙에 `src/platform/shop/`·상점 품목 추가 절차 한 단락: manifest `shop` + 마이그레이션 고정 형식 + `registry.test.ts`), `docs/deploy-checklist.md`(이번 배포: DB push → `play`·`duel` 함수 재배포 → Vercel)

- [ ] **Step 1: 문서 갱신** — 위 세 곳. 상점 품목 추가 절차는 설계 §7.1·§7.2·§10 "가격·품목 변경"을 요약.
- [ ] **Step 2: 전체 확인** — `npm test && npm run test:gate && npm run typecheck && npm run build && npm run db:test && npm run fn:test`. 모두 통과(게이트는 전부 건너뜀, 종료 0).
- [ ] **Step 3: 커밋** — `docs: 네온 라이더 자동차·상점 반영`
