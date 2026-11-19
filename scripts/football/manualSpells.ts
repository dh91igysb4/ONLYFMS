// 직접 입력 경력(data/football/manual/spells.csv)을 위키데이터 경력 위에 반영한다. 순수 함수만.
// 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §5.3. 수집(fetch-wikidata.ts)과
// 시즌 소속 계산(derive-seasons.ts)이 함께 쓴다. 같은 입력에 여러 번 반영해도 결과가 같다.
//
// action
//   add    새 경력. source_ref는 비우고(manual:<선수>:<팀>:<시작일>로 만든다), player_id·team_id·start_date·source_url 필수
//   fix    기존 경력 수정. source_ref(spells.csv의 값)·player_id·source_url 필수. 채운 칸(start_date·end_date·loan)만 바꾼다
//   delete 기존 경력 삭제(여자 팀 경력이 남자 클럽에 붙은 경우 등). source_ref·player_id·note(사유) 필수
import { cmp, type Row, type Spell } from './wikidata.ts'

export const MANUAL_SPELL_COLUMNS = ['action', 'player_id', 'team_id', 'source_ref', 'start_date', 'end_date', 'loan', 'source_url', 'note'] as const

const QID = /^Q\d+$/
const YEAR = /^\d{4}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDate = (s: string) => YEAR.test(s) || (DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)))

/** 시작·종료가 모두 일 단위(종료 없음 포함)면 day, 아니면 year로 맞춘다 (buildSpells와 같은 규칙) */
function withPrecision(sp: Spell, start: string, end: string): Spell {
  const day = DAY.test(start) && (end === '' || DAY.test(end))
  return { ...sp, start_date: day ? start : start.slice(0, 4), end_date: day ? end : end.slice(0, 4), date_precision: day ? 'day' : 'year' }
}

export function manualRef(r: Row): string {
  return `manual:${r.player_id}:${r.team_id}:${r.start_date}`
}

export type ManualResult = { spells: Spell[]; problems: string[]; added: number; fixed: number; deleted: number }

/**
 * spells에 직접 입력을 반영한 사본. 잘못된 줄은 problems(`manual/spells:<줄>: …`)로 돌려주고 건너뛴다.
 * known이 있으면 선수·팀이 수집 결과에 있는지도 본다. delete 대상이 이미 없으면(반영된 뒤 다시 돌린 경우) 문제로 치지 않는다.
 */
export function applyManualSpells(
  spells: readonly Spell[],
  manual: readonly Row[],
  known?: { players: ReadonlySet<string>; teams: ReadonlySet<string> },
): ManualResult {
  const byRef = new Map(spells.map((s) => [s.source_ref, s]))
  const problems: string[] = []
  let added = 0, fixed = 0, deleted = 0
  manual.forEach((r, i) => {
    const where = `manual/spells:${i + 2}`
    const bad = (m: string) => { problems.push(`${where}: ${m}`) }
    const v = (c: string) => (r[c] ?? '').trim()
    const action = v('action'), player = v('player_id'), team = v('team_id'), ref = v('source_ref')
    const start = v('start_date'), end = v('end_date'), loan = v('loan')
    if (!['add', 'fix', 'delete'].includes(action)) return bad(`action ${action || '(빈 값)'}은(는) add·fix·delete 중 하나`)
    if (!QID.test(player)) return bad(`player_id ${player || '(빈 값)'} 형식이 틀림`)
    if (known && !known.players.has(player)) return bad(`player_id ${player}가 players.csv에 없음`)
    if (start && !isDate(start)) return bad(`start_date ${start}은(는) YYYY 또는 YYYY-MM-DD`)
    if (end && !isDate(end)) return bad(`end_date ${end}은(는) YYYY 또는 YYYY-MM-DD`)
    if (loan && loan !== 'true' && loan !== 'false') return bad(`loan ${loan}은(는) true·false`)
    if (action !== 'delete' && !/^https?:\/\//.test(v('source_url'))) return bad(`${action}에는 근거 source_url(http…)이 필요`)

    if (action === 'add') {
      if (ref) return bad('add는 source_ref를 비운다 (manual:…로 만든다)')
      if (!QID.test(team)) return bad(`team_id ${team || '(빈 값)'} 형식이 틀림`)
      if (known && !known.teams.has(team)) return bad(`team_id ${team}가 teams.csv에 없음 (클럽만)`)
      if (!start) return bad('add에는 start_date가 필요')
      const sp = withPrecision({
        player_id: player, team_id: team, start_date: '', end_date: '', date_precision: 'day',
        loan: loan || 'false', apps: '', goals: '', source_ref: manualRef({ player_id: player, team_id: team, start_date: start }),
      }, start, end)
      if (sp.end_date && cmp(sp.end_date, sp.start_date) < 0) return bad(`end_date ${end}가 start_date ${start}보다 앞`)
      byRef.set(sp.source_ref, sp)
      added++
      return
    }

    // fix·delete: 기존 경력을 source_ref로 찾는다. 다른 선수의 경력을 건드리지 않게 선수 접두를 확인한다
    if (!ref) return bad(`${action}에는 source_ref가 필요 (spells.csv의 값)`)
    if (!ref.startsWith(`${player}-`) && !ref.startsWith(`manual:${player}:`)) return bad(`source_ref ${ref}가 player_id ${player}의 경력이 아님`)
    const cur = byRef.get(ref)
    if (action === 'delete') {
      if (!v('note')) return bad('delete에는 사유 note가 필요')
      if (cur) { byRef.delete(ref); deleted++ }
      return
    }
    if (!cur) return bad(`source_ref ${ref}가 spells.csv에 없음`)
    if (!start && !end && !loan) return bad('fix에 바꿀 값(start_date·end_date·loan)이 없음')
    const next = withPrecision({ ...cur, loan: loan || cur.loan }, start || cur.start_date, end || cur.end_date)
    if (next.end_date && cmp(next.end_date, next.start_date) < 0) return bad(`고친 뒤 end_date ${next.end_date}가 start_date ${next.start_date}보다 앞`)
    byRef.set(ref, next)
    fixed++
  })
  return { spells: [...byRef.values()], problems, added, fixed, deleted }
}
