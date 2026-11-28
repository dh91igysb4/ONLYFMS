# 낚시 데일리 과제·업적 설계 (2026-11-28)

목록: `docs/superpowers/specs/2026-11-28-fishing-daily-achievements-list.md`(프로젝트 문서 `specs/2026-11-28-fishing-daily-achievements-list.md`). 이 문서는 그 목록을 코드로 옮기는 규칙이다.

## 1. 결정 사항
- 데일리는 사람마다 다르게, 하루 3개(쉬움·보통·어려움). 보상은 **어분·미끼·재료만**(골드 없음).
- 업적은 단계형 34개 + 숨은 업적 8개. 보상은 골드(JWD)·업적 점수, 금 단계(단일·숨은 업적은 달성 때) 칭호.
- "함께" 분야는 넣지 않는다(서버가 셀 수 없음).
- 칭호는 고른 하나를 이름표 아래와 프로필에 보인다.
- 기존 지역 도전과제 10개(`CHALLENGES`)는 그대로 둔다. 화면에서 이름을 "지역 과제"로 바꾼다.
- 로직 버전 30 → 31. 세이브에 `stats`·`daily`·`achv`를 더한다. 업적 골드 합계 약 213만.

## 2. 파일
| 파일 | 하는 일 |
|---|---|
| `src/games/fishing/goalEvents.ts` | 행동 전후 상태·행동·결과에서 "사건" 목록을 뽑는다(잡기·팔기·어분·캐기·순간이동·쓰레기통·포션·재료·연구 투척). 판정 코드는 기존 행동 함수를 건드리지 않고 이 사건만 본다 |
| `src/games/fishing/stats.ts` | `Stats` 형식, 사건으로 갱신, 옛 세이브 소급(migrate) |
| `src/games/fishing/daily.ts` | 후보 표, 뽑기(`ensureDaily`), 진행·완료·보상 지급, 리롤, 주간 |
| `src/games/fishing/achievements.ts` | 업적 표(단계·골드·점수·칭호), 진행값 계산, 숨은 업적 판정, 새 단계 지급 |
| `src/games/fishing/GoalsPanel.tsx` | 화면: 데일리 탭·업적 탭·칭호 고르기 |
| 각 `*.test.ts` | 아래 §8 |

`logic.ts`에서 바뀌는 곳은 `apply` 감싸기, `migrate`, `View`, `records`, `avatar`, 행동 3개(`dailyOpen`·`dailyReroll`·`setTitle`)뿐이다.

## 3. 세이브(v31)
```ts
type Stats = {
  catches: number            // 총 포획(자동 어분으로 간 것 포함)
  perfects: number
  perfectRun: number         // 지금 연속 퍼펙트(퍼펙트 아닌 포획·놓침이면 0)
  perfectBest: number
  bySpot: Record<string, number>   // 'area:spot' → 마릿수
  big: string[]              // 크기 상위 10%(백분위 ≥ 0.9)로 잡아 본 어종
  max: string[]              // 상위 1%(≥ 0.99)
  tiny: string[]             // 하위 1%(≤ 0.01)
  seasons: Season[]          // 잡아 본 계절
  day: { day: string; catches: number; income: number; sold: number; mythics: number }  // 한국 시간 하루
  cleanDays: number          // 감쇠 없이 150마리를 판 날 수
  teleports: number; trash: number; gathers: number; potions: number
  researchCatches: number    // 연구 투척으로 잡은 대상(origin recatch)
  legendPerfect: string[]    // 퍼펙트로 잡은 전설·신화 id
}
type DailyTask = {
  id: string                 // 후보 id(d-any 등)
  tier: 'easy' | 'normal' | 'hard'
  target: number
  progress: number
  done: boolean
  // 후보별 인자: 지역·자리·어종, 서로 다른 종·지역 집계
  area?: AreaId; spot?: string; species?: string
  seen?: string[]; perArea?: Record<string, number>
  reward: Reward             // 뽑을 때 진행 단계로 정해 저장
}
type Reward = { meal?: number; baits?: Partial<Record<BaitKind, number>>; mats?: Partial<Record<MatArea, number>>; isle?: Partial<Mats> }
type Daily = {
  day: string                // 'YYYY-MM-DD'(KST). '' = 아직 없음
  tasks: DailyTask[]         // 0 또는 3개
  rerolled: boolean
  allDone: boolean           // 셋 다 완료 보너스를 받았나
  week: { start: string; days: number; claimed: boolean }   // start = 그 주 월요일(KST)
}
type Achv = { tiers: Record<string, number>; title: string | null }  // tiers: 업적 id → 받은 단계(1~3, 숨은·단일은 1)
```

## 4. 처리 순서(`apply` 감싸기)
1. `ensureDaily(state, now, rng)`: `daily.day`가 오늘(KST)이 아니면 새로 3개를 뽑는다. 주가 바뀌었으면 `week`를 새로 시작한다.
2. 기존 `applyAction`. 오류면 그대로 돌려준다(아무것도 저장 안 함).
3. `goalEvents(prev, next, action, result)` → 사건 목록.
4. `stats` 갱신 → 데일리 진행 갱신(완료되면 그 자리에서 보상을 세이브에 더한다) → 숨은 업적 판정.
5. 업적 단계 평가: 새로 넘은 단계마다 골드를 더하고 `tiers`를 올린다. 골드는 행동의 `gold`에 합쳐 한 번에 장부로 간다(world 핸들러 그대로, reason `world`).
6. 기존 `grantEarned`(업적 옷).
7. `result`에 `goals: { daily: 완료한 과제 id[], rewards: Reward[], achv: { id, tier }[], gold }`를 덧붙인다. 화면이 알림을 띄운다.

데일리 뽑기는 행동이 있어야 일어난다. 화면은 낚시 화면을 열 때와 과제 창을 열 때 `{ type: 'dailyOpen' }`을 보낸다(바뀐 게 없으면 아무것도 하지 않는 행동).

### 사건(`goalEvents`)
| 사건 | 언제 | 내용 |
|---|---|---|
| catch | `resolve` 결과에 잡힌 물고기 | 어종·크기·퍼펙트·지역·자리(행동 전 `pending`), 던질 때 조건(밤·비·계절), 연구 투척 여부, 포션 켜짐 |
| miss | `resolve`로 놓침 | 퍼펙트 연속 끊기 |
| sell | `sell` 성공 | 마릿수·수입·그날 몇 번째부터였는지 |
| meal | 어분 개수가 늘었을 때(`grind`·자동 어분) | 늘어난 양 |
| gather | `gather` 성공 | 재료 종류 |
| teleport · trash · potion · extract · researchCast | 각 행동 성공 | 횟수·양 |

## 5. 데일리
### 진행 단계와 N
- 진행 단계(보상용): P0 허가증 없음, P1 허가증 있음, P2 첫 신화 전시(`stageB`). 뽑을 때 정한다.
- N: 목록의 "초반 → 후반"을 낚싯대 단계 1→6에 선형으로 나누고 반올림한다.
- `d-income` 목표 = `INCOME_REF[낚싯대] × 0.5`, 100 단위 반올림. `INCOME_REF`는 상수표 `{1: 12600, 2: 21500, 3: 55300, 4: 90200, 5: 141300, 6: 161300}`이고, `econSim.bestSpot`과 ±5% 안인지 테스트로 지킨다.

### 뽑기
- 난이도마다 그 사람에게 가능한 후보(목록의 "뽑히는 조건")에서 `rng`로 하나씩 뽑는다. 같은 날 같은 id는 두 번 나오지 않는다.
- `d-area`·`d-deep`·`d-tide`: 연 지역에서 고른다. `d-species`: 오늘 계절에 나오고 그 사람 낚싯대로 잡을 수 있는 흔함·드묾 중에서(시간·날씨 조건은 하루 안에 온다고 보고 허용). `d-variety`: 그 사람 낚싯대로 N종 이상 나오는 자리.
- `d-rain`: KST 하루는 게임 날 60일이라 비가 사실상 늘 온다. 그래도 그날 게임 날 60개 중 비 오는 날이 하나도 없으면 뽑지 않는다(`weatherOf`로 확인).
- 리롤(`{ type: 'dailyReroll', index }`): 하루 1번, 끝나지 않은 과제만. 같은 난이도에서 그날 나온 적 없는 후보로 바꾸고 진행은 0.

### 진행 판정
| id | 세는 사건 |
|---|---|
| d-any / d-area / d-tide / d-deep | catch(지역·자리 맞으면) |
| d-species | catch(그 어종) |
| d-perfect / d-perfect-rare | catch 퍼펙트(드묾 이상) |
| d-perfect-run | 오늘 안의 연속 퍼펙트 최고값(miss·일반 포획에서 끊김) |
| d-uncommon / d-rare | catch 희귀도 |
| d-big / d-pier | catch 크기 백분위(≥ 0.7 / 부두 ≥ 0.5) |
| d-variety | catch 그 자리 서로 다른 어종(`seen`) |
| d-night / d-rain | catch 던질 때 밤 / 비 |
| d-two-areas | catch 지역별 수(`perArea`), 5마리 이상인 지역 수 |
| d-sell / d-income | sell 마릿수 / 수입 |
| d-grind | meal 늘어난 양(자동 어분 포함) |
| d-gather / d-extract / d-research | gather 횟수 / extract로 생긴 재료 수 / researchCast 횟수 |
| d-potion | catch 중 포션이 켜져 있던 것 |

### 보상 지급
- 완료 순간 그 과제의 `reward`를 세이브에 더한다. 셋 다 완료되면 완료 보너스(단계별 표), 주간 5일째에 주간 보너스.
- 어분 → `econ.meal`, 미끼 → `econ.baits`, 지역 재료 → `gallery.mats`(상한 9999), 섬 재료 → `isle.mats`(상한 999). 상한을 넘는 만큼은 버리고 실제로 받은 양을 결과에 넣는다. 섬이 없으면 섬 재료 대신 목록 표의 어분.
- 보상 표는 목록 문서 §0 그대로.

## 6. 업적
### 표(`ACHIEVEMENTS`)
```ts
type AchvDef = {
  id: string; cat: 'collect' | 'skill' | 'record' | 'explore' | 'economy' | 'isle' | 'gallery' | 'daily' | 'hidden'
  name: string; unit: string
  tiers: readonly number[]        // 기준값(단일·숨은은 [1])
  gold: readonly number[]         // 단계별 골드
  score: readonly number[]        // 단계별 점수: 동 10·은 25·금 50, 단일 30, 숨은 40
  title: string                   // 마지막 단계에서 얻는 칭호
  value?: (s: State) => number    // 진행값(숨은 업적은 없음: 사건으로 바로 1)
}
```
값은 목록 문서 §2 그대로. 숨은 업적 골드는 모두 20,000.

### 진행값(대부분 세이브에 이미 있음)
| 업적 | 값 |
|---|---|
| 도감·지역 도감·희귀 전부·전설·신화 | `dex`·`legends` |
| 총 포획·퍼펙트·퍼펙트 연속·전설 퍼펙트 | `stats` |
| 대물·최대 크기 | `stats.big`·`max` 길이 |
| 하루 포획 | 지금까지의 하루 최고(`stats.day.catches`의 최대를 `stats`에 함께 저장) |
| 지역 열기 | `areas` 중 낚시 지역 수 |
| 네 계절 | `stats.seasons` 길이 = 4 |
| 갯골·얼음 구멍·심해 | `stats.bySpot` |
| 누적 판매 수입 | `totalEarned` |
| 감쇠 없이 150마리 | `stats.cleanDays` |
| 장비 | 낚싯대 단계·가방·신발·찌 보유로 단계 1·2·3 |
| 연구 재포획 | `stats.researchCatches` |
| 섬 | `isle.cleared`·`house`·`deco` 길이·`placed` 길이·`stats.gathers` |
| 전시관 | `gallery.exhibits`·`expansions`·완성 테마 수·시설 수·`stats.potions` |
| 데일리 | `daily` 누적(완료한 날 수·주간 보너스 수를 `stats`에 둔다) |

### 숨은 업적 판정(catch 사건에서)
- h-dawn-turtle: 천년 자라, 던질 때 비·게임 4~8시
- h-dragon-perfect: 용왕 퍼펙트
- h-two-mythic: `stats.day.mythics` ≥ 2
- h-tiny: `stats.tiny` 길이 ≥ 10
- h-midnight: 전설, 던질 때 게임 0~1시
- h-full-bag: 잡은 뒤 가방이 가방 크기만큼 참(60칸 가방일 때)
- h-trash: `stats.trash` ≥ 100(trash 사건)
- h-snow-night: 얼음 구멍, 퍼펙트, 겨울·비(눈)·밤

### 칭호
- `{ type: 'setTitle', id }`: 받은 칭호의 업적 id 또는 `null`(안 보이기).
- 프로필: `avatar` 문자열을 `{ ...outfit, title }` JSON으로 낸다. `decodeOutfit`은 슬롯만 읽어 그대로 동작한다. 낚시 `Avatar` 컴포넌트가 캐릭터 아래 칭호를 쓴다.
- 이름표: `src/platform/world/peers.ts` 위치 메시지에 선택 필드 `tag`(문자열 24자 이하, 플랫폼은 내용을 모른다)를 더한다. 낚시 화면이 고른 칭호를 보내고 `peerTags.ts`가 이름 아래 작게 쓴다. 내 이름표에도 같다.

### 기록·명예의 전당
- `records`에 `achv`(업적 점수, value = 점수 합, detail = "N개")를 더하고 manifest `records`에 `{ key: 'achv', label: '업적 점수', unit: '점' }`. 명예의 전당 RPC는 키 제한이 없어 게시판이 바로 생긴다(마이그레이션 없음).

## 7. migrate(v30 → v31)
- `stats`: `catches` = 도감 `count` 합. `big`·`max` = 도감 `maxCm`의 크기 백분위로 소급. `legendPerfect`·`tiny`·`seasons`·횟수들은 빈 값·0. `researchCatches` = 기증 수 합 + 전시 수 × 2.
- `daily`: 빈 값(`day: ''`) → 첫 행동 때 뽑힌다.
- `achv`: `{ tiers: {}, title: null }`. 첫 행동 때 소급된 값으로 단계가 한꺼번에 지급된다(진행이 많은 사람은 첫 행동에 골드를 많이 받는다. 의도한 소급이다).
- 옛 버전 세이브를 읽는 테스트를 더하고 `world`를 다시 배포한다. 배포 뒤 v30으로 되돌리지 않는다.

## 8. 테스트
- `daily.test.ts`: 할 수 없는 과제가 안 뽑힘(지역·낚싯대·허가증·B단계·섬), 같은 id 중복 없음, N 선형, 하루 안 고정·다음 날 새로 뽑기, 리롤 1번·끝난 과제 거절, 진행 판정 후보별 1개씩, 완료 보상 지급·상한, 셋 다 완료·주간 5일 1번만, `INCOME_REF`와 `econSim` ±5%.
- `achievements.test.ts`: 표 형식(단계 오름차순·골드/점수 길이), 골드 합계 = 2,132,000, 진행값별 단계 지급과 골드가 행동 `gold`에 합쳐짐, 같은 단계 두 번 안 줌, 숨은 업적 8개 각각, 칭호는 받은 것만 고를 수 있음.
- `stats.test.ts`: 사건별 갱신, 퍼펙트 연속 끊김, 하루 경계(KST).
- `goalEvents.test.ts`: 행동별 사건 추출(자동 어분 포함).
- `logic.test.ts`: v30 세이브 migrate 소급, 버전 31.
- 화면: 과제 창 탭·리롤·칭호 고르기, 완료 알림, 이름표 칭호.

## 9. 화면
- 위 메뉴의 "도전과제"를 **"과제"** 창으로 바꾸고 탭 셋: 오늘(데일리 3개·진행 막대·보상·리롤, 주간 n/5), 업적(분야별 목록·단계·진행 막대·골드, 숨은 업적은 ???), 지역 과제(기존 10개).
- 완료 순간 화면 위 알림: "오늘의 과제 완료: 어분 +5, 집어 미끼 +2", "업적 은 단계: 퍼펙트 1,000번 · +12,000 JWD".
- 칭호 고르기: 업적 탭 위 "칭호" 선택(받은 것만, "없음" 포함).

## 10. 범위 밖
- 친구 관련 업적, 데일리 친구 비교, 업적 옷(기존 `Unlock`과의 통합)은 다음 단계에서 본다.
