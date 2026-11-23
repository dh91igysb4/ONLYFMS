# 펨타듀 낚시 — 가방 물고기 잠금 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가방에서 잠근 물고기는 "전부 팔기"에서 빠지고, 전설은 잡는 순간 자동으로 잠긴다.

**Architecture:** 가방 물고기에 `locked?: true`를 두고 서버 행동 `lock`으로만 바꾼다. `sell`은 잠기지 않은 것만 판다. 화면은 view의 `locked`를 그대로 보여 주고 칸을 누르면 `lock`을 보낸다. `logic.version` 5.

**Tech Stack:** TypeScript, React 18, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-lock-design.md`

## Global Constraints

- `logic.ts`는 순수 모듈: 외부 의존 없음, 상대 import에 `.ts`.
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다.
- 화면 문구 한국어, 모바일 우선. 색은 `theme.css` 토큰만.
- 잠기지 않은 물고기는 `locked` 필드가 없다(`false`를 저장하지 않는다). 기존 세이브·테스트의 물고기 모양이 그대로 같아야 한다.
- `logic.version` 5. 가격·추첨·rng 호출 순서 불변.
- 커밋 `type: 내용`, 경로 지정 스테이징.

## Review Focus

1. **잠긴 물고기가 팔리는 경로**: `sell`은 잠긴 물고기를 순서 그대로 남기고 값에 넣지 않는다. 전부 잠겨 있으면 `bag_empty`, 상태 그대로. → Task 1
2. **잘못된 `lock` 입력**: 범위 밖·소수·문자열 index, boolean 아닌 `locked` → `bad_action`, 상태 그대로. → Task 1
3. **기존 세이브**: v4 이하 가방의 전설은 잠기고 나머지는 그대로. v5 세이브에서 직접 푼 전설은 다시 잠기지 않는다. `locked`가 `true`가 아닌 값이면 버린다. → Task 1
4. **가방이 꽉 찬 채 전부 잠김**: 던지기는 지금처럼 `bag_full`. 상점 버튼은 팔 물고기가 0이면 비활성. → Task 2
5. **연타**: 응답 전 같은 칸을 다시 눌러 잠금이 뒤집히지 않게, 요청 중에는 칸 버튼 비활성. → Task 2

---

### Task 1: 서버 로직 (`lock`, `sell`, 전설 자동 잠금, migrate, version 5)

**Files:**
- Modify: `src/games/fishing/logic.ts`
- Test: `src/games/fishing/logic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Fish = { species: string; sizeCm: number; perfect: boolean; locked?: true }
  // Action에 추가
  | { type: 'lock'; index: number; locked: boolean }
  ```
  `lock`의 결과는 `{ state }`(result 없음). 낚시 중(`pending`)에도 된다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `version 5`
  - `lock: index 1 잠금 → bag[1].locked === true, 다른 칸·골드 그대로; 다시 locked:false → locked 필드 없음(toEqual 원래 물고기); pending 있어도 됨`
  - `lock 잘못된 입력(-1, bag.length, 0.5, '0', locked 'yes', locked 없음) → bad_action`
  - `sell: [멸치, 잠긴 다금바리, 고등어] → earned = 멸치+고등어 값, bag = [잠긴 다금바리]; 전부 잠김 → bag_empty`
  - `resolve: 전설을 잡으면 bag의 그 물고기 locked true, result.caught도 locked true; 일반 어종은 locked 없음`
  - `migrate: v4 가방 [멸치, 다금바리] → 다금바리만 locked; v5 [잠긴 멸치, 안 잠긴 다금바리] → 그대로; locked: 'x'·false → 필드 없음`
  - 기존 v3 migrate 테스트는 가방에 전설이 없으니 그대로 통과해야 한다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/logic.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `migrate`의 두 번째 인자를 쓴다: `fromVersion < 5`면 전설 어종을 잠그고, 아니면 저장된 `locked === true`만 유지.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/logic.ts src/games/fishing/logic.test.ts && git commit -m "feat: 낚시 가방 물고기 잠금 로직"`

### Task 2: 가방·상점 화면, 배포 안내

**Files:**
- Modify: `src/games/fishing/Menus.tsx`, `src/games/fishing/Game.tsx`, `src/games/fishing/fishing.css`, `docs/deploy-checklist.md`
- Test: `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Fish.locked`, 행동 `lock`
- `BagPanel` props에 `busy: boolean`, `onLock(index: number, locked: boolean): void` 추가.
- 동작:
  - 물고기 칸은 `<button aria-pressed={잠김} aria-label="{이름} {cm}cm 잠금|잠금 해제">`. 잠긴 칸은 클래스 `fish-cell-locked` + 자물쇠 표시. 가방 위에 안내 "물고기를 누르면 잠가서 팔리지 않게 해요".
  - 상점: `팔 물고기 n마리 · 잠금 m마리 · 예상 X G`(잠금 0이면 "잠금" 부분 생략 — 지금 문구 `가방 n마리 · 예상`은 `팔 물고기 n마리 · 예상`으로). "전부 팔기"는 팔 물고기 0이면 비활성.
  - 전설을 잡았을 때 알림은 지금 그대로(추가 문구 없음).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `가방: 멸치 칸 누르면 world act {type:'lock', index:0, locked:true}; 응답 뒤 aria-pressed true; 다시 누르면 locked:false`
  - `상점: [멸치, 잠긴 다금바리] → "팔 물고기 1마리 · 잠금 1마리 · 예상 {멸치 값}"; 전부 잠김이면 "전부 팔기" 비활성`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/Game.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — `docs/deploy-checklist.md` 낚시 절에 "잠금" 항목: `logic.version` 5, `world` 재배포, 수동 확인(칸 눌러 잠금·해제, 잠근 채 전부 팔기, 전설 자동 잠금, 새로고침 뒤 유지).
- [ ] **Step 4: 전체 검증** — Run: `npm test && npm run typecheck && npm run build && npm run fn:test` / Expected: 모두 PASS
- [ ] **Step 5: 커밋** — `git add src/games/fishing/Menus.tsx src/games/fishing/Game.tsx src/games/fishing/fishing.css src/games/fishing/Game.test.tsx docs/deploy-checklist.md && git commit -m "feat: 낚시 가방 잠금 화면과 배포 안내"`
