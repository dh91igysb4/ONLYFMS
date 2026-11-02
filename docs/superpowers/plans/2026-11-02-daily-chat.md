# 데일리 채팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데일리 문제를 끝낸 사람끼리 그 문제에 대해 실시간으로 글·사진을 주고받는 채팅을 붙인다.

**Architecture:** DB 테이블 `daily_chat` + definer RPC(`chat_list`/`chat_post`/`chat_delete`) + `can_chat` 기반 RLS, Supabase Realtime postgres_changes(RLS 적용)와 5초 폴링, 비공개 Storage 버킷 `daily-chat`(서명 주소). 화면은 플랫폼 `DailyPage`에 `DailyChat` 컴포넌트를 붙인다. 서버 함수(`play`·`duel`) 변경 없음.

**Tech Stack:** Supabase Postgres(RLS, definer 함수, pgTAP), Supabase Storage, supabase-js Realtime, Vite + React 18 + TS, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-02-daily-chat-design.md` (선행 `docs/superpowers/specs/2026-10-31-onlyfms-platform-design.md`). `CLAUDE.md`를 먼저 읽는다.

## Global Constraints

- 볼 수 있는 사람: 그 **데일리** 문항(`contests.kind = 'daily'`, 취소 안 됨, 숨김 게임이면 관리자만)을 **끝낸**(`attempts.finished = true`) 승인 사용자. 날이 지나도 같다.
- 글 1~300자(앞뒤 공백 제외, 공백만 불가) 또는 사진 1장, 둘 중 하나 이상.
- 도배: 본인 최근 2초 안에 글이 있으면 `too_fast`, 최근 1시간 60개 이상이면 `too_many`.
- 사진: 비공개 버킷 `daily-chat`, 경로 `<item_id>/<user_id>/<13자리 epoch_ms>.jpg`, `image/jpeg`만, 최대 1MB. 브라우저에서 EXIF 방향 반영 후 긴 쪽 1280px, JPEG 품질 0.85로 다시 그린다(메타데이터 제거). 서명 주소 유효 3600초.
- 지우기: 본인 또는 관리자. `deleted_at = now()`, `body = null`, `image_path = null`. 사진 파일도 지운다.
- 실시간: `daily_chat`만 `supabase_realtime` publication에 추가(대전 테이블은 계속 제외). 화면은 Realtime과 별개로 5초 폴링.
- 오류 코드 → 문구: `forbidden` "문제를 끝낸 사람만 쓸 수 있어요", `invalid_message` "1~300자로 써 주세요", `too_fast` "조금 천천히 보내 주세요", `too_many` "잠시 뒤에 다시 보내 주세요", 사진 형식 오류 "지원하지 않는 형식이에요", 사진 크기 초과 "사진이 너무 커요".
- 마이그레이션 파일: `supabase/migrations/20261102053000_daily_chat.sql` (기존 최신 `20261102043011` 뒤, UTC 기준). 실행 직전 `git fetch origin main`으로 더 새 파일이 생겼으면 그 뒤 시각으로 이름을 고친다.
- 정의자 함수는 `security definer set search_path = public`, 오류는 `raise exception using errcode = 'P0001', message = '<code>'`, 기본 권한 회수 후 필요한 것만 grant(기존 마이그레이션 패턴).
- 화면 문구 한국어, 모바일 우선, 색은 테마 토큰만. 게임 코드(`src/games/*`)는 바꾸지 않는다.
- 커밋 `type: 내용` + 세션 트레일러. 푸시 전 `npm test && npm run typecheck && npm run build`, DB 변경 시 `npm run db:test`.

## Review Focus

1. 안 끝낸 사람이 화면을 거치지 않고 `chat_list`/`chat_post`/테이블 select/Storage select를 직접 호출 → 전부 거부(Task 1 pgTAP).
2. 같은 메시지가 Realtime과 폴링으로 두 번 도착 → 한 번만 보임(Task 3 테스트 `dedupe_realtime_and_poll`).
3. 사진 업로드는 됐는데 `chat_post`가 `too_fast` 등으로 실패 → 올린 파일 삭제, 입력 내용 유지, "다시 보내기"(Task 3 `upload_then_post_fails_cleans_up`).
4. 서명 주소가 만료된 사진(1시간 넘게 켜 둔 탭) → 로드 실패 시 새 주소를 한 번 받아 다시 표시(Task 3 `signed_url_retry_once`).
5. 사진만 보내기·글만 보내기·둘 다 → 모두 허용, 둘 다 없으면 버튼 비활성(Task 3 `send_button_states`).

---

### Task 1: DB — 테이블·권한·RPC·Realtime·Storage

**Files:**
- Create: `supabase/migrations/20261102053000_daily_chat.sql`
- Modify: `supabase/tests/shim.sql` (Storage 최소 흉내: 스키마 `storage`, 테이블 `storage.buckets(id text pk, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])`, `storage.objects(id uuid pk default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now())` RLS 켬, 함수 `storage.foldername(name text) returns text[]`(Supabase와 같은 동작: 마지막 요소 뺀 경로 조각), publication `supabase_realtime`가 없으면 생성. 주석으로 "실제 Supabase가 제공, 테스트 전용" 명시)
- Test: `supabase/tests/08_daily_chat.test.sql`

**Interfaces:**
- Produces (DB):
  - 테이블 `daily_chat(id uuid pk, item_id uuid not null → contest_items on delete cascade, user_id uuid → profiles on delete set null, body text, image_path text, created_at timestamptz not null default now(), deleted_at timestamptz)`, 인덱스 `(item_id, created_at)`, 제약: 삭제되지 않은 행은 `body is not null or image_path is not null`; `body`는 null 또는 `char_length(btrim(body)) between 1 and 300`; `image_path`는 null 또는 `image_path ~ ('^' || item_id || '/' || user_id || '/[0-9]{13}\.jpg$')`.
  - `can_chat(p_item uuid) returns boolean` — 승인 사용자 + 데일리 문항 + 미취소 + (숨김 게임이면 관리자) + 본인 attempt finished.
  - `chat_list(p_item uuid, p_before timestamptz default null, p_limit int default 100) returns table(id uuid, user_id uuid, handle text, body text, image_path text, created_at timestamptz, deleted boolean, mine boolean)` — 최신순, `p_limit`은 1~100으로 자름, 못 보면 `forbidden`.
  - `chat_post(p_item uuid, p_body text, p_image_path text default null) returns table(id uuid, created_at timestamptz)` — body는 btrim 후 빈 문자열이면 null 처리. 오류 `forbidden` / `invalid_message` / `too_fast` / `too_many`.
  - `chat_delete(p_id uuid) returns text` — 지우기 전 `image_path`(없으면 null) 반환. 본인·관리자 외 `forbidden`, 없는 id `not_found`.
  - RLS: select는 `can_chat(item_id)`. insert/update/delete 정책 없음(브라우저 쓰기 불가), 테이블 쓰기 권한 회수. `authenticated`에 select 컬럼 권한만.
  - `alter publication supabase_realtime add table public.daily_chat;`
  - Storage: `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('daily-chat', 'daily-chat', false, 1048576, array['image/jpeg']) on conflict (id) do nothing;` 정책(대상 `authenticated`, `bucket_id = 'daily-chat'`): select `public.can_chat(((storage.foldername(name))[1])::uuid)`; insert 위 조건 + `(storage.foldername(name))[2] = auth.uid()::text`; delete 본인 폴더 또는 `public.is_admin()`.

- [ ] **Step 1: `08_daily_chat.test.sql` 작성** (기존 `07_duel.test.sql`의 사용자 생성·`request.jwt.claims` 패턴). 데일리 대회+문항 2개(어제·오늘), 일반 대회 문항 1개, 사용자 A(오늘 맞힘), B(오늘 포기 = finished, score 0), C(시작만, 미완료), D(미시작), 관리자 E, 미승인 F.
  - `can_chat_rules`: A·B true, C·D·F false, 일반 대회 문항 false, 어제 문항은 A false(어제 안 풂).
  - `select_rls`: C로 `select count(*) from daily_chat` = 0, A는 오늘 글 수.
  - `list_forbidden`: C의 `chat_list(오늘)` → `forbidden`.
  - `post_ok_and_lengths`: A 300자 OK, 301자 `invalid_message`, `'   '` `invalid_message`, null+null `invalid_message`.
  - `post_forbidden`: C·D·F `forbidden`.
  - `too_fast`: A가 연달아 두 번 → 두 번째 `too_fast`(테스트에서는 첫 행 `created_at`을 now()로 둠). `too_many`: A의 최근 1시간 60행을 직접 넣은 뒤(소유자 권한으로) post → `too_many`.
  - `image_path_rules`: A가 자기 폴더 경로 OK, B 폴더 경로 `invalid_message`, 다른 문항 경로 `invalid_message`, `.png` `invalid_message`.
  - `delete_rules`: A가 자기 글 삭제 → 반환 경로, `body`·`image_path` null, `chat_list`의 `deleted` true. B가 A 글 삭제 → `forbidden`. E가 B 글 삭제 OK. 없는 id `not_found`.
  - `no_direct_writes`: authenticated로 insert/update/delete `daily_chat` 거부.
  - `hidden_game`: 숨김 게임 데일리 문항 → 일반 사용자 false, 관리자(끝냈으면) true.
  - `publication`: `daily_chat`은 `pg_publication_tables`(supabase_realtime)에 있고, 대전 테이블 4개는 없다.
  - `storage_policies`: A로 `insert into storage.objects(bucket_id, name, owner)` 자기 폴더 OK, B 폴더 거부; C로 select 0행; A로 select 보임; E delete OK.
- [ ] **Step 2: 실패 확인** — `npm run db:test` → 08 실패.
- [ ] **Step 3: shim 보강 + 마이그레이션 구현.**
- [ ] **Step 4: 통과 확인** — `npm run db:test` 전체 PASS(기존 07_duel의 publication 검사 포함).
- [ ] **Step 5: 커밋** — `feat: 데일리 채팅 테이블·권한·RPC·사진 저장소`

---

### Task 2: 채팅 데이터 계층(브라우저)

**Files:**
- Create: `src/platform/chat/api.ts`, `src/platform/chat/image.ts`
- Test: `src/platform/chat/api.test.ts`, `src/platform/chat/image.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC 이름·인자(`p_item`, `p_before`, `p_limit`, `p_body`, `p_image_path`, `p_id`), `src/lib/api.ts`의 `rpc`, `ApiError`, `src/lib/supabase.ts`의 `supabase`.
- Produces:
  - `type ChatMessage = { id: string; userId: string | null; handle: string | null; body: string | null; imagePath: string | null; createdAt: string; deleted: boolean; mine: boolean }`
  - `listChat(itemId: string, before?: string): Promise<ChatMessage[]>` (오래된 것→최신 순으로 뒤집어 돌려줌)
  - `postChat(itemId: string, body: string | null, imagePath: string | null): Promise<{ id: string; createdAt: string }>`
  - `deleteChat(id: string): Promise<void>` (반환 경로가 있으면 `supabase.storage.from('daily-chat').remove([path])`)
  - `uploadChatImage(itemId: string, userId: string, blob: Blob): Promise<string>` (경로 `${itemId}/${userId}/${Date.now()}.jpg`, `contentType: 'image/jpeg'`, `upsert: false`), `removeChatImage(path: string): Promise<void>`
  - `signedChatImageUrl(path: string): Promise<string>` (3600초)
  - `chatErrorMessage(code: string): string` (Global Constraints 문구, 모르는 코드는 `errorMessage` 사용)
  - `image.ts`: `prepareChatImage(file: File): Promise<Blob>` — `createImageBitmap(file, { imageOrientation: 'from-image' })`, 긴 쪽 1280px로 축소(작으면 그대로), canvas → `toBlob('image/jpeg', 0.85)`; 디코딩 실패 → `ApiError('image_unsupported', 0)`, 결과 > 1,048,576 바이트 → `ApiError('image_too_large', 0)`. 크기 계산은 순수 함수 `fitSize(w: number, h: number, max = 1280): { w: number; h: number }`로 분리.

- [ ] **Step 1: 테스트 작성**
  - `fitSize`: (4000,3000)→(1280,960), (3000,4000)→(960,1280), (800,600)→(800,600), (1280,1280)→(1280,1280).
  - `prepareChatImage`: `createImageBitmap` 거부 시 `image_unsupported`; `toBlob` 결과 크기 1,048,577 → `image_too_large` (createImageBitmap·canvas는 mock).
  - `api`: `listChat`가 RPC 결과를 최신순→오래된순으로 뒤집고 필드 이름을 바꿈; `postChat` 인자 매핑; `deleteChat`가 반환 경로로 `remove` 호출, null이면 호출 안 함; `uploadChatImage` 경로 형식 `/^item\/user\/\d{13}\.jpg$/`; `chatErrorMessage` 6개 코드 문구.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/chat`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과** — `npx vitest run src/platform/chat && npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat: 데일리 채팅 데이터 계층과 사진 줄이기`

---

### Task 3: 채팅 화면과 데일리 연결

**Files:**
- Create: `src/platform/chat/DailyChat.tsx`, `src/platform/chat/chat.css`, `src/platform/chat/useChat.ts`
- Modify: `src/platform/games/PlayRunner.tsx` (server 모드에 선택 prop `onFinishedChange?: (finished: boolean) => void` — 보기의 `finished`가 바뀔 때 호출), `src/platform/games/DailyPage.tsx` (끝났을 때 `<DailyChat itemId={itemId} />`를 러너 아래에)
- Test: `src/platform/chat/DailyChat.test.tsx`, `src/platform/games/pages.test.tsx`(데일리 연결 1건)

**Interfaces:**
- Consumes: Task 2 전부, `useAuth()`(`profile.id`, `profile.is_admin`), `supabase.channel`.
- Produces:
  - `useChat(itemId: string): { messages: ChatMessage[]; error: string | null; send(body: string | null, file: File | null): Promise<boolean>; remove(id: string): Promise<void>; loadOlder(): Promise<void>; hasOlder: boolean }` — 마운트 시 `listChat`; Realtime `supabase.channel(\`daily-chat:${itemId}\`).on('postgres_changes', { event: '*', schema: 'public', table: 'daily_chat', filter: \`item_id=eq.${itemId}\` }, …)`로 insert는 추가, update는 교체(삭제 반영); 5초마다 `listChat`로 최신 병합; id로 중복 제거, `createdAt` 순 정렬; 진행 중 요청이 있으면 폴링을 겹쳐 보내지 않음(single-flight); 언마운트 시 채널·타이머 정리. Realtime 이벤트에는 `handle`이 없으므로 이미 아는 `userId→handle`을 쓰고, 모르면 다음 폴링이 채운다(그 전엔 "…").
  - `DailyChat({ itemId }: { itemId: string })` — 카드 제목 "오늘의 대화", 메시지 목록(아이디·시각 HH:MM·내용·사진 썸네일 최대 240px, 내 메시지 오른쪽 정렬, 지운 메시지 "삭제된 메시지"), 맨 위 "이전 대화 더 보기"(hasOlder일 때), 맨 아래 붙어 있으면 새 글에 자동 스크롤·아니면 "새 메시지" 버튼, 입력 textarea(Enter 보내기·Shift+Enter 줄바꿈, `n/300` 표시), 사진 버튼(파일 input `accept="image/*"`, 고르면 미리보기·취소), 보내기 버튼, 실패 시 입력 유지 + 오류 문구 + "다시 보내기", 내 메시지(관리자는 모두)에 "지우기"(두 번 눌러 확정). 사진 클릭 시 큰 보기(오버레이, Esc·바깥 클릭 닫기).
  - 보내기 순서: 사진 있으면 `prepareChatImage` → `uploadChatImage` → `postChat`; `postChat` 실패 시 `removeChatImage`.

- [ ] **Step 1: 테스트 작성** (`vi.mock` api·supabase 채널·`useAuth`, 가짜 타이머)
  - `hidden_until_finished`: `DailyPage`에서 러너가 `finished=false`면 "오늘의 대화" 없음, `onFinishedChange(true)` 뒤 표시(pages.test).
  - `renders_messages`: 내 메시지 `data-mine`, 지운 메시지 "삭제된 메시지", 사진은 서명 주소 img.
  - `send_text`: 입력 후 Enter → `postChat(item, '안녕', null)`, 입력 비워짐; Shift+Enter는 보내지 않음.
  - `send_button_states`: 글·사진 둘 다 없으면 비활성; 글만, 사진만, 둘 다 활성; 301자면 비활성.
  - `send_image_only`: 파일 고름 → `prepareChatImage`→`uploadChatImage`→`postChat(item, null, path)`.
  - `upload_then_post_fails_cleans_up`: `postChat`이 `too_fast` → `removeChatImage(path)` 호출, 입력·사진 유지, "조금 천천히 보내 주세요", "다시 보내기".
  - `realtime_insert_appends`: 채널 콜백에 insert → 목록에 추가.
  - `dedupe_realtime_and_poll`: 같은 id가 Realtime과 5초 폴링 모두로 와도 1개.
  - `poll_when_realtime_fails`: `channel()`이 throw해도 5초마다 `listChat` 호출, 새 글 표시.
  - `delete_two_step`: "지우기" → "한 번 더 누르면 지우기" → `deleteChat(id)`; 남의 메시지엔 버튼 없음, 관리자는 있음.
  - `signed_url_retry_once`: img `onError` → `signedChatImageUrl` 한 번 더 호출, 두 번째 실패 뒤엔 더 안 부름.
  - `forbidden_shows_message`: `listChat`이 `forbidden` → 카드에 "문제를 끝낸 사람만 쓸 수 있어요".
- [ ] **Step 2: 실패 확인** — `npx vitest run src/platform/chat src/platform/games`.
- [ ] **Step 3: 구현.** 색은 테마 토큰, 내 메시지 배경은 `--panel` 계열·테두리 `--accent-strong` 같은 기존 토큰 사용.
- [ ] **Step 4: 통과** — `npm test && npm run typecheck && npm run build`. 390px·1280px(라이트·다크)에서 가로 스크롤 없음(가능하면 `/tmp/claude-0/-home-claude/c014076f-edc3-56db-9a60-910b757c78df/scratchpad/audit/`의 하네스 재사용, 저장소에 남기지 않음).
- [ ] **Step 5: 커밋** — `feat: 데일리 채팅 화면(실시간·사진·지우기)`

---

### Task 4: 문서와 배포 확인 항목

**Files:**
- Modify: `docs/deploy-checklist.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/deploy-checklist.md`에 "데일리 채팅 배포" 절**: `npx -y supabase@2 db push`(daily_chat 마이그레이션) → 머지(Vercel). 수동 확인: 끝낸 계정 둘이 글·사진 주고받기(1~2초), 안 끝낸 계정은 채팅 미표시 + 개발자 도구 WebSocket에 `daily_chat` 이벤트 없음, 안 끝낸 계정으로 사진 서명 주소 생성 실패, 지우기 후 사진 주소 열리지 않음, 아이폰·안드로이드 사진 올리기.
- [ ] **Step 2: `CLAUDE.md` 폴더 규칙**에 `src/platform/chat/` (데일리 채팅: 데이터 계층·화면, 권한은 DB `can_chat`), Storage 버킷 `daily-chat`(비공개) 한 줄.
- [ ] **Step 3: 전체 검증** — `npm test && npm run typecheck && npm run build && npm run db:test`.
- [ ] **Step 4: 커밋** — `docs: 데일리 채팅 배포 확인 항목과 폴더 규칙`
