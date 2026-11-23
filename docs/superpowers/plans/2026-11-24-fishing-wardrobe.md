# 펨타듀 낚시 — 옷장(캐릭터 꾸미기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모자·상의·하의·머리 모양·머리 색·낚싯대 겉모습 6부위 옷장. 상점에서 골드로 사거나 업적으로 얻고, 낚시 세계 캐릭터(15장 모든 자세)와 프로필 요약 탭에 보인다. `logic.version` 10.

**Architecture:** 품목 목록은 공용 순수 모듈 `wardrobe.ts`(그림 없음, `world` 번들에 들어감), 그림 자료는 화면 전용 `wearArt.ts`, 합성은 순수 모듈 `outfit.ts`(지금 15장 Sprite → 옷 입힌 Sprite, 옷차림 키마다 캐시). 서버는 `buyWear`·`wear` 행동과 v9 → v10 migrate. 프로필은 manifest `avatar` + `WorldLogic.avatar` + `world` 함수가 `game_records` 키 `avatar`에 쓰는 문자열 + `ui.ts` `getAvatarComponent` — 플랫폼은 게임 id를 모른다. DB 변경 없음.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-24-fishing-wardrobe-design.md`

## Global Constraints

- `wardrobe.ts`·`outfit.ts`·`wearArt.ts`·`logic.ts`는 순수 모듈(React·DOM·`Date.now`·`Math.random` 없음, 상대 import에 `.ts`). `logic.ts`는 `wardrobe.ts`만 import하고 `wearArt.ts`·`outfit.ts`·`sprites.ts`는 import하지 않는다(`world` 번들에 그림이 들어가지 않게).
- 기본 옷차림 합성 결과는 지금 15장과 픽셀이 같다(테스트로 고정).
- 그림은 전부 새로 그린 16px 픽셀 아트(`sprites.ts` 글자 형식). 유니폼에 엠블럼·로고·글자 없음, 이름·설명·화면 어디에도 구단 이름 없음.
- 화면 문구 한국어, 모바일 우선, 캔버스 밖 색은 theme 토큰만.
- 플랫폼(`src/platform/`)은 게임 id로 분기하지 않는다.
- 커밋은 `type: 내용`, 밤샘 규칙의 트레일러 두 줄. 푸시하지 않는다.

## Task 1: 품목 목록 `wardrobe.ts`

**Files:** Create `src/games/fishing/wardrobe.ts`, `src/games/fishing/wardrobe.test.ts`

- [ ] 테스트 먼저: id가 부위 안에서 유일, 부위마다 기본 품목(`DEFAULT_OUTFIT`)이 무료, 무료 품목 수(부위마다 2, `rodSkin` 1), 업적 품목은 가격 0이고 조건의 도전과제 id가 `CHALLENGES`에 있다, 상점 총액이 `REF × 55 ~ 75`, 부위마다 가장 비싼 상점 품목 ≥ 가장 싼 것 × 10, 유니폼(`kit-` 접두) 6벌이 있고 이름·설명에 구단 이름(한·영)이 없다.
- [ ] 구현: `WEAR_SLOTS`, `WearItem = { id, slot, name, price, unlock? }`, `WEAR`(설계 §3 표 그대로), `DEFAULT_OUTFIT`, `wearItem(slot, id)`, `isShopItem(item)`, `unlockMet(state, unlock)`, `ownsWear(state, slot, id)`, `unlockText(unlock)`(화면 문구).
- [ ] `npx vitest run src/games/fishing/wardrobe.test.ts` 통과 → 커밋 `feat: 낚시 옷장 품목 목록`

## Task 2: 서버 상태·행동 (`logic.version` 10)

**Files:** Modify `src/games/fishing/logic.ts`, `src/games/fishing/logic.test.ts`

- [ ] 테스트 먼저: `init`에 `wardrobe: []`·기본 옷차림 / `buyWear` 성공(골드 감소·`wardrobe`·바로 입음), `already_owned`(무료·이미 산 것), `not_for_sale`(업적), `bad_wear`, `not_enough_gold` / `wear` 성공·`bad_wear`(모르는 부위·id·다른 부위)·`not_owned`·업적 조건 채우면 입을 수 있다(전설 1마리 → 왕관, 과제 6개 → 무지개, 한 지역 도감 완성 → 물고기 모자) / migrate: v9 세이브 → 기본 옷차림·빈 옷장, v10 세이브의 모르는 id·안 가진 옷·다른 부위 id는 기본값으로, 중복 제거 / `avatar(state)`가 옷차림 JSON / `version === 10`.
- [ ] 구현 후 `npx vitest run src/games/fishing/` → 커밋 `feat: 낚시 옷 사기·입기 서버 행동(logic.version 10)`

## Task 3: 프로필 캐릭터 통로 (플랫폼·함수)

**Files:** Modify `src/games/types.ts`, `supabase/functions/world/handler.ts`, `supabase/functions/world/handler.test.ts`, `src/games/registry.test.ts`, `src/games/fishing/manifest.ts`, `src/test-fixtures/world.ts`

- [ ] `Manifest.avatar?: { label: string }`, `WorldLogic.avatar?(state): string`, `AVATAR_RECORD_KEY = 'avatar'`.
- [ ] 함수 테스트 먼저: avatar가 있는 가짜 게임에서 `act` 뒤 `game_records`에 `avatar` 행(값 0, detail 문자열), `load`만으로는 안 생김, avatar 없는 게임은 행 없음.
- [ ] handler: records upsert 뒤 `logic.avatar`가 있으면 같은 upsert.
- [ ] 등록부 테스트: `manifest.avatar` ⇔ `logic.avatar`, `records` 키에 `avatar` 없음. (화면 등록 `getAvatarComponent`는 Task 6에서 `ui` 테스트로)
- [ ] `npm run fn:test` → 커밋 `feat: 지속형 게임 프로필 캐릭터 기록(avatar)`

## Task 4: 합성 `outfit.ts` + 그림 `wearArt.ts`

**Files:** Create `src/games/fishing/outfit.ts`, `outfit.test.ts`, `wearArt.ts`; Modify `sprites.ts`(`drawSpriteData` 분리), `sprites.test.ts`

- [ ] 테스트 먼저: 기본 옷차림 15장이 원래 Sprite와 픽셀 같음 / 모든 품목 × 15장이 16×24이고 예외 없음 / 모든 비비니 모자가 대기 3방향에서 머리 맨 윗줄(비니 맨 윗줄 칸)을 덮는다 / 모든 장·품목에서 `ROD_TIP` 칸이 투명이 아니다 / 낚싯대 겉모습이 줄 끝 칸 색을 바꾼다 / 머리 이동표(§4.2) 확인 / 캐시: 같은 키 → 같은 객체 / `wearArt`에 모든 `WEAR` 품목의 그림 자료가 있다.
- [ ] 구현: 픽셀 격자 합성(색 바꾸기 → 무늬 → 모자 벗기기·외곽선 → 머리 덧그림 → 모자 덧그림 → 낚싯대 다시 칠하기) → Sprite. `playerSprites(outfit)` 캐시(최근 8개).
- [ ] `scripts/preview-wardrobe.ts`: 품목마다 4방향 + 걷기·낚시 자세 PNG를 `/home/claude/preview/wardrobe/`에. 눈으로 보고 고친다.
- [ ] 커밋 `feat: 낚시 캐릭터 옷 합성과 픽셀 그림`

## Task 5: 장면에 옷 입히기

**Files:** Modify `scene.ts`, `scene.test.ts`, `Game.tsx`

- [ ] `WorldScene.outfit?: Outfit`. `drawPlayer`는 `playerSprites(outfit)[pose.name]`를 그린다(없으면 기본).
- [ ] 테스트: 옷차림이 바뀌면 그린 색이 바뀐다, 기본이면 지금과 같다.
- [ ] Game: `view.outfit`을 장면에 넘긴다.

## Task 6: 옷장 창·프로필 캐릭터 화면

**Files:** Create `src/games/fishing/WardrobePanel.tsx`, `WardrobePanel.test.tsx`, `src/games/fishing/Avatar.tsx`, `src/platform/profile/AvatarSection.tsx`, `AvatarSection.test.tsx`; Modify `Game.tsx`, `Menus.tsx`(가방·상점에 버튼), `fishing.css`, `src/games/ui.ts`, `ProfilePage.tsx`, `Game.test.tsx`

- [ ] WardrobePanel 테스트 먼저: 부위 탭 6개, 입는 중 표시, 가진 것 "입기" → `onWear(slot,id)`, 상점 품목 "사기"는 상점 앞에서만 켜짐·골드 부족이면 꺼짐, 업적 품목은 조건 문구만, 고르면 미리보기 바뀜(이름 표시).
- [ ] Game: 메뉴 `wardrobe`, `buyWear`·`wear` 요청, 가방·상점 창 버튼.
- [ ] `getAvatarComponent`, fishing `Avatar`(캔버스, 모르는 값은 기본).
- [ ] AvatarSection 테스트(테스트 월드에 avatar 붙여): avatar 행이 있으면 컴포넌트를 그림, 숨김 게임·등록 안 된 게임·행 없음이면 안 그림, 오류면 조용히 아무것도 안 그림.
- [ ] 커밋 `feat: 낚시 옷장 창과 프로필 캐릭터`

## Task 7: 문서·검증

- [ ] `docs/deploy-checklist.md` 낚시 절에 옷장 배포(`world` 재배포 → Vercel, 새로고침 안내, v9로 되돌리지 않기, DB 변경 없음, 수동 확인 목록).
- [ ] `CLAUDE.md` 폴더 규칙에 `avatar` 통로 한 줄.
- [ ] `npm test && npm run typecheck && npm run build && npm run fn:test` (마이그레이션 없음 → `db:test` 불필요, 그래도 돌려 본다).
- [ ] 커밋 `docs: 낚시 옷장 배포 안내`
