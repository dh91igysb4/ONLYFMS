# ONLYFMS 축구 데이터 계층 설계

- 작성일: 2026-10-31
- 상태: 검토 대기 (개정 1: 2026-11-01 출처·라이선스 구체화, 외부 ID 대응표, 후알야 출처 전환)
- 개정 2 (2026-11-01): §4 데이터 원본, §5 단계 1 스키마, §6.1 검색, §8 적재·갱신, §9의 데이터 부분, §10의 1~2번은 [축구 데이터 계층 설계 (1차)](2026-11-01-football-data-layer-design.md)가 대체한다. 대상 리그·시즌 범위·출처 범위도 그 문서의 §2 결정을 따른다.
- 범위: 여러 게임이 함께 쓰는 축구 데이터(선수·팀·커리어·대회·경기·라인업)의 저장 방식, 문제 생성 경로, 선수 검색, 이를 위해 필요한 플랫폼 변경. 개별 게임의 규칙·점수는 게임마다 별도 설계 문서로 붙인다(플랫폼 설계 §14).
- 선행 문서: [ONLYFMS 플랫폼 설계](2026-10-31-onlyfms-platform-design.md)

## 1. 목표

playfootball.games 류의 게임(Who Are Ya, Career Path, Box2Box, Bingo, Missing XI, TenaBall, Connections 등)을 하나씩 붙일 때, 게임마다 데이터를 새로 모으지 않고 **한 곳의 데이터에서 문제를 만들어** 쓴다.

성공 기준:

1. 선수·팀·국가·대회·커리어·경기 데이터는 저장소의 CSV 한 벌이 원본이며, 같은 CSV가 Supabase DB에 적재된다. 데이터 수정은 PR로 리뷰한다.
2. 게임 문제는 이 데이터에서 **스크립트로 생성**한 고정본(snapshot)이다. 출제 후 데이터가 바뀌어도 이미 낸 문제의 정답·판정은 바뀌지 않는다.
3. 플랫폼 설계 §4.4의 원칙("문제 하나에 판정에 필요한 정보가 모두 들어 있다, 판정 때 별도 조회를 하지 않는다")과 `logic.ts` 순수 함수 규칙을 지킨다.
4. 사용자는 한글·영문·악센트 없는 표기 어느 것으로도 선수·팀을 검색해 답을 고를 수 있다. 검색 결과로 정답이 드러나지 않는다.
5. 문제 은행(`bank`) 게임도 자유 플레이를 지원한다.
6. Supabase 무료 등급(DB 500MB) 안에서 운영한다.

## 2. 결정: 공통 DB + 게임별 문제 은행(생성본)

| 방식 | 문제 |
|---|---|
| 게임별 문제 은행만 | 그리드·빙고처럼 사용자가 **아무 선수나** 입력하는 게임은 칸마다 정답이 수십~수백 명이라 손으로 만들 수 없다. 이적 하나에 게임 N개를 고쳐야 한다. 자동완성용 전체 선수 목록이 어차피 필요하다 |
| DB만 (판정 때 조회) | `apply`가 순수 함수가 아니게 되고, 브라우저 판정(자유 플레이)이 불가능해진다. 데이터를 고치면 끝난 대회의 정답이 바뀐다. 선수 DB 전체는 Edge Function 번들에 넣을 수 없다(§4.4 generate 한도) |
| **공통 데이터 → 생성 스크립트 → 문제 은행** | 데이터는 한 곳, 문제는 출제 시점에 고정. 판정 코드는 지금 구조 그대로 |

```
data/football/*.csv  (원본, git)
   │                      │
   │ npm run football:load│ npm run puzzles:gen -- <game> <n>
   ▼                      ▼
Supabase football_* 테이블      src/games/<game>/generate.ts (순수 함수)
 ├─ 선수·팀 검색 RPC              │
 └─ (향후) 통계·관리 화면          ▼
                              puzzles-<game>.json ──/admin 업로드──▶ puzzle_bank
                                                                    │
                                                         Edge Function 출제 → logic.apply
```

- 생성기는 DB가 아니라 **CSV를 직접 읽는다.** 그래서 프로덕션 키 없이 로컬에서 돌고, Vitest로 고정 데이터 테스트가 가능하다. DB는 검색과 공유 풀 제공(§6)에 쓴다.
- DB와 생성기가 같은 CSV를 쓰므로 둘은 항상 같은 데이터셋 버전을 본다. 데이터셋 버전은 CSV 디렉터리의 git 커밋 해시 앞 7자리이며, 생성된 모든 문제에 `datasetVersion`으로 들어간다(추적용, 판정에는 안 씀).

## 3. 게임 유형과 필요한 데이터

playfootball.games를 참고해 정리한 후보이다. 실제 추가 여부·순서는 각 게임 설계에서 정한다.

| 유형 | 예시 게임 | 판정 방식 | 필요한 데이터 | 단계 |
|---|---|---|---|---|
| 속성 비교 | Who Are Ya, Football Wordle, Contextinho | 정답 1명, 추측한 선수와 속성 비교 | 선수 속성(국적·현 소속·리그·포지션·나이·등번호) | 1 |
| 커리어 | Career Path Challenge | 정답 1명, 이적 경로 단계별 공개 | 선수 커리어(기간·임대 여부) | 1 |
| 조건 그리드 | Box2Box, Tiki-Taka-Toe 1인용, The Heatmap, Gegenpressure | 칸마다 "조건 A ∧ 조건 B" 만족하는 선수 입력 | 커리어, 국적, 대회 소속, 수상 | 1 |
| 빙고 | Football Bingo | 제시 선수를 맞는 칸에 배치 | 그리드와 같음 | 1 |
| 그룹 | Football Connections | 16명을 공통점 4묶음으로 | 그리드와 같음 + 사람이 고른 주제 | 1 |
| 엠블럼 | Who Ate All the Pies? | 클럽 색 비율로 클럽 맞히기 | 클럽 색상 | 1 |
| 라인업 | Missing XI | 경기 선발 11명 | 경기, 라인업, 포메이션 | 2 |
| 순위 목록 | TenaBall, Goalless, Futbol List-a | 질문의 정답 목록(순위·희귀도) | 시즌별 선수 기록(출전·골·도움) | 3 |
| 카드 비교 | Pack 11 | 선수 스탯 비교 | 시즌별 기록 | 3 |

- 실시간 멀티플레이(Rondo Ringer, Possession Play, 대전형 Tiki-Taka-Toe)는 현재의 "1인 1기록, 서버 판정" 구조 밖이므로 이 문서 범위 밖이다.
- 단계는 §5의 테이블 도입 순서이다. 단계 1만으로 7종 이상을 만들 수 있다.

## 4. 데이터 원본 (CSV)

### 4.1 위치와 형식

```
data/football/
  README.md            출처, 라이선스, 컬럼 설명, 갱신 절차
  nations.csv
  competitions.csv
  teams.csv
  team_competitions.csv
  players.csv
  aliases.csv
  external_ids.csv
  spells.csv
  caps.csv
  honours.csv
  matches.csv          (단계 2)
  match_players.csv    (단계 2)
  player_seasons.csv   (단계 3)
  restricted/          재배포 제한 출처(API-Football, StatsBomb)에서 온 CSV (§4.3)
```

- UTF-8, 헤더 있음, 쉼표 구분. 빈 값은 빈 칸. 날짜는 `YYYY-MM-DD`, 날짜를 모르면 `YYYY`만 쓰고 정밀도 컬럼으로 표시한다(§5).
- 시즌은 시작 연도 정수(`2009` = 2009/10, 단일 연도 대회는 그 해).
- 파일마다 기본 키 순으로 정렬해 저장한다. diff가 작아져 PR 리뷰가 쉽다.

### 4.2 식별자

- 모든 엔터티 ID는 **영구 고정 문자열**이다. 한번 출제된 문제가 ID를 들고 있으므로 ID는 바꾸거나 재사용하지 않는다. 지우는 대신 `retired = true`로 둔다.
- 위키데이터 항목이 있으면 그 QID를 쓴다(예: `Q11571`). 없으면 `x-` 접두사에 사람이 읽을 수 있는 이름(`x-kim-minjae-1996`).
- 두 항목이 같은 대상으로 밝혀지면 하나를 남기고 다른 하나를 `retired`로 둔다. `aliases`에 옛 ID를 기록해 옛 문제의 표시가 깨지지 않게 한다.
- 다른 출처의 ID(API-Football, StatsBomb, FotMob 등)는 우리 ID로 쓰지 않고 `football_external_ids`(§5)에 대응표로만 둔다. 출처를 바꿔도 우리 ID와 이미 출제된 문제는 그대로이다.

### 4.3 출처와 라이선스

원칙: **사실(누가 언제 어느 팀에 있었나)은 저작권 대상이 아니지만, 남의 데이터베이스를 대량 복제하면 이용약관과 저작권법상 데이터베이스제작자 권리(제93조)에 걸린다.** 그래서 라이선스가 명시된 출처, 약관이 허용하는 API, 사람이 직접 확인해 입력한 사실만 쓴다.

| 출처 | 라이선스·조건 | 맡는 데이터 | 단계 |
|---|---|---|---|
| 위키데이터 | CC0, 제한 없음 | 선수(생년월일·국적·포지션·주발·키), 클럽 커리어 기간, 국가대표, 수상, 클럽 색상, 한국어 이름(라벨), 외부 ID 대응 | 1 (뼈대) |
| API-Football (api-sports.io) | 무료 플랜 하루 100회, 약관 준수(원본 재배포 금지 취지) | 현재 스쿼드·등번호, 이적, 시즌별 출전·골·도움, 경기 라인업 | 1 (현재 스쿼드), 3 |
| StatsBomb Open Data | 비상업적 이용, 출처·로고 표기, 이용 동의서 준수 | 공개된 경기(월드컵·유로 등)의 라인업·포지션 | 2 |
| openfootball | 퍼블릭 도메인(CC0) | 경기 결과·일정 | 2 |
| 직접 입력 | 우리 데이터 | 한글 이름·별칭 다듬기, 명경기 라인업, TenaBall·Connections 질문, 누락·오류 보정 | 전 단계 |
| 위키백과 | 사람이 사실을 확인하는 참고 자료 | (직접 입력의 근거) | 전 단계 |

- 수집 스크립트는 `scripts/football/fetch-<source>.ts`로 출처마다 하나씩 두고, 결과는 §4.1의 CSV로 쓴다. 자동 수집은 이 표의 출처만 한다.
- **쓰지 않는 출처:** Transfermarkt, FBref, FotMob, Sofascore, WhoScored 등 약관으로 자동 수집을 금지하는 사이트. 이들을 크롤링해 만든 Kaggle 등의 2차 데이터셋도 표시된 라이선스와 무관하게 쓰지 않는다.
- **후알야의 현재 출처(FotMob)** 는 위 원칙과 맞지 않는다. API-Football 현재 스쿼드로 바꾼다(§10). 바꾸기 전까지는 지금 절차(CLAUDE.md "데이터 갱신")를 유지한다.
- **재배포 제한 데이터의 분리:** API-Football·StatsBomb에서 온 데이터는 `data/football/restricted/` 아래 CSV에만 둔다. 사이트 화면에 쓰는 것은 약관 범위 안이지만, 원본을 공개 저장소에 올리면 재배포가 될 수 있다. 저장소는 비공개로 유지하고, 공개로 바꿀 일이 생기면 `restricted/`를 먼저 뺀다. `data/football/README.md`에 파일별 출처를 적는다.
- StatsBomb 데이터를 쓴 게임은 결과 화면 하단에 "Data: StatsBomb" 출처를 표기한다.
- API 키(`API_FOOTBALL_KEY`)는 수집 스크립트만 쓰며 `.env.local`에 둔다. Vercel·Edge Function에는 넣지 않는다(사이트는 API를 직접 부르지 않는다).
- 선수 사진·클럽 엠블럼 이미지는 저작권·상표 문제로 저장하지 않는다. 화면에는 국기 이모지, 클럽 색상, 텍스트를 쓴다.
- 위키데이터의 커리어 기간은 누락이 많다. 단계 1에서는 **5대 리그 + K리그1 현역과 최근 20년 은퇴 선수**로 범위를 좁히고, 출제에 쓰기 전 생성기가 검증 규칙(§7.3)으로 불완전한 선수를 걸러낸다. 현역 선수의 최근 구간은 API-Football 이적 기록으로 보완한다.
- 각 서비스의 무료 한도·약관은 바뀔 수 있다. 수집 스크립트를 처음 돌리기 전에 그 시점 약관을 확인하고 README에 확인 날짜를 적는다.

## 5. DB 스키마 (`npx supabase@2 migration new football` 부터)

공통 규칙: 모든 테이블 이름은 `football_` 접두사, RLS를 켜고 **승인 사용자는 읽기만, 쓰기는 적재 스크립트(service role)만** 한다. 데이터 자체는 공개 지식이고 어떤 문제가 출제될지는 들어 있지 않으므로 읽기를 막을 이유가 없다.

### 단계 1

**football_nations**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | text PK | 위키데이터 QID 또는 `x-…` |
| name_ko, name_en | text | |
| iso2 | text NULL | 국기 이모지용. 잉글랜드처럼 ISO가 없는 곳은 `gb-eng` 형식 |
| confederation | text | `UEFA`, `AFC` 등 |

**football_competitions**: 리그·컵·대륙 대회·국가대항전을 하나로 묶는다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | text PK | |
| name_ko, name_en | text | |
| kind | enum `league`/`cup`/`continental`/`international` | |
| nation_id | text NULL FK | 국내 대회만 |
| tier | int NULL | 리그 단계(1부 = 1) |

**football_teams**: 클럽과 국가대표팀.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | text PK | |
| kind | enum `club`/`national` | |
| name_ko, name_en, short_name | text | |
| nation_id | text FK | 클럽 소재국, 또는 대표팀의 국가 |
| colors | jsonb NULL | `[{"hex":"#DA291C","share":0.6}, …]` 엠블럼 색 비율(합 1) |
| founded | int NULL | |
| retired | boolean | |

**football_team_competitions**: 시즌별 리그 소속. "프리미어리그에서 뛴 선수" 같은 조건에 쓴다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| team_id, competition_id, season | PK | |

**football_players**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | text PK | |
| name_ko, name_en | text | 표시용 대표 이름 |
| birth_date | date NULL | |
| birth_precision | enum `day`/`year` | |
| nation_id | text FK | 대표 국적(대표팀 기준, 없으면 출생국) |
| position | enum `GK`/`DF`/`MF`/`FW` | 대표 포지션 |
| position_detail | text NULL | `CB`, `RW` 등 |
| foot | enum `left`/`right`/`both` NULL | |
| height_cm | int NULL | |
| shirt_number | int NULL | 현 소속팀 등번호 |
| popularity | int | 0~100. 출제 난이도·후보 풀 필터용(§7.2) |
| retired | boolean | 데이터상 폐기 여부(선수 은퇴가 아님) |

**football_aliases**: 검색용 다른 이름.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| entity_id | text | 선수·팀 ID |
| alias | text | `손흥민`, `Son Heung-min`, `Sonny`, 옛 ID 등 |
| lang | text NULL | `ko`, `en` 등 |
| PK | (entity_id, alias) | |

**football_external_ids**: 다른 출처 ID 대응표(§4.2). 수집 스크립트가 출처 데이터를 우리 ID에 붙일 때 쓴다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| entity_id | text | 선수·팀·경기 ID |
| source | text | `wikidata`, `api-football`, `statsbomb`, `fotmob`, `transfermarkt` |
| external_id | text | 그 출처의 ID |
| PK | (source, external_id) | 한 외부 ID는 우리 엔터티 하나에만 |

- `transfermarkt`·`fotmob` ID는 위키데이터에 이미 있는 대응(P2446 등)을 옮겨 적는 것뿐이며, 그 사이트에서 데이터를 가져오지 않는다. 후알야 전환(§10) 때 옛 FotMob ID를 이어 주는 데 쓴다.

**football_spells**: 클럽 커리어 한 구간.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| player_id, team_id | text FK | team은 `club`만 |
| start_date | date | |
| end_date | date NULL | 현 소속이면 null |
| date_precision | enum `day`/`year` | |
| loan | boolean | |
| apps, goals | int NULL | 리그 기준, 모르면 null |

**football_caps**: 국가대표 경력.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| player_id, team_id | PK | team은 `national`만 |
| caps, goals | int NULL | |
| first_year, last_year | int NULL | |

**football_honours**: 팀 우승과 개인상.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| honour | text | 대회 우승이면 competition id, 개인상이면 `award:ballon-dor` 형식 |
| season | int | |
| team_id | text NULL | 우승 팀 |
| player_id | text NULL | 개인상 수상자, 또는 우승 팀 소속으로 기록된 선수 |

**football_meta**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| key | text PK | `dataset_version`, `loaded_at` |
| value | text | |

### 단계 2: 경기와 라인업

**football_matches**: id, date, competition_id, season, stage(text, 예: `final`), home_team_id, away_team_id, home_goals, away_goals, home_pens NULL, away_pens NULL, home_formation, away_formation(`4-3-3` 형식).

**football_match_players**: match_id, team_id, player_id, started(boolean), slot(int NULL, 포메이션 위치 1~11), shirt_number NULL, minute_on NULL, minute_off NULL, goals int. PK (match_id, player_id).

### 단계 3: 시즌 기록

**football_player_seasons**: player_id, team_id, competition_id, season, apps, starts NULL, goals, assists NULL, minutes NULL. PK (player_id, team_id, competition_id, season).

### 인덱스와 용량

- `pg_trgm`과 `unaccent` 확장을 켜고 `football_aliases.alias`, 선수·팀 `name_ko`·`name_en`에 trigram GIN 인덱스를 건다.
- 단계 1 목표 범위(선수 약 1~2만 명, 커리어 약 10만 행)는 인덱스 포함 수십 MB로 무료 등급 한도 안이다.

## 6. 플랫폼 변경

게임별 분기 없이 일반 기능으로 추가한다.

### 6.1 검색 RPC

`football_search(q text, kind text, lim int default 10)`

- `kind`는 `player` 또는 `team`. 승인 사용자만. `retired` 제외.
- `unaccent(lower(q))`로 이름과 별칭을 trigram 유사도 순으로 찾고 `popularity`로 동점을 깬다.
- 반환: `id, name_ko, name_en, nation_id, position, birth_year`. 동명이인을 구분할 최소 정보만 주고, 커리어 같은 정답 단서는 주지 않는다.
- 입력 컴포넌트 `src/platform/games/EntityPicker.tsx`를 공통으로 두고, 게임 화면은 고른 `id`를 행동(`{ type: 'guess', playerId }`)에 담는다.

### 6.2 공유 풀(pool)

Who Are Ya처럼 "추측한 선수의 속성"이 판정에 필요한 게임은 후보 선수 전체의 속성이 문제 안에 있어야 한다. 이를 매번 문제에 넣으면 문제당 수백 KB가 쌓인다. 그래서 **불변 공유 풀**을 둔다.

- 테이블 `puzzle_pools(id text PK, game_id text, data jsonb, created_at)`. `id`는 `data`의 SHA-256 앞 16자(내용 주소). 같은 내용이면 같은 ID라 중복 저장이 없고, 한번 만든 풀은 바뀌지 않는다.
- 문제 JSON은 풀을 `{ "$pool": "<id>" }` 자리표시자로 참조할 수 있다(최상위 키 `pool`에 한정).
- Edge Function `play`와 자유 플레이 실행기는 `logic`을 부르기 전에 자리표시자를 풀 내용으로 바꿔 넣는다. `logic`은 언제나 풀이 채워진 완전한 문제를 받는다. 그래서 §4.4 원칙은 그대로이다.
- Edge Function은 풀을 함수 인스턴스 메모리에 ID 기준으로 캐시한다(불변이라 무효화 불필요).
- 풀은 승인 사용자에게 읽기를 연다. 후보 목록일 뿐 정답이 아니며, 브라우저는 이 풀로 자동완성을 한다(§6.1 대신).
- 업로드: `admin_upload_puzzles`가 `{ pools: {id: data}, puzzles: [...] }` 형식도 받는다. 풀 ID를 서버에서 다시 계산해 맞지 않으면 거부한다.

### 6.3 은행 출제에 설정(options) 반영

지금 은행 출제는 `game_id`만 보고 꺼낸다. Box2Box의 "리그 선택"처럼 설정에 따라 다른 문제가 필요하므로:

- `puzzle_bank`에 `options_key text not null default ''` 컬럼 추가. 값은 설정을 키 순으로 정렬해 `k=v&k=v`로 이은 문자열.
- 출제 시 `game_id`와 `options_key`가 모두 맞는 미사용 문제를 꺼낸다. `admin_bank_status`는 (game_id, options_key)별 잔량을 돌려준다.
- 생성 스크립트는 설정별로 따로 생성한다.

### 6.4 은행 게임의 자유 플레이

지금 자유 플레이는 브라우저에서 `pickPuzzle`을 부르므로 은행 게임에는 쓸 수 없다. **이미 정답이 공개된 지난 문제를 다시 푸는 방식**으로 지원한다(playfootball.games의 "Yesterday / Random Game"과 같음).

- RPC `free_puzzle(game_id text, options jsonb)`: 승인 사용자. 종료되고 취소되지 않은 데일리·공개 대회(초대 대회 제외)의 `contest_items` 중 그 게임·설정의 문제 하나를 무작위로 돌려준다. 본인이 최근 30판 안에 푼 `puzzle_key`는 가능한 한 피한다.
- 지난 문제가 아직 없으면 `free_unavailable`을 돌려주고 화면은 "아직 지난 문제가 없어요"를 보인다.
- 정답이 이미 공개된 문제라 브라우저 판정이어도 새로 새는 정보가 없다.
- `manifest.modes.free`가 true인 은행 게임에만 적용. 실행기는 `puzzleSource`로 `pickPuzzle`과 `free_puzzle` 중 하나를 고른다(게임 id 분기가 아님).

## 7. 문제 생성

### 7.1 게임 쪽 약속

`src/games/<game-id>/generate.ts`를 둔다(은행 게임만). Edge Function 번들에 들어가지 않도록 `index.ts`에서 import하지 않는다.

```ts
// src/games/types.ts 에 추가
import type { FootballData } from '../shared/football.ts'

export type Generated<Puzzle> = {
  pools: Record<string, unknown>      // §6.2. 없으면 {}
  puzzles: { puzzle: Puzzle; puzzleKey: string; optionsKey: string }[]
}

export interface GameGenerator<Puzzle> {
  /** 데이터와 난수로 문제 n개를 만든다. 검증을 통과한 문제만 돌려준다 (7.3) */
  generate(data: FootballData, rng: () => number, options: Record<string, string>, n: number): Generated<Puzzle>
}
```

- `src/shared/football.ts`: CSV를 읽어 만든 메모리 구조의 타입과 자주 쓰는 질의(선수의 클럽 목록, 두 조건을 모두 만족하는 선수 등). 순수 함수, 외부 의존 없음.
- `scripts/puzzles-gen.ts`: `npm run puzzles:gen -- <game-id> <n> [k=v …]`. CSV를 읽어 `FootballData`를 만들고 생성기를 돌려 `out/puzzles-<game>-<options>-<date>.json`을 쓴다(`out/`은 `.gitignore`에 추가). 이미 은행에 있는 `puzzle_key`는 업로드 때 건너뛰어지므로 겹쳐도 된다.
- 관리자가 이 파일을 `/admin`에서 올린다. 업로드는 기존 기능을 §6.2·§6.3 형식으로 넓힌 것이다.

### 7.2 문제 안에 넣는 것 (예시)

정답 판정과 결과 화면 표시에 필요한 것을 모두 넣는다. 이름도 함께 넣어 나중에 데이터 표기가 바뀌어도 옛 문제 화면이 그대로 나오게 한다.

```jsonc
// 조건 그리드 (Box2Box)
{
  "datasetVersion": "a1b2c3d",
  "rows": [{ "kind": "team", "id": "Q8682", "label": "레알 마드리드" }, …],
  "cols": [{ "kind": "nation", "id": "Q155", "label": "브라질" }, …],
  "cells": { "0,0": ["Q…", "Q…"], … },          // 칸별 정답 선수 ID 전체
  "names": { "Q…": "호나우두", … },              // 정답 선수 표시 이름
  "rarity": { "Q…": 0.12, … }                    // 선택. 희귀도 점수용
}

// 속성 비교 (Who Are Ya)
{
  "datasetVersion": "a1b2c3d",
  "answerId": "Q…",
  "pool": { "$pool": "9f3c…" }   // { 선수ID: {name, nation, team, league, position, age, shirt} }
}
```

- 정답 판정은 ID 비교로만 한다. 이름 문자열로 판정하지 않는다.
- `publicState`에는 정답 ID 집합을 넣지 않는다(플랫폼 설계 §4.2).
- 후보 풀은 `popularity` 하한과 리그 범위로 정한다. 게임 설정(`options`)으로 범위를 고를 수 있다.

### 7.3 생성 검증 규칙

생성기는 다음을 만족하지 않는 문제를 버린다. 게임마다 더 엄격하게 할 수 있다.

- 조건 그리드: 모든 칸의 정답이 1명 이상, 그리고 `popularity ≥ 30`인 정답이 1명 이상(아무도 모를 칸 방지).
- 커리어: 커리어 구간이 3개 이상이고 기간 누락이 없는 선수만.
- 속성 비교: 정답 선수의 비교 속성이 모두 채워져 있어야 한다.
- 모든 유형: 쓰인 ID가 `retired`가 아님.

## 8. 데이터 적재와 갱신

- `npm run football:load`: `scripts/football/load.sh`. `DATABASE_URL`(로컬 또는 원격) 대상으로 `psql \copy`로 임시 테이블에 넣고, 한 트랜잭션 안에서 `football_*`에 upsert한 뒤 `football_meta.dataset_version`을 갱신한다. CSV에서 사라진 행은 지우지 않고 `retired = true`로 둔다(행을 지우는 것은 ID 영구 규칙과 충돌).
- 원격 적재는 배포 체크리스트에 단계로 추가한다. 원격 `DATABASE_URL`은 비밀값이므로 커밋하지 않는다.
- 갱신 주기: 이적 시장(여름·겨울) 뒤에 한 번씩. 이미 출제된 문제는 고정본이라 영향이 없다.
- 갱신 순서: `fetch-wikidata` → `fetch-api-football`(하루 100회 한도 안에서 리그별로 나눠 실행, 받은 응답은 `.cache/`에 보관해 재실행 때 다시 부르지 않음) → 직접 입력분 병합 → CSV PR → 머지 후 `football:load`.
- 데이터 오류 제보는 이 문서 범위 밖이다. 우선은 친구들이 메신저로 알려 주면 PR로 고친다.

## 9. 테스트

- `src/shared/football.test.ts`: 작은 고정 CSV(`src/shared/__fixtures__/football/`)로 질의 함수(클럽 목록, 교집합, 시즌 범위)를 검사한다.
- 게임별 `generate.test.ts`: 고정 데이터와 고정 시드로 생성 결과가 검증 규칙(§7.3)을 지키는지, 같은 시드면 같은 결과인지 검사한다.
- pgTAP:
  - `football_*` 읽기는 승인 사용자만, 쓰기는 모두 거부
  - `football_search`가 한글·영문·악센트 없는 입력을 찾고 `retired`를 제외
  - 은행 출제가 `options_key`를 지킴, `admin_bank_status`가 설정별 잔량을 돌려줌
  - `free_puzzle`이 종료 전 문제를 돌려주지 않음
  - 풀 업로드에서 ID가 내용 해시와 다르면 거부
- Edge Function: `$pool` 자리표시자가 채워진 문제가 `logic`에 들어가는지, 없는 풀이면 500 대신 409 `pool_missing`인지.
- 적재 스크립트: 로컬 임시 DB에 고정 CSV를 두 번 적재해 결과가 같은지(멱등), 사라진 행이 `retired`가 되는지.

## 10. 구현 순서

1. 단계 1 스키마 마이그레이션, RLS, `football_search`, pgTAP
2. `data/football/` 초기 데이터와 수집·적재 스크립트: `fetch-wikidata`(5대 리그 + K리그1 범위) → 한글 이름 보정 → `fetch-api-football`(현재 스쿼드·등번호) → `football:load`
3. 플랫폼 변경 §6.3(설정별 은행), §6.4(은행 자유 플레이), §6.2(공유 풀)
4. `src/shared/football.ts`, `scripts/puzzles-gen.ts`, `EntityPicker`
5. 첫 새 게임: Box2Box(풀 없음)를 별도 게임 설계로 붙인다. 후알야는 이미 FotMob 번들 방식으로 운영 중이므로 §6.2는 필요해질 때까지 미룬다.
6. 후알야 출처 전환: `build-wya-data.py`의 입력을 `data/football/`(API-Football 현재 스쿼드)로 바꾼다. 게임 코드는 `data.ts` 생성 구조를 유지한다. 옛 FotMob 숫자 ID로 저장된 문제는 `football_external_ids`로 이어 붙이고 `logic.version`을 올린다. `data/fotmob_squads.json`은 전환 PR에서 지운다.
7. 단계 2(Missing XI: StatsBomb + 직접 입력), 단계 3(TenaBall 등: API-Football 시즌 기록)은 해당 게임 설계와 함께 추가한다.

## 11. 결정할 것

- 단계 1 데이터 범위: 5대 리그 + K리그1이 적당한지, 과거 레전드를 얼마나 넣을지.
- 한글 이름 표기 기준(국립국어원 외래어 표기법 vs 국내 중계 관행). 검색은 별칭으로 둘 다 받으므로 표시용 대표 이름만 정하면 된다.
- 후알야 출처 전환(§10의 6) 시점: 공통 데이터 첫 적재 직후 vs 다음 이적 시장 갱신 때.
- API-Football 무료 한도(하루 100회)로 단계 3 시즌 기록까지 감당할지, 그때 유료 플랜(월 단위)을 잠깐 쓸지.

## 12. 범위 밖

- 개별 게임 규칙과 점수(게임별 설계 문서)
- 실시간 멀티플레이 게임
- 데이터 편집용 관리자 화면(CSV + PR로 대신)
- 실시간 경기 결과·라이브 데이터 연동
- 선수 사진·엠블럼 이미지
