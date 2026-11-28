import { expect, test } from 'vitest'
import { pinShopOptions } from './options.ts'
import type { Manifest } from './types.ts'

test('pinShopOptions resets only shop options to default', () => {
  const m = {
    options: [
      { key: 'car', label: '차', shop: true, choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
      { key: 'len', label: '길이', choices: [{ value: 's', label: 'S' }, { value: 'l', label: 'L' }], default: 's' },
    ],
  } as unknown as Manifest
  const input = { car: 'b', len: 'l' }
  expect(pinShopOptions(m, input)).toEqual({ car: 'a', len: 'l' })
  expect(input).toEqual({ car: 'b', len: 'l' })
  expect(pinShopOptions(m, {})).toEqual({ car: 'a' })
})
