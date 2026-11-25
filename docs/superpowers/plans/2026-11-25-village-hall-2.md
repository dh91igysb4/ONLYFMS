# 마을회관 2차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회관 1번 방 냉장고(개인 보관함 15칸)와 쓰레기통(버리기 부담금 5%), 가방 버리기 부담금 50%, 회관 텔레포터를 넣는다.

**Architecture:** 낚시 서버 로직(`logic.ts`)에 `fridge` 상태와 `store`·`takeOut` 행동, 버리는 곳(`at`)에 따른 부담금, 과제 없는 지역의 이동기 켜짐 규칙을 더한다(`logic.version` 18). 회관 맵에 이동기·고정물 두 개를 더하고, 화면은 냉장고 창과 쓰레기통 버리기 모드를 단다.

**Tech Stack:** TypeScript/React, vitest, Deno(world 함수 테스트).

**Spec:** `docs/superpowers/specs/2026-11-25-village-hall-design.md` §5·§6·§10(2차)

## Global Constraints

- 문구 한국어, 모바일 우선. 색은 theme 토큰(캔버스 내부 예외).
- `logic.ts` 순수, 상대 import `.ts`. 결과가 바뀌므로 `logic.version` 17 → 18, migrate 테스트, `world` 재배포.
- 부담금: 가방 `max(1, ceil(sellPrice/2))`, 쓰레기통 `max(1, ceil(sellPrice/20))`. `sellPrice`는 지금처럼 감쇠 전·버프 포함.
- 냉장고 1인당 15칸 고정, 보관만(냉장고에서 팔기·버리기 없음). 위치는 서버가 확인하지 않는다(화면이 고정물 앞에서만 창을 연다).
- 회관 이동기: 과제 없이 켜짐(지역이 열려 있으면). 순간이동은 출발·도착 둘 다 켜져야 한다(기존).
- 커밋 `type: 내용` + 세션 attribution 두 줄.

## Review Focus

1. 옛 화면(v17 번들)이 `discard`를 `at` 없이 보내면 가방(50%) 요금으로 판정되어, 옛 10% 요금을 보낸 요청은 `price_changed`로 거절된다(돈을 잘못 받지 않는다) → Task 1 테스트.
2. 가방·냉장고가 가득 찼을 때 넣기·꺼내기가 상태를 바꾸지 않고 오류만 낸다 → Task 1.
3. 다른 탭에서 칸이 밀린 뒤 넣기·꺼내기(오래된 index)는 `bag_changed`/`fridge_changed`로 거절 → Task 1.
4. 낚는 중(pending)에는 넣기·꺼내기·버리기가 상태를 꼬지 않는다(가방 index 기준이 바뀌지 않는다) → Task 1에서 pending 중 `busy`.
5. 옛 서버 응답(fridge 없음)에도 냉장고 창이 빈 냉장고로 그려진다 → Task 3.

---

### Task 1: 서버 로직 — 부담금, 냉장고, 이동기 규칙

**Files:** Modify `src/games/fishing/logic.ts`, `src/games/fishing/data.ts`(`FRIDGE_SIZE = 15`); Test `src/games/fishing/logic.test.ts`

**Interfaces (Produces):**
- `export const FRIDGE_SIZE = 15` (data.ts)
- `export type DiscardAt = 'bag' | 'trash'`
- `export function discardFee(f, buffs, at: DiscardAt = 'bag'): number` — bag `ceil(p/2)`, trash `ceil(p/20)`, 최소 1
- `State.fridge: Fish[]`; `View = Omit<State, 'pending' | 'buffs' | 'sold' | 'fridge'> & { …; fridge?: Fish[] }`
- Action 추가: `{ type: 'discard'; …; at?: DiscardAt }`(없으면 'bag', 모르는 값이면 `bad_action`), `{ type: 'store'; index: number; species: string; sizeCm: number }`, `{ type: 'takeOut'; index: number; species: string; sizeCm: number }`
- `store`: pending이면 `busy`; index 범위 밖 `bad_action`; species·sizeCm 다르면 `bag_changed`; 냉장고 15칸이면 `fridge_full`; 가방 칸을 빼서 냉장고 끝에(잠금 표시 유지).
- `takeOut`: pending이면 `busy`; 범위 밖 `bad_action`; 다르면 `fridge_changed`; 가방이 `bagSize`면 `bag_full`; 냉장고 칸을 빼서 가방 끝에.
- `teleporterOpen(state, area)`: 그 지역 과제가 있으면 기존 규칙, 없으면 `state.areas.includes(area) && teleporterWorld(area) !== null`.
- migrate: `fridge`는 가방과 같은 규칙으로 읽고 15개까지, 없으면 `[]`. version 18.

- [ ] Step 1: 테스트 — `discardFee` 가방 50%(예: 판매가 101 → 51)·쓰레기통 5%(101 → 6)·최소 1; `discard`에 `at:'trash'`이면 5% 요금으로, `at` 없음이면 50%, 옛 10% 요금 → `price_changed`, `at:'zzz'` → `bad_action`; `store`/`takeOut` 정상·`fridge_full`·`bag_full`·`bag_changed`·`fridge_changed`·pending 중 `busy`·잠금 유지; migrate v17 → `fridge: []`, 저장된 냉장고 16개 → 15개, 모르는 어종 버림; `teleporterOpen(…,'hall')`은 hall이 areas에 있으면 true(Task 2 전에는 이동기가 없어 false라 이 테스트는 Task 2에서 추가); version 18.
- [ ] Step 2: 실패 확인 `npx vitest run src/games/fishing/logic.test.ts`
- [ ] Step 3: 구현
- [ ] Step 4: 통과 `npx vitest run src/games/fishing/logic.test.ts src/games/fishing/gold.test.ts`
- [ ] Step 5: Commit `feat: 낚시 냉장고·쓰레기통 부담금·과제 없는 이동기 규칙`

### Task 2: 회관 맵 — 이동기, 냉장고·쓰레기통 고정물

**Files:** Modify `src/games/fishing/map.ts`(FixtureAct에 `{ kind: 'fridge' } | { kind: 'trash' }`), `src/games/fishing/maps/hall.ts`; Test `map.test.ts`, `logic.test.ts`, `teleport.test.ts`, `atlas.test.ts`

**Interfaces:** 회관 `teleporter: { tiles: { tx: 1, ty: 8, w: 2, h: 2 }, front: { tx: 3, ty: 8, facing: 'right' } }`; 고정물 냉장고 (13,1)(13,2)(13,3) `right` → fridge, 쓰레기통 (11,1)(11,2)(11,3) `left` → trash.

- [ ] Step 1: 테스트 — (3,8)에서 왼쪽 보면 `teleporter`, 오른쪽(도착 방향)은 null; 이동기 칸 못 걷기; 입구에서 front에 닿음; 냉장고·쓰레기통 interaction; `teleporterOpen(fresh(), 'hall')` true; `teleportFee('village','hall')`가 TP 공식 값; 큰 지도 회관 이동기는 표시 안 함(세계 지도 밖).
- [ ] Step 2: 실패 확인 `npx vitest run src/games/fishing/map.test.ts src/games/fishing/logic.test.ts src/games/fishing/teleport.test.ts`
- [ ] Step 3: 구현(회관 행은 그대로: x1–2 y8–9는 이미 바닥)
- [ ] Step 4: 통과 `npx vitest run src/games/fishing`
- [ ] Step 5: Commit `feat: 마을회관 텔레포터·냉장고·쓰레기통 자리`

### Task 3: 화면 — 냉장고 창, 쓰레기통 버리기, 부담금 안내

**Files:** Create `src/games/fishing/FridgePanel.tsx`; Modify `Game.tsx`, `Menus.tsx`(BagPanel `discardAt?: DiscardAt`), `Controls.tsx`(라벨 '냉장고'·'쓰레기통'), `fishing.css`; Test `Game.test.tsx`, `FridgePanel.test.tsx`

**Interfaces:**
- `FridgePanel({ view, busy, onStore(index), onTakeOut(index) })`: section `aria-label="냉장고"`, 머리 `냉장고 n/15`, 냉장고 물고기 버튼 `{이름} {cm}cm 꺼내기`, 가방 물고기 버튼 `{이름} {cm}cm 넣기`. 냉장고 가득이면 넣기 끔 + `'냉장고가 가득 찼어요'`, 가방 가득이면 꺼내기 끔. `view.fridge` 없으면 빈 냉장고.
- Game: fixture `fridge` → 메뉴 `fridge`(창 제목 '냉장고'), `trash` → 가방 창을 버리기 모드·`discardAt='trash'`로(창 제목 '쓰레기통'). `act({ type: 'store'|'takeOut', index, species, sizeCm })`. `discard(index, fee, at)`이 `at`을 보낸다. 메시지 `fridge_full: '냉장고가 가득 찼어요'`, `fridge_changed: '냉장고가 바뀌었어요. 다시 골라 주세요'`.
- BagPanel 버리기 확인 줄: 가방이면 `환경부담금 {fee} · 쓰레기통에 버리면 {trashFee}`, 쓰레기통이면 `환경부담금 {fee}`.
- GUARDED에 `fridge` 추가.

- [ ] Step 1: 테스트 — 냉장고 앞(13,2) 오른쪽 → 행동 '냉장고' → 창, 넣기 → `store` 요청 내용, 꺼내기 → `takeOut`; 쓰레기통 앞(11,2) 왼쪽 → '쓰레기통' → 버리기 모드, 확인 → `discard`에 `at:'trash'`와 5% fee; 가방에서 버리면 `at:'bag'`·50% fee와 쓰레기통 요금 안내; FridgePanel 단위 테스트(가득 참·옛 응답).
- [ ] Step 2: 실패 확인 `npx vitest run src/games/fishing/FridgePanel.test.tsx src/games/fishing/Game.test.tsx`
- [ ] Step 3: 구현
- [ ] Step 4: 통과 `npm test && npm run typecheck && npm run build`
- [ ] Step 5: Commit `feat: 마을회관 냉장고 창·쓰레기통 버리기`

### Task 4: 함수 테스트·문서

**Files:** `supabase/functions/world/handler.test.ts`(버전 기대값이 상수면), `docs/deploy-checklist.md`(마을회관 2차: `world` 재배포만, DB 변경 없음), 설계 §5 잠금 문구(유지로 바뀜)

- [ ] Step 1: `npm run fn:test` 통과 확인, 문서 수정
- [ ] Step 2: Commit `docs: 마을회관 2차 배포 메모`
