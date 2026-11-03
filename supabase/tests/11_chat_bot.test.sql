-- 채팅 봇: 봇 표 권한, daily_chat.bot_id 제약, chat_list의 봇 이름 (설계 2026-11-03-chat-bot §3)
begin;
select plan(14);

\set A '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'
\set ua '00000000-0000-0000-0000-0000000000b1'
\set item 'db000000-0000-0000-0000-000000000001'

insert into auth.users (id, email) values (:'ua', 'bota@example.com');
update public.profiles set status = 'approved', handle = 'bota' where id = :'ua';
insert into public.contests (id, kind, title, visibility, starts_at, ends_at, daily_key) values
  ('cb000000-0000-0000-0000-000000000001', 'daily', 'bot', 'public',
   now() - interval '1 hour', now() + interval '23 hours', 'bot-today');
insert into public.contest_items (id, contest_id, position, game_id, logic_version, generated_at) values
  (:'item', 'cb000000-0000-0000-0000-000000000001', 1, 'g-bot', 1, now());
insert into public.attempts (item_id, user_id, state, logic_version, finished, score, finished_at) values
  (:'item', :'ua', '{}', 1, true, 1, now());

insert into public.chat_bots (id, handle, trigger_words, system_prompt) values
  ('jaewon', '재원봇', array['@재원', '재원봇'], 'secret persona');
insert into public.chat_bot_examples (bot_id, context, reply) values ('jaewon', 'a: b', 'c');

-- ---------------------------------------------------------------- schema / constraints
select has_column('public', 'daily_chat', 'bot_id', 'daily_chat.bot_id exists');
select throws_ok($$insert into public.chat_bots (id, handle, system_prompt) values ('Bad Id', 'x', 'p')$$,
  '23514', null, 'chat_bots: id format');
select throws_ok($$insert into public.daily_chat (item_id, user_id, bot_id, body)
                   values ('db000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'jaewon', 'x')$$,
  '23514', null, 'daily_chat: bot row cannot have user_id');
select lives_ok($$insert into public.daily_chat (item_id, user_id, bot_id, body, created_at)
                  values ('db000000-0000-0000-0000-000000000001', null, 'jaewon', 'ㅇㄴ', now() + interval '1 second')$$,
  'daily_chat: bot row without user inserts');
insert into public.daily_chat (item_id, user_id, body) values (:'item', :'ua', '@재원 뭐함');

-- ---------------------------------------------------------------- browser cannot touch bot tables
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok($$select * from public.chat_bots$$, '42501', null, 'authenticated: chat_bots not readable');
select throws_ok($$select * from public.chat_bot_examples$$, '42501', null, 'authenticated: examples not readable');
select throws_ok($$select * from public.chat_bot_calls$$, '42501', null, 'authenticated: calls not readable');
select throws_ok($$insert into public.chat_bot_calls (bot_id, item_id) values ('jaewon', 'db000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'authenticated: calls not writable');
select throws_ok($$update public.chat_bots set system_prompt = 'x'$$, '42501', null, 'authenticated: bots not writable');

-- ---------------------------------------------------------------- daily_chat select + chat_list
select is((select count(*)::int from public.daily_chat where item_id = :'item' and bot_id = 'jaewon'), 1,
  'authenticated: bot rows visible via RLS with bot_id column');
select results_eq(
  $$select handle, body, mine from public.chat_list('db000000-0000-0000-0000-000000000001') order by created_at$$,
  $$values ('bota'::text, '@재원 뭐함'::text, true), ('재원봇'::text, 'ㅇㄴ'::text, false)$$,
  'chat_list: bot row shows bot handle and mine=false');
select is((select count(*)::int from public.chat_list('db000000-0000-0000-0000-000000000001') where user_id is null), 1,
  'chat_list: bot row has no user_id');
reset role;

-- ---------------------------------------------------------------- bot removal keeps messages
delete from public.chat_bots where id = 'jaewon';
select is((select count(*)::int from public.daily_chat where item_id = :'item' and bot_id is null and user_id is null), 1,
  'bot deleted: message kept, bot_id set null');
select is((select count(*)::int from public.chat_bot_examples), 0, 'bot deleted: examples cascade');

select * from finish();
rollback;
