import { expect, test } from 'vitest'
import { HISTORY_FROM, LEAGUES } from './leagues.ts'

// 리그와 전신 대회의 시기가 겹치지 않고, 1987 이후로는 빈 해 없이 이어진다 (설계 2026-11-25 §3.7)
// 전신 대회 QID를 아직 못 찾아 시작이 늦은 리그 (찾으면 지운다). 챔피언십 1987~1991 = 풋볼리그 2부
const PENDING: Record<string, number> = {}

test('league_eras_are_contiguous_without_overlap_since_history_from', () => {
  for (const l of LEAGUES) {
    const periods = [...(l.eras ?? []).map((e) => ({ id: e.id, from: e.from, to: e.to })), { id: l.id, from: l.since ?? HISTORY_FROM, to: Infinity }]
      .map((p) => ({ ...p, from: Math.max(p.from, HISTORY_FROM) })).filter((p) => p.to >= p.from)
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].from, `${l.name_en}: ${periods[i - 1].id} → ${periods[i].id}`).toBe(periods[i - 1].to + 1)
    }
    expect(periods[0].from, `${l.name_en}: ${HISTORY_FROM}부터 시작`).toBe(PENDING[l.id] ?? HISTORY_FROM)
  }
})
