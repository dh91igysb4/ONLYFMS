-- 섬이 있는 플레이어 목록 (내 섬 설계 §5.4): world_players(p_game, p_key) → 그 게임 기록 키 p_key 행이 있는 승인 사용자.
begin;
select plan(9);

\set u1 '00000000-0000-0000-0000-0000000001a1'
\set u2 '00000000-0000-0000-0000-0000000001a2'
\set u3 '00000000-0000-0000-0000-0000000001a3'
\set up '00000000-0000-0000-0000-0000000001a4'
\set ad '00000000-0000-0000-0000-0000000001a5'
\set U1 '{"sub":"00000000-0000-0000-0000-0000000001a1","role":"authenticated"}'
\set AD '{"sub":"00000000-0000-0000-0000-0000000001a5","role":"authenticated"}'

insert into auth.users (id, email) values
  (:'u1', 'wp1@example.com'), (:'u2', 'wp2@example.com'), (:'u3', 'wp3@example.com'), (:'up', 'wpp@example.com'), (:'ad', 'wpad@example.com');
update public.profiles set status = 'approved', handle = 'wpone' where id = :'u1';
update public.profiles set status = 'approved', handle = 'wptwo' where id = :'u2';
update public.profiles set status = 'approved', handle = 'wpthree' where id = :'u3';
update public.profiles set handle = 'wppend' where id = :'up';
update public.profiles set status = 'approved', handle = 'wpboss', is_admin = true where id = :'ad';
insert into public.hidden_games (game_id) values ('wp-hid');

insert into public.game_records (user_id, game_id, key, value, detail) values
  (:'u1', 'wp-a', 'isle', 0, 'twin'), (:'u2', 'wp-a', 'isle', 0, 'crescent'), (:'u2', 'wp-a', 'avatar', 0, 'AV2'),
  (:'u3', 'wp-a', 'avatar', 0, 'AV3'), (:'up', 'wp-a', 'isle', 0, 'twin'), (:'u2', 'wp-hid', 'isle', 0, 'twin');

select has_function('public', 'world_players', array['text', 'text'], 'has world_players');
select ok(not has_function_privilege('anon', 'public.world_players(text, text)', 'execute'), 'anon 실행 불가');
select ok(has_function_privilege('authenticated', 'public.world_players(text, text)', 'execute'), 'authenticated 실행 가능');

set local role authenticated;
set local request.jwt.claims = :'U1';
select is((select array_agg(handle order by handle) from public.world_players('wp-a', 'isle')), array['wptwo'], '키 있는 승인 사용자만, 본인·대기 제외');
select is((select avatar from public.world_players('wp-a', 'isle') where handle = 'wptwo'), 'AV2', 'avatar = 같은 게임 avatar 행');
select is((select id from public.world_players('wp-a', 'isle') where handle = 'wptwo'), :'u2'::uuid, 'id');
select is((select count(*)::int from public.world_players('wp-hid', 'isle')), 0, '숨김 게임 비관리자: 빈 결과');
reset role;
set local role authenticated;
set local request.jwt.claims = :'AD';
select is((select count(*)::int from public.world_players('wp-hid', 'isle')), 1, '관리자: 숨김 게임도');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000001a4","role":"authenticated"}';
select throws_ok($$select * from public.world_players('wp-a', 'isle')$$, null, null, '대기 사용자: 거부');
reset role;

select * from finish();
rollback;
