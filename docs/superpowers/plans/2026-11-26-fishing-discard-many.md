# 낚시 여러 마리 버리기 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. **Spec:** `docs/superpowers/specs/2026-11-26-fishing-discard-many-design.md`

## Global Constraints
- 요청 한 번. 원자적(하나라도 틀리면 아무것도 안 버림). `logic.version` 21. 옛 `discard` 유지. 문구 한국어.

## Review Focus
- 같은 칸을 두 번 보냄, 빈 목록, 가방보다 많은 칸 → bad_action
- 화면이 본 뒤 가방이 바뀜(다른 탭) → bag_changed, 아무것도 안 버림
- 선택한 뒤 잠금·가방 변화가 생기면 선택이 없는 칸을 가리키지 않게 선택을 비움

### Task 1: 서버 `discardMany` (logic.ts, logic.test.ts)
- [ ] 테스트: 두 마리(가방·쓰레기통) 버리면 남은 순서 유지, 골드 −합계, result `{ fee, n }`; 중복·빈 목록·형식 오류 bad_action; 칸 다름 bag_changed; 잠김 locked; 합계 다름 price_changed; 모자람 not_enough_gold(아무것도 안 버림); at 잘못 bad_action; version 21
- [ ] 구현·커밋 `feat: 낚시 여러 마리 버리기 서버(logic v21)`

### Task 2: 화면 (Menus.tsx BagPanel, Game.tsx)
- `onDiscard(indices: number[], fee: number, at)`; Game `discard(indices, fee, at)` → act `{ type: 'discardMany', items, fee, at }`, 알림 "N마리 버렸어요 · 환경부담금 X G"(한 마리면 "버렸어요 · …")
- [ ] 테스트: 두 마리 고르면 "2마리 버리기 · 환경부담금 합계"·한 번의 discardMany; 다시 누르면 선택 해제; 모두 선택은 잠긴 것 제외; 쓰레기통 at trash; 기존 한 마리 문구 유지
- [ ] 구현·전체 검사·커밋 `feat: 낚시 여러 마리 골라 한 번에 버리기`·PR(world 재배포 안내)
