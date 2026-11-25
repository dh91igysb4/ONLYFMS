# 축구 데이터 (`data/football/`)

여러 게임이 함께 쓰는 원본 데이터. 설계: [`docs/superpowers/specs/2026-10-31-football-data-design.md`](../../docs/superpowers/specs/2026-10-31-football-data-design.md)

## 파일과 출처

| 파일 | 내용 | 출처 |
|---|---|---|
| `competitions.csv` | 수집 대상 리그와 전신 대회 | `scripts/football/leagues.ts` (직접) |
| `competition_eras.csv` | 대회의 시기별 나라·단계(풋볼리그 1부처럼 시기마다 단계가 다른 대회) | `scripts/football/leagues.ts` (직접) |
| `nations.csv` | 국가, 국기 코드 | 위키데이터 |
| `teams.csv` | 클럽·성인 국가대표팀 (유스·2군·여자 팀 제외) | 위키데이터 |
| `team_competitions.csv` | 시즌별 리그 참가팀 | 위키데이터 + openfootball + `manual/team_competitions.csv` |
| `players.csv` | 선수 | 위키데이터 (+ `manual/names_ko.csv`) |
| `aliases.csv` | 검색용 이름(한/영) | 위키데이터 |
| `external_ids.csv` | 다른 출처 ID (지금은 Transfermarkt ID만, 위키데이터 P2446) | 위키데이터 |
| `spells.csv` | 클럽 경력 | 위키데이터 (+ `manual/spells.csv`) |
| `caps.csv` | 국가대표 경력 | 위키데이터 |
| `honours.csv` | 리그 우승(대상 리그만), 축구 개인상 | 위키데이터 |
| `honour_catalog.csv` | 우승·수상·대표팀 대회·감독 수집 목록이자 화면 이름표(한글 이름) | 직접 |
| `honours_extra.csv` | 리그·컵·대륙 대회 팀 우승(적재 때 `honours.csv`의 같은 대회·시즌 팀 우승을 대신), 선수 단위 우승(리그 포함), 대표팀 엔트리(`squad:`), 개인상(`award:`), 월드컵 결승 득점(`final_goal:`) | 위키데이터 + 위키백과 (`npm run football:honours`) |
| `managers.csv`, `manager_spells.csv` | 카탈로그 감독과 팀별 재임 시즌 | 위키백과 감독 문서 정보상자 |
| `season_memberships.csv` | 시즌별 소속 팀(주 소속·머문 날·추정 여부) | `spells.csv`에서 계산(`npm run football:seasons`) |
| `openfootball/team_competitions.csv` | openfootball 경기 일정에서 뽑아 우리 ID로 이은 참가팀 | openfootball (퍼블릭 도메인) |
| `openfootball/seasons.csv`, `remap.csv`, `unmatched.csv` | 시즌별 연결 수, 옮길 옛 ID, 못 이은 이름 | 생성 파일 |
| `manual/*.csv` | 직접 입력 | 우리 |

위키데이터 데이터는 CC0, openfootball은 퍼블릭 도메인이다. 재배포 제한 출처(API-Football, StatsBomb)는 `restricted/`에만 둔다 (설계 §4.3).

## 수집

레전드 명단을 바꿨으면 먼저 `npm run football:legends`(1~2분)로 `manual/legends.csv`를 갱신한다.

```bash
npm run football:fetch                                  # 대상 리그 전체 (40분~1시간)
npm run football:fetch -- --leagues Q9448 --limit-teams 5   # 시험 실행 (1~2분, 결과는 .cache/football-trial/)
npm run football:fetch -- --seasons 3 --to 2025         # 모든 리그를 2023~2025로 (시험, 결과는 .cache/football-trial/)
```

- 리그와 리그별 수집 시즌 수는 `scripts/football/leagues.ts`에 있다(프리미어리그 최근 15시즌, 나머지 최근 10시즌, 현재 시즌 포함). 현재 시즌은 7월 이후면 올해, 아니면 작년이다. `--seasons N`은 모든 리그를 N시즌으로 바꾸는 시험용 옵션이다(옛 `--from`은 없어짐).
- 팀마다 선수를 찾는 시작 연도는 그 팀이 창 안에서 속했던 리그(또는 지금 소속 리그)의 창 시작 중 가장 이른 해다.
- `--leagues`·`--limit-teams`·`--seasons`를 쓰면 시험 실행이라 결과를 `.cache/football-trial/`에 쓴다(본 데이터 `data/football/`은 그대로). 직접 입력(`manual/`)·openfootball 결과는 `data/football/`에서 읽는다. 본 폴더에 쓰려면 `--out data/football`.
- 위키데이터 공식 질의 서비스만 쓴다. 한 번에 한 요청, 요청 사이 1초.
- 응답은 `.cache/wikidata/`에 보관된다(커밋 안 함). 중간에 멈추면 다시 돌려 이어 간다. 새로 받으려면 `--no-cache`(캐시를 읽지 않고 새로 받아 캐시도 갱신한다. 그 뒤 실행은 갱신된 캐시를 쓴다). 단 `--no-cache`로 돌리다 멈췄을 때 옵션 없이 이어 돌리면 아직 못 받은 부분은 옛 캐시를 쓴다. 중간에 멈출 수 있으면 `.cache/wikidata/` 폴더를 지우고 옵션 없이 돌리는 편이 안전하다.
- `User-Agent`는 `WIKIDATA_UA` 환경 변수로 바꿀 수 있다(위키미디어 정책상 연락처 포함 권장).
- 끝나면 리그·시즌별 참가팀 수 표가 나온다. `--`(없음)나 `!`(리그 정원 `teams` 미만) 칸은 `manual/team_competitions.csv`에 채운다.
- ONLYFMS 클라우드 개발 환경은 네트워크 정책이 `query.wikidata.org`를 막고 있다. 로컬 PC에서 돌리거나 환경의 허용 도메인에 추가한 뒤 돌린다.

## 1987년부터 받기 (옛 선수·옛 시즌)

설계: [`2026-11-25-football-history-clubs-design.md`](../../docs/superpowers/specs/2026-11-25-football-history-clubs-design.md)

- `football:fetch`는 기본으로 모든 대상 팀의 선수를 1987년부터 받고, 시즌 참가팀도 리그와 전신 대회(`leagues.ts`의 `since`·`eras`)의 1987년부터 받는다. `--history-from 1995`로 바꾸거나 `--history-from off`로 끈다(이전처럼 리그별 최근 시즌만). `--seasons N`만 주면 꺼진다.
- `manual/active_players.csv`(`player_id,note`): 40세가 넘었어도 현역인 선수. `football:seasons`가 이 선수의 열린 경력은 닫지 않는다(설계 §3.4).
- `manual/history_clubs.csv`(`team_id,from,note`): 참가 기록에 없어 선수 수집 대상에서 빠지는 옛 클럽. `from`이 비면 1987.
- 전신 대회 찾기: `npm run football:eras` — 리그별 이전 대회(P155·P1365)와 시즌 항목 연도·참가팀 커버리지를 찍는다. 결과로 `leagues.ts`의 `since`·`eras`·시즌별 `teams`(정원 계단)를 채운다.
- 위키데이터·openfootball에 없는 옛 시즌 참가팀은 영어 위키백과 시즌 문서를 보고 `manual/team_competitions.csv`에 넣고 `source_url` 열에 그 문서 주소를 적는다(시즌 참가팀만 예외적으로 위키백과를 근거로 인정. 경력은 아님). 넣은 뒤 `npm run football:openfootball -- --merge`로 반영한다.
- 진행 표시: 선수 찾기는 묶음마다 `선수 찾기 (1987~) 40/316 — 아스널, 첼시 … — 새 선수 1,203명 (예: …)`처럼 클럽 이름과 새로 찾은 선수를 화면에 찍는다.
- 시간: 전체 수집이 몇 시간 걸릴 수 있다. 끊기면 같은 명령을 다시 돌리면 캐시(`.cache/wikidata/`)로 이어진다.

### Windows PowerShell에서 돌리기

위키데이터는 Claude 환경에서 막혀 있어 수집은 사람이 돌린다. Git과 Node 22.18 이상이 필요하다(`git --version`, `node -v`).

```powershell
git clone https://github.com/dh91igysb4/onlyfms
cd onlyfms
npm install
npm run football:eras                            # 1. 전신 대회 확인 (출력을 Claude에게)
# → Claude가 leagues.ts의 since·eras·정원을 채운 PR을 머지한 뒤에 다음으로
git checkout main; git pull
npm run football:fetch -- --leagues Q9448        # 2. 시험 수집 (.cache/football-trial/에 씀)
git checkout -b data/history-1987                # 3. 본 수집 (eras가 비어 있으면 옛 시즌 참가팀이 비니 1·2를 먼저)
npm run football:fetch
npm run football:seasons
npm test
git add data/football
git commit -m "chore: 축구 데이터 1987년부터 수집"
git push -u origin data/history-1987
```

## 시즌 참가팀 보완 (openfootball)

위키데이터의 시즌별 참가팀이 빈 시즌을 openfootball 경기 일정으로 채운다(설계 2026-11-01 §3.5).

```bash
npm run football:openfootball            # openfootball/*.csv만 만든다 (1분 안쪽, raw.githubusercontent.com)
npm run football:openfootball -- --merge # 지금 team_competitions.csv·honours.csv 등에 바로 반영
```

- `teams.csv`·`aliases.csv`로 팀 이름을 잇기 때문에 `football:fetch`를 한 번 돌린 뒤에 쓴다. 다음 `football:fetch`는 `openfootball/*.csv`를 자동으로 합치고, 새로 들어온 팀의 선수까지 받는다.
- 끝에 나오는 표는 리그·시즌별 `위키데이터/openfootball(?는 못 이은 이름 있음)→합친 결과`다. 명단이 다 이어진 시즌은 openfootball이 기준이라 위키데이터에만 있는 팀은 빠진다.
- 못 이은 이름은 `openfootball/unmatched.csv`에 후보와 함께 남는다. `manual/openfootball_teams.csv`(`competition_id,name,team_id`)에 ID를 적고 다시 돌린다. 팀이 `teams.csv`에 아예 없으면 위키데이터에서 QID를 확인해 적는다(다음 `football:fetch`가 그 팀을 받는다).
- 응답은 `.cache/openfootball/`에 보관된다. 새로 받으려면 `--no-cache`.

## 시즌 소속 (`season_memberships.csv`)

"몇 시즌에 어느 팀"은 게임마다 따로 판정하지 않고 이 파일을 쓴다. 규칙은 설계 2026-11-01 §3.6.

```bash
npm run football:seasons                       # 수집·openfootball 반영 뒤에 (몇 초, 네트워크 없음)
npm run football:seasons -- --as-of 2026-11-05 # 열린 경력을 이 날까지로
```

- 시즌 = 시작 연도. 가을–봄 시즌은 7/1~다음 해 7/1, 한국·일본·미국 등(`leagues.ts`의 `CALENDAR_YEAR_NATIONS`)은 달력 연도.
- 개막 이적시장(가을–봄 9/1까지, 단일 연도 3/31까지) 안에서 끝난 경력은 그 시즌 소속이 아니다(출전 전 이적으로 본다). 겨울 이적·임대는 두 팀 모두.
- 연도만 있는 날짜는 여름 이적으로 본다. 종료일이 빈 경력은 그 뒤 다른 팀 완전 이적 시작일로 닫는다. 원 소속 경력에서 임대 나간 기간은 뺀다. 시즌과 7일 미만 겹치면 치지 않는다.
- `primary`: 그 시즌 머문 날이 가장 많은 팀(같으면 늦게 온 팀). "그 시즌 스쿼드"는 전체, "그 시즌 그 선수의 팀"은 `primary`.
- `estimated = true`: 연도 단위 날짜나 열린 경력 닫기로 나온 소속(1987년부터 계산한 지금 약 97%).
- 한계: 시즌 초 출전 뒤 9/1 전에 떠난 선수는 옛 팀에서 빠진다. 연도 단위 겨울 이적은 한 시즌 어긋난다. 뒤 경력이 원본에 없는 열린 경력(예: 이헤아나초의 맨시티)과 남자 클럽에 붙은 여자 선수는 그대로 남는다. 이런 경우는 `manual/spells.csv`로 고친다.

## 우승·수상·감독 (`npm run football:honours`)

설계 `docs/superpowers/specs/2026-11-25-football-honours-design.md`. 순서: `football:fetch` → `football:seasons` → `football:honours`(시즌 소속을 쓴다).

```bash
npm run football:honours                              # 전체 (첫 실행 약 25분, 위키백과 호출 간격 5초)
npm run football:honours -- --only Q166177,Q19317     # 카탈로그 줄 일부만 다시(나머지 줄 행은 그대로)
npm run football:honours -- --no-cache                # 캐시(.cache/honours/) 무시
```

- 카탈로그 한 줄 = 수집 단위. `page`는 위키백과 문서 제목이고 `제목#절`이면 그 절만(하위 절 제외) 읽는다. 대표팀 대회는 `{year}` 틀.
- 리그·컵·대륙 대회 우승팀은 위키데이터 시즌 항목(P3450·P1346), 빠진 시즌만 `page`의 결승·역대 우승 표(리그는 그 대회가 1부였던 시기만). 둘이 다르면 "우승팀 불일치"를 찍으니 맞는 쪽을 `manual/honour_winners.csv`에 적는다.
- 선수 우승 = 그 시즌 그 팀 소속(시즌 소속 파일). 한 시즌 클럽 소속이 둘 이상인 선수의 그 시즌은 만들지 않는다(시즌 중간 이적·반 시즌 임대).
- 끝에 카탈로그 줄별 "행 N, 버린 선수·팀 M, 메모"를 찍는다. 버린 수는 우리 DB에 없는 선수(주로 아시아·옛 선수)다.
- `football:fetch`로 선수 목록이 바뀌면 `football:seasons`·`football:honours`도 다시 돌린다(없어진 선수를 가리키는 행은 CSV 검사에서 걸린다).

## 직접 입력 (`manual/`)

다시 수집해도 지워지지 않는다. 수집 때마다 위키데이터 값 위에 덮어쓴다.

- `names_ko.csv` (`entity_id,name_ko`): 선수·팀·국가 한글 표시 이름. 위키데이터에 없거나 표기가 마음에 안 들 때.
- `team_competitions.csv` (`team_id,competition_id,season`): 위키데이터에 빠진 시즌 참가팀. `team_id`는 위키데이터 QID, `season`은 시작 연도.
- `legends.csv` (`player_id,note`): 수집 범위(최근 시즌) 밖이지만 넣을 레전드 선수의 위키데이터 QID와 메모(예: `Q1487,티에리 앙리`). 전체 경력까지 함께 받는다. 축구 선수가 아니거나 QID 형식이 아니면 경고하고 뺀다. 레전드의 옛 시즌 리그 참가 기록은 수집 창 밖이라 생기지 않는다.
- `ballon_dor_nominees.csv` (`name,nation_ko,years,best_rank,player_id`): 레전드 원본. 발롱도르 후보 2000~2025년 전원 + 1990~1999년 연도별 상위 5위(381명). `npm run football:legends`가 이름을 위키데이터 ID로 바꿔 `legends.csv`에 `[발롱도르]` 줄로 넣고, 판정을 `ballon_dor_resolved.csv`에 쓴다. 확인 필요·못 찾음은 이 파일의 `player_id` 칸에 ID를 적고 다시 돌린다.
- `ballon_dor_resolved.csv`: 위 도구의 판정 결과(생성 파일, 손으로 고치지 않음).
- `honour_winners.csv` (`honour,season,team_id,source_url`): 위키데이터 대회 우승팀이 틀리거나 둘 이상일 때 덮어쓴다(예: 유로 2004).
- `world_cup_final_scorers.csv` (`season,player_id,team_id,source_url`): 1990~2022 월드컵 결승 득점자(자책골·승부차기 제외). 1990 서독은 독일 대표팀 ID.
- `openfootball_teams.csv` (`competition_id,name,team_id`): openfootball 팀 이름을 우리 ID로 직접 지정. `competition_id`가 비면 모든 리그.
- `spells.csv` (`action,player_id,team_id,source_ref,start_date,end_date,loan,source_url,note`): 경력 추가·수정·삭제. 설계 2026-11-01 §5.3.
  - `add`: 빠진 이적. `source_ref`는 비운다. `player_id`·`team_id`·`start_date`·`source_url` 필수.
  - `fix`: 기존 경력(`spells.csv`의 `source_ref`)의 날짜·임대 여부를 고친다. 채운 칸만 바뀐다. 연도 단위 경력을 일 단위로 고치려면 시작·종료를 둘 다 적는다. `source_url` 필수.
  - `delete`: 잘못된 경력(남자 클럽에 붙은 여자 팀 경력 등). `note`에 사유.
  - 근거는 구단 공식 발표·리그 기록 URL. 나무위키·위키백과는 단서로만 쓰고 크롤링하지 않는다.
  - 고친 뒤 `npm run football:seasons`를 돌리면 `spells.csv`와 `season_memberships.csv`에 바로 반영된다(다시 수집할 필요 없음). 오류가 있으면 줄 번호와 함께 멈춘다.
  - 예: `fix,Q15506789,,Q15506789-6E0BE90E-3141-4B62-81C8-DE4BE13349A4,2015-08-01,2017-08-03,,https://…,맨시티 → 레스터`

## 알려진 한계

- `name_en`(필수)은 영어 라벨 → 다국어(`mul`) 라벨 → 한국어 라벨 순으로 채운다. 위키데이터가 인명 라벨을 `mul`로 합치면서 영어 라벨이 없는 선수가 많다.
- 위키데이터의 '알 수 없는 값'은 빈 값으로 둔다. 종료일이 시작일보다 앞인 경력 구간(원본 오류)은 뺀다.
- 시즌 연도는 시즌 항목의 시작일(P580), 없으면 시점(P585)으로 잡는다.
- '축구 선수' 판별은 직업(P106)의 모든 순위 진술을 본다(폐기 제외). `wdt:P106`은 최고 순위만 보여 은퇴 후 감독이 우선 순위인 선수가 빠지기 때문이다.
- K리그1은 위키데이터의 시즌별 참가팀(P1923)이 시즌당 0~7팀뿐이고, 지금 소속(P118)에는 옛 클럽이 섞이고 현재 클럽 일부가 빠져 있다(2026-11-02 확인). 2017~2026 참가팀은 `manual/team_competitions.csv`로 채운다.
- 분데스리가 2020~2025의 위키데이터 시즌별 참가팀은 실제 클럽이 아닌 별도 항목(`Q979xxxxx`)을 가리킨다. openfootball 명단이 다 이어진 시즌은 openfootball 기준이라 빠진다.
- 위키데이터·openfootball 둘 다 없는 시즌: 쉬페르리그 2021·2022, 벨기에 2017·2021~2023·2026.
- 날짜가 없는 경력 구간은 뺀다. 위키데이터에 빠진 이적은 다른 출처(API-Football)나 직접 입력으로 보완한다.
- 대표 국적은 성인 대표팀 출전 → 종목 국적(P1532) → 시민권(P27) 순이라 이중 국적 선수가 틀릴 수 있다.
- 포지션 세부(`position_detail`)는 위키데이터에 있을 때만 채운다. 주발(`foot`)은 대부분 비어 있다.
- 클럽 색 비율은 같은 비율로 나눈 값이다. 등번호(`shirt_number`)는 비워 두며 API-Football 현재 스쿼드로 채운다.
- `confederation`은 아직 비어 있다.
- 우승·수상: 카탈로그 밖 대회·상은 없다. 아시아 선수 상당수가 선수 목록에 없어 아시안컵 엔트리는 일부만 이어진다. 캐나다(2001·2024 코파, 2022·2026 월드컵)·예멘(2019 아시안컵) 대표팀이 `teams.csv`에 없어 그 엔트리는 빠진다.
- 유스·2군·여자 팀은 이름 규칙(`U21`, `II`, `B`, `Jong`, `women` 등)으로 거른다. 걸러지지 않은 팀이 보이면 `scripts/football/wikidata.ts`의 `isYouthOrReserve`에 추가한다.
- 티키타카토(`data/tiki-taka-toe/`)는 이 데이터에서 생성한다. 갱신 순서는 `CLAUDE.md`의 "티키타카토 데이터 갱신"을 따른다.
