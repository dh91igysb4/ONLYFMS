# 1대1 레이싱 2단계(온라인 대전) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 친구 둘이 대전 탭에서 레이싱 대국을 만들어(판돈·Elo 포함) 실시간으로 함께 달리고 부딪히며, 결과를 서버가 판정한다.

**Architecture:** 3번 구조(각자 자기 차 권위 + 충돌 각자 처리, 설계 §4). 0단계 시험판(`spike/racer-collide`)에서 사용자가 지연 약 30ms에서 괜찮다고 판단했다. 대국·판돈·Elo는 기존 `duel` 함수를 쓰고 실시간 게임만 `report` 행동과 마감 처리를 따로 둔다. 두 브라우저는 Supabase Realtime 채널로 WebRTC 연결 정보를 주고받아 DataChannel로 20Hz 상태를 보내고, 연결이 안 되면 같은 채널 브로드캐스트 10Hz로 대신한다.

**Tech Stack:** TypeScript, React 18, Rapier 3D, Three.js, WebRTC DataChannel, Supabase Realtime, Deno(duel Edge Function), Vitest, `npm run fn:test`.

**Spec:** `docs/superpowers/specs/2026-11-28-duel-racer-design.md` (§4, §5.2, §6, §7). 1단계 계획: `docs/superpowers/plans/2026-11-28-duel-racer-p1.md`. 시험판 코드: 브랜치 `spike/racer-collide`의 `src/games/duel-racer/spike/duel.ts`(옮겨 올 충돌 공식의 원본).

## Global Constraints

- 플랫폼 코드는 manifest `duel.realtime`으로만 가른다. 게임 id 분기 금지(`CLAUDE.md`).
- `src/games/duel-racer/{manifest,logic,constants}.ts`는 Deno가 번들한다: three·Rapier·`physics/`·`render/`·`net/`·React import 금지, 상대 import에 `.ts`.
- 판정이 바뀌므로 `logic.version`을 2로 올린다. `duel` 함수를 다시 배포해야 서버 판정이 바뀐다(배포 체크리스트에 적는다).
- 판돈·Elo 정산은 `status` update만으로 기존 트리거가 한다. 지갑을 직접 건드리지 않는다.
- 끊김·이탈은 구분하지 않고 미완주(사용자 결정, 설계 §7). 양쪽 기록이 엇갈리거나 둘 다 미완주면 무효(판돈 환불).
- 경주 상태는 Supabase로 보내지 않는다(무료 한도 초당 100건, 낚시가 80건 사용). 대체 경로만 10Hz(초당 40건).
- 출발 시각 = 대국 시작 + `START_DELAY_SEC`(5초). 기록은 물리 틱 수(1/60초). 대국 화면은 서버 시각 기준 경과로 따라잡는다(프레임당 250ms 상한 없음, 설계 §6.3).
- 화면 문구 한국어. PC 키보드와 모바일 버튼 둘 다(1단계와 같은 화면).

| 상수 (`constants.ts`) | 값 | 근거 |
|---|---|---|
| `START_DELAY_SEC` | 5 | 설계 §6.3 |
| `REPORT_GRACE_SEC` | 60 | 설계 §7 |
| `MATCH_SECONDS` | `START_DELAY_SEC + RACE_SECONDS + REPORT_GRACE_SEC` (245) | manifest `turnSeconds` 하나뿐인 선택지 = 대국 마감 |
| `NET_HZ` | 20 | 설계 §6.5 |
| `NET_FALLBACK_HZ` | 10 | 설계 §6.2 |
| `GHOST_MARGIN` | 0.35 (m) | 시험판: 맞는 쪽도 접촉을 느끼게 |
| `GHOST_EXTRAP_MAX_MS` | 250 | 설계 §6.5 |
| `HIT_RESTITUTION` | 0.35 | 시험판 |
| `HIT_PUSH_OUT` | 0.04 (m/틱) | 시험판 |
| `SPIN_HIT_SPEED` | 5 (m/s) | 시험판 |
| `SPIN_KICK` | 3.2 (rad/s) | 시험판 |
| `RTC_CONNECT_TIMEOUT_MS` | 4000 | 이 안에 DataChannel이 안 열리면 대체 경로 |

## Review Focus

1. **한 사람이 출발 뒤 창을 닫거나 새로고침** — 남은 사람은 혼자 끝까지 달려 보고하고, 마감(`MATCH_SECONDS`) 뒤 `tick`으로 승리 처리된다. 새로고침한 사람이 다시 들어오면 이미 지난 시간만큼 따라잡은(혹은 끝난) 레이스를 본다. → Task 1(마감 처리)·Task 6(따라잡기) 테스트.
2. **두 브라우저의 로직 버전이 다름**(한쪽이 옛 화면 캐시) — 출발 전에 "새로고침해 주세요"를 띄우고 그 사람은 달리지 않는다. 서버는 기존 `voidIfVersionChanged`로 보고를 막는다. → Task 6 테스트.
3. **WebRTC가 끝내 안 열림**(회사·학교망, 핫스팟) — 4초 뒤 대체 경로로 넘어가 계속 달릴 수 있고, 화면에 "연결이 느려요" 표시. → Task 3 테스트.
4. **같은 보고를 두 번 보냄**(네트워크 재시도) — 두 번째는 거절되고 대국 상태는 그대로. → Task 2·Task 1 테스트.
5. **상대 상태가 끊김**(1초 이상 소식 없음) — 유령 차를 250ms까지만 외삽하고 멈춘 뒤 반투명으로 그리며, 그 동안은 충돌하지 않는다(보이지 않는 차에 부딪히지 않게). → Task 5 테스트.

---

### Task 1: duel 함수 — 실시간 대국 열기, `report`, 마감 처리, 무효 결과

**Files:**
- Modify: `src/games/types.ts` (`DuelLogic.result`의 `void`, `DuelLogic.report?`)
- Modify: `supabase/functions/duel/handler.ts`, `supabase/functions/duel/handler.test.ts`
- Modify: `src/platform/duel/DuelHomePage.tsx`, `src/platform/duel/DuelHomePage.test.tsx` (실시간 게임도 대국 만들기 목록에)
- Modify: `src/test-fixtures/duel.ts` (`realtimeDuelOf`의 로직을 테스트용 보고 로직으로: 상태 `[number|null|undefined, number|null|undefined]`, `report(s, seat, {my})`는 이미 보고했으면 `{error:'already_reported'}`, 둘 다 보고하면 끝 — 둘 다 null이면 `void`, 아니면 작은 값(null은 무한대) 승, `payload.mismatch === true`면 `void`. `reportTimeout` → `{ my: null }`)

**Interfaces:**
- Produces:
  - `DuelLogic.result(state)`의 반환에 `void?: true` 추가 — `{ over: true; winner: null; void: true }`면 핸들러가 `voidMatch`(판돈 환불, Elo 없음).
  - `DuelLogic.report?(state, seat, payload): { state } | { error }` — 실시간 게임만. 차례·`action_no` 검사 없이 받는다.
  - `DuelLogic.reportTimeout?(state): unknown` — 마감 때 아직 보고하지 않은 좌석마다 이 값으로 `report`를 대신 부른다.
  - 요청 `{ action: 'report', match_id, payload }` → 200 `DuelView` / 409 `already_reported`(로직의 error 코드 그대로) / 409 `not_realtime`.

- [ ] **Step 1: 실패하는 Deno 시험 작성** (`handler.test.ts`, 기존 `realtime_game_create_409_until_phase_2`는 지운다)

```ts
t('realtime_create_and_join_starts_with_match_deadline', async () => { /* 픽스처 realtime-duel: create→join→status active, turn_seconds === MATCH_SECONDS, turn_deadline = started + MATCH_SECONDS */ })
t('realtime_report_from_either_seat_in_any_order', async () => { /* 좌석1 먼저 report 200, 좌석0 report 200 → finished, winner = 짧은 기록 */ })
t('realtime_report_twice_409', async () => { /* 같은 좌석 두 번째 report → 409 already_reported, action_no 그대로 */ })
t('realtime_mismatched_reports_void_and_refund', async () => { /* 판돈 500으로 시작, 엇갈린 기록 → status void, 두 사람 지갑 원래대로 */ })
t('realtime_deadline_marks_unreported_as_dnf', async () => { /* 좌석0만 보고, 시계를 MATCH_SECONDS 뒤로 → tick → finished, winner 0 */ })
t('realtime_nobody_reports_void', async () => { /* 아무도 보고 안 함, 마감 뒤 tick → void */ })
t('report_on_turn_based_game_409_not_realtime', async () => { /* 요트 대국에 report → 409 not_realtime */ })
t('move_on_realtime_game_409', async () => { /* 실시간 대국에 move → 409 not_your_turn 또는 invalid_action (move 경로는 쓰지 않는다) */ })
```

- [ ] **Step 2: 실패 확인** — `npm run fn:test` → 새 시험 FAIL
- [ ] **Step 3: 구현**
  - `create`의 `realtime_unsupported` 막기를 지운다.
  - `route`에 `case 'report'`: `loadMember` → `active` 아니면 `notActive` → 로직 버전 검사(`voidIfVersionChanged`) → `logic.report` 없으면 409 `not_realtime` → 마감이 지났으면 먼저 실시간 마감 처리(아래) 후 409 `finished`/`stale` → `report` 적용, `recordMove(auto=false)`, `action_no += 1`, `result` 확인(`void`면 `voidMatch`, `over`면 `finish`).
  - 실시간 마감 처리 `runRealtimeDeadline(m, logic, now)`: `runTimeouts` 대신 `manifest.duel.realtime`이 있으면 이것을 부른다. 아직 보고하지 않은 좌석마다 `logic.report(state, seat, logic.reportTimeout(state))`, `recordMove(auto=true)`, 그다음 `result`. 결과가 끝이 아니면(로직 오류) `voidMatch`.
  - `tick`·`move`·`report`의 마감 분기에서 실시간이면 `runRealtimeDeadline`.
  - `DuelHomePage`: `creatable`에서 실시간 제외를 지운다(혼자 연습 패널은 그대로).
- [ ] **Step 4: 통과 확인** — `npm run fn:test` → 모두 ok, `npx vitest run src/platform/duel src/games/registry.test.ts` → PASS
- [ ] **Step 5: 커밋** — `feat(duel): 실시간 대국 열기와 report·마감 처리`

---

### Task 2: 레이싱 대전 로직(보고 판정)

**Files:**
- Modify: `src/games/duel-racer/logic.ts`, `logic.test.ts`, `constants.ts`, `manifest.ts`

**Interfaces:**
- Consumes: `DuelLogic.report?`, `reportTimeout?`, `result().void`(Task 1)
- Produces:
  - `RacerState = { course: string; reports: [RacerReport | null, RacerReport | null] }`
  - `RacerReport = { my: number | null; opp: number | null }` — `my`: 내 완주 틱(미완주 null), `opp`: 상대가 DataChannel로 알려 준 상대 완주 틱(모르면 null).
  - `logic.version = 2`. manifest `turnSeconds: { choices: [MATCH_SECONDS], default: MATCH_SECONDS }`, `realtime: { raceSeconds: RACE_SECONDS, startDelaySec: START_DELAY_SEC }`(`src/games/types.ts`의 `realtime` 타입에 `startDelaySec: number`도 이 태스크에서 더한다).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('report accepts ticks in (0, RACE_SECONDS*TICK_HZ] or null', () => { /* 0, -1, 1.5, RACE_SECONDS*60+1 → error 'bad_report' */ })
test('second report from the same seat is refused', () => { /* error 'already_reported' */ })
test('shorter time wins when both agree', () => { /* r0 {my:4300, opp:4500}, r1 {my:4500, opp:4300} → { over:true, winner:0, scores:[4300,4500] } */ })
test('equal times draw', () => {})
test('a finisher beats a DNF', () => { /* r0 {my:4300, opp:null}, r1 {my:null, opp:4300} → winner 0 */ })
test('cross-check mismatch voids', () => { /* r0.my 4300, r1.opp 4400 → { over:true, winner:null, void:true } */ })
test('unknown opp (null) skips the cross-check', () => {})
test('both DNF voids', () => {})
test('reportTimeout is a DNF with unknown opp', () => { expect(logic.reportTimeout!(s)).toEqual({ my: null, opp: null }) })
test('result is not over until both seats reported', () => {})
test('manifest turnSeconds is the single MATCH_SECONDS choice and realtime.startDelaySec is START_DELAY_SEC', () => {})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/games/duel-racer/logic.test.ts` → FAIL
- [ ] **Step 3: 구현** — 위 시그니처. `scores`는 `[my0 ?? 0, my1 ?? 0]`.
- [ ] **Step 4: 통과 확인** → PASS, `npm run fn:test`도 PASS(픽스처 대신 실제 로직으로도 Task 1 시험이 돈다면)
- [ ] **Step 5: 커밋** — `feat(duel-racer): 보고 판정 로직(v2)`

---

### Task 3: 플랫폼 실시간 연결(`src/platform/duel/realtime/`)

**Files:**
- Create: `src/platform/duel/realtime/peer.ts`, `peer.test.ts`

**Interfaces:**
- Produces:
  - `type RealtimeLink = { send(data: ArrayBuffer): void; onMessage(cb: (data: ArrayBuffer) => void): () => void; status: () => 'connecting' | 'direct' | 'relay' | 'closed'; onStatus(cb): () => void; close(): void }`
  - `openLink(opts: { matchId: string; mySeat: 0 | 1; channel: ChannelLike; rtc?: () => RTCPeerConnectionLike; now?: () => number }): RealtimeLink`
  - `ChannelLike`(Supabase 채널의 쓰는 부분만: `send({type:'broadcast', event, payload})`, `on('broadcast', {event}, cb)`, `subscribe(cb)`, `unsubscribe()`), `RTCPeerConnectionLike`(쓰는 메서드만) — 테스트에서 가짜를 넣는다.
- 규칙: 채널 이름 `duel:<matchId>`. 좌석 0이 offer를 만든다. ICE는 `stun:stun.l.google.com:19302`. DataChannel `{ ordered: false, maxRetransmits: 0 }`. `RTC_CONNECT_TIMEOUT_MS` 안에 열리지 않으면 상태 `relay`로 바꾸고 `send`는 브로드캐스트(이벤트 `s`, base64)로, 받는 쪽은 같은 `onMessage`로 넘긴다. 대체 경로의 보내기 간격 제한(10Hz)은 이 모듈이 한다(초과 호출은 마지막 것만 남겨 다음 슬롯에 보냄).

- [ ] **Step 1: 실패하는 테스트**(가짜 채널 둘을 서로 잇고, 가짜 RTC 둘을 서로 잇는다)

```ts
test('seat 0 offers, seat 1 answers, both reach direct and exchange bytes', async () => {})
test('falls back to relay after RTC_CONNECT_TIMEOUT_MS and still delivers', async () => { /* 가짜 RTC가 열리지 않음 → 4000ms 뒤 status relay, send→상대 onMessage */ })
test('relay sends at most NET_FALLBACK_HZ, keeping the latest packet', async () => {})
test('close unsubscribes the channel and closes the peer', () => {})
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 위 규칙. 실제 채널은 호출하는 쪽(Task 4)이 `supabase.channel('duel:'+id)`로 만들어 넘긴다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat(duel): 실시간 대국 연결(WebRTC + 대체 경로)`

---

### Task 4: 대국 화면에서 실시간 게임 띄우기

**Files:**
- Modify: `src/games/ui.ts` (`RealtimeGameProps`에 `'match'`)
- Modify: `src/platform/duel/DuelMatchPage.tsx`, `DuelMatchPage.test.tsx`

**Interfaces:**
- Consumes: `openLink`(Task 3), `useDuelMatch`(기존, `act`는 쓰지 않음)
- Produces:

```ts
export type RealtimeGameProps =
  | { gameId: string; mode: 'practice'; onExit(): void }
  | {
      gameId: string
      mode: 'match'
      onExit(): void
      matchId: string
      mySeat: 0 | 1
      names: [string, string]
      /** 출발 시각(서버 시각 ms) */
      startAt: number
      /** 서버 시각 지금(ms) — src/lib/serverTime.ts now() */
      serverNow(): number
      link: RealtimeLink
      /** 서버 판정이 끝났으면 결과(화면은 이것으로 결과를 그린다) */
      result: { winner: 0 | 1 | null; void: boolean; scores: [number, number] | null } | null
      report(r: unknown): void
    }
```

- 규칙: `startAt = Date.parse(turn_deadline) - turn_seconds*1000 + manifest.duel.realtime.startDelaySec*1000`(Task 2가 manifest에 넣은 값). `report`는 `duel({action:'report', match_id, payload})`을 부르고 응답 view로 화면을 갱신한다(`useDuelMatch`에 `report(payload)` 추가, 기존 `act`처럼 늦은 응답 무시 규칙 유지).
- 대국이 `active`이고 내가 참가자일 때만 링크를 연다. 언마운트·대국 종료 때 `link.close()`.

- [ ] **Step 1: 실패하는 테스트**(픽스처 `realtime-duel` + 가짜 실시간 화면 + `openLink` mock)

```ts
test('active realtime match mounts the realtime component in match mode with startAt from the deadline', () => {})
test('report() calls duel report and the finished view reaches the component as result', async () => {})
test('void match passes result.void', () => {})
test('spectators and waiting matches do not open a link', () => {})
test('unmount closes the link', () => {})
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → `npx vitest run src/platform/duel` PASS
- [ ] **Step 5: 커밋** — `feat(duel): 대국 화면에 실시간 게임 연결`

---

### Task 5: 상대 차 — 패킷, 유령 몸체, 충돌

**Files:**
- Create: `src/games/duel-racer/net/codec.ts`, `codec.test.ts`
- Create: `src/games/duel-racer/physics/opponent.ts`, `opponent.test.ts`
- Modify: `src/games/duel-racer/constants.ts`(위 표의 상수)

**Interfaces:**
- Produces:
  - 패킷: `type StatePacket = { kind: 'state'; tick: number; pos: Vec3; quat: Quat; vel: Vec3; nitro: boolean }`, `{ kind: 'hello'; version: number }`, `{ kind: 'finish'; ticks: number | null }`. `encode(p): ArrayBuffer`, `decode(b: ArrayBuffer): Packet | null`(모르는 형식·길이면 null). 상태 패킷은 Float32 13개 + 틱 Uint32 + 플래그 1바이트 = 57바이트 이하.
  - `createOpponent(pw: PhysWorld): Opponent` — 센서 운동학 몸체, 크기 `CAR_HALF + GHOST_MARGIN`.
  - `receiveState(o: Opponent, p: StatePacket, atTick: number): void`
  - `placeOpponent(o: Opponent, nowTick: number): { pose: Pose; fresh: boolean } | null` — 받은 상태를 `(nowTick - p.tick + 1)`틱만큼(시험판에서 찾은 한 틱 보정) 속도로 외삽, 최대 `GHOST_EXTRAP_MAX_MS`. 마지막 소식이 1초보다 오래면 `fresh: false`(그리기 반투명, 충돌 없음). `setNextKinematicTranslation/Rotation`.
  - `resolveContact(o: Opponent, car: Car, tick: number): 'none' | 'touch' | 'hit' | 'spin'` — 시험판 `resolve`와 같은 공식: 겹치고 다가오면 `j = -(1+HIT_RESTITUTION)/2·m·v_rel·n`을 내 차에만, 매 틱 `HIT_PUSH_OUT` 밀어내기, 옆면(|앞·n| < 0.5)을 `SPIN_HIT_SPEED` 넘게 맞으면 yaw에 `SPIN_KICK`. `fresh: false`면 'none'.

- [ ] **Step 1: 실패하는 테스트**

```ts
// codec.test.ts
test('state packet round-trips within float32 precision and is ≤ 57 bytes', () => {})
test('hello and finish round-trip; finish null means DNF', () => {})
test('garbage or short buffers decode to null', () => {})
// opponent.test.ts (flatCourse, 실제 Rapier)
test('a faster opponent rear-ending me pushes me forward (equal-mass impulse)', () => {})
test('a side hit above SPIN_HIT_SPEED spins me; a slow side touch does not', () => {})
test('extrapolation adds one tick and caps at GHOST_EXTRAP_MAX_MS', () => {})
test('stale opponent (>1s) is not fresh and never collides', () => {})
test('no contact when apart', () => {})
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 시험판 `spike/duel.ts`의 `placeGhost`·`resolve`를 이 시그니처로 옮긴다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat(duel-racer): 상대 차 패킷·유령 몸체·충돌`

---

### Task 6: 레이싱 대국 화면

**Files:**
- Create: `src/games/duel-racer/match.ts`, `match.test.ts`
- Modify: `src/games/duel-racer/RacerGame.tsx`, `RacerGame.test.tsx`, `render/scene.ts`(상대 차·이름표, 시험판의 `setGhost` + 반투명)

**Interfaces:**
- Consumes: `RealtimeGameProps` `'match'`(Task 4), codec·opponent(Task 5), `createRace`/`advance`/`snapshot`(1단계)
- Produces:
  - `createMatch(R, props): MatchSession`, `stepMatch(s: MatchSession, serverNowMs: number, controls: Controls): void` — 목표 틱 = `floor((serverNow - startAt) / (1000/TICK_HZ))`(출발 전은 카운트다운), 지금 틱이 모자라면 그만큼 한 번에 돌린다(프레임 상한 없음). 틱마다: 받은 패킷 반영 → `placeOpponent` → `advance` 1틱 → `resolveContact`. `NET_HZ`마다 내 상태 전송.
  - 도착하면 `finish` 패킷을 보내고, 상대 `finish`를 받거나 내가 도착한 지 `REPORT_GRACE_SEC`의 절반이 지나면 `report({ my, opp })`를 한 번만 부른다.
  - 출발 전 `hello`로 `logic.version`을 주고받아 다르면 상태 `version_mismatch`(달리지 않음).
- 화면: 1단계 HUD + 상대 이름표, 순위(진행도 비교, 그리기 전용), 연결 상태 "연결이 느려요"(relay), 출발 전 "상대 기다리는 중", 결과 화면은 `props.result`(서버 판정)로 승패·두 기록·판돈은 플랫폼이 그린다. 연습 모드는 그대로(250ms 상한 유지).

- [ ] **Step 1: 실패하는 테스트**

```ts
// match.test.ts (가짜 링크 둘을 서로 잇고 실제 Rapier로 두 세션)
test('countdown until startAt, then both cars run from the same tick', () => {})
test('a 30 s gap catches up to the server clock in one step', () => {})
test('each side receives the other at NET_HZ and places the opponent', () => {})
test('finishing sends finish and reports once with the opponent time', () => {})
test('opponent never finishing → report after half the grace with opp null', () => {})
test('version mismatch in hello stops the race before the start', () => {})
// RacerGame.test.tsx (match 모드, 세션 mock)
test('shows waiting, countdown, opponent name and rank', () => {})
test('relay link shows 연결이 느려요', () => {})
test('server result shows win/lose and both times; void shows 무효', () => {})
test('version mismatch shows 새로고침 안내', () => {})
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run src/games/duel-racer src/platform/duel` PASS
- [ ] **Step 5: 커밋** — `feat(duel-racer): 온라인 대국 화면`

---

### Task 7: 마무리

- [ ] **Step 1:** `npm test && npm run typecheck && npm run build && npm run fn:test` → 모두 PASS. 메인 번들에 Rapier 코드 없음(`grep -c RigidBodyDesc dist/assets/index-*.js` → 0).
- [ ] **Step 2:** `docs/deploy-checklist.md`에 "레이싱 2단계: `duel` 함수 재배포(`npx supabase@2 functions deploy duel --no-verify-jwt`), 숨김 상태로 관리자 둘이 실제 대국" 추가. `CLAUDE.md` 실시간 대전 단락에서 "2단계 전까지 create 409" 문장을 `report`·마감 처리 설명으로 바꾼다.
- [ ] **Step 3:** 설계 문서 §9 단계 0에 시험판 결과(지연 약 30ms에서 사용자 확인, 충돌 상수, 한 틱 보정)를 적는다.
- [ ] **Step 4:** 수동 확인 — 관리자 계정 둘(PC + 폰)로 미리보기에서 대국 만들기 → 참가 → 함께 달리기·부딪히기 → 결과·판돈.
- [ ] **Step 5:** 커밋 `docs: 레이싱 2단계 배포·규칙`
