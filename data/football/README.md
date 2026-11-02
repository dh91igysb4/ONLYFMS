# 축구 데이터 (`data/football/`)

여러 게임이 함께 쓰는 원본 데이터. 설계: [`docs/superpowers/specs/2026-10-31-football-data-design.md`](../../docs/superpowers/specs/2026-10-31-football-data-design.md)

## 파일과 출처

| 파일 | 내용 | 출처 |
|---|---|---|
| `competitions.csv` | 수집 대상 리그 | `scripts/football/leagues.ts` (직접) |
| `nations.csv` | 국가, 국기 코드 | 위키데이터 |
| `teams.csv` | 클럽·성인 국가대표팀 (유스·2군·여자 팀 제외) | 위키데이터 |
| `team_competitions.csv` | 시즌별 리그 참가팀 | 위키데이터 + `manual/team_competitions.csv` |
| `players.csv` | 선수 | 위키데이터 (+ `manual/names_ko.csv`) |
| `aliases.csv` | 검색용 이름(한/영) | 위키데이터 |
| `external_ids.csv` | 다른 출처 ID (지금은 Transfermarkt ID만, 위키데이터 P2446) | 위키데이터 |
| `spells.csv` | 클럽 경력 | 위키데이터 |
| `caps.csv` | 국가대표 경력 | 위키데이터 |
| `honours.csv` | 리그 우승(대상 리그만), 축구 개인상 | 위키데이터 |
| `manual/*.csv` | 직접 입력 | 우리 |

위키데이터 데이터는 CC0다. 재배포 제한 출처(API-Football, StatsBomb)는 `restricted/`에만 둔다 (설계 §4.3).

## 수집

```bash
npm run football:fetch                                  # 대상 리그 전체 (40분~1시간)
npm run football:fetch -- --leagues Q9448 --limit-teams 5   # 시험 실행 (1~2분)
npm run football:fetch -- --seasons 3 --to 2025         # 모든 리그를 2023~2025로 (시즌 = 시작 연도)
```

- 리그와 리그별 수집 시즌 수는 `scripts/football/leagues.ts`에 있다(프리미어리그 최근 15시즌, 나머지 최근 10시즌, 현재 시즌 포함). 현재 시즌은 7월 이후면 올해, 아니면 작년이다. `--seasons N`은 모든 리그를 N시즌으로 바꾸는 시험용 옵션이다(옛 `--from`은 없어짐).
- 팀마다 선수를 찾는 시작 연도는 그 팀이 창 안에서 속했던 리그(또는 지금 소속 리그)의 창 시작 중 가장 이른 해다.
- 위키데이터 공식 질의 서비스만 쓴다. 한 번에 한 요청, 요청 사이 1초.
- 응답은 `.cache/wikidata/`에 보관된다(커밋 안 함). 중간에 멈추면 다시 돌려 이어 간다. 새로 받으려면 `--no-cache` 또는 그 폴더를 지운다.
- `User-Agent`는 `WIKIDATA_UA` 환경 변수로 바꿀 수 있다(위키미디어 정책상 연락처 포함 권장).
- 끝나면 리그·시즌별 참가팀 수 표가 나온다. `--`(없음)나 `!`(리그 정원 `teams` 미만) 칸은 `manual/team_competitions.csv`에 채운다.
- ONLYFMS 클라우드 개발 환경은 네트워크 정책이 `query.wikidata.org`를 막고 있다. 로컬 PC에서 돌리거나 환경의 허용 도메인에 추가한 뒤 돌린다.

## 직접 입력 (`manual/`)

다시 수집해도 지워지지 않는다. 수집 때마다 위키데이터 값 위에 덮어쓴다.

- `names_ko.csv` (`entity_id,name_ko`): 선수·팀·국가 한글 표시 이름. 위키데이터에 없거나 표기가 마음에 안 들 때.
- `team_competitions.csv` (`team_id,competition_id,season`): 위키데이터에 빠진 시즌 참가팀. `team_id`는 위키데이터 QID, `season`은 시작 연도.
- `legends.csv` (`player_id,note`): 수집 범위(최근 시즌) 밖이지만 넣을 레전드 선수의 위키데이터 QID와 메모(예: `Q1487,티에리 앙리`). 전체 경력까지 함께 받는다. 축구 선수가 아니거나 QID 형식이 아니면 경고하고 뺀다. 레전드의 옛 시즌 리그 참가 기록은 수집 창 밖이라 생기지 않는다.

## 알려진 한계

- `name_en`(필수)은 영어 라벨 → 다국어(`mul`) 라벨 → 한국어 라벨 순으로 채운다. 위키데이터가 인명 라벨을 `mul`로 합치면서 영어 라벨이 없는 선수가 많다.
- 위키데이터의 '알 수 없는 값'은 빈 값으로 둔다. 종료일이 시작일보다 앞인 경력 구간(원본 오류)은 뺀다.
- 날짜가 없는 경력 구간은 뺀다. 위키데이터에 빠진 이적은 다른 출처(API-Football)나 직접 입력으로 보완한다.
- 대표 국적은 성인 대표팀 출전 → 종목 국적(P1532) → 시민권(P27) 순이라 이중 국적 선수가 틀릴 수 있다.
- 포지션 세부(`position_detail`)는 위키데이터에 있을 때만 채운다. 주발(`foot`)은 대부분 비어 있다.
- 클럽 색 비율은 같은 비율로 나눈 값이다. 등번호(`shirt_number`)는 비워 두며 API-Football 현재 스쿼드로 채운다.
- `confederation`은 아직 비어 있다.
- 유스·2군·여자 팀은 이름 규칙(`U21`, `II`, `B`, `Jong`, `women` 등)으로 거른다. 걸러지지 않은 팀이 보이면 `scripts/football/wikidata.ts`의 `isYouthOrReserve`에 추가한다.
