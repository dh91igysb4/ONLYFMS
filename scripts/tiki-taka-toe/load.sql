-- 티키타카토 CSV 적재 (scripts/tiki-taka-toe/load.sh가 CSV 폴더에서 psql -v version=… 으로 실행한다).
-- 설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §5.2: 한 트랜잭션, 세 테이블을 지우고 다시 넣는다.
--   어디서든 실패하면 전부 롤백. CSV 열 이름이 다르면 header match로 실패한다.
--   condition_players의 선수가 football_players에 없으면 FK로 실패한다(축구를 다시 적재했으면 생성부터 다시).
\set ON_ERROR_STOP 1
begin;

create temp table s_conditions (id text, kind text, label_ko text, label_en text, ref text) on commit drop;
create temp table s_condition_players (condition_id text, player_id text) on commit drop;
create temp table s_puzzles (id text, theme text, r1 text, r2 text, r3 text, c1 text, c2 text, c3 text) on commit drop;

\copy s_conditions from 'conditions.csv' with (format csv, header match)
\copy s_condition_players from 'condition_players.csv' with (format csv, header match)
\copy s_puzzles from 'puzzles.csv' with (format csv, header match)

delete from public.ttt_puzzles;
delete from public.ttt_condition_players;
delete from public.ttt_conditions;

insert into public.ttt_conditions (id, kind, label_ko, label_en, ref)
select id, kind, label_ko, label_en, ref from s_conditions;

insert into public.ttt_condition_players (condition_id, player_id)
select condition_id, player_id from s_condition_players;

insert into public.ttt_puzzles (id, theme, r1, r2, r3, c1, c2, c3)
select id, theme, r1, r2, r3, c1, c2, c3 from s_puzzles;

-- 데이터셋 버전은 축구 메타 표에 ttt_ 접두어로 둔다
insert into public.football_meta (key, value) values ('ttt_dataset_version', :'version'), ('ttt_loaded_at', now()::text)
on conflict (key) do update set value = excluded.value;

-- 결과 (커밋 전에 출력)
select t as "테이블", n as "행 수" from (
  select 'conditions' t, 1 o, count(*) n from public.ttt_conditions
  union all select 'condition_players', 2, count(*) from public.ttt_condition_players
  union all select 'puzzles', 3, count(*) from public.ttt_puzzles
) c order by o;

commit;

analyze public.ttt_conditions, public.ttt_condition_players, public.ttt_puzzles;
