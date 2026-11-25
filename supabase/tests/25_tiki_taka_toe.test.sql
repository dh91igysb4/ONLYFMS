-- 티키타카토 테이블·판 고르기 RPC (설계 2026-11-26-tiki-taka-toe-design.md §5.2).
-- db-test.sh가 축구 픽스처 다음에 supabase/tests/fixtures/tiki-taka-toe를 적재해 둔다 (판 eur-0001 하나).
begin;
select plan(23);

\set AP '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'
\set PE '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}'
\set AN '{"role":"anon"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ttt-approved@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'ttt-pending@example.com');
update public.profiles set status = 'approved', handle = 'tttappr' where id = '00000000-0000-0000-0000-0000000000e1';

select has_table('public', 'ttt_conditions', 'conditions table');
select has_table('public', 'ttt_condition_players', 'condition players table');
select has_table('public', 'ttt_puzzles', 'puzzles table');
select fk_ok('public', 'ttt_condition_players', 'player_id', 'public', 'football_players', 'id', 'player_id references football_players');
select throws_ok($$insert into public.ttt_puzzles values ('x-1', 'kor', 'club:x-r', 'nation:x-n', 'award:x-a', 'club:x-c', 'continent:asia', 'teammate:Q21621995')$$,
  '23514', null, 'theme check');
select throws_ok($$insert into public.ttt_condition_players values ('club:x-r', 'Q-no-such-player')$$,
  '23503', null, 'unknown player rejected');
select results_eq($$select daily, contest, free from public.game_modes where game_id = 'tiki-taka-toe'$$,
  $$values (false, false, false)$$, 'game_modes row');
select ok(exists (select 1 from public.hidden_games where game_id = 'tiki-taka-toe'), 'hidden at first');

-- 칸 0(행 클럽 × 열 클럽)을 6명으로 늘려 예시가 5명에서 잘리는지 본다
insert into public.football_players (id, name_ko, name_en, popularity) values
  ('x-ttt-a', '가선수', 'A Player', 50), ('x-ttt-b', null, 'B Player', 1);
insert into public.ttt_condition_players values ('club:x-r', 'x-ttt-a'), ('club:x-c', 'x-ttt-a'), ('club:x-r', 'x-ttt-b'), ('club:x-c', 'x-ttt-b');

-- 승인 사용자
set local role authenticated;
select set_config('request.jwt.claims', :'AP', true);
create temp table pick on commit drop as select public.ttt_pick_puzzle('{"theme":"eur"}') p;

select is((select p ->> 'puzzle_id' from pick), 'eur-0001', 'picks the eur puzzle');
select is((select p -> 'rows' -> 0 from pick), '{"id":"club:x-r","kind":"club","label":"행 클럽"}'::jsonb, 'row header shape, Korean label');
select is((select array[jsonb_array_length(p -> 'rows'), jsonb_array_length(p -> 'cols'), jsonb_array_length(p -> 'answers'), jsonb_array_length(p -> 'examples')] from pick),
  array[3, 3, 9, 9], '3 rows, 3 cols, 9 answer cells, 9 example cells');
select is((select array(select x ->> 'id' from pick, jsonb_array_elements(p -> 'cols') x)),
  array['club:x-c', 'continent:asia', 'teammate:Q21621995'], 'cols in order');
reset role;

-- 칸마다 정답 = 두 조건 선수 교집합 (행 우선)
select is((
  select count(*)::int from pick, generate_series(0, 8) i
  where (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(p -> 'answers' -> i) x)
    is distinct from (
      select coalesce(array_agg(a.player_id order by a.player_id), '{}')
      from public.ttt_condition_players a
      join public.ttt_condition_players b on b.player_id = a.player_id
      where a.condition_id = p -> 'rows' -> (i / 3) ->> 'id' and b.condition_id = p -> 'cols' -> (i % 3) ->> 'id')
), 0, 'every cell answer set is the intersection');
select is((select jsonb_array_length(p -> 'answers' -> 0) from pick), 6, 'cell 0 has 6 answers');
select is((select p -> 'examples' -> 0 from pick),
  '["킬리안 음바페","손흥민","가선수","김민수","John Doe"]'::jsonb, 'examples: top 5 by popularity, Korean name or English');
select is((select p -> 'answers' -> 5 from pick), '[]'::jsonb, 'empty cell is an empty array');

set local role authenticated;
select set_config('request.jwt.claims', :'AP', true);
select is(public.ttt_pick_puzzle('{"theme":"eng"}'), null, 'theme without puzzles -> null');
select is(public.ttt_pick_puzzle('{}'), null, 'no theme -> null');
select throws_ok($$select * from public.ttt_puzzles$$, '42501', null, 'puzzles not readable directly');
select throws_ok($$select * from public.ttt_condition_players$$, '42501', null, 'condition players not readable directly');

select set_config('request.jwt.claims', :'PE', true);
select throws_ok($$select public.ttt_pick_puzzle('{"theme":"eur"}')$$, '42501', null, 'pending user cannot pick');
reset role;

set local role anon;
select set_config('request.jwt.claims', :'AN', true);
select throws_ok($$select public.ttt_pick_puzzle('{"theme":"eur"}')$$, '42501', null, 'anon cannot pick');
reset role;

-- duel Edge Function: 소유자 연결, JWT 없음
select set_config('request.jwt.claims', '', true);
select is((public.ttt_pick_puzzle('{"theme":"eur"}') ->> 'puzzle_id'), 'eur-0001', 'server connection (no JWT) can pick');

select * from finish();
rollback;
