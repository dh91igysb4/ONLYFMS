// 폰 화면 배치(CSS). 캔버스 배율은 정수라 남은 높이가 480px(240칸×2)보다 작으면 1배로 작아진다.
// 그래서 폰에서는 캔버스 위·아래 줄을 줄여 2배를 지킨다(실측: 430×740 화면에서 1배 → 2배).
import { expect, test } from 'vitest'
import css from './fishing.css?raw'

const flat = css.replace(/\s+/g, ' ')

test('폰(≤600px)에서 게임 위 골드 줄은 숨긴다(머리글 지갑에 같은 골드). 전체화면에서는 그대로', () => {
  expect(flat).toMatch(/@media \(max-width: 600px\) \{[^@]*\.fish:not\(\.fish-full\) > \.fish-top \{ display: none; \}/)
})

test('폰(≤600px)에서 아래 메뉴 버튼은 한 줄을 고르게 나눠 쓰고, 넘치면 고르게 두 줄', () => {
  expect(flat).toMatch(/@media \(max-width: 600px\) \{[^@]*\.fish-menu \{ flex: 1 1 100%; flex-wrap: wrap; gap: 4px; \}[^@]*\.fish-menu \.btn \{ flex: 1 1 auto; padding: 0 6px; \}/)
})

test('지도가 캔버스보다 작을 때 남는 칸이 페이지 바탕과 섞이지 않게 게임 틀에 판 색', () => {
  expect(flat).toContain('.fish-frame { position: relative; max-width: 100%; background: var(--panel); border-radius: 8px; overflow: hidden; }')
})
