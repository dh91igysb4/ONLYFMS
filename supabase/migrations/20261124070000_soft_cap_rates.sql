-- 사이트 하루 상한 지급률 완화 (2026-11-24 사용자 결정): 첫 구간 20% → 75%, 둘째 구간 4% → 50%.
-- 구간 경계(30,750 / 41,000)와 셈·줄임 규칙은 그대로. _gold_move가 _economy()의 soft_cap_rate·soft_cap_rate_2를 읽으므로
-- 이 함수만 바꾼다. 상수 원본은 src/games/economy.ts, economy.test.ts가 이 파일(가장 마지막 _economy())과 비교한다.
create or replace function public._economy() returns jsonb
language sql immutable security definer set search_path = public as $$
  select '{"daily_soft_cap": 30750, "soft_cap_rate": 0.75, "daily_soft_cap_2": 41000, "soft_cap_rate_2": 0.5, "daily_prizes": [6150, 5120, 4100, 3070, 2460, 2050], "stake_max": 41000, "fee_max": 41000, "free_bonus_max_pct": 400}'::jsonb
$$;
revoke execute on function public._economy() from public, anon, authenticated;
