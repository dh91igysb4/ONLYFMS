-- 지갑 켜기 (지갑 계획 Task 4, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §6·§10).
-- 낚시가 플랫폼 지갑을 쓰게 되면서(낚시 logic.version 14, `wallet: true`) 등록부 walletEnabled()가 true가 된다.
-- _wallet_enabled()는 그 SQL 사본이라 함께 true로 바꾼다(src/games/walletFlag.test.ts가 비교한다).
-- 이제 create_contest가 참가비 > 0 대회를 받는다(대전 판돈은 duel 함수가 등록부로 같은 판단을 한다).
-- 파일 이름: 지금 UTC 시각(2026-11-24 00시대)으로 지으면 KST로 이름 붙은 20261124020000_contest_fee보다 앞이 되므로
-- 그 뒤 시각으로 직접 지었다(CLAUDE.md 마이그레이션 이름 규칙의 대전 마이그레이션 주의와 같은 사정).
create or replace function public._wallet_enabled() returns boolean
language sql immutable security definer set search_path = public as $$
  select true
$$;

revoke execute on function public._wallet_enabled() from public, anon, authenticated;
