# 데일리 채팅 설계

- 작성일: 2026-11-02
- 상태: 검토 대기
- 범위: 데일리 문제를 끝낸 사람끼리 그 문제에 대해 실시간으로 대화하는 채팅(글·사진). 모든 데일리 게임에 공통으로 붙는다.
- 선행 문서: [플랫폼 설계](2026-10-31-onlyfms-platform-design.md). 승인 사용자, 숨김 게임, 한국어·모바일·테마 토큰, 게임별 분기 금지 규칙은 그 문서를 따른다.

## 1. 목표와 성공 기준

1. 데일리 문제를 **끝낸**(맞혔든 포기했든 `attempts.finished = true`) 승인 사용자만 그 문제의 채팅을 읽고 쓸 수 있다. 끝내지 않은 사람에게는 채팅이 보이지 않고, 어떤 경로로도(테이블, RPC, Realtime, 사진 주소) 내용을 얻을 수 없다.
2. 날이 바뀌어도 규칙은 같다(지난 데일리도 끝낸 사람만).
3. 새 글은 1~2초 안에 다른 사람 화면에 나타난다. Realtime이 끊겨도 5초 안에 맞춰진다.
4. 글(1~300자)과 사진(메시지당 1장, 선택)을 보낼 수 있다. 글 없이 사진만도 된다.
5. 본인은 자기 메시지를, 관리자는 모든 메시지를 지울 수 있다. 지우면 사진 파일도 지워진다.
6. 게임 코드는 바뀌지 않는다. 데일리 화면(플랫폼)에만 붙는다.

## 2. 결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| 볼 수 있는 사람 | 그 데일리 문항을 끝낸 사람 | 사용자 결정. 정답이 공개된 사람끼리라 스포일러 없음 |
| 형태 | 실시간 채팅 | 사용자 결정 |
| 날이 지난 뒤 | 계속 끝낸 사람만 | 기본값 |
| 실시간 전달 | Supabase Realtime postgres_changes(RLS 적용) + 5초 폴링 | 서버 함수 추가 없음. RLS가 끝낸 사람에게만 전달 |
| 사진 저장 | 비공개 Storage 버킷 + 1시간 서명 주소 | 채팅을 못 보는 사람은 사진도 못 봐야 함 |
| 사진 크기 | 브라우저에서 긴 쪽 1280px JPEG로 줄임, 최대 1MB | 무료 1GB 안에서 오래 운영 |
| 도배 방지 | 1인당 2초에 1개, 1시간에 60개 | 친구 규모 |

## 3. 데이터 모델 (새 마이그레이션 하나, `npx supabase@2 migration new daily_chat`)

### daily_chat

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| item_id | uuid not null FK contest_items on delete cascade | 데일리 문항 |
| user_id | uuid FK profiles on delete set null | 작성자(탈퇴 시 null, "알 수 없음") |
| body | text null | 1~300자(공백만은 불가). 사진만 보낼 때 null |
| image_path | text null | Storage 경로 `<item_id>/<user_id>/<epoch_ms>.jpg` |
| created_at | timestamptz not null default now() | |
| deleted_at | timestamptz null | 지운 메시지(목록에는 "삭제된 메시지"로 남음) |

- 제약: `body is not null or image_path is not null`; `image_path`는 정규식 `^<item_id>/<user_id>/[0-9]{13}\.jpg$` 형식(작성자 본인 폴더만).
- 인덱스: `(item_id, created_at)`.

### 권한

- `can_chat(p_item uuid) returns boolean` (definer, `search_path = public`): 호출자가 승인 사용자이고, `p_item`이 **데일리** 대회 문항이며(`contests.kind = 'daily'`, 취소되지 않음, 숨김 게임이면 관리자만), 호출자의 `attempts(item_id = p_item).finished = true`일 때만 true.
- RLS
  - select: `can_chat(item_id)`.
  - insert/update/delete: 브라우저 직접 쓰기 불허. 아래 RPC로만.
- 컬럼 권한: 브라우저는 `id, item_id, user_id, body, image_path, created_at, deleted_at`만 select. 지운 메시지의 `body`/`image_path`는 RPC·화면에서 숨긴다(Realtime 페이로드에서도 지운 뒤에는 null이 되도록 삭제 시 두 컬럼을 null로 바꾼다).

### RPC (definer, 승인 사용자)

- `chat_list(p_item uuid, p_before timestamptz default null, p_limit int default 100)` → `id, user_id, handle, body, image_path, created_at, deleted, mine` 최신순 최대 100개(`p_before`보다 이전). `can_chat` false면 `forbidden`.
- `chat_post(p_item uuid, p_body text, p_image_path text default null)` → 새 행. 검사: `can_chat`, 길이, 경로 형식(본인 폴더·해당 문항), 도배(최근 2초 내 본인 글 있으면 `too_fast`, 최근 1시간 60개 이상이면 `too_many`). 오류 코드 `forbidden`, `invalid_message`, `too_fast`, `too_many`.
- `chat_delete(p_id uuid)` → 본인 또는 관리자. `deleted_at = now()`, `body = null`, `image_path = null`로 바꾸고, 지우기 전 경로를 돌려준다(화면이 Storage 파일 삭제에 씀). 관리자가 지운 경우 파일 삭제는 관리자 권한 Storage 정책으로 허용.

### Realtime

- `daily_chat`을 `supabase_realtime` publication에 추가. postgres_changes는 구독자별로 select RLS를 적용하므로 끝낸 사람에게만 전달된다(원격에서 확인 필요, §8).
- 다른 대전 테이블은 publication에 넣지 않는다(기존 pgTAP 검사 유지).

### Storage

- 버킷 `daily-chat`: 비공개, 파일 최대 1MB, `image/jpeg`만.
- `storage.objects` 정책(버킷 `daily-chat`):
  - select: `can_chat((storage.foldername(name))[1]::uuid)`.
  - insert: 위 조건 + `(storage.foldername(name))[2] = auth.uid()::text`.
  - delete: 본인 폴더 또는 관리자.
- 화면은 `createSignedUrl(path, 3600)`으로 보여준다.

## 4. 화면

- 위치: 데일리 화면(`DailyPage`, 플랫폼)에서 그 문항이 끝났을 때(`finished`) 결과 아래에 "오늘의 대화" 카드. 데스크톱(≥900px)에서는 오른쪽 칸 맨 위. 지난 데일리를 끝난 상태로 다시 열어도 보인다.
- 목록: 아이디·시각·내용, 내 메시지는 오른쪽·다른 색(테마 토큰). 지운 메시지는 "삭제된 메시지". 위로 스크롤하면 이전 100개 더 불러오기.
- 새 글: Realtime insert/update 이벤트로 붙이거나 갱신. 맨 아래에 있으면 자동 스크롤, 위에 있으면 "새 메시지" 버튼. Realtime과 별개로 5초마다 `chat_list`로 최신을 맞춘다(중복은 id로 제거).
- 입력: 글 입력칸(Enter 보내기, Shift+Enter 줄바꿈, 300자 표시), 사진 버튼. 보내는 중 비활성, 실패하면 메시지 옆 "다시 보내기". 오류 문구: `too_fast` "조금 천천히 보내 주세요", `too_many` "잠시 뒤에 다시 보내 주세요", `forbidden` "문제를 끝낸 사람만 쓸 수 있어요", 사진 형식 오류 "지원하지 않는 형식이에요".
- 사진: 고르면 브라우저에서 EXIF 방향 반영 → 긴 쪽 1280px JPEG(품질 0.85)로 줄임(GPS 등 메타데이터 제거) → 1MB 넘으면 거부 → Storage 업로드 → `chat_post`. 업로드 후 `chat_post`가 실패하면 올린 파일을 지운다. 목록에서는 최대 240px 썸네일, 누르면 크게.
- 지우기: 내 메시지(관리자는 모두)에 "지우기" → 확인 → `chat_delete` → 돌려받은 경로의 파일 삭제.

## 5. 오류·경계

- 끝내지 않은 상태에서 화면을 조작해 RPC를 불러도 `forbidden`.
- 서명 주소 만료(1시간): 이미지 로드 실패 시 새 주소를 한 번 다시 받는다.
- HEIC 등 브라우저가 못 읽는 형식: 거부(기기별 동작은 원격 확인, §8).
- Realtime 구독 실패: 경고 로그만, 폴링으로 계속.

## 6. 테스트

- pgTAP: 안 끝낸 사람 select·`chat_list`·`chat_post` 거부, 끝낸 사람 허용(맞힘·포기 둘 다), 데일리가 아닌 대회 문항 거부, 다른 날 문항 분리, 길이·빈 메시지·경로 형식(남의 폴더, 다른 문항) 거부, `too_fast`·`too_many`, 본인·관리자 삭제·남의 삭제 거부, 삭제 시 body·image_path null, 숨김 게임 비관리자 거부, Storage 정책(로컬 shim에서 가능한 범위: `can_chat` 기반 정책 식 검사), publication 포함 확인.
- 화면(vitest): 끝나기 전 채팅 미표시, 목록 표시·내 메시지 정렬, 보내기·실패 후 다시 보내기, Realtime 이벤트로 추가, 구독 실패 시 5초 폴링, 중복 제거, 삭제 표시, 사진 줄이기(가로·세로·큰 사진, 1MB 초과 거부), 사진만 보내기, 업로드 후 post 실패 시 파일 삭제.

## 7. 배포

1. `npx -y supabase@2 db push` (테이블·RPC·RLS·publication·버킷·Storage 정책).
2. Vercel 배포(머지). 서버 함수 재배포 없음.

## 8. 원격에서만 확인할 것 (배포 체크리스트에 추가)

- 끝낸 계정 A, 안 끝낸 계정 B: A가 글을 쓰면 다른 끝낸 계정에는 1~2초 안에 보이고, B에게는 Realtime 이벤트가 오지 않는다(브라우저 개발자 도구 WebSocket 프레임 확인).
- B가 사진의 서명 주소를 만들 수 없고, A가 받은 서명 주소는 1시간 뒤 열리지 않는다.
- 아이폰·안드로이드에서 사진 고르기·줄이기·올리기.

## 9. 범위 밖

- 대회·대전 채팅, 1:1 메시지, 알림, 이모지 반응, 답글, 메시지 수정, 동영상.
