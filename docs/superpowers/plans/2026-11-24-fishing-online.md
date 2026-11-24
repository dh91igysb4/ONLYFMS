# 펨타듀 밸리 온라인 1단계 — 같은 지역 친구 보이기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 낚시 세계에서 같은 지역에 있는 친구 캐릭터가 옷차림·걷기·낚시 자세와 아이디 이름표로 보이게 한다.

**Architecture:** 플랫폼 공통 모듈(`src/platform/world/`)이 Supabase Realtime 채널 `world:<gameId>:<areaId>`에 프레즌스로 참여하고 브로드캐스트로 위치를 주고받는다. 보내기 간격 결정·보간·정리는 순수 함수(`peers.ts`)로 두고, 채널 래퍼(`room.ts`)가 그것을 쓴다. 낚시 화면은 지역이 바뀔 때 방을 갈아타고, 프레임마다 받은 친구 목록을 `drawWorld`에 넘기며 이름표는 HTML로 캔버스 위에 띄운다.

**Tech Stack:** Vite + React + TypeScript, `@supabase/supabase-js` 2.118 Realtime(broadcast, presence), vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-11-24-fishing-online-design.md`

**Branch:** `feat/fishing-online` (`feat/home-valley` 위에서)

## Global Constraints

- 서버 판정·골드·세이브·`logic.version`·DB 마이그레이션·Edge Function 변경 없음. 실시간 값은 그리기에만 쓴다.
- `src/platform/world/*`는 게임 id로 분기하지 않는다(방 이름에 gameId 문자열만 들어간다).
- `peers.ts`는 순수(React·supabase·DOM import 없음).
- 채널: `world:<gameId>:<areaId>`, 공개 채널, 프레즌스 키 = 사용자 id, `broadcast.self = false`. 이벤트 이름 `pos`.
- 보내기: 방 인원 n(프레즌스, 나 포함) < 2면 보내지 않음. 멈춰 있으면 2500ms마다. 움직이면 `moveIntervalMs(n) = max(250, ceil(1000 × n² / 80))`. 상태(방향·act·옷차림) 변경은 즉시 한 번(단 `moveIntervalMs(n)`보다 자주 아님). 인원이 늘면 즉시 한 번.
- 받기: 순서가 뒤바뀐 메시지(`t`가 더 작거나 같음) 버림, 10000ms 소식 없음 또는 프레즌스에서 빠지면 지움, 내 메시지 무시.
- 숨김 게임(`manifest.hidden`)이면 관리자가 아닐 때 방에 들어가지 않는다.
- 연결 실패·끊김은 `console.warn`만. 혼자 하는 게임은 그대로.
- 화면 문구 한국어, 메뉴·이름표 색은 theme 토큰(캔버스 안은 낚시 예외).
- 커밋 `type: 내용`(한국어), 끝에 세션 attribution 줄. 푸시 전 `npm test && npm run typecheck && npm run build`.

## Review Focus

1. **지역 전환 직후**(페이드 중 방 갈아타기): 이전 지역 친구가 새 맵에 잠깐 그려지지 않는다. → Task 4 테스트 "지역을 옮기면 이전 방을 나가고 이전 친구 목록을 비운다"
2. **깨진·악의적 메시지**(필드 누락, 숫자 아님, 너무 긴 handle/outfit, 모르는 facing): 무시하고 그리기가 죽지 않는다. → Task 1 `parsePeerState` 테스트
3. **실시간 연결 실패**(`subscribe`가 CHANNEL_ERROR, `channel()`이 던짐): 낚시는 계속되고 친구만 안 보인다. → Task 2 테스트
4. **탭이 숨었다 돌아옴/오래 멈춘 친구**: 2.5초마다 오는 신호로 남아 있고, 10초 끊기면 사라진다. → Task 1 `prunePeers` 테스트
5. **이름표 위치**: 화면 밖 친구의 이름표는 숨기고, 배율·카메라가 바뀌어도 머리 위에 붙는다. → Task 4 `syncTags` 테스트

---

### Task 1: 순수 로직 `peers.ts` — 메시지 검증, 보내기 결정, 보간, 정리

**Files:**
- Create: `src/platform/world/peers.ts`
- Create: `src/platform/world/peers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Facing = 'up' | 'down' | 'left' | 'right'
  export type PeerAct = 'walk' | 'fish'
  export type PeerState = { id: string; handle: string; x: number; y: number; facing: Facing; moving: boolean; act: PeerAct; outfit: string; t: number }
  export const IDLE_SEND_MS = 2500
  export const PEER_TIMEOUT_MS = 10_000
  export const MAX_HANDLE = 32
  export const MAX_OUTFIT = 512
  export function moveIntervalMs(n: number): number
  export function parsePeerState(raw: unknown): PeerState | null
  export type SendClock = { lastAt: number; lastSig: string; lastN: number }
  export const newSendClock: () => SendClock      // lastAt -Infinity, lastSig '', lastN 0
  export function shouldSend(c: SendClock, now: number, moving: boolean, sig: string, n: number): boolean
  export function markSent(c: SendClock, now: number, sig: string, n: number): SendClock
  export type PeerEntry = { prev: { x: number; y: number }; cur: PeerState; recvAt: number; span: number }
  export type PeerBook = Map<string, PeerEntry>
  export function receivePeer(book: PeerBook, s: PeerState, now: number, selfId: string): void
  export function prunePeers(book: PeerBook, now: number, present: ReadonlySet<string>): void
  export type ShownPeer = { id: string; handle: string; x: number; y: number; facing: Facing; moving: boolean; act: PeerAct; outfit: string }
  export function peersAt(book: PeerBook, now: number): ShownPeer[]
  ```
  - `shouldSend`: n < 2 → false. n > lastN → true. sig ≠ lastSig이고 `now − lastAt ≥ moveIntervalMs(n)` → true. `now − lastAt ≥ (moving ? moveIntervalMs(n) : IDLE_SEND_MS)` → true. 그 밖 false.
  - `receivePeer`: `s.id === selfId`면 무시. 기존 항목이 있고 `s.t ≤ cur.t`면 무시. 새 항목은 `prev = cur 위치`, `span = 0`. 기존이면 `prev = 지금 보이는 위치(peersAt 식)`, `span = clamp(s.t − cur.t, 100, 1000)`, `recvAt = now`.
  - `peersAt`: `alpha = span === 0 ? 1 : clamp((now − recvAt) / span, 0, 1)`, 위치 = `prev + (cur − prev) × alpha`. 결과는 `y` 오름차순.
  - `parsePeerState`: 모든 필드 타입 검사, x·y 유한수, handle 1~`MAX_HANDLE`자, outfit ≤ `MAX_OUTFIT`자, facing·act는 정한 값만, t 유한수. 아니면 null.

- [ ] **Step 1: 실패하는 테스트 작성** (`peers.test.ts`)
  - `moveIntervalMs: 2→250, 3→250, 4→250, 5→313, 6→450`
  - `parsePeerState: 정상 → 같은 객체; facing 'north'·x NaN·handle '' 또는 33자·outfit 513자·act 'run'·필드 누락·null·문자열 → null`
  - `shouldSend: n=1이면 언제나 false`
  - `shouldSend: 새 시계 + n=2 → true (들어간 직후 한 번)`
  - `shouldSend: 멈춤, n=2, 마지막 보낸 뒤 2499ms → false, 2500ms → true`
  - `shouldSend: 움직임, n=6, 449ms → false, 450ms → true; n=2면 250ms → true`
  - `shouldSend: sig가 바뀌어도 moveIntervalMs 전이면 false, 지나면 true(멈춤 상태에서도)`
  - `shouldSend: n이 2→3으로 늘면 직전에 보냈어도 true`
  - `receivePeer: 자기 id 무시; t가 같거나 작은 메시지 무시`
  - `peersAt: 첫 메시지는 그 위치; 두 번째 메시지(t +400, x +40) 뒤 200ms → x +20, 400ms 이후 → x +40`
  - `prunePeers: recvAt 뒤 9999ms → 남음, 10000ms → 지움; present에 없으면 바로 지움`
  - `peersAt: y 오름차순`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/platform/world/peers.test.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현** — 위 시그니처, 순수 함수.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/platform/world/peers.test.ts && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 월드 온라인 순수 로직(메시지 검증·보내기 간격·보간·정리)"`

---

### Task 2: 채널 래퍼 `room.ts`

**Files:**
- Create: `src/platform/world/room.ts`
- Create: `src/platform/world/room.test.ts`

**Interfaces:**
- Consumes: Task 1 전부, `supabase`(`src/lib/supabase.ts`)
- Produces:
  ```ts
  export type WorldRoom = {
    /** 프레임마다 부른다. 보낼 때가 되면 브로드캐스트한다 */
    tick(now: number, me: Omit<PeerState, 't'>): void
    /** 지금 그릴 친구들(나 제외) */
    peers(now: number): ShownPeer[]
    /** 방 인원(나 포함, 프레즌스 기준). 연결 전 1 */
    count(): number
    leave(): void
  }
  export function joinWorldRoom(gameId: string, areaId: string, selfId: string): WorldRoom
  export const roomName = (gameId: string, areaId: string) => `world:${gameId}:${areaId}`
  ```
  - `supabase.channel(roomName(...), { config: { presence: { key: selfId }, broadcast: { self: false } } })`, `.on('broadcast', { event: 'pos' }, ({ payload }) => parsePeerState → receivePeer)`, `.on('presence', { event: 'sync' }, () => present = presenceState의 키 집합, prunePeers)`, `.subscribe(status => SUBSCRIBED면 channel.track({ id: selfId }), CHANNEL_ERROR·TIMED_OUT면 console.warn)`.
  - `tick`: `sig = facing|moving|act|outfit`. `shouldSend` 참이면 `channel.send({ type: 'broadcast', event: 'pos', payload: { ...me, t: now } })` 후 `markSent`. 보내기 전 `prunePeers(book, now, present)`도 한다.
  - `leave`: `supabase.removeChannel(channel)`. 두 번 불러도 안전.
  - `channel()`·`subscribe`·`send`가 던지면 잡아서 `console.warn`, 그 뒤 `tick`·`peers`는 아무것도 하지 않고 `peers`는 `[]`.

- [ ] **Step 1: 실패하는 테스트 작성** (`room.test.ts`, `../../lib/supabase.ts`를 가짜 채널 객체로 mock: `on`이 핸들러를 저장, `subscribe(cb)`가 cb 저장, `send`·`track`·`presenceState` spy, `removeChannel` spy)
  - `채널 이름 'world:fishing:village', presence key = selfId, broadcast self false`
  - `SUBSCRIBED → track({ id: selfId }) 1회`
  - `presence sync로 키 2개 → count() 2; tick 한 번 → send 1회, payload에 t = now와 me 필드`
  - `혼자(키 1개) → tick해도 send 없음`
  - `broadcast pos(다른 사람, 정상) → peers(now)에 1명; 깨진 payload → 무시; 내 id → 무시`
  - `presence sync에서 빠진 사람 → peers에서 사라짐`
  - `CHANNEL_ERROR → console.warn, 예외 없음`
  - `supabase.channel이 던짐 → joinWorldRoom은 던지지 않고 tick·peers·leave 모두 안전(peers [])`
  - `leave 두 번 → removeChannel 1회`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/platform/world/room.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/platform/world && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 월드 실시간 방(프레즌스·브로드캐스트) 래퍼"`

---

### Task 3: 장면에 친구 캐릭터 그리기

**Files:**
- Modify: `src/games/fishing/scene.ts` (`WorldScene`, `drawWorldLayer`, 새 `drawPeer`)
- Modify: `src/games/fishing/scene.test.ts`

**Interfaces:**
- Produces (`scene.ts`):
  ```ts
  export type ScenePeer = { pos: Vec; facing: Facing; moving: boolean; walkMs: number; act: 'walk' | 'fish'; outfit: Outfit }
  // WorldScene에 추가
  others?: ScenePeer[]
  ```
  - 깊이: `drawWorldLayer`의 `tall` 목록과 같은 방식으로, 친구마다 `key = pos.y`인 항목을 넣어 나무·탑과 함께 기준선 순으로 그린다. 내 캐릭터는 지금처럼 `feet` 기준. 같은 y면 친구가 먼저(내 캐릭터가 위).
  - 자세: `act === 'fish'`면 `player-cast<suffix>`, 아니면 `poseFor('idle', peer)`와 같은 규칙(걷기 프레임은 `walkMs`). 그림자·옷차림 합성(`playerSprites(outfit)`)은 `drawPlayer`와 같게. 찌·줄·HUD·안개 중심은 내 캐릭터 그대로.
  - 화면 밖(타일 범위 밖) 친구는 건너뛴다.

- [ ] **Step 1: 실패하는 테스트 작성** (`scene.test.ts`의 기존 가짜 컨텍스트·스프라이트 spy 방식을 따른다)
  - `others 없음 → 지금과 같은 그리기 호출(기존 스냅샷/검사 통과)`
  - `others 1명(화면 안) → 그 위치에 캐릭터 스프라이트 1번 더 그림(발 좌표 기준 px = round(x) − 8, py = round(y) − 24)`
  - `act 'fish' → 'player-cast…' 자세 이름으로 그림`
  - `화면 밖 친구 → 그리지 않음`
  - `친구 y가 내 y보다 크면 내 캐릭터 뒤가 아니라 앞(나중)에 그림; 작으면 먼저`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/scene.test.ts` / Expected: FAIL (새 테스트만)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 낚시 장면에 같은 지역 친구 캐릭터 그리기"`

---

### Task 4: 낚시 화면 연결과 이름표

**Files:**
- Create: `src/games/fishing/peerTags.ts`, `src/games/fishing/peerTags.test.ts`
- Modify: `src/games/fishing/Game.tsx`, `src/games/fishing/fishing.css`
- Modify: `src/games/fishing/Game.test.tsx`

**Interfaces:**
- Consumes: `joinWorldRoom`·`WorldRoom`(Task 2), `ShownPeer`(Task 1), `ScenePeer`·`others`(Task 3), `decodeOutfit`, `getWorld`(`src/games/index.ts`), `useAuth().profile`(`id`, `handle`, `is_admin`)
- Produces:
  ```ts
  // peerTags.ts (DOM, React 없음)
  export type Tag = { id: string; handle: string; x: number; y: number; visible: boolean } // x,y는 CSS px(프레임 기준)
  export function syncTags(container: HTMLElement, tags: Tag[]): void
  ```
  - `syncTags`: 아이디마다 자식 `<span class="fish-peer-tag" data-id>` 하나. 없으면 만들고, 목록에 없는 것은 지우고, `textContent = handle`, `style.transform = translate(x, y)`, `hidden = !visible`.
- Game.tsx 변경:
  - 방 참여: `profile?.id`와 `profile?.handle`이 있고 `!(getWorld(gameId)?.manifest.hidden && !profile.is_admin)`일 때, `rt.map.id`가 바뀔 때마다 이전 방 `leave()` 후 `joinWorldRoom(gameId, rt.map.id, profile.id)`. 언마운트 때 `leave()`. 방 참조는 `useRef<WorldRoom | null>`.
  - 프레임(`frame`)마다: `room.tick(now, { id, handle, x: pos.x, y: pos.y, facing, moving, act: 낚시 단계(charging·waiting·bite·fighting)면 'fish' 아니면 'walk', outfit: JSON.stringify(outfitOf(view)) })`. 지역 전환 페이드 중(`rt.trans`)에는 보내지 않고 `others`도 비운다.
  - `others`: `room.peers(now)`를 `ScenePeer`로 바꿔 `drawWorld`에 넘긴다. 옷차림 문자열 → `decodeOutfit`은 문자열별로 메모(`Map<string, Outfit>`). `walkMs`는 `moving`이면 `now`, 아니면 0.
  - 이름표: `.fish-frame` 안에 `<div className="fish-peer-tags" ref={tagsRef} aria-hidden="true">`. 프레임마다 `syncTags`, x = `(round(px) − cam.x) × scale`, y = `(round(py) − PLAYER_H − cam.y) × scale`, `visible` = 캔버스 안.
  - CSS: `.fish-peer-tags { position:absolute; inset:0; pointer-events:none; overflow:hidden }`, `.fish-peer-tag { position:absolute; left:0; top:0; transform-origin:… ; font-size:11px; padding:0 4px; border-radius:4px; background: var(--panel); color: var(--ink); white-space:nowrap; translate:-50% -100% }`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `peerTags.test.ts`: `태그 2개 → span 2개, 글자·transform 맞음`; `다시 1개 → 나머지 span 제거`; `visible false → hidden`; `같은 id 다시 → 같은 span 재사용`
  - `Game.test.tsx` (`../../platform/world/room.ts`를 mock, `joinWorldRoom`이 가짜 방을 돌려주고 호출 인자 기록):
    - `첫 로드 뒤 joinWorldRoom('fishing', 'village', 'u1') 1회`
    - `프레임이 돌면 tick이 me(id·handle·x·y·facing·act 'walk')로 불림`
    - `가짜 방 peers가 1명 → drawWorld 인자 others 길이 1, 이름표 span 1개(글자 = handle)`
    - `지역을 옮기면 이전 방 leave 1회, 새 지역으로 joinWorldRoom, 전환 중 drawWorld others는 빈 배열`
    - `숨김 게임 + 관리자 아님 → joinWorldRoom 호출 없음, 게임은 정상`
    - `언마운트 → leave`
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/games/fishing/peerTags.test.ts src/games/fishing/Game.test.tsx` / Expected: FAIL (새 테스트만)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/games/fishing && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 낚시 화면에서 같은 지역 친구 보이기(실시간 방·이름표)"`

---

### Task 5: 문서·체크리스트·전체 검증

**Files:**
- Modify: `CLAUDE.md`(폴더 규칙의 `src/platform/world/` 줄에 "실시간 방(`room.ts`, 채널 `world:<gameId>:<areaId>`)" 추가)
- Modify: `docs/deploy-checklist.md`(새 절 "펨타듀 밸리 온라인 1단계": DB·함수 배포 없음, Vercel만; 수동 확인: 두 계정을 두 브라우저로 같은 지역에 → 서로 보임·이름표·걷기 부드러움·낚시 자세; 지역 옮기면 사라짐; 탭 닫으면 10초 안에 사라짐; 배포 뒤 1주일 Supabase 대시보드 Realtime 메시지 수 확인, 월 200만 한도)

- [ ] **Step 1: 문서 수정**
- [ ] **Step 2: 전체 검증** — Run: `npm test && npm run typecheck && npm run build` / Expected: 모두 PASS
- [ ] **Step 3: 수동 확인(가능한 범위)** — 헤드리스 브라우저로 낚시 장면에 가짜 친구 2명을 넣어 그린 화면을 찍어 이름표·자세 확인. 실제 두 계정 확인은 Vercel 미리보기에서 사용자가 한다.
- [ ] **Step 4: 커밋** — `git commit -m "docs: 펨타듀 밸리 온라인 1단계 안내"`
