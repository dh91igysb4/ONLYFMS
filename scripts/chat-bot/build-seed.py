#!/usr/bin/env python3
"""채팅 봇 seed SQL 만들기 (설계 2026-11-03-chat-bot §5).

봇의 성격과 말투 예시는 실제 단톡방 대화에서 왔으므로 공개 저장소에 두지 않는다.
restricted/<bot-id>/ (gitignore) 에 아래 세 파일을 두고 이 스크립트로 seed.sql을 만든 뒤,
Supabase SQL 편집기나 psql로 한 번 실행한다. 다시 실행하면 봇 설정은 덮어쓰고 예시는 갈아 끼운다.

  restricted/<bot-id>/bot.json          {"handle": "재원봇", "trigger_words": ["@재원", "재원봇"], "model": "claude-sonnet-5-5"}
  restricted/<bot-id>/system_prompt.md  system 프롬프트(성격·말투 규칙)
  restricted/<bot-id>/examples.json     [{"ctx": ["이름: 말", ...], "reply": ["말풍선", ...]}, ...]

사용: python3 scripts/chat-bot/build-seed.py jaewon   → restricted/jaewon/seed.sql
"""
import json
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def lit(s: str) -> str:
    """달러 인용. 내용에 같은 태그가 나올 수 없게 무작위 태그를 쓴다."""
    while True:
        tag = 'q' + secrets.token_hex(4)
        if f'${tag}$' not in s:
            return f'${tag}${s}${tag}$'


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit('usage: build-seed.py <bot-id>')
    bot_id = sys.argv[1]
    d = ROOT / 'restricted' / bot_id
    bot = json.loads((d / 'bot.json').read_text(encoding='utf-8'))
    prompt = (d / 'system_prompt.md').read_text(encoding='utf-8').strip()
    examples = json.loads((d / 'examples.json').read_text(encoding='utf-8'))

    out = [
        f'-- 자동 생성: scripts/chat-bot/build-seed.py {bot_id}. 저장소에 올리지 않는다.',
        'begin;',
        'insert into public.chat_bots (id, handle, trigger_words, system_prompt, model, enabled) values (',
        f"  {lit(bot_id)}, {lit(bot['handle'])},",
        '  array[' + ', '.join(lit(w) for w in bot.get('trigger_words', [])) + ']::text[],',
        f'  {lit(prompt)},',
        f"  {lit(bot.get('model', 'claude-sonnet-5-5'))}, true)",
        'on conflict (id) do update set handle = excluded.handle, trigger_words = excluded.trigger_words,',
        '  system_prompt = excluded.system_prompt, model = excluded.model, enabled = excluded.enabled;',
        f'delete from public.chat_bot_examples where bot_id = {lit(bot_id)};',
    ]
    n = 0
    for e in examples:
        ctx = '\n'.join(e['ctx']).strip()
        reply = '\n'.join(e['reply']).strip()
        if not ctx or not reply:
            continue
        out.append(
            f'insert into public.chat_bot_examples (bot_id, context, reply) values ({lit(bot_id)}, {lit(ctx)}, {lit(reply)});')
        n += 1
    out.append('commit;')
    (d / 'seed.sql').write_text('\n'.join(out) + '\n', encoding='utf-8')
    print(f'{d / "seed.sql"}: bot {bot_id}, examples {n}')


if __name__ == '__main__':
    main()
