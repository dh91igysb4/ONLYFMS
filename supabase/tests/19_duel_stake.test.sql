-- 대전 판돈 열과 끝남·무효 때 지급·환불 트리거 (지갑 4단계 Task 19, 설계 §9, §14)
-- 슈퍼유저(= duel Edge Function의 소유자 연결)가 대국 행을 넣고 _gold_move(…,'duel_stake',…)로 맡기기를 흉내 낸다.
-- 트리거 _duel_settle_stakes는 status가 finished/void로 바뀌는 순간 장부 duel_stake 줄을 보고 지급·환불한다.
begin;
select plan(53);

\set s1 '00000000-0000-0000-0000-0000000007a1'
\set s2 '00000000-0000-0000-0000-0000000007a2'
\set s3 '00000000-0000-0000-0000-0000000007a3'
\set s4 '00000000-0000-0000-0000-0000000007a4'
\set S1 '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}'
\set S3 '{"sub":"00000000-0000-0000-0000-0000000007a3","role":"authenticated"}'
-- 대국
--   m1 s1 vs s2 active 판돈 1000 (승자 있음)     m2 s1 vs s2 active 1000 (무승부)
--   m3 s1 waiting 1000 (취소)                    m4 s1 vs s2 active 1000 (첫 행동 전 무효)
--   m5 s1 vs s2 active 0                         m6 s1 vs s2 active 1000 (finished 재update·되돌림)
--   m7·m8 s3 waiting 500 (일괄 무효)             m9 s2 vs s4 active 2000 (사이트 상한 무관)
--   ma s1 vs s2 active 1000 (s2 승, 승자가 user_id가 큰 쪽)   mb s4 waiting 300 (duel_list 만료 정리)
--   mc s1 vs s4 active 700 (승자 계정 삭제 → 환불)
\set m1 'f7000000-0000-0000-0000-000000000001'
\set m2 'f7000000-0000-0000-0000-000000000002'
\set m3 'f7000000-0000-0000-0000-000000000003'
\set m4 'f7000000-0000-0000-0000-000000000004'
\set m5 'f7000000-0000-0000-0000-000000000005'
\set m6 'f7000000-0000-0000-0000-000000000006'
\set m7 'f7000000-0000-0000-0000-000000000007'
\set m8 'f7000000-0000-0000-0000-000000000008'
\set m9 'f7000000-0000-0000-0000-000000000009'
\set ma 'f7000000-0000-0000-0000-00000000000a'
\set mb 'f7000000-0000-0000-0000-00000000000b'
\set mc 'f7000000-0000-0000-0000-00000000000c'

-- ---------------------------------------------------------------- fixture (superuser)
insert into auth.users (id, email) values
  (:'s1', 'st1@example.com'), (:'s2', 'st2@example.com'), (:'s3', 'st3@example.com'), (:'s4', 'st4@example.com');
update public.profiles set status = 'approved', handle = 'stakeone' where id = :'s1';
update public.profiles set status = 'approved', handle = 'staketwo' where id = :'s2';
update public.profiles set status = 'approved', handle = 'stakethree' where id = :'s3';
update public.profiles set status = 'approved', handle = 'stakefour' where id = :'s4';
insert into public.hidden_games (game_id) values ('g-shidden') on conflict do nothing;

-- 넉넉한 잔액
select public._gold_move(:'s1', 100000, 'admin', 'seed-s1');
select public._gold_move(:'s2', 100000, 'admin', 'seed-s2');
select public._gold_move(:'s3', 100000, 'admin', 'seed-s3');
select public._gold_move(:'s4', 100000, 'admin', 'seed-s4');

insert into public.duel_matches
  (id, game_id, logic_version, rated, visibility, status, created_by, players, turn_seconds, created_at, started_at, stake) values
  (:'m1', 'g-stake', 1, true,  'public', 'active',  :'s1', array[:'s1', :'s2']::uuid[], 60, now(), now(), 1000),
  (:'m2', 'g-stake', 1, false, 'public', 'active',  :'s1', array[:'s1', :'s2']::uuid[], 60, now(), now(), 1000),
  (:'m3', 'g-stake', 1, true,  'public', 'waiting', :'s1', null,                        60, now(), null,  1000),
  (:'m4', 'g-stake', 1, true,  'public', 'active',  :'s1', array[:'s2', :'s1']::uuid[], 60, now(), now(), 1000),
  (:'m5', 'g-stake', 1, true,  'public', 'active',  :'s1', array[:'s1', :'s2']::uuid[], 60, now(), now(), 0),
  (:'m6', 'g-stake', 1, true,  'public', 'active',  :'s1', array[:'s1', :'s2']::uuid[], 60, now(), now(), 1000),
  (:'m7', 'g-stake', 1, true,  'public', 'waiting', :'s3', null,                        60, now() - interval '20 minutes', null, 500),
  (:'m8', 'g-stake', 1, true,  'public', 'waiting', :'s3', null,                        60, now() - interval '20 minutes', null, 500),
  (:'m9', 'g-stake', 1, true,  'public', 'active',  :'s2', array[:'s2', :'s4']::uuid[], 60, now(), now(), 2000),
  (:'ma', 'g-stake', 1, true,  'public', 'active',  :'s1', array[:'s1', :'s2']::uuid[], 60, now(), now(), 1000),
  (:'mb', 'g-stake', 1, true,  'public', 'waiting', :'s4', null,                        60, now() - interval '11 minutes', null, 300),
  (:'mc', 'g-stake', 1, true,  'public', 'active',  :'s1', array[:'s1', :'s4']::uuid[], 60, now(), now(), 700);

-- 맡기기 흉내 (duel 함수가 create·join에서 하는 것)
select public._gold_move(:'s1', -1000, 'duel_stake', :'m1', 'g-stake');
select public._gold_move(:'s2', -1000, 'duel_stake', :'m1', 'g-stake');
select public._gold_move(:'s1', -1000, 'duel_stake', :'m2', 'g-stake');
select public._gold_move(:'s2', -1000, 'duel_stake', :'m2', 'g-stake');
select public._gold_move(:'s1', -1000, 'duel_stake', :'m3', 'g-stake');
select public._gold_move(:'s1', -1000, 'duel_stake', :'m4', 'g-stake');
select public._gold_move(:'s2', -1000, 'duel_stake', :'m4', 'g-stake');
select public._gold_move(:'s1', -1000, 'duel_stake', :'m6', 'g-stake');
select public._gold_move(:'s2', -1000, 'duel_stake', :'m6', 'g-stake');
select public._gold_move(:'s3', -500,  'duel_stake', :'m7', 'g-stake');
select public._gold_move(:'s3', -500,  'duel_stake', :'m8', 'g-stake');
select public._gold_move(:'s2', -2000, 'duel_stake', :'m9', 'g-stake');
select public._gold_move(:'s4', -2000, 'duel_stake', :'m9', 'g-stake');
select public._gold_move(:'s1', -1000, 'duel_stake', :'ma', 'g-stake');
select public._gold_move(:'s2', -1000, 'duel_stake', :'ma', 'g-stake');
select public._gold_move(:'s4', -300,  'duel_stake', :'mb', 'g-stake');
select public._gold_move(:'s1', -700,  'duel_stake', :'mc', 'g-stake');
select public._gold_move(:'s4', -700,  'duel_stake', :'mc', 'g-stake');

create temp table bal0 as select user_id, balance from public.wallets where user_id in (:'s1', :'s2', :'s3', :'s4');
create function pg_temp.bal(p uuid) returns bigint language sql as $$ select balance from public.wallets where user_id = p $$;
create function pg_temp.led(p uuid, r text, m text) returns bigint language sql as $$
  select coalesce(sum(delta), 0)::bigint from public.gold_ledger where user_id = p and reason = r and ref = m $$;
create function pg_temp.net(m text) returns bigint language sql as $$
  select coalesce(sum(delta), 0)::bigint from public.gold_ledger where ref = m and reason like 'duel\_%' $$;

-- ---------------------------------------------------------------- schema / check
select has_column('public', 'duel_matches', 'stake', 'duel_matches.stake');
select col_default_is('public', 'duel_matches', 'stake', '0', '기본 판돈 0');
select has_function('public', '_duel_settle_stakes', 'trigger function');
select has_trigger('public', 'duel_matches', 'duel_matches_settle_stakes', 'status 변경 트리거');
select throws_ok(
  $$insert into public.duel_matches (game_id, logic_version, rated, visibility, created_by, turn_seconds, stake)
    values ('g-stake', 1, true, 'public', '00000000-0000-0000-0000-0000000007a1', 60, -1)$$,
  '23514', null, '판돈 −1 거절');
select throws_ok(
  $$insert into public.duel_matches (game_id, logic_version, rated, visibility, created_by, turn_seconds, stake)
    values ('g-stake', 1, true, 'public', '00000000-0000-0000-0000-0000000007a1', 60, 41001)$$,
  '23514', null, '판돈 41,001 거절');
select lives_ok(
  $$insert into public.duel_matches (game_id, logic_version, rated, visibility, created_by, turn_seconds, stake)
    values ('g-stake', 1, true, 'public', '00000000-0000-0000-0000-0000000007a1', 60, 41000)$$,
  '판돈 41,000(STAKE_MAX) 가능');
select is((select (public._economy() ->> 'stake_max')::int), 41000, 'check 상한 = _economy() stake_max');
-- 숨김 게임은 0만
select throws_ok(
  $$insert into public.duel_matches (game_id, logic_version, rated, visibility, created_by, turn_seconds, stake)
    values ('g-shidden', 1, true, 'public', '00000000-0000-0000-0000-0000000007a1', 60, 1)$$,
  'P0001', 'invalid_stake', '숨김 게임 판돈 > 0 거절');
select lives_ok(
  $$insert into public.duel_matches (game_id, logic_version, rated, visibility, created_by, turn_seconds, stake)
    values ('g-shidden', 1, true, 'public', '00000000-0000-0000-0000-0000000007a1', 60, 0)$$,
  '숨김 게임 판돈 0 가능');
-- 만든 뒤 판돈은 바뀌지 않는다
select throws_ok(
  $$update public.duel_matches set stake = 2000 where id = 'f7000000-0000-0000-0000-000000000003'$$,
  'P0001', 'stake_immutable', '판돈 변경 거절');

-- ---------------------------------------------------------------- finished + winner
update public.duel_matches set status = 'finished', winner = 0, end_reason = 'normal', ended_at = now() where id = :'m1';
select is(pg_temp.led(:'s1', 'duel_payout', :'m1'), 2000::bigint, 'm1 승자(players[1])에게 2,000');
select is(pg_temp.led(:'s2', 'duel_payout', :'m1') + pg_temp.led(:'s2', 'duel_refund', :'m1'), 0::bigint, 'm1 진 사람 장부 없음');
select is((select game_id from public.gold_ledger where user_id = :'s1' and reason = 'duel_payout' and ref = :'m1'),
          'g-stake', '지급 game_id = 대국 게임');
select is(pg_temp.net(:'m1'), 0::bigint, 'm1 맡김 + 지급 = 0');

-- 승자가 players[2]이고 user_id가 큰 쪽
update public.duel_matches set status = 'finished', winner = 1, end_reason = 'resign', ended_at = now() where id = :'ma';
select is(pg_temp.led(:'s2', 'duel_payout', :'ma'), 2000::bigint, 'ma 기권승(players[2])에게 2,000');
select is(pg_temp.net(:'ma'), 0::bigint, 'ma 합 0');

-- ---------------------------------------------------------------- draw
update public.duel_matches set status = 'finished', winner = null, end_reason = 'normal', ended_at = now() where id = :'m2';
select is(pg_temp.led(:'s1', 'duel_refund', :'m2'), 1000::bigint, 'm2 무승부 s1 환불 1,000');
select is(pg_temp.led(:'s2', 'duel_refund', :'m2'), 1000::bigint, 'm2 무승부 s2 환불 1,000');
select is(pg_temp.led(:'s1', 'duel_payout', :'m2'), 0::bigint, 'm2 지급 없음');
select is(pg_temp.net(:'m2'), 0::bigint, 'm2 합 0');

-- ---------------------------------------------------------------- waiting → void (취소)
update public.duel_matches set status = 'void', end_reason = 'void', ended_at = now() where id = :'m3';
select is(pg_temp.led(:'s1', 'duel_refund', :'m3'), 1000::bigint, 'm3 대기 취소 → 만든 사람 환불');
select is(pg_temp.net(:'m3'), 0::bigint, 'm3 합 0');

-- ---------------------------------------------------------------- active → void (첫 행동 전 종료·버전 변경)
update public.duel_matches set status = 'void', end_reason = 'void', ended_at = now() where id = :'m4';
select is(pg_temp.led(:'s1', 'duel_refund', :'m4'), 1000::bigint, 'm4 무효 s1 환불');
select is(pg_temp.led(:'s2', 'duel_refund', :'m4'), 1000::bigint, 'm4 무효 s2 환불');
select is(pg_temp.net(:'m4'), 0::bigint, 'm4 합 0');

-- ---------------------------------------------------------------- 판돈 0
update public.duel_matches set status = 'finished', winner = 0, end_reason = 'normal', ended_at = now() where id = :'m5';
select is((select count(*)::int from public.gold_ledger where ref = :'m5'), 0, 'm5 판돈 0 → 장부 없음');

-- ---------------------------------------------------------------- 두 번 / 되돌림
update public.duel_matches set status = 'finished', winner = 0, end_reason = 'normal', ended_at = now() where id = :'m6';
select is(pg_temp.led(:'s1', 'duel_payout', :'m6'), 2000::bigint, 'm6 첫 종료 지급');
update public.duel_matches set status = 'finished', winner = 1, ended_at = now() where id = :'m6';
select is(pg_temp.led(:'s2', 'duel_payout', :'m6'), 0::bigint, 'finished → finished 재update는 아무 일 없음');
update public.duel_matches set status = 'void', winner = null, end_reason = 'void' where id = :'m6';
select is((select count(*)::int from public.gold_ledger where ref = :'m6' and reason = 'duel_refund'), 0,
          'finished → void도 아무 일 없음');
-- 강제로 active로 되돌렸다가 다시 같은 승자로 finished → 장부 unique로 그대로
update public.duel_matches set status = 'active', winner = null, end_reason = null, ended_at = null where id = :'m6';
update public.duel_matches set status = 'finished', winner = 0, end_reason = 'normal', ended_at = now() where id = :'m6';
select is((select count(*)::int from public.gold_ledger where ref = :'m6' and reason = 'duel_payout'), 1, 'm6 지급 한 줄');
select is(pg_temp.net(:'m6'), 0::bigint, 'm6 합 0');

-- ---------------------------------------------------------------- 일괄 무효 (create의 오래된 대기 정리)
update public.duel_matches set status = 'void', end_reason = 'void', ended_at = now()
 where created_by = :'s3' and status = 'waiting' and created_at <= now() - interval '10 minutes';
select is(pg_temp.led(:'s3', 'duel_refund', :'m7'), 500::bigint, 'm7 일괄 무효 환불');
select is(pg_temp.led(:'s3', 'duel_refund', :'m8'), 500::bigint, 'm8 일괄 무효 환불');
select is(pg_temp.bal(:'s3'), (select balance from bal0 where user_id = :'s3') + 1000, 's3 잔액 원래대로');

-- ---------------------------------------------------------------- 사이트 상한과 무관
-- s2는 오늘 world +60,000(상한 넘김)
select public._gold_move(:'s2', 60000, 'world', 'stake-world-s2', 'g-world');
create temp table e0 as select public._earned_today(:'s2') as v;
update public.duel_matches set status = 'finished', winner = 0, end_reason = 'timeout', ended_at = now() where id = :'m9';
select is(pg_temp.led(:'s2', 'duel_payout', :'m9'), 4000::bigint, 'm9 시간 초과승 지급 전액 4,000');
select is((select raw_delta from public.gold_ledger where user_id = :'s2' and reason = 'duel_payout' and ref = :'m9'),
          null, 'duel_payout raw_delta null(줄지 않음)');
select is(public._earned_today(:'s2'), (select v from e0), 'duel_payout은 오늘 수입 합계에 들지 않음');

-- ---------------------------------------------------------------- 승자 계정 삭제 → 환불(트리거가 대국 종료를 막지 않는다)
delete from auth.users where id = :'s4';
select is((select count(*)::int from public.profiles where id = :'s4'), 0, 's4 삭제됨');
select lives_ok(
  $$update public.duel_matches set status = 'finished', winner = 1, end_reason = 'normal', ended_at = now()
     where id = 'f7000000-0000-0000-0000-00000000000c'$$,
  '승자 계정이 없어도 대국은 끝난다');
select is(pg_temp.led(:'s1', 'duel_refund', :'mc'), 700::bigint, '승자가 없으면 남은 맡긴 사람에게 환불');

-- ---------------------------------------------------------------- duel_list: 만료 대기 정리도 환불, 로비에 stake
-- mb(s4의 것, s4는 지워져 created_by null) 대신 새 만료 대기 하나를 s3로
insert into public.duel_matches
  (id, game_id, logic_version, rated, visibility, status, created_by, turn_seconds, created_at, stake) values
  ('f7000000-0000-0000-0000-0000000000d1', 'g-stake', 1, true, 'public', 'waiting', :'s3', 60, now() - interval '11 minutes', 400),
  ('f7000000-0000-0000-0000-0000000000d2', 'g-stake', 1, true, 'public', 'waiting', :'s3', 60, now(), 600);
select public._gold_move(:'s3', -400, 'duel_stake', 'f7000000-0000-0000-0000-0000000000d1', 'g-stake');
select public._gold_move(:'s3', -600, 'duel_stake', 'f7000000-0000-0000-0000-0000000000d2', 'g-stake');

set local role authenticated;
set local request.jwt.claims = :'S1';
create temp table lst as select public.duel_list() as v;
reset role;
select is((select status::text from public.duel_matches where id = 'f7000000-0000-0000-0000-0000000000d1'), 'void',
          'duel_list가 10분 지난 대기를 무효로');
select is(pg_temp.led(:'s3', 'duel_refund', 'f7000000-0000-0000-0000-0000000000d1'), 400::bigint, 'duel_list 만료 정리 환불');
select is((select (e ->> 'stake')::int from lst, jsonb_array_elements(v -> 'lobby') e
            where e ->> 'id' = 'f7000000-0000-0000-0000-0000000000d2'), 600, 'duel_list 로비 항목에 stake');
select is((select count(*)::int from lst, jsonb_array_elements(v -> 'recent') e where e ? 'stake'),
          (select jsonb_array_length(v -> 'recent') from lst), 'recent 항목에도 stake');
-- authenticated가 stake 열을 읽는다
set local role authenticated;
set local request.jwt.claims = :'S3';
select is((select stake from public.duel_matches where id = 'f7000000-0000-0000-0000-0000000000d2'), 600,
          'authenticated가 stake를 읽음');
reset role;

-- ---------------------------------------------------------------- 돈 보존(이 파일의 끝난 대국 전체)
select is((select count(*)::int from (
             select l.ref from public.gold_ledger l
              where l.reason like 'duel\_%'
                and l.ref in (select id::text from public.duel_matches where status in ('finished', 'void') and game_id = 'g-stake')
              group by l.ref having sum(l.delta) <> 0) x), 1,
          '끝난 대국은 맡김 + 지급·환불 = 0 (계정 삭제로 s4 장부가 지워진 m9 하나만 예외)');
select is(pg_temp.net(:'mc'), 0::bigint, 'mc 합 0 (s4 맡김 줄은 계정과 함께 지워짐)');

-- ---------------------------------------------------------------- 본문 검사 (교착·상한 무관)
select ok(pg_get_functiondef('public._duel_settle_stakes()'::regprocedure) ~ 'order by\s+l\.user_id',
          '환불 루프 user_id 오름차순');
select ok(pg_get_functiondef('public._duel_settle_stakes()'::regprocedure) !~ '(_economy|soft_cap)',
          '트리거에 상한 계산 없음');
select ok(pg_get_functiondef('public.duel_list()'::regprocedure) ~ 'skip locked',
          'duel_list 만료 정리는 skip locked로 잠근다');
select ok(pg_get_functiondef('public.duel_list()'::regprocedure) ~ 'order by\s+m\.created_by',
          'duel_list 만료 정리는 만든 사람 순서(지갑 오름차순)');
select ok(not has_function_privilege('authenticated', 'public._duel_settle_stakes()', 'execute'),
          'authenticated는 트리거 함수 실행 불가');

select * from finish();
rollback;
