// 수집 범위 밖 선수를 다시 수집하지 않고 기존 CSV에 더할 때 쓰는 순수 함수 (add-players.ts).
import { FILES, sortRows, type FileName } from './schema.ts'

/**
 * 새 선수의 인지도: 기존 선수 위키 문서 수(base)와 새 선수들을 합친 분포에서의 백분위(0~100).
 * 전체 수집의 popularity()와 같은 식(아래 값 개수 / (전체 - 1))이다. 기존 선수 값은 바꾸지 않는다.
 */
export function popularityAgainst(base: readonly number[], added: ReadonlyMap<string, number>): Map<string, number> {
  const vals = [...base, ...added.values()].sort((a, b) => a - b)
  const below = (v: number) => {
    let lo = 0, hi = vals.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < v) lo = mid + 1; else hi = mid }
    return lo
  }
  return new Map([...added].map(([id, v]) => [id, vals.length <= 1 ? 100 : Math.round((below(v) / (vals.length - 1)) * 100)]))
}

/** 파일 키(schema.ts)가 같은 줄은 새 줄로 바꾸고 파일 순서로 정렬한 사본 */
export function mergeRows<T extends object>(file: FileName, existing: readonly T[], added: readonly T[]): T[] {
  const key = (r: T) => FILES[file].key.map((c) => String((r as Record<string, unknown>)[c] ?? '')).join('\u0001')
  const m = new Map(existing.map((r) => [key(r), r]))
  for (const r of added) m.set(key(r), r)
  return sortRows(file, [...m.values()])
}
