# 펨타듀 낚시 — 넓은 세계 6단계 마무리 (경제 · 전설 표시 · 버그) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하루 1시간쯤 하는 사람이 낚시 장비·해금을 다 사는 데 약 한 달(지갑의 사이트 하루 상한을 넣은 달력 기준)이 걸리게 경제를 맞추고, 전설 표시를 다듬고, 남은 버그 넷(가라앉는 물고기 무입력 잡기, 모르는 어종 throw, 민물 바위 뒤 바다 칸, 안 보이는 실루엣)을 고친다. 배포 체크리스트를 더한다.

**Architecture:** 기존 장비 가격은 그대로 둔다(사용자 결정, 2026-11-24: "지금 있는 장비 가격은 유지하고, 새로운 더 좋은 장비를 개비싸게 파는게 맞을듯"). 그 위에 고급 장비 넷 — 5·6단계 낚싯대(백골·용왕), 50·60칸 가방 — 을 더해 다 사는 시간을 늘린다. 새 장비는 어떤 어종에도 필요 없다(어종 `minRod`는 1~4). 진행 속도는 결정적 시뮬레이션(`econSim.ts`, 실제 `rollCatch` 규칙·`price()`·어종 데이터, 지갑 설계 §4 `REF` 계산과 같은 가정)으로 재고 `gold.test.ts`가 고정한다. 서버 `buyRod`·`buyBag` 결과가 바뀌므로 `logic.version` 9.

**Tech Stack:** TypeScript, React 18, Canvas 2D, vitest, Deno(`world` 함수 테스트). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-23-fishing-world-design.md` (§10의 6단계), `docs/superpowers/specs/2026-11-23-wallet-design.md` (PR #78 판, §4 `REF`·§4.1 목표 속도·§4.3 채택하지 않은 것·§5.6 사이트 하루 상한)

## Global Constraints

- `data.ts`·`logic.ts`·`minigame.ts`·`econSim.ts`는 순수 모듈: React·DOM·`Date.now()`·`Math.random` 없음, 상대 import에 `.ts`. `econSim.ts`는 서버·화면 어디서도 import하지 않는다(world 번들에 넣지 않는다).
- 물고기 판매가(어종 `basePrice`, `price()`, 등급 가중치 1~4단계, 입질 시간)는 바꾸지 않는다 → `REF` = 20,500 G/h 그대로.
- 기존 장비 가격 불변: 낚싯대 0 / 1,500 / 8,000 / 40,000, 가방 0 / 800 / 5,000, 찌 1,000 / 1,500 / 2,000 / 1,500 / 5,000, 해금 5,000 / 15,000 / 50,000.
- 쓰지 않는 것(사용자 결정, 지갑 §4.3): 순간이동 요금 인상, 같은 어종 판매가 감소, 소모품, 수수료.
- 플랫폼 코드(`src/platform/`, `src/app/`)와 DB는 바꾸지 않는다. 마이그레이션 없음.
- 화면 문구 한국어, 모바일 우선. 캔버스 밖 색은 `theme.css` 토큰만. 그림은 새로 그린 16px 픽셀 아트(`sprites.ts` 형식).
- `logic.version` 9 (8 = 4단계 도전과제·순간이동기). 이번 단계에서 한 번만 올린다.
- 커밋 `type: 내용`, 마지막 두 줄 트레일러(Co-Authored-By: <작성 모델 이름> <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_01T7oyVpQAuQkbAiCkNHahWh). 경로 지정 스테이징, 푸시 금지.

## 경제 결정 (시뮬레이션 결과)

시뮬레이션 가정(지갑 §4와 같음): 조건 평균(계절 균등, 게임 시각 10분 간격, 비 25%), 등급 가중치·`pickPool`·등급 안 균등, 전설 제외(세이브당 한 번뿐), 힘 0.8(부두 +0.25), 퍼펙트 20%, 던지기 한 번 = 평균 입질 3.75초 × biteScale(× 회전 찌 0.7) + 미니게임 8초 + 3초, 성공률 80%(화면 찌 효과 없음), 가방이 차면 상점 왕복(마을 30초, 강 45, 숲 60, 호수 60, 섬 75, 동굴 90초). 그때 가진 것으로 가장 많이 버는 자리에서 낚시하고, 찌는 칸 안에서 가장 좋은 조합을 낀다. 구매 순서(`BUY_ORDER`): 유리섬유 → 30칸 → 산 호수 → 카본 → 회전 찌 → 동굴 → 40칸 → 호기심 찌 → 명장 → 섬 → 코르크·함정·가시 → 백골 → 50칸 → 용왕 → 60칸.

| 품목 | 가격 | 효과 |
|---|---|---|
| 백골 낚싯대 (5단계) | 280,000 | 바 +48%, 입질 ×0.72, 가중치 44/34/22, 찌 2칸 |
| 용왕의 낚싯대 (6단계) | 620,000 | 바 +50%, 입질 ×0.66, 가중치 42/34/24, 찌 3칸 |
| 50칸 가방 | 50,000 | |
| 60칸 가방 | 100,000 | |

- 하루 1시간 + 사이트 하루 상한(30,750, 넘은 몫 20%): 기존 품목은 4일째, 다 사기까지 약 29일. 상한 없이 몰아서 하면 기존 품목 약 2.9시간(지금 속도 그대로), 다 사기까지 약 16시간. 총액 1,186,300 G.
- 바 보너스는 0.45 → 0.48 → 0.50으로 거의 늘지 않게 했다(코르크 포함 바 0.22 × 1.5 × 1.2 = 0.40, 지금 최대 0.38과 비슷). 미니게임 균형이 크게 바뀌지 않는다.
- **판단 (총액 목표와 충돌, 컨트롤러 결정)**: 지갑 §4.1의 `FISHING_SINK_TARGET` = `REF × 40` = 820,000(±15%), "플레이 30시간", "하루 1시간에 한 달"은 동시에 맞출 수 없다. 동굴 가장 깊은 곳 + 카본 이상의 시간당 수입이 54,000~88,000 G(`REF`의 2.6~4.3배)라 82만은 약 11시간(상한 넣고 약 20일)에 끝난다. 사용자 뜻은 달력(하루 1시간에 약 1개월)이고 지갑의 사이트 하루 상한이 다음 작업이라, **상한을 넣은 하루 1시간 시뮬레이션이 약 30일(±20%)** 이 되게 맞췄다(`gold.test.ts`가 고정). 총액은 82만 범위를 넘는다(약 `REF × 58`). 지갑 §4.1 수치는 지갑 PR에서 고친다.

## Review Focus

1. **기존 세이브·기존 장비**: v8 세이브는 v9로 그대로 읽히고(낚싯대·가방·찌·지역·과제·전설 유지), 기존 가격이 그대로다. → Task 1
2. **새 장비가 필수가 아님**: 모든 어종이 4단계 낚싯대로 낚인다. 새 장비는 수입만 올린다. → Task 1
3. **가라앉는 물고기**: 바를 안 눌러도 잡히는 일이 다른 유형만큼 드물다. → Task 2
4. **새 서버 · 옛 화면 / 옛 서버 · 새 화면**: 모르는 어종·낚싯대 단계에도 미니게임이 죽지 않는다. → Task 2
5. **스포일러**: 실루엣은 모양만(색 하나), 밝기만 바꾼다. → Task 4

---

### Task 1: 고급 장비와 경제 시뮬레이션, `logic.version` 9

**Files:**
- Create: `src/games/fishing/econSim.ts`, `src/games/fishing/gold.test.ts`
- Modify: `src/games/fishing/data.ts`, `src/games/fishing/logic.ts`, `src/games/fishing/sprites.ts`(낚싯대 그림 2), `src/games/fishing/minigame.ts`(타입), `src/games/fishing/Menus.tsx`(찌 칸 안내 문구)
- Test: `gold.test.ts`, `logic.test.ts`, `data.test.ts`, `sprites.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // data.ts
  export type RodTier = 1 | 2 | 3 | 4 | 5 | 6
  export type BagTier = 1 | 2 | 3 | 4 | 5
  // RODS에 5·6단계, BAGS에 4·5단계. tackleSlots: 3→1, 4·5→2, 6→3
  // econSim.ts
  export function hourlyIncome(area, spot, gear): number
  export function bestSpot(areas, rodTier, bagTier, owned): { area; spot; equipped; income }
  export function totalSinks(): number
  export const BUY_ORDER: readonly Purchase[]
  export function simulate(order?, day?: { hoursPerDay; cap; rate }): Milestone[]
  ```

- [ ] `gold.test.ts` 먼저: (1) `hourlyIncome('village','shore', 2단계·20칸)`이 `REF` 20,500의 ±25%(지갑 §4 고정 검사, 계산값 20,515와 1% 안), (2) 기존 품목 가격 목록 불변, (3) 모든 어종 `minRod ≤ 4`, (4) 시뮬레이션: 첫 구매 1시간 안, 기존 품목 다 사기까지 4시간 이하, 상한 없는 전부 다 사기 약 16시간(±20%, 참고값), 새 장비마다 산 뒤 수입이 오른다, (5) 사이트 하루 상한 + 하루 1시간: 전부 다 사기까지 30일 ±20%(24~36), 21일 이상(지갑 실패 조건 "3주 안"), 기존 품목은 7일 안. 실패 확인.
- [ ] `data.ts`에 고급 장비, `econSim.ts` 작성. `logic.ts` `State.rodTier`·`bagTier`·`CastCtx.rodTier` 타입 확장(`buyRod`·`buyBag`·`migrate`는 `RODS`·`BAGS`로 판정하므로 규칙 그대로). `logic.version` 9.
- [ ] `logic.test.ts`: v8 세이브 → v9 그대로(골드·낚싯대 4·가방 3·찌·장착·지역·과제·전설), 4단계에서 5단계 구매·6단계에서 더 못 삼(`bad_tier`), 가방 3 → 4, 6단계 찌 3칸 장착.
- [ ] `sprites.ts`에 `rod-5`(백골: 남색 대·금빛 별 장식), `rod-6`(용왕: 비취색 대·비늘 무늬·용 머리 끝) 새 그림. 가방 화면 "카본 낚싯대부터 낄 수 있어요" 그대로.
- [ ] `npx vitest run src/games/fishing` → 커밋 `feat: 낚시 고급 장비(5·6단계 낚싯대·50·60칸 가방)와 경제 시뮬레이션`

### Task 2: 미니게임 — 가라앉는 물고기 무입력 잡기, 모르는 어종 대비

**Files:** Modify `src/games/fishing/minigame.ts`, Test `minigame.test.ts`

- [ ] 테스트 먼저: 실제 sinker 어종(우럭·도다리·문어·꺽지·미꾸라지·백년 가물치·철갑상어·돌가재어·곰치·가오리)을 자기가 낚일 수 있는 가장 낮은 낚싯대와 6단계+코르크로 시드 100개씩, 60초 동안 안 누르면 잡히는 비율 ≤ 5%(지금 63~100%). 따라가기(물고기가 바보다 위면 누름)로는 쉬운 sinker(우럭, 2단계)가 잘 잡힌다. `barParams('unknown-fish', 1)`·`barParams('goby', 9 as never)`는 throw하지 않고 중립값(난이도 0.5, mixed, 기본 바).
- [ ] 고침: sinker 새 목표를 "바닥"이 아니라 **쉬고 있는 바 바로 위**(`barSize + 0.03` ~ `barSize + 0.30`)에서 고른다. 트랙 아래쪽에 머물지만, 손을 놓아 바닥에 붙은 바에는 들어오지 않아 살살 눌러 받쳐야 한다.
- [ ] 추가(컨트롤러 결정): 큰 바(6단계+코르크 0.41)에서는 smooth(최대 46%)·mixed(30%)·dart(12%)도 안 눌러 잡혔다. mixed·smooth·dart의 새 목표도 바닥 `barSize × 0.8` 위에서만 고른다(난수 한 번 그대로, 범위만 옮김). 테스트: 모든 어종 × 낚을 수 있는 낚싯대 1~6 × 코르크 있음/없음, 안 누르면 잡히는 비율 ≤ 5%. mixed 골든 값은 새로 구한다(옛 값은 주석).
- [ ] 커밋 `fix: 낚시 가라앉는 물고기를 안 눌러도 잡히던 문제, 모르는 어종에 미니게임이 죽던 문제`

### Task 3: 민물 속 바위 뒤 물 그림

**Files:** Modify `src/games/fishing/scene.ts`, Test `scene.test.ts`

- [ ] 테스트 먼저: 강·연못·호수·석호·용암 한가운데 바위(`o`) 칸에 그 물 그림(`river-0/1` 등)이 깔리고 `water-*`(바다)는 없다. 바다 속 바위는 그대로 `water-*`.
- [ ] 고침: 바위 칸이 물 위면 이웃(상하좌우) 물 칸 그림 종류 중 가장 많은 것(같으면 위·아래·왼쪽·오른쪽 순서 첫 번째)을 깐다. 부두·선착장은 바다, 다리는 강.
- [ ] 커밋 `fix: 낚시 민물 속 바위 뒤에 바다 칸이 그려지던 문제`

### Task 4: 안 잡은 물고기 실루엣 색

**Files:** Modify `src/games/fishing/sprites.ts`, Test `sprites.test.ts`

- [ ] 테스트 먼저: `SILHOUETTE` 색이 모든 팔레트(다크·라이트)의 `bg`·`panel`과 대비 3:1 이상(WCAG 그래픽 대비). 실루엣은 색 하나만 쓴다(모양만).
- [ ] 고침: `#1b1f2a` → 중간 밝기 회청색 `#767e90`(최소 대비 약 3.5).
- [ ] 커밋 `fix: 낚시 도감·지도에서 안 잡은 물고기 실루엣이 어두운 화면에서 안 보이던 문제`

### Task 5: 전설 표시 다듬기 (설계 §10의 6단계, §5.4)

지금 있는 것: 도감·지도 목록의 "전설" 배지(잡은 뒤), 안 잡은 전설 테두리, 지도 목록 "세이브당 한 마리, 이미 잡았어요". 빠진 것만 더한다.

**Files:** Modify `Menus.tsx`, `Game.tsx`, `MapPanel.tsx`, `fishing.css`, Test `Game.test.tsx`, `MapPanel.test.tsx`

- [ ] 테스트 먼저:
  - 도감: 전설 칸은 잡았든 아니든 테두리. 안 잡은 전설은 `???` 아래 "전설 · 세이브당 한 마리", 잡은 전설은 "세이브당 한 마리 · 잡았어요".
  - 가방: 전설 칸에 테두리 클래스(`fish-cell-legend`)와 aria-label에 "전설".
  - 잡은 알림: 전설이면 "전설의 물고기!"와 "세이브당 한 마리 · 가방에 잠가 뒀어요". 모르는 어종이면 가격 줄 없이(지금은 `price()` throw).
  - 지도 목록: 전설 칸 테두리를 잡은 뒤에도 유지.
- [ ] 구현, 색은 `--accent-strong` 토큰.
- [ ] 커밋 `feat: 낚시 전설 표시 다듬기(도감·가방·잡은 알림)`

### Task 6: 배포 체크리스트와 전체 검증

- [ ] `docs/deploy-checklist.md`에 "낚시 6단계 마무리" 절: `logic.version` 9, PR 브랜치에서 `world` 재배포 → 미리보기 확인 → 머지 뒤 main에서 다시 배포, Vercel, 열린 화면 새로고침 안내(옛 화면은 5·6단계 낚싯대·새 가방을 모름), 8로 되돌리지 않기(9 세이브를 8이 읽으면 5·6단계·4·5단계 가방이 1단계로 떨어진다), 수동 확인(상점 가격·새 장비 구매, 가라앉는 물고기, 전설 표시, 민물 바위, 실루엣).
- [ ] `npm test && npm run typecheck && npm run build && npm run fn:test`
- [ ] 커밋 `docs: 낚시 6단계 마무리 배포 안내`
