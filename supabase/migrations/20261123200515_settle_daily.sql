-- 정산과 데일리 상금 (지갑 3단계, 설계 docs/superpowers/specs/2026-11-23-wallet-design.md §8, §8.1)

-- ------------------------------------------------------------------ 경제 상수 (economy.ts 사본)
-- 상금 표 REF × [0.3, 0.25, 0.2, 0.15, 0.12, 0.1](10 단위 내림), 판돈·참가비 상한 REF × 2.
-- src/games/economy.test.ts가 마이그레이션의 가장 마지막 _economy() 본문 JSON을 economy.ts와 비교한다.
create or replace function public._economy() returns jsonb
language sql immutable security definer set search_path = public as $$
  select '{"daily_soft_cap": 30750, "soft_cap_rate": 0.2, "daily_soft_cap_2": 41000, "soft_cap_rate_2": 0.04, "daily_prizes": [6150, 5120, 4100, 3070, 2460, 2050], "stake_max": 41000, "fee_max": 41000}'::jsonb
$$;

revoke execute on function public._economy() from public, anon, authenticated;
