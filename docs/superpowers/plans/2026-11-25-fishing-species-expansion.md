# 낚시 어종 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 낚시 어종 75종을 더해, 모든 낚시 자리에서 어떤 순간이든 흔함 4 / 드묾 2 / 희귀 1 이상이 낚이게 한다.

**Architecture:** 데이터(`data.ts` `SPECIES` 끝에 75종), 그림(새 파일 `fishArt.ts`를 `SPRITES`에 펼쳐 넣음), 판정 버전(`logic.version` 19), 경제 목표(하루 1시간 약 25일, 21~31일)만 바꾼다. 화면·서버 코드는 데이터에서 자동으로 따라온다. 값과 픽셀의 원본은 `.superpowers/fish-art/new.json`(커밋하지 않는 작업 폴더)이고, 일회용 변환 스크립트로 TS를 만든 뒤 그 결과만 커밋한다.

**Tech Stack:** TypeScript, Vitest, Deno(Edge Function `world` 번들), React(화면 확인만)

**Spec:** `docs/superpowers/specs/2026-11-25-fishing-species-expansion-design.md`

## Global Constraints

- 기존 94종의 순서·값은 바꾸지 않는다(앞 94종 = 지금 그대로). 새 75종은 그 뒤에 지역 순서 마을·강·숲·호수·동굴·갯벌·섬·늪지·산정·난파선, 지역 안에서는 `new.json` 순서.
- 새 어종은 모두 조건 없음(`seasons`·`hours`·`weather` 없음). `spots`는 `new.json` 값 그대로(없으면 지역 전체).
- 새 어종 가격은 `new.json` 초안 그대로(그 지역·등급 기존 가격대 안). `SELL_DECAY`·장비·해금 가격은 그대로.
- 4/2/1 판정: 지역 × 자리(물때 자리는 열린 시각만) × 계절 × 정각 × 날씨. 흔함·드묾은 지역 최소 낚싯대(`areaMinRod`), 희귀는 낚싯대 4(난파선 5). 전설·신화는 세지 않는다.
- 진행 목표: 하루 1시간 다 사기 약 25일, **21일 초과 31일 미만**. "3주 안에 다 사지 못한다(> 21일)", "가시 바늘 7일 안" 유지.
- `logic.version` 18 → 19.
- `logic.ts`·`data.ts`·`fishArt.ts`는 순수 데이터·함수, 외부 의존 없음, 상대 import에 `.ts` 확장자(Deno).
- 화면 문구 한국어. 캔버스 내부 색(물고기 팔레트)은 토큰 규칙 예외.
- 커밋 메시지 `type: 내용`(한국어 가능), 끝에 세션 attribution 줄. 작업 브랜치 → PR, 푸시 전 `npm test && npm run typecheck && npm run build`.
- 연결 폴더에서 git이 잠금 파일을 못 지우면(`Operation not permitted`, `.lock` 남음) 첫 git 쓰기 전에 `device_request_delete_permission`으로 저장소 폴더 삭제 권한을 한 번 받는다.

## Review Focus

- **배포 직후 진행 중이던 낚시(pending)**: v18 세이브에 pending이 있어도 v19가 그대로 읽고, 그 물고기를 끝까지 낚을 수 있어야 한다 → Task 3 테스트.
- **이미 받은 지역 도감 업적 옷**: 어종이 늘어 지역 도감 조건이 다시 거짓이 되어도 세이브 `wardrobe`에 있는 옷은 그대로 가진다 → Task 2 테스트.
- **썰물이 아닐 때의 갯골**: 4/2/1 검사는 열린 시각만 센다. 닫힌 갯골은 던지기 자체가 막혀야 한다(기존 `spot_closed`) → Task 2 검사에서 열린 시각만 세는지 확인.
- **대나무 낚싯대(희귀 0%)**: 희귀 후보가 늘어도 1단계에서는 희귀가 안 나와야 한다(가중치 0) → Task 2 테스트.
- **도감·지도 목록이 지역당 최대 20종**: 모바일 폭(375px)에서 넘치지 않아야 한다 → Task 5 화면 확인.

---

### Task 1: 새 어종 그림 75장 (`fishArt.ts`)

**Files:**
- Create: `src/games/fishing/fishArt.ts`
- Modify: `src/games/fishing/sprites.ts` (`SPRITES` 객체 끝에 `...FISH_ART`, 파일 머리 import)
- Test: `src/games/fishing/sprites.test.ts`
- 일회용(커밋 안 함): `.superpowers/fish-art/to-ts.py`

**Interfaces:**
- Consumes: `.superpowers/fish-art/new.json` — 배열, 원소 `{ id, name, rarity, basePrice, minCm, maxCm, difficulty, minRod, behavior, area, spots?, sprite: { w: 16, h: 16, rows: string[16], palette: Record<string,string> } }`
- Produces: `export const FISH_ART: Record<string, Sprite>` (키 `fish-<id>`, 75개, `new.json` 순서), `export const FISH_ART_IDS: readonly string[]` (75개 id, 같은 순서). `Sprite`는 `import type { Sprite } from './sprites.ts'`(타입만, 순환 실행 없음).

- [ ] **Step 1: 실패하는 테스트 쓰기** — `sprites.test.ts`에 추가:

```ts
import { FISH_ART, FISH_ART_IDS } from './fishArt.ts'
it('확장 75종 그림: 16×16, 팔레트 글자 모두 정의, 서로 다르고 기존 어종 그림과도 다르다', () => {
  expect(FISH_ART_IDS).toHaveLength(75)
  const old = new Set(SPECIES.slice(0, 94).map((s) => SPRITES[`fish-${s.id}`].rows.join('\n')))
  const seen = new Set<string>()
  for (const id of FISH_ART_IDS) {
    const sp = SPRITES[`fish-${id}`]
    expect(sp, id).toBe(FISH_ART[`fish-${id}`])
    expect([sp.w, sp.h, sp.rows.length], id).toEqual([16, 16, 16])
    for (const r of sp.rows) { expect(r).toHaveLength(16); for (const ch of r) if (ch !== '.') expect(sp.palette[ch], `${id} ${ch}`).toBeDefined() }
    const d = sp.rows.join('\n')
    expect(old.has(d), id).toBe(false)
    expect(seen.has(d), id).toBe(false)
    seen.add(d)
  }
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/sprites.test.ts` → FAIL(`./fishArt.ts` 없음).

- [ ] **Step 3: 변환 스크립트로 `fishArt.ts` 만들기** — `to-ts.py`가 `new.json`을 읽어 다음 형식으로 쓴다. 머리 주석 두 줄(“낚시 어종 확장(2026-11-25) 75종 그림. 기존 sprites.ts와 같은 규칙: 머리 왼쪽, '.' 투명, 캔버스 내부 색은 토큰 예외” + “원본은 설계 문서의 견본 시트. 이제부터 이 파일을 직접 고친다”), 어종마다 `// <이름>` 한 줄 주석 + `const FISH_<ID_대문자_밑줄>: Sprite = { w: 16, h: 16, palette: {...}, rows: [ ...16줄 ] }`, 끝에 `FISH_ART`·`FISH_ART_IDS`. 실행: `python3 -I .superpowers/fish-art/to-ts.py > src/games/fishing/fishArt.ts`.

- [ ] **Step 4: `sprites.ts`에 연결** — 머리에 `import { FISH_ART } from './fishArt.ts'`, `SPRITES` 객체 마지막 항목 뒤에 `...FISH_ART,`.

- [ ] **Step 5: 통과 확인** — `npx vitest run src/games/fishing/sprites.test.ts` → PASS. `npm run typecheck` → 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/games/fishing/fishArt.ts src/games/fishing/sprites.ts src/games/fishing/sprites.test.ts
git commit -m "feat: 낚시 새 어종 75종 그림"
```

---

### Task 2: 새 어종 데이터 75종과 4/2/1 검사

**Files:**
- Modify: `src/games/fishing/data.ts` (`SPECIES` 배열 끝, 지역별 한 줄 주석 `// 확장(2026-11-25): <지역>`)
- Modify: `src/games/fishing/testFixtures.ts` (`withSpeciesPrefix` 추가)
- Modify: `src/games/fishing/logic.test.ts` (“찌 없음: 고정 rng 열의 결과가 v4 코드와 같다”를 앞 94종으로 고정)
- Test: `src/games/fishing/data.test.ts`, `src/games/fishing/logic.test.ts`, `src/games/fishing/wardrobe.test.ts`, `src/games/fishing/__snapshots__/data.test.ts.snap`

**Interfaces:**
- Consumes: Task 1 `FISH_ART_IDS`(그림 존재), `new.json` 값
- Produces: `SPECIES.length === 169`, `SPECIES.slice(94)`가 새 75종. `testFixtures.ts`에 `export const SPECIES_BEFORE_EXPANSION = 94` 와 `export function withSpeciesPrefix(n: number): void` (describe 안에서 부르면 각 테스트 앞에 `SPECIES.length = n`으로 잘라 두고 뒤에 원래 배열로 되돌린다. `installTempData`와 같은 beforeEach/afterEach 방식, 잘라 낸 원소를 보관했다가 다시 push).

- [ ] **Step 1: 실패하는 테스트 쓰기** — `data.test.ts`:
  - `'94 species, …'` 테스트를 169로: `expect(SPECIES).toHaveLength(169)`, id 유일 169, 이름도 유일(`new Set(SPECIES.map(s => s.name)).size === 169`).
  - 새 테스트 `'기존 94종 값은 그대로(앞 94종 순서·값), 새 75종 스냅숏'`: 앞 94종을 기존 4개 스냅숏 테스트가 보던 방식으로 `SPECIES.slice(0, 94)` 기준으로 비교하게 기존 필터(`filter((s) => !['summit','wreck'].includes(s.area))` 등)를 `SPECIES.slice(0, 94)`의 부분집합 필터로 바꾸고(기대 길이 16/33/56/75 그대로), 새 `expect(SPECIES.slice(94)).toMatchSnapshot()`, `expect(SPECIES.slice(94).map(s=>s.area))`가 지역 순서대로 정렬되어 있음.
  - 새 75종은 조건이 없다: `for (const s of SPECIES.slice(94)) expect([s.seasons, s.hours, s.weather, s.legend], s.id).toEqual([undefined, undefined, undefined, undefined])`, 등급은 common/uncommon/rare만.
  - 지역별 수: `[19, 12, 19, 13, 16, 18, 18, 16, 18, 20]`(마을·강·숲·호수·동굴·섬·갯벌·늪지·산정·난파선).
  - 늪지 테스트를 `'늪지: 이무기·전설을 뺀 14종 중 비·밤 전용 5종(기존 8종), 새 6종은 상시'`로: 길이 14, 비·밤 전용 5.
  - 새 테스트 `'모든 자리·순간에 흔함 4·드묾 2·희귀 1 이상'`: 지역(`FISHING_AREAS`) × 자리 × 계절 × 0~23시 정각 × 날씨에서 `spotOpen(area, spot, gameMinute)`이 false면 건너뛰고, `SPECIES.filter(s => !s.legend && speciesAvailable(s, area, spot, cond, rod))`를 등급별로 센다. 흔함·드묾은 `rod = areaMinRod(area)`, 희귀는 `rod = Math.max(areaMinRod(area), 4)`. 실패 메시지에 `${area}/${spot} ${season} ${hour}시 ${weather}`.
- `logic.test.ts`(기존 `ctxOf`·`sequence` 헬퍼 사용): `'대나무 낚싯대(1단계)에서는 새 희귀도 나오지 않는다'` — 숲 연못·폭포 각각 봄 12시 맑음, r1 ∈ {0.5, 0.9, 0.999}에서 `rollCatch(sequence(0.5, r1, 0.5, 0.5, 0.5), ctxOf({ rodTier: 1, area: 'forest', spot, cond }))`의 어종 등급이 rare가 아니다.
- `wardrobe.test.ts`: `'지역 도감 옷: 어종이 늘어 조건이 거짓이 돼도 wardrobe에 있으면 가진다'` — 숲 기존 8종만 dex에 있는 OwnFacts로 `unlockMet(f, areaDex)`가 false이고, 그 옷 키가 `wardrobe`에 있으면 `ownsWear`가 true, `newlyEarned`에 다시 나오지 않는다(옷 id는 `WEAR`에서 `unlock.kind === 'areaDex'`인 것을 찾는다).

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/data.test.ts` → 길이·수·4/2/1 테스트 FAIL.

- [ ] **Step 3: `data.ts`에 75종 넣기** — `to-ts.py`에 두 번째 출력(`--species`)을 더해 `new.json`에서 `sprite`를 뺀 객체를 기존 한 줄 형식(`{ id: '…', name: '…', rarity: '…', basePrice: …, minCm: …, maxCm: …, difficulty: …, minRod: …, behavior: '…', area: '…', spots: [...] }`, spots 없으면 생략)으로 찍고, `SPECIES` 마지막 원소(`dragon-king`) 뒤에 붙인다. 지역이 바뀔 때마다 주석 한 줄.

- [ ] **Step 4: 고정 rng 테스트를 앞 94종으로** — `logic.test.ts`의 `'찌 없음(equipped []): 고정 rng 열의 결과가 v4 코드와 같다'`를 감싸는 `describe` 안에서 `withSpeciesPrefix(SPECIES_BEFORE_EXPANSION)`(그 테스트만 담는 새 describe로 옮겨도 된다). 기대값은 바꾸지 않는다. 주석에 “어종 확장(v19) 뒤에도 v4 판정과 같음을 보려고 앞 94종으로 잘라서 돈다” 한 줄.

- [ ] **Step 5: 스냅숏 갱신과 통과 확인** — `npx vitest run src/games/fishing -u` 뒤 `git diff src/games/fishing/__snapshots__`에서 **기존 스냅숏 블록은 바뀌지 않고 새 75종 블록만 생겼는지** 눈으로 확인. 그다음 `npx vitest run src/games/fishing/data.test.ts src/games/fishing/sprites.test.ts src/games/fishing/wardrobe.test.ts` → PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/games/fishing/data.ts src/games/fishing/testFixtures.ts src/games/fishing/*.test.ts src/games/fishing/__snapshots__
git commit -m "feat: 낚시 새 어종 75종 데이터, 자리마다 흔함4·드묾2·희귀1"
```

---

### Task 3: 판정 버전 19와 옛 세이브

**Files:**
- Modify: `src/games/fishing/logic.ts:743` (`version: 19`), 버전 이력 주석(파일 위쪽 버전 설명이 있으면 한 줄: “19: 어종 확장 75종(추첨 결과가 달라진다), 세이브 구조 그대로”)
- Test: `src/games/fishing/logic.test.ts`

**Interfaces:**
- Consumes: Task 2의 `SPECIES`(169종)
- Produces: `logic.version === 19`

- [ ] **Step 1: 실패하는 테스트 쓰기** — `logic.test.ts`:
  - `'init and version'`과 `'version 18'`의 `toBe(18)` → `toBe(19)`(`'version 18'` 테스트 이름도 `'version 19'`).
  - 새 describe `'어종 확장 (logic.version 19)'`:
    - `'migrate: v18 세이브(진행 중 pending 포함)는 그대로 읽히고 version만 19'` — 기존 v18 픽스처(냉장고 describe가 쓰는 세이브 만드는 헬퍼)를 version 18로 두고, `pending`에 기존 어종(`species: 'mackerel'`)을 넣어 `migrate` → 결과가 version 외에는 입력과 같고, 이어서 hook·resolve 행동이 정상(잡힌 물고기가 가방에 들어감).
    - `'새 어종을 잡으면 dex·가방에 들어가고 판매가가 basePrice 기준'` — 숲 연못에서 rng를 골라 `koi`가 나오게 하거나 pending을 직접 `{ species: 'koi', sizeCm: 60, … }`로 둔 세이브로 resolve → dex에 `koi`, 가방 1마리, `sellPrice`가 0보다 큼.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/fishing/logic.test.ts -t "version"` → FAIL(18).
- [ ] **Step 3: `logic.version`을 19로**.
- [ ] **Step 4: 낚시 전체 테스트** — `npx vitest run src/games/fishing`. 고정 rng로 **어종·크기를 박아 둔 다른 테스트**가 깨지면: 그 테스트의 목적이 “옛 데이터에서의 판정 고정”이면 Task 2의 `withSpeciesPrefix(SPECIES_BEFORE_EXPANSION)`로 감싸고, 목적이 “지금 데이터의 동작”이면 새로 나온 값으로 고치되 고친 이유를 한 줄 주석으로 남긴다. 화면 테스트(`Game*.test.tsx`, `MapPanel.test.tsx` 등)에서 어종 수·목록 길이를 박아 둔 곳은 새 수로 고친다. 전부 PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/games/fishing
git commit -m "feat: 낚시 logic.version 19(어종 확장)"
```

---

### Task 4: 진행 속도 목표 25일(21~31일)

**Files:**
- Modify: `src/games/fishing/gold.test.ts:92-120` (범위·기록 값)
- Modify: `src/games/fishing/econSim.ts:3` 주석, `src/games/fishing/data.ts` `SELL_DECAY` 주석(“하루 1시간 약 30일” 문구)
- Modify: `CLAUDE.md` “낚시 데이터 갱신” 4번
- Modify: `docs/superpowers/specs/2026-11-25-fishing-species-expansion-design.md` 끝에 “측정값” 한 줄(Step 3 값)

**Interfaces:**
- Consumes: Task 2·3 데이터
- Produces: 없음(테스트·문서)

- [ ] **Step 1: 실패 확인** — `npx vitest run src/games/fishing/gold.test.ts` → `'전부 다 사기까지 약 30일(27~41일 안)'`, `'하루 1·2·3·5·10시간 = …'`, 마일스톤 날짜 고정(`daily.slice(0, 13)…`) 등이 FAIL하는 것을 기록.
- [ ] **Step 2: 새 값 재기** — 일회용 스크립트(`npx tsx`)로 `simulate(BUY_ORDER, { hoursPerDay: h })`의 마지막 `atDay`(h = 1, 2, 3, 5, 10), `daily.slice(0, 13)`의 `atDay`(소수 둘째 자리), 그리고 `gold.test`가 고정하는 나머지 기록 값(시간당 수입 등 FAIL 목록에 나온 것)을 출력. 1시간 값이 21~31 안인지 확인(설계 때 잰 값 약 25.05일). 범위 밖이면 멈추고 사용자에게 알린다.
- [ ] **Step 3: 테스트 고치기** — `'전부 다 사기까지 약 25일(21~31일 안)'`: `toBeGreaterThan(21)`, `toBeLessThan(31)`. `'3주 안에 다 사지 못한다…'`·`'가시 바늘 7일 안'`은 그대로 통과해야 한다(고치지 않는다). `'하루 여러 시간 …(기록, ±5%)'`의 이름과 `near(...)` 값, 마일스톤 날짜 배열, 그 밖의 기록 값을 Step 2 값으로. **기록 값이 아닌 성질 검사(순서·단조성·지역 수입 비교)가 깨지면 고치지 말고 멈추고 보고**한다.
- [ ] **Step 4: 문구 고치기** — `CLAUDE.md` 4번의 “(하루 1시간 약 30일, 27~41일, 설계 `2026-11-25-fishing-sell-decay-design.md`)” → “(하루 1시간 약 25일, 21~31일, 설계 `2026-11-25-fishing-species-expansion-design.md`)”. `econSim.ts` 머리 주석과 `data.ts` `SELL_DECAY` 주석의 “약 30일”을 같은 목표로. 설계 문서 끝에 “측정값(구현 시): 하루 1·2·3·5·10시간 = …일”.
- [ ] **Step 5: 통과 확인** — `npx vitest run src/games/fishing/gold.test.ts` → PASS.
- [ ] **Step 6: 커밋**

```bash
git add src/games/fishing/gold.test.ts src/games/fishing/econSim.ts src/games/fishing/data.ts CLAUDE.md docs/superpowers/specs/2026-11-25-fishing-species-expansion-design.md
git commit -m "test: 낚시 진행 목표 약 25일(21~31일), 어종 확장 반영"
```

---

### Task 5: 전체 검증, 화면 확인, PR

**Files:** 없음(필요하면 화면 넘침 수정: `src/games/fishing/Menus.tsx`·`MapPanel.tsx`·`fishing.css`)

- [ ] **Step 1: 전체 검사** — `npm test && npm run typecheck && npm run build` → 모두 통과. `npm run fn:test`(Deno가 있으면) → `world` 함수 테스트 통과(새 데이터 번들 확인).
- [ ] **Step 2: 화면 확인(모바일 375px)** — `npm run dev`, 관리자 계정으로 `/world/fishing`: 도감에서 숲(19종)·난파선(20종) 목록, 지도 패널의 자리별 물고기 목록, 새 어종 하나 낚아 잡기 카드·가방·냉장고 표시. 넘치거나 겹치면 그 화면의 CSS만 고친다(토큰 색만). 고친 게 있으면 `fix: …`로 커밋.
- [ ] **Step 3: 푸시와 PR** — 브랜치(예: `feat/fishing-species-expansion`)를 푸시하고 PR을 연다. 본문: 설계 링크, 4/2/1 검사 결과, 진행 목표 변경(30일 → 약 25일, 21~31일)과 측정값, `logic.version` 19, **머지 뒤 `world` 재배포 필요**(`npx supabase@2 functions deploy world --no-verify-jwt`, 진행 중 데일리가 적은 새벽 KST 권장). PR 끝에 attribution 줄.
- [ ] **Step 4: 배포는 사용자 확인 후** — `world` 재배포와 머지는 사용자가 “배포해” 하면 `docs/deploy-checklist.md` “낚시 배포” 순서로 한다. 그 전에는 하지 않는다.
