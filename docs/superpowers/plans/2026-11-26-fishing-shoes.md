# 낚시 신발 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 상점에서 신발(4단계)을 사면 걷기 속도가 ×1.0/1.25/1.5/1.75가 된다.
**Spec:** `docs/superpowers/specs/2026-11-26-fishing-shoes-design.md`

## Global Constraints
- 단계·이름·가격·속도는 설계 표 그대로. `logic.version` 20. 옛 세이브 `shoesTier` 1. 화면 문구 한국어.
- `data.ts`·`logic.ts`·`walk.ts` 순수, 상대 import `.ts`.

## Review Focus
- 옛 세이브(v19) migrate → shoesTier 1, 다른 값 그대로 (Task 1 테스트)
- 빠른 신발로 한 프레임 최대 이동이 얇은 벽(1칸)을 뚫지 않음 (Task 2 테스트)
- 화면이 옛 서버 응답(shoesTier 없음)을 받아도 1단계로 봄 (Task 3 테스트)

### Task 1: 데이터와 서버 행동
- Files: `data.ts`(SHOES, ShoeTier, shoeSpeed), `logic.ts`(State.shoesTier, init, migrate, Action buyShoes, buyShoes(), version 20), `data.test.ts`, `logic.test.ts`(W0 등 전체 세이브 비교에 shoesTier: 1)
- [ ] 테스트: `SHOES` 표 값; `shoeSpeed(1..4)` = 1/1.25/1.5/1.75, 모르는 단계 1; `buyShoes 1->2 at 1000 gold → shoesTier 2, gold -1000`; 건너뛰기 `bad_tier`, 다른 가격 `price_changed`, 모자라면 `not_enough_gold`, 최고 단계 다음 `bad_tier`; migrate v19 → shoesTier 1, 알 수 없는 값 → 1, 저장된 3 → 3; version 20
- [ ] 구현, 낚시 테스트 통과, 커밋 `feat: 낚시 신발 데이터·구매(logic v20)`

### Task 2: 걷기 속도
- Files: `walk.ts` `stepWalk(map, p, input, dtMs, opened, dyn = STATIC_DYNAMIC, speed = 1)`, `walk.test.ts`, `Game.tsx`(stepWalk 호출에 `shoeSpeed(viewRef.current?.shoesTier ?? 1)`)
- [ ] 테스트: 같은 입력·dt에서 speed 1.75면 이동 거리 1.75배; MAX_DT_MS 한 프레임 ×1.75 이동이 16px보다 작다(벽 건너뜀 없음)
- [ ] 구현, 커밋 `feat: 낚시 신발 단계로 걷기 속도`

### Task 3: 상점 화면
- Files: `Menus.tsx`(ShopPanel "신발" 목록, `onBuyShoes`), `Game.tsx`(`buyShoes(tier)` → act `{ type: 'buyShoes', tier, price }`), `Game.test.tsx`
- [ ] 테스트: 상점에 신발 4종(이름·가격·속도 "×1.25"), 사용 중 표시, 딱 맞는 골드로 운동화 구매 → payload `{ type: 'buyShoes', tier: 2, price: 1000 }`; view에 shoesTier 없으면 기본 장화 사용 중
- [ ] 구현, 전체 검사(`npm test && npm run typecheck && npm run build`), 커밋 `feat: 낚시 상점 신발 목록`, PR(머지 뒤 world 재배포 안내)
