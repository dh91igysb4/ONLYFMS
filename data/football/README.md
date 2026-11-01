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
npm run football:fetch                                  # 10개 리그, 최근 10시즌 (40분 안팎)
npm run football:fetch -- --leagues Q9448 --limit-teams 5   # 시험 실행 (1~2분)
npm run football:fetch -- --from 2016 --to 2025         # 시즌 범위 지정 (시즌 = 시작 연도)
```

- 위키데이터 공식 질의 서비스만 쓴다. 한 번에 한 요청, 요청 사이 1초.
- 응답은 `.cache/wikidata/`에 보관된다(커밋 안 함). 중간에 멈추면 다시 돌려 이어 간다. 새로 받으려면 `--no-cache` 또는 그 폴더를 지운다.
- `User-Agent`는 `WIKIDATA_UA` 환경 변수로 바꿀 수 있다(위키미디어 정책상 연락처 포함 권장).
- 끝나면 리그·시즌별 참가팀 수 표가 나온다. `--`(없음)나 `!`(16팀 미만) 칸은 `manual/team_competitions.csv`에 채운다.

## 직접 입력 (`manual/`)

다시 수집해도 지워지지 않는다. 수집 때마다 위키데이터 값 위에 덮어쓴다.

- `names_ko.csv` (`entity_id,name_ko`): 선수·팀·국가 한글 표시 이름. 위키데이터에 없거나 표기가 마음에 안 들 때.
- `team_competitions.csv` (`team_id,competition_id,season`): 위키데이터에 빠진 시즌 참가팀. `team_id`는 위키데이터 QID, `season`은 시작 연도.

## 알려진 한계

- 날짜가 없는 경력 구간은 뺀다. 위키데이터에 빠진 이적은 다른 출처(API-Football)나 직접 입력으로 보완한다.
- 대표 국적은 성인 대표팀 출전 → 종목 국적(P1532) → 시민권(P27) 순이라 이중 국적 선수가 틀릴 수 있다.
- 포지션 세부(`position_detail`)는 위키데이터에 있을 때만 채운다. 주발(`foot`)은 대부분 비어 있다.
- 클럽 색 비율은 같은 비율로 나눈 값이다. 등번호(`shirt_number`)는 비워 두며 API-Football 현재 스쿼드로 채운다.
- `confederation`은 아직 비어 있다.
- 유스·2군·여자 팀은 이름 규칙(`U21`, `II`, `B`, `Jong`, `women` 등)으로 거른다. 걸러지지 않은 팀이 보이면 `scripts/football/wikidata.ts`의 `isYouthOrReserve`에 추가한다.
