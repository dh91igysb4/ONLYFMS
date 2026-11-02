import { expect, test } from 'vitest'
import { brandMessages } from './brandTicker.ts'

const at = (iso: string) => Date.parse(iso)

test('전역 전에는 사이트 이름과 D-n을 번갈아 보여 준다', () => {
  expect(brandMessages(at('2026-11-02T09:00:00Z'))).toEqual(['playONLYFMS', '재원이 전역까지 D-490'])
  expect(brandMessages(at('2028-03-05T14:59:59Z'))).toEqual(['playONLYFMS', '재원이 전역까지 D-1'])
})

test('전역 당일에는 D-DAY', () => {
  expect(brandMessages(at('2028-03-05T15:00:00Z'))).toEqual(['playONLYFMS', '재원이 전역 D-DAY 🎉'])
})

test('전역 다음 날부터는 사이트 이름만', () => {
  expect(brandMessages(at('2028-03-06T15:00:00Z'))).toEqual(['playONLYFMS'])
})
