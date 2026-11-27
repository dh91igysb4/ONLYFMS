# 낚시 경제 P0 구현 계획 (물고기 id·출처, world 중복 방지)

설계: `docs/superpowers/specs/2026-11-27-fishing-economy-design.md` §4. 화면에 보이는 변화는 없다.

## Task 1. 물고기 id·출처 (낚시 `logic.version` 26)
- [x] `Fish`에 `id`·`origin`, `State.nextFishId`(init 1). `View`에서는 `nextFishId`를 뺀다
- [x] `migrate`: v25 이하 물고기는 `legacy`, 가방 → 냉장고 순서로 1부터(`numberFish`). v26은 저장된 id·출처를 지키고 깨진·겹친 id만 새 번호. 옛 세이브의 `nextFishId`는 읽지 않는다
- [x] `resolve`: `nextFishId`를 쓰고 올린다. 전설·신화 `first`, 나머지 `normal`
- [x] `lock`·`discard`·`discardMany`·`store`·`takeOut`: `id`가 오면 그 칸 개체와 같아야 한다(다르면 `bag_changed`/`fridge_changed`). 없으면 그대로
- [x] 화면(`Game.tsx`)이 위 행동에 `id`를 보낸다
- [x] 시험: v25 전체 세이브 보존·두 번 migrate, v26 id 보존·수리, resolve 번호, 스테일 id 거절, view. 옛 migrate 시험은 `asOldFish`가 legacy 번호를 확인한 뒤 v25 모양으로 되돌려 비교한다

## Task 2. world 행동 중복 방지 (플랫폼)
- [x] 마이그레이션 `world_actions`(RLS, 권한 없음)
- [x] `world` 핸들러: `action_id` 형식 검사(400 `bad_action_id`), 세이브 잠금 뒤 조회(같으면 저장 응답, 다르면 409 `action_id_reused`), 200 응답 저장, 하루 지난 행 정리, 장부 ref = `action_id`
- [x] `handler.test.ts`: 순차·동시 중복, 다른 payload, 오류 미저장, 형식, 사용자·게임 분리, 정리
- [x] 화면 `world()`: act마다 `action_id`, network/5xx면 같은 id로 2번까지 다시 보낸다(`api.test.ts`)

## 배포 (사용자 지시 뒤에만)
1. `npx supabase@2 db push --dry-run`으로 `20261127074613_world_actions.sql` 하나만 나오는지 확인 → push
2. `npx supabase@2 functions deploy world --no-verify-jwt` (낚시 v26 포함. 이후 v25로 되돌리지 않는다)
3. Vercel 머지 배포
4. 확인: 낚시 불러오기 → 가방·냉장고 그대로, 잠금·버리기·보관 동작

`npm run fn:test`는 로컬 Postgres가 있는 머신에서 돌린다(이 Windows 환경에는 없어 `deno check`만 확인).
