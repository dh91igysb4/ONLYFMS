// SQL _wallet_enabled()는 등록부 walletEnabled()의 사본이다(지갑 설계 §10, 5단계 리뷰 I1).
// create_contest가 이 값이 false면 새 참가비 대회를 거절한다(duel 함수의 invalid_stake와 같은 규칙).
// 낚시를 지갑으로 옮긴(wallet: true, 낚시 logic.version 14) 지갑 Task 4가 20261124030000_wallet_on에서 `select true`로 바꿨다.
import { expect, test } from 'vitest'
import { getWorld, walletEnabled } from './index.ts'

test('지갑이 켜져 있다: 낚시가 wallet: true (헤더 골드·자유 플레이 +N G·상금 알림·판돈·참가비 화면이 보인다)', () => {
  expect(getWorld('fishing')?.logic.wallet).toBe(true)
  expect(walletEnabled()).toBe(true)
})

/** 마이그레이션을 이름순으로 읽어 가장 마지막 _wallet_enabled() 정의의 true/false를 꺼낸다 */
function lastWalletFlag(files: Record<string, string>): boolean | null {
  let body: string | null = null
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?_wallet_enabled\s*\(\s*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi
  for (const name of Object.keys(files).sort()) {
    for (const m of files[name].matchAll(re)) body = m[1]
  }
  if (body === null) return null
  const v = body.match(/^\s*select\s+(true|false)\s*;?\s*$/i)
  return v ? v[1].toLowerCase() === 'true' : null
}

test('SQL 사본 _wallet_enabled()가 등록부 walletEnabled()와 같다', () => {
  const sqlFiles = import.meta.glob('../../supabase/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const flag = lastWalletFlag(sqlFiles)
  expect(flag, '_wallet_enabled()가 마이그레이션에 없거나 본문이 `select true|false`가 아니다').not.toBeNull()
  expect(flag, '등록부의 wallet: true와 맞추려면 새 마이그레이션에서 _wallet_enabled()를 create or replace 한다').toBe(walletEnabled())
})

test('lastWalletFlag: 이름순 마지막 정의, 형식이 다르면 null', () => {
  const f = (v: string) => `create or replace function public._wallet_enabled() returns boolean language sql immutable as $$\n  select ${v}\n$$;`
  expect(lastWalletFlag({ 'b.sql': f('true'), 'a.sql': f('false') })).toBe(true)
  expect(lastWalletFlag({ 'a.sql': f('true'), 'b.sql': f('false') })).toBe(false)
  expect(lastWalletFlag({ 'a.sql': 'select 1;' })).toBeNull()
  expect(lastWalletFlag({ 'a.sql': f('exists (select 1)') })).toBeNull()
})
