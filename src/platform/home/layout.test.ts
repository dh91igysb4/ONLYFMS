import { describe, expect, test } from 'vitest'
import {
  moveDown,
  moveUp,
  resolveLayout,
  toggle,
  toSaved,
  type HomeLayoutEntry,
} from './layout.ts'

const known = ['a', 'b', 'c']
const defaults: HomeLayoutEntry[] = [
  { id: 'a', on: true },
  { id: 'b', on: true },
  { id: 'c', on: true },
]

describe('resolveLayout', () => {
  test.each([
    ['null', null],
    ['문자열', 'x'],
    ['객체', {}],
    ['undefined', undefined],
  ])('저장값이 배열이 아니면(%s) 기본값', (_, saved) => {
    expect(resolveLayout(saved, known)).toEqual(defaults)
  })

  test('저장 순서를 지키고, 새 블록 b는 맨 아래 켜짐', () => {
    expect(
      resolveLayout(
        [
          { id: 'c', on: false },
          { id: 'a', on: true },
        ],
        known,
      ),
    ).toEqual([
      { id: 'c', on: false },
      { id: 'a', on: true },
      { id: 'b', on: true },
    ])
  })

  test('모르는 id·중복·형식 틀린 원소를 버린다', () => {
    expect(
      resolveLayout(
        [
          { id: 'z', on: true },
          { id: 'b', on: false },
          { id: 'b', on: true },
          { id: 'a' },
          'x',
          null,
        ],
        known,
      ),
    ).toEqual([
      { id: 'b', on: false },
      { id: 'a', on: true },
      { id: 'c', on: true },
    ])
  })

  test('모르는 id만 있는 배열은 기본값과 같음', () => {
    expect(resolveLayout([{ id: 'z', on: false }], known)).toEqual(defaults)
  })

  test('결과에 known 각 id가 정확히 한 번 나온다', () => {
    const result = resolveLayout(
      [
        { id: 'c', on: false },
        { id: 'c', on: true },
        { id: 'q', on: true },
      ],
      known,
    )
    const ids = result.map((e) => e.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  test('입력 배열과 원소를 바꾸지 않는다', () => {
    const saved = [{ id: 'c', on: false }, { id: 'z', on: true }]
    const copy = JSON.parse(JSON.stringify(saved))
    const result = resolveLayout(saved, known)
    expect(saved).toEqual(copy)
    expect(result).not.toBe(saved)
  })
})

describe('moveUp / moveDown', () => {
  const layout: HomeLayoutEntry[] = [
    { id: 'a', on: true },
    { id: 'b', on: false },
    { id: 'c', on: true },
  ]

  test('맨 위를 위로 올리면 그대로', () => {
    expect(moveUp(layout, 'a')).toEqual(layout)
  })

  test('맨 아래를 아래로 내리면 그대로', () => {
    expect(moveDown(layout, 'c')).toEqual(layout)
  })

  test('중간 항목 위로 이동은 이웃과 자리 바꿈 (꺼진 블록도 이동)', () => {
    expect(moveUp(layout, 'b')).toEqual([
      { id: 'b', on: false },
      { id: 'a', on: true },
      { id: 'c', on: true },
    ])
  })

  test('중간 항목 아래로 이동은 이웃과 자리 바꿈 (꺼진 블록도 이동)', () => {
    expect(moveDown(layout, 'b')).toEqual([
      { id: 'a', on: true },
      { id: 'c', on: true },
      { id: 'b', on: false },
    ])
  })

  test('입력 배열을 바꾸지 않는다', () => {
    const copy = JSON.parse(JSON.stringify(layout))
    const up = moveUp(layout, 'b')
    const down = moveDown(layout, 'b')
    expect(layout).toEqual(copy)
    expect(up).not.toBe(layout)
    expect(down).not.toBe(layout)
  })
})

describe('toggle', () => {
  const layout: HomeLayoutEntry[] = [
    { id: 'a', on: true },
    { id: 'b', on: true },
    { id: 'c', on: false },
  ]

  test('해당 on만 뒤집는다', () => {
    expect(toggle(layout, 'b')).toEqual([
      { id: 'a', on: true },
      { id: 'b', on: false },
      { id: 'c', on: false },
    ])
    expect(toggle(layout, 'c')).toEqual([
      { id: 'a', on: true },
      { id: 'b', on: true },
      { id: 'c', on: true },
    ])
  })

  test('입력 배열과 원소를 바꾸지 않는다', () => {
    const copy = JSON.parse(JSON.stringify(layout))
    const result = toggle(layout, 'a')
    expect(layout).toEqual(copy)
    expect(result).not.toBe(layout)
  })
})

describe('toSaved', () => {
  test('기본값이면 null', () => {
    expect(toSaved(resolveLayout(null, known), known)).toBeNull()
  })

  test('순서가 다르면 배열 그대로', () => {
    const layout = [
      { id: 'b', on: true },
      { id: 'a', on: true },
      { id: 'c', on: true },
    ]
    expect(toSaved(layout, known)).toEqual(layout)
  })

  test('on이 하나라도 다르면 배열 그대로', () => {
    const layout = [
      { id: 'a', on: true },
      { id: 'b', on: false },
      { id: 'c', on: true },
    ]
    expect(toSaved(layout, known)).toEqual(layout)
  })
})
