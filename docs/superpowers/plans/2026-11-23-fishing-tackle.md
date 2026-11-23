# 펨타듀 낚시 — 찌 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 찌 5종을 상점에서 사고, 카본 낚싯대 1칸·명장 낚싯대 2칸에 끼워 미니게임과 추첨을 바꾼다.

**Architecture:** 서버 상태에 산 찌(`tackles`)와 장착 찌(`equipped`)를 두고 `buyTackle`·`equip` 행동으로만 바꾼다. 회전 찌·호기심 찌는 서버 추첨(`rollCatch`)에서, 코르크·함정·가시 바늘은 화면 미니게임(`barParams`·`stepBar`)에서 적용한다. 화면은 view의 `equipped`로 미니게임 매개변수를 정한다. `logic.version` 5.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-world-design.md` §7 (설계 §10의 5단계를 사용자 요청으로 3단계보다 먼저 한다)

## Global Constraints

- `data.ts`·`logic.ts`·`minigame.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`.
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다.
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만. 그림은 새로 그린 픽셀 아트(`sprites.ts` 형식).
- 찌 5종과 값(설계 §7 그대로): `cork` 코르크 찌 1,000G 바 길이 ×1.2 / `trap` 함정 찌 1,500G 물고기가 바 밖일 때 진행도 감소 ×0.5 / `barbed` 가시 바늘 2,000G 바 안의 물고기 쪽으로 바가 끌림 / `spinner` 회전 찌 1,500G 입질 지연 ×0.7 / `curious` 호기심 찌 5,000G rare 가중치 ×1.5·전설 확률 ×1.5.
- 칸: 낚싯대 1·2단계 0칸, 3단계 1칸, 4단계 2칸. 같은 찌 중복 장착 불가. 한 번 사면 영구.
- `rollCatch`의 rng 호출 수(항상 5번)와 순서는 그대로. 찌가 없으면 추첨 결과는 지금과 같다.
- `logic.version` 5. 기존 33종·낚싯대·가방 값 불변.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## Review Focus

1. **칸보다 많이 끼우기·안 산 찌 끼우기·중복**: `equip`이 `too_many`/`not_owned`/`bad_tackle`로 거절하고 상태는 그대로. 화면은 그런 조합을 만들 수 없게 버튼을 막는다. → Task 1, Task 4
2. **낚시 중 장착 변경**: `pending`이 있으면 `equip`은 `busy`. 던진 뒤 바꾼 찌로 추첨이 달라지지 않는다(추첨은 던질 때 끝남). → Task 1
3. **찌 없는 사람의 결과 불변**: 장착 찌가 없으면 같은 rng 열에서 `rollCatch` 결과·입질 지연이 지금과 똑같다. → Task 1
4. **낚싯대 칸 0인데 찌를 산 경우**: 사도 되지만 끼울 수 없고, 상점·가방에서 "카본 낚싯대부터 낄 수 있어요"가 보인다. → Task 4
5. **기존 세이브**: v4 세이브는 `tackles: []`, `equipped: []`로 옮겨지고 나머지는 그대로. → Task 1

---

### Task 1: 찌 데이터·서버 행동·추첨 효과 (`logic.version` 5)

**Files:**
- Modify: `src/games/fishing/data.ts`, `src/games/fishing/logic.ts`
- Test: `src/games/fishing/data.test.ts`, `src/games/fishing/logic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // data.ts
  export type TackleId = 'cork' | 'trap' | 'barbed' | 'spinner' | 'curious'
  export type Tackle = { id: TackleId; name: string; price: number; desc: string }
  export const TACKLES: readonly Tackle[] // 위 표 순서. desc는 한 줄 효과 설명(한국어)
  export function tackleSlots(rodTier: number): number // 1·2 → 0, 3 → 1, 4 → 2
  export const TACKLE_FX = { corkBar: 1.2, trapDrain: 0.5, spinnerBite: 0.7, curiousRare: 1.5, curiousLegend: 1.5 } as const
  // logic.ts
  export type State = { …; tackles: TackleId[]; equipped: TackleId[] }
  export type Action = … | { type: 'buyTackle'; id: string } | { type: 'equip'; ids: string[] }
  //   buyTackle 오류: bad_tackle(모르는 id), already_owned, not_enough_gold. 성공: gold -= price, tackles에 추가
  //   equip 오류: busy(pending 있음), bad_tackle(모르는 id·중복), not_owned, too_many(> tackleSlots(rodTier)). 성공: equipped = ids
  export type CastCtx = { …기존; equipped: readonly TackleId[] }
  ```
- `rollCatch`: `spinner` 장착이면 입질 지연 ×0.7(반올림은 지금 식 뒤에), `curious` 장착이면 rare 가중치 ×1.5와 `LEGEND_CHANCE` ×1.5. rng 호출 순서·수 불변.
- `migrate`: v4 이하 → `tackles: []`, `equipped: []` 추가(나머지 지금 규칙). v5 세이브의 `tackles`·`equipped`는 알려진 id만 남기고 중복 제거, `equipped`는 `tackles`에 있는 것만, 칸 수 초과분은 앞에서부터 자른다.
- `view`에 `tackles`·`equipped` 포함(지금 `View = Omit<State,'pending'> & …`이라 자동).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `data: TACKLES 5종 id·가격(1000/1500/2000/1500/5000), tackleSlots(1..4) = 0,0,1,2`
  - `buyTackle cork: 골드 1200 → 200, tackles [cork]; 다시 → already_owned; 골드 부족 → not_enough_gold(불변); 'zzz' → bad_tackle`
  - `equip: rod 3에 [cork] 성공; rod 3에 [cork, trap] → too_many; 안 산 찌 → not_owned; [cork, cork] → bad_tackle; pending 있으면 busy; rod 4에 2개 성공; [] 성공(전부 해제)` (Review Focus 1, 2)
  - `rollCatch: equipped []이면 기존 테스트 결과 그대로(고정 rng 열의 결과를 스냅숏처럼 비교)` (Review Focus 3)
  - `spinner: 같은 rng에서 biteDelayMs가 ×0.7(±1)`
  - `curious: rod 3에서 r1이 rare 경계 바로 위(장착 없으면 uncommon)일 때 장착하면 rare; 전설 조건에서 r0 = LEGEND_CHANCE×1.2이면 장착 없으면 전설 아님, 장착하면 전설`
  - `rng 호출 수: 찌 조합 4가지에서 항상 5번`
  - `cast는 state.equipped를 CastCtx로 넘긴다(spinner 장착 세이브의 pending.biteDelayMs가 짧음)`
  - `version 5; v4 세이브 → tackles [], equipped [], 나머지 그대로; v5 세이브의 모르는 id·중복·미보유 장착·칸 초과 정리` (Review Focus 5)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/logic.test.ts src/games/fishing/data.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck && npm run fn:test` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/data.ts src/games/fishing/logic.ts` + 테스트 `&& git commit -m "feat: 낚시 찌 구매·장착과 서버 추첨 효과(로직 버전 5)"`

---

### Task 2: 미니게임 찌 효과

**Files:**
- Modify: `src/games/fishing/minigame.ts`
- Test: `src/games/fishing/minigame.test.ts`

**Interfaces:**
- Consumes: Task 1 `TackleId`, `TACKLE_FX`
- Produces:
  ```ts
  export type BarParams = { barSize: number; difficulty: number; behavior: Behavior; drain: number; pull: number }
  //   drain: 물고기가 바 밖일 때 진행도 감소 배율(기본 1, trap 0.5)
  //   pull: 물고기가 바 안에 있을 때 바 중심을 물고기 쪽으로 끄는 세기(1/s, 기본 0, barbed는 상수 BARBED_PULL)
  export function barParams(speciesId: string, rodTier: 1 | 2 | 3 | 4, equipped?: readonly TackleId[]): BarParams
  //   cork: barSize ×1.2(낚싯대 보너스와 곱). equipped 생략 = []
  ```
- `stepBar`: 진행도 감소에 `drain`을 곱한다. `pull > 0`이고 물고기가 바 안이면, 바 속도에 `(fishPos - barCenter) * pull` 방향의 가속을 더한다(누르기 가속과 별개로 더해짐, 바가 트랙 밖으로 나가지 않음은 지금 규칙).
- 찌가 없으면(`drain` 1, `pull` 0) 지금 동작과 같다 — 1단계에서 만든 mixed 고정값 테스트(golden)가 그대로 통과해야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `barParams: equipped 없음 → drain 1·pull 0·barSize 지금 값; cork → barSize ×1.2; trap → drain 0.5; barbed → pull > 0; 세 개 조합은 각각 반영`
  - `trap: 물고기가 바 밖에 있는 같은 상황 1초에서 진행도 감소량이 절반`
  - `barbed: 물고기가 바 안 위쪽 끝 근처일 때, 버튼을 안 눌러도 바 중심이 물고기 쪽으로 움직인다(같은 상황 pull 0 대비 더 위); 물고기가 바 밖이면 효과 없음`
  - `기존 mixed golden 테스트 통과(찌 없음)`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/minigame.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `BARBED_PULL`은 구현 재량(바가 물고기에 "달라붙는" 느낌이 나되 혼자서 다 잡지는 않는 정도). 값과 이유를 주석으로.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/minigame.ts src/games/fishing/minigame.test.ts && git commit -m "feat: 낚시 미니게임 코르크·함정·가시 바늘 효과"`

---

### Task 3: 찌 그림 5종

**Files:**
- Modify: `src/games/fishing/sprites.ts`
- Test: `src/games/fishing/sprites.test.ts`

**Interfaces:**
- Produces: `tackle-cork`, `tackle-trap`, `tackle-barbed`, `tackle-spinner`, `tackle-curious` (16×16, 상점·가방 아이콘용)

- [ ] **Step 1: 실패하는 테스트 작성** — `5개 존재, 16×16, 서로 다름`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 코르크 찌(갈색 코르크 공 + 빨간 윗부분), 함정 찌(작은 그물망 바구니), 가시 바늘(미늘 달린 갈고리), 회전 찌(반짝이는 금속 날개 스피너), 호기심 찌(물음표가 비치는 보라 구슬). 원작 아이콘과 닮지 않게. PNG로 렌더해 확인, 보고서에 경로.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing/sprites.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/sprites.ts src/games/fishing/sprites.test.ts && git commit -m "feat: 낚시 찌 그림 5종"`

---

### Task 4: 상점·장비 화면, 미니게임 연결, 배포 안내

**Files:**
- Modify: `src/games/fishing/Menus.tsx`, `src/games/fishing/Game.tsx`, `src/games/fishing/fishing.css`, `docs/deploy-checklist.md`
- Test: `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Consumes: Task 1 `TACKLES`, `tackleSlots`, view `tackles`/`equipped`, 행동 `buyTackle`/`equip`; Task 2 `barParams(…, equipped)`; Task 3 아이콘
- 동작:
  - 상점 패널에 "찌" 구역: 찌마다 아이콘·이름·효과 한 줄·가격·"사기" 버튼(보유면 "보유 중", 골드 부족이면 비활성). 낚싯대 칸이 0이면 구역 위에 "카본 낚싯대부터 낄 수 있어요".
  - 가방 패널에 "장비" 구역: 칸 수만큼 칸(빈 칸/낀 찌 아이콘), 보유 찌 목록에서 눌러 끼우기/빼기. 칸이 다 차면 안 낀 찌는 비활성. 낚시 중(`view.pending` 있음)이면 구역 전체 비활성 + "낚시 중에는 바꿀 수 없어요". 변경은 `world({type:'equip', ids})`.
  - 미니게임: 걸린 물고기의 `barParams(species, rodTier, view.equipped)`.
  - 서버 오류는 지금 상점 오류 표시 방식으로.
- [ ] **Step 1: 실패하는 테스트 작성**
  - `상점: 찌 5종 표시, 사기 → world({type:'buyTackle', id:'cork'}); 보유 중 표시; 골드 부족 비활성; rod 2면 "카본 낚싯대부터 낄 수 있어요"` (Review Focus 4)
  - `가방 장비: rod 3·보유 [cork, trap]·장착 [] → 칸 1개, cork 누르면 world({type:'equip', ids:['cork']}); 응답 equipped [cork] 뒤 trap 버튼 비활성; cork 다시 누르면 ids []` (Review Focus 1)
  - `낚시 중이면 장비 구역 비활성·문구` (Review Focus 2)
  - `미니게임: 장착 [cork]일 때 그려지는 낚시 바 길이가 장착 없을 때의 1.2배`(drawWorld에 넘기는 bar 매개변수로 확인)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/Game.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — 색은 theme 토큰만. `docs/deploy-checklist.md` 낚시 절 2단계 항목 뒤에 "찌" 항목: `logic.version` 5, `world` 재배포 직후 머지·Vercel(main 기준 한 번 더), 새로고침 안내, v4로 되돌리지 않기(옛 migrate는 찌를 모름 — 산 찌가 사라짐). 수동 확인: 찌 구매, 카본에서 1칸·명장에서 2칸, 낚시 중 변경 불가, 코르크 바 길이, 함정 찌로 놓쳐도 덜 깎임, 가시 바늘 끌림, 회전 찌 입질이 빨라짐.
- [ ] **Step 4: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/Menus.tsx src/games/fishing/Game.tsx src/games/fishing/fishing.css src/games/fishing/Game.test.tsx docs/deploy-checklist.md && git commit -m "feat: 낚시 찌 상점·장비 화면과 배포 안내"`
