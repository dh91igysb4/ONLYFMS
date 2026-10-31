-- 한글 아이디 (0009_hangul_handle)
begin;
select plan(13);

\set H1 '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'
\set H2 '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'
\set H3 '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'h1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'h2@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'h3@example.com');

set local role authenticated;

-- 거부: 낱자모, 1자, 17자, 공백, 다른 문자
set local request.jwt.claims = :'H1';
select throws_ok($$select public.set_handle('ㅋㅋㅋ')$$, 'P0001', 'handle_invalid', 'hangul jamo is rejected');
select throws_ok($$select public.set_handle('ㅏ가나')$$, 'P0001', 'handle_invalid', 'vowel jamo mixed in is rejected');
select throws_ok($$select public.set_handle('손')$$, 'P0001', 'handle_invalid', '1 char is too short');
select throws_ok($$select public.set_handle('가나다라마바사아자차카타파하가나다')$$, 'P0001', 'handle_invalid', '17 hangul chars is too long');
select throws_ok($$select public.set_handle('손 흥민')$$, 'P0001', 'handle_invalid', 'inner space is rejected');
select throws_ok($$select public.set_handle('ソン')$$, 'P0001', 'handle_invalid', 'kana is rejected');

-- 허용: 2자 한글, 한글+영문·숫자·_ 혼용, 앞뒤 공백 정리
select is(public.set_handle(' 손흥민 '), '손흥민', 'hangul handle accepted and trimmed');
set local request.jwt.claims = :'H2';
select is(public.set_handle('승주'), '승주', '2-char hangul handle accepted');

-- 분해형(NFD) 입력은 완성형(NFC)으로 저장되고, 같은 아이디로 중복 판정된다
set local request.jwt.claims = :'H3';
select throws_ok(format($$select public.set_handle(%L)$$, normalize('손흥민', NFD)), 'P0001', 'handle_taken',
  'NFD input collides with the NFC handle');
select is(public.set_handle('Kane_' || normalize('케인', NFD)), 'kane_케인', 'mixed handle lowercased and NFC-normalized');
select is((select handle::text is nfc normalized from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'), true,
  'stored handle is NFC');

-- 테이블 제약도 막는다(함수를 거치지 않는 쓰기)
reset role;
select throws_ok($$update public.profiles set handle = 'ㄱㄴㄷ' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'check constraint rejects jamo');
select throws_ok(format($$update public.profiles set handle = %L where id = '00000000-0000-0000-0000-0000000000c1'$$,
  normalize('가나다', NFD)), '23514', null, 'check constraint rejects NFD');

select * from finish();
rollback;
