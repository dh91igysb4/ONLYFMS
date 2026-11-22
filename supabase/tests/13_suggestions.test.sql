-- 제안 게시판: 테이블·RLS·RPC (suggestion-board Task 1)
-- 한 트랜잭션 안에서 now()는 고정이다. 하루 5개 제한·정렬은 소유자 권한으로 created_at을 과거로 밀어 확인한다.
-- 게임 id는 등록부와 무관한 테스트용 문자열(g-sug*)을 쓴다.
begin;
select plan(130);

insert into public.game_modes (game_id, daily, contest, free) values
  ('g-sug', false, false, true),
  ('g-sug-hidden', false, false, true);
insert into public.hidden_games (game_id) values ('g-sug-hidden');

\set A '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
\set B '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}'
\set C '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}'
\set E '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}'
\set F '{"sub":"00000000-0000-0000-0000-0000000000f6","role":"authenticated"}'
\set ua '00000000-0000-0000-0000-0000000000f1'
\set ub '00000000-0000-0000-0000-0000000000f2'
-- 관리자 시험용 제안 (소유자 권한으로 직접 넣는다)
\set x1  'a1000000-0000-0000-0000-000000000001'
\set x2  'a1000000-0000-0000-0000-000000000002'
\set x3  'a1000000-0000-0000-0000-000000000003'
\set x4  'a1000000-0000-0000-0000-000000000004'
\set x5  'a1000000-0000-0000-0000-000000000005'
\set x6  'a1000000-0000-0000-0000-000000000006'
\set x7  'a1000000-0000-0000-0000-000000000007'
\set x8  'a1000000-0000-0000-0000-000000000008'
\set x9  'a1000000-0000-0000-0000-000000000009'
\set x10 'a1000000-0000-0000-0000-00000000000a'
\set x11 'a1000000-0000-0000-0000-00000000000b'
\set x12 'a1000000-0000-0000-0000-00000000000c'
-- 중복 링크 시험용
\set d1 'a2000000-0000-0000-0000-000000000001'
\set d2 'a2000000-0000-0000-0000-000000000002'
\set d3 'a2000000-0000-0000-0000-000000000003'

-- ---------------------------------------------------------------- fixture (superuser)
-- A·B·C 승인, E 승인 관리자, F 미승인
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'sa@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'sb@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'sc@example.com'),
  ('00000000-0000-0000-0000-0000000000f5', 'se@example.com'),
  ('00000000-0000-0000-0000-0000000000f6', 'sf@example.com');
update public.profiles set status = 'approved', handle = 'sugga' where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set status = 'approved', handle = 'suggb' where id = '00000000-0000-0000-0000-0000000000f2';
update public.profiles set status = 'approved', handle = 'suggc' where id = '00000000-0000-0000-0000-0000000000f3';
update public.profiles set status = 'approved', handle = 'sugge', is_admin = true where id = '00000000-0000-0000-0000-0000000000f5';
update public.profiles set handle = 'suggf' where id = '00000000-0000-0000-0000-0000000000f6';

-- ---------------------------------------------------------------- schema
select has_table('public', 'suggestions', 'suggestions exists');
select has_table('public', 'suggestion_triage', 'suggestion_triage exists');
select has_table('public', 'suggestion_votes', 'suggestion_votes exists');
select has_index('public', 'suggestions', 'suggestions_target_created_idx', array['target', 'created_at'],
  'index (target, created_at)');
select has_index('public', 'suggestions', 'suggestions_user_created_idx', array['user_id', 'created_at'],
  'index (user_id, created_at)');
select has_index('public', 'suggestions', 'suggestions_status_idx', array['status'], 'index (status)');

-- ---------------------------------------------------------------- post
set local role authenticated;
set local request.jwt.claims = :'A';
select public.suggestion_post('g-sug', '점프대 뒤 간격을 넓혀줘') as s_a1 \gset
select isnt(:'s_a1'::uuid, null, 'post: A writes to a game');
select public.suggestion_post('site', '사이트에 다크 모드가 있으면 좋겠어요') as s_a2 \gset
select isnt(:'s_a2'::uuid, null, 'post: A writes to site');
select throws_ok($$select public.suggestion_post('nope', '없는 게임에 쓰는 제안')$$,
  'P0001', 'invalid_target', 'post: unknown target invalid_target');
select throws_ok($$select public.suggestion_post(null, '대상이 비어 있는 제안')$$,
  'P0001', 'invalid_target', 'post: null target invalid_target');
select throws_ok($$select public.suggestion_post('g-sug-hidden', '숨김 게임에 쓰는 제안')$$,
  'P0001', 'forbidden', 'post: A on hidden game forbidden');
select throws_ok($$select public.suggestion_post('g-sug', '    ')$$,
  'P0001', 'invalid_body', 'post: blank body invalid_body');
select throws_ok($$select public.suggestion_post('g-sug', 'abcd')$$,
  'P0001', 'invalid_body', 'post: 4 chars invalid_body');
select throws_ok($$select public.suggestion_post('g-sug', repeat('x', 501))$$,
  'P0001', 'invalid_body', 'post: 501 chars invalid_body');
select public.suggestion_post('g-sug', '  abcde  ') as s_a3 \gset
select isnt(:'s_a3'::uuid, null, 'post: 5 chars after trim ok');
select is((select body from public.suggestions where id = :'s_a3'), 'abcde', 'post: body stored trimmed');
select public.suggestion_post('g-sug', E'<script>x</script>\n둘째 줄 😀') as s_a4 \gset
select isnt(:'s_a4'::uuid, null, 'post: markup and emoji ok');
select is((select body from public.suggestions where id = :'s_a4'), E'<script>x</script>\n둘째 줄 😀',
  'post: body stored verbatim (no escaping)');
select public.suggestion_post('g-sug', repeat('가', 500)) as s_a5 \gset
select isnt(:'s_a5'::uuid, null, 'post: 500 chars ok');
select throws_ok($$select public.suggestion_post('g-sug', '하루에 여섯 번째 제안')$$,
  'P0001', 'too_many', 'post: 6th within 24h too_many');

set local request.jwt.claims = :'E';
select public.suggestion_post('g-sug-hidden', '숨김 게임에 쓰는 관리자 제안') as s_e1 \gset
select isnt(:'s_e1'::uuid, null, 'post: admin writes to hidden game');

set local request.jwt.claims = :'F';
select throws_ok($$select public.suggestion_post('g-sug', '미승인 사용자의 제안')$$,
  'P0001', 'forbidden', 'post: unapproved forbidden');
select throws_ok($$select public.suggestion_post('nope', 'x')$$,
  'P0001', 'forbidden', 'post: unapproved is forbidden before target or body checks');

-- ---------------------------------------------------------------- daily limit
-- A: 5개를 서로 다른 25시간 이상 전 시각으로 민다(정렬 시험 겸용)
reset role;
update public.suggestions set created_at = now() - interval '30 hours' where id = :'s_a1';
update public.suggestions set created_at = now() - interval '29 hours' where id = :'s_a2';
update public.suggestions set created_at = now() - interval '28 hours' where id = :'s_a3';
update public.suggestions set created_at = now() - interval '27 hours' where id = :'s_a4';
update public.suggestions set created_at = now() - interval '26 hours' where id = :'s_a5';
set local role authenticated;
set local request.jwt.claims = :'A';
select lives_ok($$select public.suggestion_post('g-sug', '25시간 지난 뒤의 새 제안')$$,
  'limit: posts older than 24h no longer count');

-- C: 5개를 쓰고 하나를 지워도 6번째는 막힌다(지운 글도 센다)
set local request.jwt.claims = :'C';
do $$ begin
  for i in 1..5 loop
    perform public.suggestion_post('g-sug', '지워도 세는 제안 ' || i);
  end loop;
end $$;
do $$ declare v_id uuid; begin
  select id into v_id from public.suggestions where user_id = auth.uid() limit 1;
  perform public.suggestion_delete(v_id);
end $$;
select throws_ok($$select public.suggestion_post('g-sug', '지운 뒤의 여섯 번째 제안')$$,
  'P0001', 'too_many', 'limit: deleted posts still count');

-- ---------------------------------------------------------------- vote
set local request.jwt.claims = :'B';
select public.suggestion_post('g-sug', 'B가 쓴 첫 제안입니다') as s_b1 \gset
select is(public.suggestion_vote(:'s_a1', true), 1, 'vote: B votes → 1');
select is(public.suggestion_vote(:'s_a1', true), 1, 'vote: idempotent');
select is(public.suggestion_vote(:'s_a1', false), 0, 'vote: B unvotes → 0');
select is(public.suggestion_vote(:'s_a1', false), 0, 'vote: unvote is idempotent');
select is(public.suggestion_vote(:'s_a1', true), 1, 'vote: B votes again → 1');
set local request.jwt.claims = :'A';
select is(public.suggestion_vote(:'s_a1', true), 2, 'vote: A votes on own → 2');
select throws_ok(format('select public.suggestion_vote(%L, true)', :'s_e1'),
  'P0001', 'not_found', 'vote: hidden game post is not_found for A');
select throws_ok($$select public.suggestion_vote(gen_random_uuid(), true)$$,
  'P0001', 'not_found', 'vote: unknown id not_found');
set local request.jwt.claims = :'E';
select is(public.suggestion_vote(:'s_e1', true), 1, 'vote: admin votes on hidden game post');
set local request.jwt.claims = :'F';
select throws_ok(format('select public.suggestion_vote(%L, true)', :'s_a1'),
  'P0001', 'forbidden', 'vote: unapproved forbidden');

-- 공감 표는 그 제안이 보일 때만 읽힌다
set local request.jwt.claims = :'A';
select is((select count(*)::int from public.suggestion_votes where suggestion_id = :'s_a1'), 2,
  'votes rls: A sees votes on a visible post');
select is((select count(*)::int from public.suggestion_votes where suggestion_id = :'s_e1'), 0,
  'votes rls: A does not see votes on a hidden game post');
set local request.jwt.claims = :'E';
select is((select count(*)::int from public.suggestion_votes where suggestion_id = :'s_e1'), 1,
  'votes rls: admin sees votes on a hidden game post');
set local request.jwt.claims = :'A';
select throws_ok(format('insert into public.suggestion_votes (suggestion_id, user_id) values (%L, auth.uid())', :'s_a2'),
  '42501', null, 'votes rls: direct insert denied');

-- ---------------------------------------------------------------- list
reset role;
insert into public.suggestion_triage (suggestion_id, verdict, summary) values (:'s_a3', 'recommend', '요약');
set local role authenticated;
set local request.jwt.claims = :'A';
select is((select count(*)::int from public.suggestion_list() where target = 'g-sug-hidden'), 0,
  'list: A does not see hidden game posts');
select results_eq(
  format($f$select id from public.suggestion_list() where id in (%L, %L, %L, %L, %L)$f$,
         :'s_a1', :'s_a2', :'s_a3', :'s_a4', :'s_a5'),
  format($f$values (%L::uuid), (%L::uuid), (%L::uuid), (%L::uuid), (%L::uuid)$f$,
         :'s_a5', :'s_a4', :'s_a3', :'s_a2', :'s_a1'),
  'list: newest first');
select results_eq($$select id from public.suggestion_list('site')$$,
  format('values (%L::uuid)', :'s_a2'), 'list: site filter returns only site posts');
select results_eq(
  format('select handle, mine, can_delete, votes, voted from public.suggestion_list() where id = %L', :'s_a1'),
  $$values ('sugga'::text, true, true, 2, true)$$, 'list: A own post (mine, can_delete, votes, voted)');
select results_eq(
  format('select mine, can_delete from public.suggestion_list() where id = %L', :'s_a3'),
  $$values (true, false)$$, 'list: own post with triage is not deletable');
select results_eq(
  format('select handle, mine, can_delete, votes, voted from public.suggestion_list() where id = %L', :'s_b1'),
  $$values ('suggb'::text, false, false, 0, false)$$, 'list: others post (not mine, no delete)');
select is((select count(*)::int from public.suggestions where target = 'g-sug-hidden'), 0,
  'select rls: A does not see hidden game posts in the table');
select is((select count(*)::int from public.suggestion_triage), 0, 'select rls: A sees no triage rows');
select throws_ok($$insert into public.suggestions (target, user_id, body) values ('site', auth.uid(), 'direct insert')$$,
  '42501', null, 'no direct writes: insert denied');
set local request.jwt.claims = :'B';
select results_eq(
  format('select mine, can_delete, votes, voted from public.suggestion_list() where id = %L', :'s_a1'),
  $$values (false, false, 2, true)$$, 'list: B view of A post (voted)');
set local request.jwt.claims = :'E';
select is((select count(*)::int from public.suggestion_list() where target = 'g-sug-hidden'), 1,
  'list: admin sees hidden game posts');
select results_eq(
  format('select can_delete from public.suggestion_list() where id = %L', :'s_a3'),
  $$values (true)$$, 'list: admin can delete anything');
select is((select count(*)::int from public.suggestions where target = 'g-sug-hidden'), 1,
  'select rls: admin sees hidden game posts in the table');
select is((select count(*)::int from public.suggestion_triage), 1, 'select rls: admin sees triage rows');
set local request.jwt.claims = :'F';
select throws_ok($$select * from public.suggestion_list()$$, 'P0001', 'forbidden', 'list: unapproved forbidden');
select is((select count(*)::int from public.suggestions), 0, 'select rls: unapproved sees no posts');

-- ---------------------------------------------------------------- delete
set local request.jwt.claims = :'A';
select throws_ok(format('select public.suggestion_delete(%L)', :'s_b1'),
  'P0001', 'forbidden', 'delete: A cannot delete B''s post');
select throws_ok(format('select public.suggestion_delete(%L)', :'s_a3'),
  'P0001', 'not_deletable', 'delete: own post with triage is not_deletable');
reset role;
update public.suggestions set status = 'planned' where id = :'s_a4';
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok(format('select public.suggestion_delete(%L)', :'s_a4'),
  'P0001', 'not_deletable', 'delete: own post no longer open is not_deletable');
select lives_ok(format('select public.suggestion_delete(%L)', :'s_a5'), 'delete: own open post ok');
select is((select body from public.suggestions where id = :'s_a5'), null, 'delete: body is null afterwards');
select is((select deleted_at is not null from public.suggestions where id = :'s_a5'), true,
  'delete: deleted_at set');
select is((select count(*)::int from public.suggestion_list() where id = :'s_a5'), 0,
  'delete: deleted post is gone from the list');
select lives_ok(format('select public.suggestion_delete(%L)', :'s_a5'), 'delete: already deleted → silent success');
select throws_ok(format('select public.suggestion_vote(%L, true)', :'s_a5'),
  'P0001', 'not_found', 'vote: deleted post not_found');
set local request.jwt.claims = :'F';
select throws_ok(format('select public.suggestion_delete(%L)', :'s_a1'),
  'P0001', 'forbidden', 'delete: unapproved forbidden');
set local request.jwt.claims = :'A';
select throws_ok($$select public.suggestion_delete(gen_random_uuid())$$, 'P0001', 'not_found', 'delete: unknown id');
set local request.jwt.claims = :'E';
select lives_ok(format('select public.suggestion_delete(%L)', :'s_a3'), 'delete: admin deletes a triaged post');
select is((select body from public.suggestions where id = :'s_a3'), null, 'delete: admin delete nulls the body');
set local request.jwt.claims = :'A';
select lives_ok(format('select public.suggestion_delete(%L)', :'s_a3'),
  'delete: owner re-deleting an already deleted post is silent');

-- ---------------------------------------------------------------- duplicate_of visibility
reset role;
insert into public.suggestions (id, target, user_id, body, duplicate_of) values
  (:'d1', 'g-sug', :'ub', '삭제된 원 제안의 중복입니다', :'s_a3'),
  (:'d2', 'g-sug', :'ub', '숨김 게임 원 제안의 중복입니다', :'s_e1'),
  (:'d3', 'g-sug', :'ub', '보이는 원 제안의 중복입니다', :'s_a1');
set local role authenticated;
set local request.jwt.claims = :'A';
select results_eq(format('select duplicate_of from public.suggestion_list() where id = %L', :'d1'),
  $$values (null::uuid)$$, 'duplicate_of: original deleted → null');
select results_eq(format('select duplicate_of from public.suggestion_list() where id = %L', :'d2'),
  $$values (null::uuid)$$, 'duplicate_of: original on hidden game → null for A');
select results_eq(format('select duplicate_of from public.suggestion_list() where id = %L', :'d3'),
  format('values (%L::uuid)', :'s_a1'), 'duplicate_of: visible original → value');
set local request.jwt.claims = :'E';
select results_eq(format('select duplicate_of from public.suggestion_list() where id = %L', :'d2'),
  format('values (%L::uuid)', :'s_e1'), 'duplicate_of: original on hidden game → value for admin');

-- ---------------------------------------------------------------- constraints (owner)
reset role;
select throws_ok(format('update public.suggestions set pr_url = %L where id = %L', 'javascript:alert(1)', :'s_a1'),
  '23514', null, 'constraint: pr_url must be a github pull url');
select lives_ok(format('update public.suggestions set pr_url = %L where id = %L',
                       'https://github.com/dh91igysb4/onlyfms/pull/53', :'s_a1'),
  'constraint: github pull url accepted');
set local role authenticated;
set local request.jwt.claims = :'A';
select is((select pr_url from public.suggestion_list() where id = :'s_a1'),
  'https://github.com/dh91igysb4/onlyfms/pull/53', 'list: pr_url exposed');
reset role;
select throws_ok(format('update public.suggestions set duplicate_of = id where id = %L', :'s_a1'),
  '23514', null, 'constraint: duplicate_of cannot point at itself');
select throws_ok(format('update public.suggestions set public_reason = repeat(%L, 201) where id = %L', 'a', :'s_a1'),
  '23514', null, 'constraint: public_reason max 200');
select throws_ok(format('update public.suggestions set body = null where id = %L', :'s_a1'),
  '23514', null, 'constraint: body required unless deleted');
select throws_ok(format('update public.suggestions set body = %L where id = %L', 'abcd', :'s_a1'),
  '23514', null, 'constraint: body min 5 chars');
select throws_ok(format('insert into public.suggestion_triage (suggestion_id, verdict, summary) values (%L, %L, %L)',
                        :'s_b1', 'hold', ''),
  '23514', null, 'constraint: triage summary not empty');
select throws_ok(format('insert into public.suggestion_triage (suggestion_id, verdict, summary) values (%L, %L, repeat(%L, 1001))',
                        :'s_b1', 'hold', 'a'),
  '23514', null, 'constraint: triage summary max 1000');
select throws_ok(format('insert into public.suggestion_triage (suggestion_id, verdict, summary, note) values (%L, %L, %L, repeat(%L, 501))',
                        :'s_b1', 'hold', '요약', 'a'),
  '23514', null, 'constraint: triage note max 500');

-- ---------------------------------------------------------------- withdrawn author
delete from auth.users where id = :'ub';
set local role authenticated;
set local request.jwt.claims = :'A';
select results_eq(format('select handle, mine from public.suggestion_list() where id = %L', :'s_b1'),
  $$values (null::text, false)$$, 'withdrawn: post stays listed with null handle');
reset role;

-- ---------------------------------------------------------------- admin fixtures
insert into public.suggestions (id, target, user_id, body, status, public_reason, duplicate_of, pr_url) values
  (:'x1',  'site', :'ua', '분류 전 제안입니다 1', 'open', null, null, null),
  (:'x2',  'site', :'ua', '추천 제안입니다 2', 'open', null, null, null),
  (:'x3',  'site', :'ua', '보류 제안입니다 3', 'open', null, null, null),
  (:'x4',  'site', :'ua', '거절됐던 제안입니다 4', 'rejected', '이전 거절 사유', null, null),
  (:'x5',  'site', :'ua', '중복 제안입니다 5', 'open', null, :'x2', null),
  (:'x6',  'site', :'ua', '거절할 제안입니다 6', 'open', null, null, null),
  (:'x7',  'site', :'ua', 'PR이 있는 제안입니다 7', 'planned', null, null,
     'https://github.com/dh91igysb4/onlyfms/pull/7'),
  (:'x8',  'site', :'ua', '이미 반영된 제안입니다 8', 'shipped', null, null, null),
  (:'x9',  'site', :'ua', '긴 사유 시험 제안입니다 9', 'open', null, null, null),
  (:'x10', 'site', :'ua', '설계 중인 제안입니다 10', 'design', null, null, null),
  (:'x11', 'site', :'ua', '계획된 제안입니다 11', 'planned', null, null, null),
  (:'x12', 'site', :'ua', '닫힌 PR이 있는 제안입니다 12', 'planned', null, null,
     'https://github.com/dh91igysb4/onlyfms/pull/12');
insert into public.suggestion_triage (suggestion_id, verdict, summary, note) values
  (:'x2',  'recommend', '추천 요약', '추천 메모'),
  (:'x3',  'hold', '보류 요약', null),
  (:'x4',  'reject', '거절 요약', null),
  (:'x5',  'duplicate', '중복 요약', null),
  (:'x6',  'reject', '거절 요약', null),
  (:'x7',  'recommend', '요약', null),
  (:'x8',  'recommend', '요약', null),
  (:'x9',  'recommend', '요약', null),
  (:'x10', 'hold', '요약', null),
  (:'x11', 'recommend', '요약', null),
  (:'x12', 'recommend', '요약', null);

-- ---------------------------------------------------------------- admin: forbidden
set local role authenticated;
set local request.jwt.claims = :'A';
select throws_ok($$select * from public.admin_suggestion_list()$$, 'P0001', 'forbidden', 'admin: list forbidden for A');
select throws_ok(format('select public.admin_suggestion_decide(%L, true)', :'x2'),
  'P0001', 'forbidden', 'admin: decide forbidden for A');
select throws_ok(format('select public.admin_suggestion_shipped(%L)', :'x10'),
  'P0001', 'forbidden', 'admin: shipped forbidden for A');
select throws_ok($$select public.admin_suggestion_pending_count()$$, 'P0001', 'forbidden',
  'admin: pending_count forbidden for A');

-- ---------------------------------------------------------------- admin: list and pending count
set local request.jwt.claims = :'E';
select is((select count(*)::int from public.admin_suggestion_list() where id = :'x8'), 0,
  'admin list: shipped excluded');
select is((select count(*)::int from public.admin_suggestion_list() where id = :'s_a3'), 0,
  'admin list: deleted excluded');
select is((select count(*)::int from public.admin_suggestion_list() where id = :'s_e1'), 1,
  'admin list: includes hidden game posts');
select is((select count(*)::int from public.admin_suggestion_list() where id = :'x4'), 1,
  'admin list: rejected included');
select results_eq(format('select handle, verdict, summary from public.admin_suggestion_list() where id = %L', :'x1'),
  $$values ('sugga'::text, null::public.suggestion_verdict, null::text)$$,
  'admin list: untriaged post has null verdict and summary');
select results_eq(format('select verdict, summary, note, votes from public.admin_suggestion_list() where id = %L', :'x2'),
  $$values ('recommend'::public.suggestion_verdict, '추천 요약'::text, '추천 메모'::text, 0)$$,
  'admin list: triage columns');
select is(public.admin_suggestion_pending_count(), 3, 'pending_count: open with recommend/hold only');

-- ---------------------------------------------------------------- admin: decide
select throws_ok($$select public.admin_suggestion_decide(gen_random_uuid(), true)$$,
  'P0001', 'not_found', 'decide: unknown id not_found');
select throws_ok(format('select public.admin_suggestion_decide(%L, true)', :'s_a3'),
  'P0001', 'not_found', 'decide: deleted post not_found');
select throws_ok(format('select public.admin_suggestion_decide(%L, true)', :'x1'),
  'P0001', 'not_triaged', 'decide: untriaged not_triaged');
select throws_ok(format('select public.admin_suggestion_decide(%L, true)', :'x7'),
  'P0001', 'not_editable', 'decide: post with pr_url not_editable');
select is(public.admin_suggestion_decide(:'x12', false, '닫힌 PR이라 거절합니다'), 'rejected'::public.suggestion_status,
  'decide: reject planned post with pr_url → rejected');
select results_eq(format('select status, pr_url, public_reason from public.suggestions where id = %L', :'x12'),
  $$values ('rejected'::public.suggestion_status, 'https://github.com/dh91igysb4/onlyfms/pull/12'::text,
            '닫힌 PR이라 거절합니다'::text)$$,
  'decide: rejecting with pr_url keeps pr_url and stores reason');
select throws_ok(format('select public.admin_suggestion_decide(%L, false)', :'x8'),
  'P0001', 'not_editable', 'decide: shipped post not_editable');
select throws_ok(format('select public.admin_suggestion_decide(%L, true, repeat(%L, 201))', :'x7', 'a'),
  'P0001', 'not_editable', 'decide: not_editable is checked before invalid_reason');
select throws_ok(format('select public.admin_suggestion_decide(%L, true, repeat(%L, 201))', :'x9', 'a'),
  'P0001', 'invalid_reason', 'decide: 201 chars invalid_reason');
select lives_ok(format('select public.admin_suggestion_decide(%L, true, %L)', :'x9', '  ' || repeat('a', 200) || '  '),
  'decide: 200 chars after trim ok');
select is(public.admin_suggestion_decide(:'x2', true), 'planned'::public.suggestion_status,
  'decide: approve recommend → planned');
select is(public.admin_suggestion_decide(:'x3', true, '설계부터 합니다'), 'design'::public.suggestion_status,
  'decide: approve hold → design');
select is(public.admin_suggestion_decide(:'x4', true), 'planned'::public.suggestion_status,
  'decide: approve previously rejected → planned');
select is(public.admin_suggestion_decide(:'x5', true), 'planned'::public.suggestion_status,
  'decide: approve duplicate verdict → planned');
select is(public.admin_suggestion_decide(:'x6', false, '  지금은 어렵습니다  '), 'rejected'::public.suggestion_status,
  'decide: reject → rejected');
select results_eq(format('select status, public_reason, decided_at = now() from public.suggestions where id = %L', :'x3'),
  $$values ('design'::public.suggestion_status, '설계부터 합니다'::text, true)$$,
  'decide: reason stored and decided_at set');
select results_eq(format('select status, public_reason from public.suggestions where id = %L', :'x4'),
  $$values ('planned'::public.suggestion_status, null::text)$$,
  'decide: approving a rejected post without reason clears public_reason');
select is((select duplicate_of from public.suggestions where id = :'x5'), null, 'decide: approve clears duplicate_of');
select results_eq(format('select status, public_reason from public.suggestions where id = %L', :'x6'),
  $$values ('rejected'::public.suggestion_status, '지금은 어렵습니다'::text)$$,
  'decide: reject stores the trimmed reason');
select is((select char_length(public_reason) from public.suggestions where id = :'x9'), 200,
  'decide: reason is trimmed before storing');
select is(public.admin_suggestion_pending_count(), 0, 'pending_count: decided posts no longer pending');

-- ---------------------------------------------------------------- admin: shipped
select lives_ok(format('select public.admin_suggestion_shipped(%L)', :'x10'), 'shipped: design → shipped');
select results_eq(format('select status, shipped_at = now() from public.suggestions where id = %L', :'x10'),
  $$values ('shipped'::public.suggestion_status, true)$$, 'shipped: status and shipped_at');
select throws_ok(format('select public.admin_suggestion_shipped(%L)', :'x11'),
  'P0001', 'not_editable', 'shipped: planned → not_editable');
select throws_ok(format('select public.admin_suggestion_shipped(%L)', :'x10'),
  'P0001', 'not_editable', 'shipped: already shipped → not_editable');
select throws_ok($$select public.admin_suggestion_shipped(gen_random_uuid())$$,
  'P0001', 'not_found', 'shipped: unknown id not_found');
select throws_ok(format('select public.admin_suggestion_shipped(%L)', :'s_a3'),
  'P0001', 'not_found', 'shipped: deleted post not_found');
select is((select count(*)::int from public.admin_suggestion_list() where id = :'x10'), 0,
  'admin list: just-shipped post drops out');

-- ---------------------------------------------------------------- privileges
reset role;
select ok(not has_function_privilege('anon', 'public.suggestion_post(text, text)', 'execute'),
  'anon cannot execute suggestion_post');
select ok(not has_function_privilege('anon', 'public.admin_suggestion_decide(uuid, boolean, text)', 'execute'),
  'anon cannot execute admin_suggestion_decide');
select ok(has_function_privilege('authenticated', 'public.suggestion_list(text)', 'execute'),
  'authenticated can execute suggestion_list');
select ok(has_function_privilege('authenticated', 'public.can_see_suggestion_target(text)', 'execute'),
  'authenticated can execute can_see_suggestion_target (RLS helper)');
select ok(not has_table_privilege('authenticated', 'public.suggestions', 'insert'),
  'authenticated has no insert on suggestions');
select ok(not has_table_privilege('authenticated', 'public.suggestions', 'update'),
  'authenticated has no update on suggestions');
select ok(not has_table_privilege('anon', 'public.suggestions', 'select'), 'anon has no select on suggestions');

select * from finish();
rollback;
