// 시즌 소속 판정 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.6). 순수 함수만.
// 경력(spells.csv)은 날짜 그대로 두고, "몇 시즌에 어느 팀"은 여기서 한 규칙으로 계산한다. 입출력은 derive-seasons.ts.
import { CALENDAR_YEAR_NATIONS } from './leagues.ts'
import { cmp } from './wikidata.ts'

/** 경력 한 줄에서 판정에 쓰는 열 (spells.csv와 같은 이름) */
export type SpellInput = {
  player_id: string; team_id: string; start_date: string; end_date: string; date_precision: string; loan: string
}
export type Membership = { player_id: string; season: string; team_id: string; primary: string; days: string; estimated: string }

/**
 * 시즌 달력. start: 시즌 시작 월-일. windowEnd: 개막 이적시장이 끝난 다음 날(이 날 전에 끝난 구간은 그 시즌 소속이 아님).
 * split: 가을–봄(7/1 시작, 9/1까지 이적). year: 단일 연도(1/1 시작, 3/31까지 이적).
 */
export const CALENDARS = {
  split: { start: '07-01', windowEnd: '09-02' },
  year: { start: '01-01', windowEnd: '04-01' },
} as const
export type Calendar = keyof typeof CALENDARS

export function calendarOf(nationId: string | undefined): Calendar {
  return nationId && CALENDAR_YEAR_NATIONS.includes(nationId) ? 'year' : 'split'
}

/** 시즌 s의 [시작, 끝) */
export function seasonRange(cal: Calendar, s: number): { from: string; to: string; windowEnd: string } {
  const c = CALENDARS[cal]
  return { from: `${s}-${c.start}`, to: `${s + 1}-${c.start}`, windowEnd: `${s}-${c.windowEnd}` }
}

/** 연도 단위 시작 Y: Y년 안의 첫 시즌 경계 */
export const yearStart = (cal: Calendar, y: number) => `${y}-${CALENDARS[cal].start}`
/** 연도 단위 종료 Y: Y-01-01 뒤의 첫 시즌 경계 (가을–봄 Y-07-01, 단일 연도 (Y+1)-01-01) */
export const yearEnd = (cal: Calendar, y: number) => cal === 'year' ? `${y + 1}-01-01` : `${y}-07-01`

/**
 * 시즌과 이보다 적게 겹치면 소속으로 치지 않는다. 종료일을 '마지막 날'(6/30)로 적은 경력과 '다음 팀 시작일'로 적은
 * 경력이 섞여 있어 시즌 경계에 하루이틀 걸치는 구간(임대 복귀일 등)을 거른다.
 */
export const MIN_DAYS = 7

const DAY = 86_400_000
const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY)
const max = (a: string, b: string) => (a > b ? a : b)
const min = (a: string, b: string) => (a < b ? a : b)

/** 판정용 구간 [from, to). estimated: 연도 단위 날짜나 열린 경력 닫기로 만든 경계가 있음 */
export type Interval = { from: string; to: string; estimated: boolean }
type Built = { spell: SpellInput; cal: Calendar; from: string; to: string | null; estimated: boolean }

/** 날짜만 해석한 구간. 종료일이 없거나 오늘 뒤면 to = null (나중에 닫는다) */
function baseOf(spell: SpellInput, cal: Calendar, today: string): Built {
  const isYear = spell.date_precision === 'year'
  const sy = Number(spell.start_date.slice(0, 4))
  let from = isYear ? yearStart(cal, sy) : spell.start_date
  let to: string | null = null
  if (spell.end_date) {
    const ey = Number(spell.end_date.slice(0, 4))
    to = isYear ? yearEnd(cal, ey) : spell.end_date
    // 가을–봄 팀에서 시작·종료가 같은 해면 그해 1~6월(겨울 임대 등 반 시즌)로 본다
    if (isYear && to <= from) from = `${sy}-01-01`
    if (to > today) to = null
  }
  return { spell, cal, from, to, estimated: isYear }
}

/**
 * 선수 한 명의 경력을 판정용 구간으로. 열린 경력은 그 뒤 다른 팀 완전 이적(임대는 아무 경력) 시작일로 닫고, 없으면 오늘까지.
 * 원 소속 구간에서는 다른 팀 임대 구간을 뺀다. 결과는 팀별 구간 목록.
 */
export function playerIntervals(spells: readonly SpellInput[], calOf: (teamId: string) => Calendar, today: string): { team_id: string; intervals: Interval[] }[] {
  const built = spells.map((s) => baseOf(s, calOf(s.team_id), today))
  for (const b of built) {
    if (b.to !== null) continue
    const isLoan = b.spell.loan === 'true'
    const next = built
      .filter((o) => o !== b && o.spell.team_id !== b.spell.team_id && o.from > b.from && (isLoan || o.spell.loan !== 'true'))
      .map((o) => o.from).sort()[0]
    if (next !== undefined) { b.to = next; b.estimated = true } else b.to = max(today, b.from)
  }
  const done = built.filter((b) => b.to! > b.from) as (Built & { to: string })[]
  const loans = done.filter((b) => b.spell.loan === 'true')
  const out: { team_id: string; intervals: Interval[] }[] = []
  for (const b of done) {
    let pieces: Interval[] = [{ from: b.from, to: b.to, estimated: b.estimated }]
    if (b.spell.loan !== 'true') {
      for (const l of loans) {
        if (l.spell.team_id === b.spell.team_id) continue
        pieces = pieces.flatMap((p) => {
          if (l.to <= p.from || l.from >= p.to) return [p]
          const est = p.estimated || l.estimated
          const parts: Interval[] = []
          if (l.from > p.from) parts.push({ from: p.from, to: l.from, estimated: est })
          if (l.to < p.to) parts.push({ from: l.to, to: p.to, estimated: est })
          return parts
        })
      }
    }
    out.push({ team_id: b.spell.team_id, intervals: pieces })
  }
  return out
}

/**
 * 시즌 소속. 구간이 시즌과 겹치면 소속, 단 개막 이적시장 안에서 끝난 구간은 빼고(출전 전 이적으로 본다).
 * 한 시즌 여러 팀이면 머문 날이 가장 많은 팀이 primary, 같으면 늦게 온 팀.
 */
export function deriveMemberships(
  spells: readonly SpellInput[],
  teamNation: ReadonlyMap<string, string>,
  opts: { from: number; to: number; today: string },
): Membership[] {
  const calOf = (t: string) => calendarOf(teamNation.get(t))
  const byPlayer = new Map<string, SpellInput[]>()
  for (const s of spells) {
    const list = byPlayer.get(s.player_id)
    if (list) list.push(s); else byPlayer.set(s.player_id, [s])
  }
  const rows: Membership[] = []
  for (const [player, list] of byPlayer) {
    type Acc = { team: string; days: number; estimated: boolean; arrived: string }
    const seasons = new Map<number, Map<string, Acc>>()
    for (const { team_id, intervals } of playerIntervals(list, calOf, opts.today)) {
      const cal = calOf(team_id)
      for (const iv of intervals) {
        const first = Math.max(opts.from, Number(iv.from.slice(0, 4)) - 1)
        const last = Math.min(opts.to, Number(iv.to.slice(0, 4)))
        for (let s = first; s <= last; s++) {
          const r = seasonRange(cal, s)
          if (iv.from >= r.to || iv.to <= r.from) continue
          if (iv.to < r.windowEnd) continue
          const days = daysBetween(max(iv.from, r.from), min(iv.to, r.to))
          if (days <= 0) continue
          let m = seasons.get(s)
          if (!m) seasons.set(s, (m = new Map()))
          const acc = m.get(team_id)
          if (acc) { acc.days += days; acc.estimated ||= iv.estimated; if (iv.from < acc.arrived) acc.arrived = iv.from }
          else m.set(team_id, { team: team_id, days, estimated: iv.estimated, arrived: iv.from })
        }
      }
    }
    for (const [season, m] of seasons) {
      const accs = [...m.values()].filter((a) => a.days >= MIN_DAYS)
      if (!accs.length) continue
      const top = accs.reduce((a, b) => (b.days > a.days || (b.days === a.days && b.arrived > a.arrived) ? b : a))
      for (const a of accs) {
        rows.push({
          player_id: player, season: String(season), team_id: a.team, primary: String(a === top),
          days: String(a.days), estimated: String(a.estimated),
        })
      }
    }
  }
  return rows.sort((a, b) => cmp(a.player_id, b.player_id) || cmp(a.season, b.season) || cmp(a.team_id, b.team_id))
}

export const MEMBERSHIP_COLUMNS: (keyof Membership)[] = ['player_id', 'season', 'team_id', 'primary', 'days', 'estimated']
