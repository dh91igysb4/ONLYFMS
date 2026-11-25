import { describe, expect, test } from 'vitest'
import { syncTags } from './peerTags.ts'

const tag = (id: string, handle: string, x = 10, y = 20, visible = true) => ({ id, handle, x, y, visible })
const spans = (c: HTMLElement) => [...c.querySelectorAll<HTMLSpanElement>('span.fish-peer-tag')]

describe('syncTags', () => {
  test('태그마다 span 하나, 글자와 위치', () => {
    const c = document.createElement('div')
    syncTags(c, [tag('a', 'kane', 10, 20), tag('b', 'son', 30, 40)])
    const s = spans(c)
    expect(s.map((x) => x.querySelector('.fish-peer-name')?.textContent)).toEqual(['kane', 'son'])
    expect(s[0].dataset.id).toBe('a')
    expect(s[0].style.transform).toBe('translate(10px, 20px)')
    expect(s[1].style.transform).toBe('translate(30px, 40px)')
  })

  test('목록에서 빠진 사람의 span은 지운다', () => {
    const c = document.createElement('div')
    syncTags(c, [tag('a', 'kane'), tag('b', 'son')])
    syncTags(c, [tag('b', 'son')])
    expect(spans(c).map((x) => x.dataset.id)).toEqual(['b'])
  })

  test('화면 밖이면 숨긴다', () => {
    const c = document.createElement('div')
    syncTags(c, [tag('a', 'kane', 0, 0, false)])
    expect(spans(c)[0].hidden).toBe(true)
    syncTags(c, [tag('a', 'kane', 0, 0, true)])
    expect(spans(c)[0].hidden).toBe(false)
  })

  test('같은 사람은 같은 span을 다시 쓴다', () => {
    const c = document.createElement('div')
    syncTags(c, [tag('a', 'kane', 1, 1)])
    const first = spans(c)[0]
    syncTags(c, [tag('a', 'kane2', 5, 6)])
    expect(spans(c)[0]).toBe(first)
    expect(first.querySelector('.fish-peer-name')?.textContent).toBe('kane2')
    expect(first.style.transform).toBe('translate(5px, 6px)')
  })
})

describe('자랑 카드·이모트 (설계 2026-11-25-fishing-brag-discard)', () => {
  test('card는 이름 아래 한 줄(희귀도 tone 클래스), emote는 이름 위. 빠지면 지운다', () => {
    const c = document.createElement('div')
    syncTags(c, [{ ...tag('a', 'kane'), card: { text: '고등어 40cm · 100 G · 흔함', tone: 'legend' }, emote: '👍' }])
    const s = spans(c)[0]
    expect(s.querySelector('.fish-peer-name')?.textContent).toBe('kane')
    const card = s.querySelector<HTMLElement>('.fish-peer-card')!
    expect(card.textContent).toBe('고등어 40cm · 100 G · 흔함')
    expect(card.dataset.tone).toBe('legend')
    expect(s.querySelector('.fish-peer-emote')?.textContent).toBe('👍')
    syncTags(c, [tag('a', 'kane')])
    expect(s.querySelector('.fish-peer-card')).toBeNull()
    expect(s.querySelector('.fish-peer-emote')).toBeNull()
    expect(s.querySelector('.fish-peer-name')?.textContent).toBe('kane')
  })
})
