# 채팅 봇 설계 (재원봇)

2026-11-03 · 데일리 채팅(`2026-11-02-daily-chat-design.md`) 위에 얹는다.

## 1. 목표
- 데일리 채팅에서 친구 말투를 흉내 내는 AI 봇(첫 봇: 재원 말투의 `재원봇`)과 떠들고 키배를 뜬다. 본인 동의를 받았다.
- 봇은 여러 개를 둘 수 있게 만들고, 플랫폼 코드에 봇별 분기를 두지 않는다. 봇마다 다른 점은 DB의 `chat_bots` 행으로 정한다.
- 범위 밖(다음 단계): 봇이 데일리를 직접 풀어 리더보드에 오르는 것, 아무도 부르지 않았을 때 봇이 끼어드는 것.

## 2. 흐름
1. 사용자가 데일리 채팅에 글을 쓴다(`chat_post`, 기존 그대로).
2. 글 쓰기가 성공하면 브라우저가 `chat-bot` Edge Function을 `{ item_id }`로 부른다(텍스트 글만, 사진만 보낸 글은 부르지 않는다).
3. 함수는
   - 토큰으로 사용자를 확인하고, 트랜잭션 안에서 `request.jwt.claims`를 그 사용자로 두고 `can_chat(item)`을 부른다. 권한 규칙을 다시 만들지 않고 기존 함수를 쓴다.
   - 그 사용자가 그 문항에 **60초 안에** 쓴 마지막 글을 DB에서 읽는다(브라우저가 보낸 본문을 믿지 않는다). 켜진 봇 가운데 `trigger_words`가 들어 있는 첫 봇을 고른다. 없으면 `{ replies: [] }`를 돌려주고 모델을 부르지 않는다.
   - 도배 제한: 같은 문항·같은 봇은 8초에 한 번, 한 사람은 한 시간에 30번. 문항별 advisory lock으로 동시 요청을 줄 세운다. 통과하면 `chat_bot_calls`에 기록한다.
   - 트랜잭션 밖에서 최근 30줄 대화와 말투 예시를 모아 모델(Anthropic Messages API)을 부른다.
   - 답을 말풍선으로 쪼개(최대 6개, 각 300자) `daily_chat`에 `user_id = null, bot_id = 봇 id`로 넣는다. 순서를 지키려고 `created_at`을 1ms씩 민다.
4. 부른 사람 화면은 함수 응답으로 봇 글을 바로 붙인다. 다른 사람 화면은 Realtime INSERT로 받는다. 이때는 봇 이름을 몰라 `…`로 보이고, 5초 폴링(`chat_list`)이 이름을 채운다.
5. 봇 호출 실패(`bot_failed`, `too_fast`, `too_many`)는 화면에 띄우지 않는다. 함수 호출의 403이 권한 알림(onAccessDenied)으로 번지지 않게 `callFunction(..., { quiet: true })`로 부른다.

## 3. 스키마 (`20261103072000_chat_bot.sql`)
- `chat_bots(id, handle, trigger_words, system_prompt, model, enabled)`
- `chat_bot_examples(bot_id, context, reply)`: 실제 대화에서 뽑은 (앞 대화 → 그 사람의 답) 쌍
- `chat_bot_calls(bot_id, item_id, user_id, created_at)`: 도배 제한용
- 세 표 모두 RLS를 켜고 정책을 두지 않으며 anon·authenticated 권한을 회수한다. 함수(소유자 연결)만 읽는다. 성격 프롬프트가 브라우저로 새지 않는다.
- `daily_chat.bot_id` 추가. 제약 `bot_id is null or (user_id is null and image_path is null)`. 봇을 지우면 글은 남고 `bot_id`만 null이 된다.
- `chat_list`는 반환 형태를 바꾸지 않고 `handle = coalesce(사용자 아이디, 봇 이름)`만 바꾼다. 봇 글은 `mine = false`.
- 볼 수 있는 사람(`can_chat`)과 지우기(`chat_delete`: 관리자만 봇 글을 지울 수 있다)는 그대로다.

## 4. 프롬프트 (`supabase/functions/chat-bot/logic.ts`)
- system: `chat_bots.system_prompt` (성격, 사실 설정, 말투 규칙, 출력 형식, 넘지 않을 선)
- user: 말투 예시 26개 + 지금 대화
  - 예시 16개는 최근 8줄과 단어가 많이 겹치는 것, 10개는 무작위다. 시드는 문항 id와 대화로 정해 결정적으로 뽑는다.
  - 대화는 "아이디: 말" 줄. 사진은 `(사진)`, 줄바꿈은 ` / `로 적고, 봇 글은 봇 이름으로 적는다.
- 출력 정리(`parseBubbles`): 이름표(`재원봇:`, `[재원봇]`, `재원:`), 따옴표, 빈 줄, `---`를 걷어 낸다.

## 5. 봇 원본 데이터 (공개 저장소에 두지 않는다)
- 저장소는 공개다. 봇 원본(단톡방 대화에서 뽑은 예시, 실명이 나오는 성격 설정)은 `restricted/<bot-id>/`(gitignore)에만 둔다.
- `scripts/chat-bot/build-seed.py <bot-id>`로 `restricted/<bot-id>/seed.sql`을 만들어 운영 DB에 한 번 실행한다(배포 체크리스트 "채팅 봇 배포").
- 모델과 부름말은 `restricted/<bot-id>/bot.json`에서 정한다. 기본 모델은 `claude-sonnet-5-5`이다.

## 6. 테스트
- `supabase/tests/11_chat_bot.test.sql`: 표 권한(브라우저 접근 불가), 봇 행 제약, `chat_list`의 봇 이름과 `mine`, 봇 삭제 시 글 보존
- `supabase/functions/chat-bot/logic.test.ts`: 부름말 판단, 예시 고르기(결정성), 대화 기록, 출력 정리
- `supabase/functions/chat-bot/handler.test.ts` (`npm run fn:test`, 가짜 모델): 401·400·403, 부름말 없음과 60초 지난 글이면 모델을 부르지 않음, 봇 글이 순서대로 들어감, 다음 호출의 대화 기록에 봇 이름, 429 `too_fast`·`too_many`, 모델 실패 502(글 없음), 빈 답
- `src/platform/chat/DailyChat.test.tsx`, `api.test.ts`, `src/lib/api.test.ts`: 글을 쓴 뒤 봇 호출, 봇 답 표시, 실패해도 화면 오류 없음, 사진만 보낸 글은 부르지 않음, Realtime 봇 글은 `…`로 보였다가 폴링 뒤 이름으로 바뀜, 403이 권한 알림으로 번지지 않음
