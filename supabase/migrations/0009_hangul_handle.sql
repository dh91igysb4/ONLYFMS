-- 0009_hangul_handle: 아이디에 한글(완성형 가-힣) 허용, 길이 2~16자.
-- 허용 문자: 영문 소문자, 숫자, _, 완성형 한글. 낱자모(ㄱ, ㅏ 등)는 받지 않는다.
-- 한글은 같은 글자가 완성형(NFC)/분해형(NFD) 두 가지 바이트로 올 수 있어 NFC로 맞춰 저장한다.
-- 그러지 않으면 '손흥민'이 두 번 가입될 수 있다(유니크가 바이트 비교라서).
-- 정규식 범위 [가-힣]은 UTF8 DB에서 코드포인트(U+AC00–U+D7A3) 비교다.

alter table public.profiles drop constraint profiles_handle_format;
alter table public.profiles add constraint profiles_handle_format check (
  handle is null
  or (handle::text is nfc normalized and handle::text ~ '^[a-z0-9_가-힣]{2,16}$')
);

-- 정규화: 앞뒤 공백 제거 → NFC → 소문자.
create or replace function public._normalize_handle(p_handle text) returns text
language plpgsql immutable security definer set search_path = public as $$
declare
  v text := lower(normalize(btrim(p_handle), NFC));
begin
  if v is null or v !~ '^[a-z0-9_가-힣]{2,16}$' then
    raise exception using errcode = 'P0001', message = 'handle_invalid';
  end if;
  return v;
end
$$;
