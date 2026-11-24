# 온라인 2단계-1 — 다른 지역 친구 위치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 지역에 있는 친구도 큰 지도(탭 인원 수·점)와 메인 미리보기(`접속 중 2명 · son 숲에서 낚시 중`)에서 보이게 한다.

**Architecture:** 게임 전체 프레즌스 채널 `world:<gameId>`를 여는 플랫폼 모듈(`presence.ts`)을 둔다. 낚시 화면은 상태를 올리고(지역·act가 바뀔 때, 움직이는 동안 10초에 한 번), 메인 화면은 듣기만 한다. 받은 목록은 지도 창과 메인 미리보기에 props로 넘기고, 지역 이름이 필요한 문구는 게임 쪽이 만든다.

**Tech Stack:** React + TypeScript, `@supabase/supabase-js` 2.118 Realtime presence, vitest

**Spec:** `docs/superpowers/specs/2026-11-24-fishing-online-2a-design.md`

**Branch:** `feat/fishing-online-2` (`feat/fishing-online` 위)

## Global Constraints
- 채널 `world:<gameId>`, 공개, 프레즌스 키 = 사용자 id. 1단계 지역 방(`world:<gameId>:<areaId>`)과 별개.
- 상태 `{ id, handle, area, act: 'walk' | 'fish', tx, ty }`. 갱신: 들어갈 때·지역 변경·act 변경 즉시, 움직이는 동안 칸이 바뀌었으면 10000ms에 한 번.
- 메인 화면은 `track`하지 않는다(듣기만). 나 자신은 목록에서 뺀다.
- 숨김 게임이면 관리자만, 탭이 숨으면 나간다, 연결 실패는 `console.warn`만.
- 플랫폼 코드는 게임 id로 분기하지 않는다. 지역 이름 문구는 게임 쪽(`src/games/fishing/`)이 만든다.
- 서버·DB·`logic.version` 변경 없음. 화면 문구 한국어, 색은 theme 토큰(캔버스·지도 그림 안은 낚시 예외).
- 커밋 `type: 내용`, 세션 attribution 줄. 푸시 전 `npm test && npm run typecheck && npm run build`.

## Review Focus
1. **깨진 프레즌스 상태**(필드 누락, 모르는 area·act, 너무 긴 handle, 숫자 아닌 칸): 목록에서 빠지고 지도·메인이 죽지 않는다. → Task 1 `parseOnlinePeer` 테스트
2. **같은 사람이 여러 탭**(프레즌스 키 하나에 상태 여러 개): 한 명으로 센다(마지막 상태). → Task 1 테스트
3. **잠긴 지역·모르는 지역에 있는 친구**: 탭 수는 세지만 잠긴 지역 지도에는 점을 그리지 않는다(잠긴 지역은 지도 그림이 없다). → Task 2 테스트
4. **메인을 열었다 바로 닫기**: 채널을 나간다(듣기만 하는 연결이 남지 않는다). → Task 3 테스트
5. **접속자가 많을 때 메인 문구**: 2명 넘으면 `외 n명`, 문구가 미리보기 폭을 넘지 않게 한 줄 말줄임. → Task 3 테스트

---

### Task 1: `presence.ts` — 게임 전체 프레즌스

**Files:**
- Create: `src/platform/world/presence.ts`, `src/platform/world/presence.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OnlinePeer = { id: string; handle: string; area: string; act: 'walk' | 'fish'; tx: number; ty: number }
  export const PRESENCE_MOVE_MS = 10_000
  export function parseOnlinePeer(raw: unknown): OnlinePeer | null   // handle 1~32자, area 1~32자 [a-z0-9-], tx·ty 0 이상 정수
  export function shouldTrack(prev: { s: OnlinePeer; at: number } | null, next: OnlinePeer, now: number): boolean
  export type WorldPresence = {
    update(me: OnlinePeer, now: number): void   // 듣기 전용이면 아무것도 안 함
    peers(): OnlinePeer[]                       // 나 제외, 아이디 가나다순
    onChange(cb: () => void): () => void
    leave(): void
  }
  export function joinWorldPresence(gameId: string, selfId: string, listenOnly: boolean): WorldPresence
  export const presenceName = (gameId: string) => `world:${gameId}`
  ```
  - `shouldTrack`: prev 없음 → true. area 또는 act가 다름 → true. tx·ty가 다르고 `now − prev.at ≥ PRESENCE_MOVE_MS` → true. 그 밖 false.
  - 채널: `supabase.channel(presenceName(gameId), { config: { presence: { key: selfId } } })`, `on('presence', { event: 'sync' })`에서 `presenceState()`의 키마다 마지막 항목을 `parseOnlinePeer`로 읽어 목록을 바꾸고 `onChange` 구독자를 부른다. `subscribe`의 SUBSCRIBED에서 대기 중인 상태가 있으면 `track`. CHANNEL_ERROR·TIMED_OUT·CLOSED면 구독 표시를 끄고 목록을 비운 뒤 구독자를 부른다.
  - `update`: 구독 전이면 마지막 상태만 저장했다가 SUBSCRIBED 때 보낸다. `shouldTrack`가 참이면 `track(me)`.
  - 실패는 1단계 `room.ts`처럼 던지지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`presence.test.ts`, `room.test.ts`의 가짜 채널 방식)
  - `parseOnlinePeer: 정상 → 같은 값; area 'Bad Area'·act 'run'·handle 33자·tx -1·tx 1.5·필드 누락·null → null`
  - `shouldTrack: prev 없음 true; area 바뀜 true; act 바뀜 true; 칸만 바뀜 9999ms false, 10000ms true; 칸도 그대로면 30000ms에도 false`
  - `채널 이름 'world:fishing', 프레즌스 키 selfId`
  - `구독 전 update → track 없음; SUBSCRIBED → 마지막 상태로 track 1회`
  - `듣기 전용이면 update·SUBSCRIBED 모두 track 없음`
  - `sync: 나 빼고 아이디 가나다순; 같은 키에 상태 2개면 마지막 것 하나; 깨진 상태는 빠짐; onChange 호출`
  - `CHANNEL_ERROR → peers() 빈 배열, onChange 호출, 이후 update해도 track 없음`
  - `channel()이 던져도 안전; leave 두 번 → removeChannel 1회`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/platform/world/presence.test.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/platform/world && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat: 월드 전체 프레즌스(다른 지역 친구 위치)`

---

### Task 2: 낚시 화면 — 상태 올리기와 지도 표시

**Files:**
- Modify: `src/games/fishing/Game.tsx`, `src/games/fishing/MapPanel.tsx`, `src/games/fishing/fishing.css`
- Modify: `src/games/fishing/Game.test.tsx`, `src/games/fishing/MapPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1 전부, 1단계 `stepOnline`·`canOnline`·`roomRef`·숨은 탭 처리
- Produces:
  - `MapPanelProps.online?: OnlinePeer[]` (기본 `[]`).
  - 탭 글자: 열린 지역 `"<이름> <물고기 표시>"` 뒤, 잠긴 지역 `"<이름> · 잠김"` 뒤에 친구가 있으면 ` · 👤n`이 아니라 ` · 친구 n` (이모지 금지, 화면 문구 한국어).
  - 열린 지역 지도(`OpenArea`)에 그 지역 친구마다 `<div class="fish-map-friend" style=pos(tx,ty)>` + 안에 `<span class="fish-map-friend-name">아이디</span>`, `role="img"`, `aria-label="<아이디> 위치"`.
- Game.tsx:
  - `presenceRef = useRef<WorldPresence | null>(null)`; `canOnline`이고 첫 서버 상태 뒤에 `joinWorldPresence(gameId, profile.id, false)` 한 번(지역과 무관), 숨은 탭·언마운트 때 `leave()` 후 null(다음 프레임에 다시 들어감).
  - `stepOnline`에서 프레임마다 `presence.update({ id, handle, area: rt.map.id, act, ...tileOf(pos) }, Date.now())`. 전환 중(`rt.trans`)에는 부르지 않는다.
  - `onlinePeers` React 상태: `presence.onChange`로 `setOnlinePeers(presence.peers())`. `MapPanel`에 `online={onlinePeers}`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `MapPanel.test.tsx`: `online에 river 친구 2명·잠긴 cave 1명 → '마을 강' 탭에 '친구 2', 동굴 탭에 '친구 1'`; `river 탭을 보면 'son 위치' 점 2개(이름 글자 포함)`; `cave(잠김) 탭에는 점 없음`; `online 없으면 '친구' 글자 없음`
  - `Game.test.tsx` (`../../platform/world/presence.ts` mock: 가짜 프레즌스가 update 호출 기록, peers/onChange 조절):
    - `첫 로드 뒤 joinWorldPresence('fishing','u1',false) 1회, 지역을 옮겨도 다시 들어가지 않음`
    - `프레임마다 update(me: area 'village', act 'walk', tx·ty = 내 칸)`
    - `지역 전환 중에는 update 없음`
    - `onChange로 친구 1명 → 지도 창을 열면 '친구 1'`
    - `탭이 숨으면 leave, 돌아오면 다시 join`; `언마운트 → leave`; `숨김 게임 + 관리자 아님 → join 없음`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/MapPanel.test.tsx src/games/fishing/Game.test.tsx` / Expected: FAIL (새 테스트만)
- [ ] **Step 3: 구현** — 점 CSS: `.fish-map-friend { position:absolute; width:10px; height:10px; border-radius:50%; transform:translate(-50%,-50%); background: var(--lime); box-shadow: 0 0 0 2px var(--panel); pointer-events:none }`, 이름표 `.fish-map-friend-name { position:absolute; left:50%; bottom:12px; translate:-50% 0; font-size:11px; padding:0 4px; border-radius:4px; background: var(--panel); color: var(--ink); white-space:nowrap }`.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat: 낚시 지도에 다른 지역 친구 수와 위치`

---

### Task 3: 메인 미리보기 — 접속 중 요약

**Files:**
- Modify: `src/games/ui.ts` (`WorldPreviewProps.online: OnlinePeer[]`)
- Modify: `src/games/fishing/preview.ts` (+ `onlineSummary`), `src/games/fishing/preview.test.ts`
- Modify: `src/games/fishing/Preview.tsx`, `src/games/fishing/Preview.test.tsx`
- Modify: `src/platform/home/HomePage.tsx`, `src/platform/home/HomePage.test.tsx`, `src/platform/home/home.css`

**Interfaces:**
- Consumes: Task 1 `joinWorldPresence(…, true)`, `OnlinePeer`
- Produces:
  ```ts
  // preview.ts
  export function onlineSummary(peers: OnlinePeer[]): string | null
  ```
  - 0명 → null. 사람마다 `<아이디> <지역 이름>` + 낚시 중이면 `에서 낚시 중` (모르는 지역 id면 지역 이름 없이 아이디만). 최대 2명을 `, `로 잇고, 넘으면 ` 외 n명`. 앞에 `접속 중 <전체 수>명 · `.
  - 예: `접속 중 1명 · son 숲에서 낚시 중`, `접속 중 3명 · kim 마을 강, son 숲에서 낚시 중 외 1명`.
  - `Preview`: `onlineSummary(online)`가 있으면 캔버스 위 왼쪽 위에 `<p class="fish-preview-online">` (한 줄, 넘치면 말줄임, `aria-live` 없음).
  - `HomePage`: 미리보기 게임이 있고 `canOnline`(profile id 있음, 숨김이면 관리자)일 때 `joinWorldPresence(gameId, profile.id, true)`, `onChange`로 목록 상태, 언마운트에 `leave`. `Preview`에 `online` 전달.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `preview.test.ts onlineSummary`: `[] → null`; `son(forest, fish) → '접속 중 1명 · son 숲에서 낚시 중'`; `kim(river, walk), son(forest, fish), zed(cave, walk) → '접속 중 3명 · kim 마을 강, son 숲에서 낚시 중 외 1명'`; `모르는 지역 → 아이디만`
  - `Preview.test.tsx`: `online 1명 → 요약 문구 보임`, `online [] → 문구 없음`
  - `HomePage.test.tsx` (`../world/presence.ts` mock): `joinWorldPresence('fishing','u1',true) 1회`; `onChange로 1명 → 가짜 미리보기의 online 길이 1`; `언마운트 → leave`; `숨김 게임 + 관리자 아님 → join 없음`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/preview.test.ts src/games/fishing/Preview.test.tsx src/platform/home` / Expected: FAIL
- [ ] **Step 3: 구현** — `.fish-preview-online` 대신 메인 쪽 CSS가 필요하면 `home.css`의 `.home-valley-online { position:absolute; left:8px; top:8px; right:8px; padding:2px 8px; border-radius:999px; background: var(--panel); color: var(--ink); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }`. 문구 요소는 `Preview`가 그리되 클래스는 이 하나로 맞춘다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games src/platform && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat: 메인 미리보기에 접속 중 친구 요약`

---

### Task 4: 문서·검증
- Modify: `CLAUDE.md`(`src/platform/world/` 줄에 `presence.ts` 채널 `world:<gameId>` 한 줄), `docs/deploy-checklist.md`(새 절: Vercel만; 두 계정 다른 지역 → 지도 탭 수·점, 메인 요약; 메인만 연 사람은 안 셈)
- [ ] **Step 1: 문서 수정**
- [ ] **Step 2: 전체 검증** — Run: `npm test && npm run typecheck && npm run build` / Expected: PASS
- [ ] **Step 3: 헤드리스로 지도 창·메인 미리보기에 가짜 친구를 넣어 찍어 확인**
- [ ] **Step 4: 커밋** — `docs: 온라인 2단계-1 안내`
