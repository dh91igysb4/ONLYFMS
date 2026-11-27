// 커리어 퀴즈 문제 만들기 (설계 docs/superpowers/specs/2026-11-25-career-quiz-design.md §2.3·§4). 순수 함수만.
// build-career-quiz.ts가 data/football/을 읽어 이 함수들로 src/games/career-quiz/data.ts를 만든다.
import type { Row } from './wikidata.ts'

export type Tier = 'easy' | 'normal' | 'hard'
export const TIERS: readonly Tier[] = ['easy', 'normal', 'hard']

/** 경력 한 줄: [시작 연도, 끝 연도(없으면 null), 클럽 영문 짧은 이름, 임대 1/0] */
export type Line = [from: number, to: number | null, team: string, loan: 0 | 1]

/** 2·3군·유스 팀 이름 (teams.csv name_en). 1군인데 걸리는 팀은 manual/career_quiz_first_teams.csv로 살린다 */
const RESERVE_NAME = /( B| C| II| III)$|Castilla|Atlètic$|\bJong\b|\bU-?\d{2}\b|Under-\d{2}|Primavera|Reserves?\b|Academy|\bYouth\b/i

export function isReserveName(nameEn: string): boolean {
  return RESERVE_NAME.test(nameEn.trim())
}

// 클럽 짧은 이름: 앞뒤의 법인·종목 약어(FC, F.C., CF, AS, SSC …)와 창단 연도를 뗀다.
// 규칙이 어색한 팀(Real Madrid Club de Fútbol, AC Milan, FC Seoul …)은 manual/career_quiz_club_names.csv로 지정한다.
const CLUB_PREFIX = /^(?:Club Social y Deportivo|Club Atlético|Club de Fútbol|Associação Desportiva|Sociedade Esportiva|Esporte Clube|Club|Calcio|1\. ?FC|F\.?C\.?|A\.?F\.?C\.?|C\.?F\.?|A\.?C\.?|A\.?S\.?|S\.?S\.?C\.?|S\.?S\.?|ACF|S\.?L\.?|S\.?C\.?|S\.?D\.?|C\.?S\.?|U\.?C\.?|R\.?S\.?C\.?|R\.?C\.?|RCD|K\.?A\.?A\.?|K\.?R\.?C\.?|K\.?S\.?V\.?|K\.?S\.?K\.?|GNK|HNK|N\.?K\.?|PFC|SBV|VfL|VfB|SV|CR|C\.?D\.?|U\.?D\.?|C\.?A\.?|OGC|U\.?S\.?|A\.?D\.?|FK|SK|IF)\s+/
const CLUB_SUFFIX = /\s+(?:Futebol Clube|Fútbol Club|Football Club|Esporte Clube|Sports? Club|Balompié|Calcio|F\.?C\.?|A\.?F\.?C\.?|C\.?F\.?|S\.?C\.?|A\.?C\.?|U\.?D\.?|CFC|BC|S\.?K\.?|J\.?K\.?|F\.?K\.?|K\.?V\.?|V\.?V\.?|SFC|PFC|OSC|FF|IF|fB|E\.?C\.?|F\.?R\.?|FBPA|\d{4})$/

export function shortClubName(nameEn: string): string {
  let n = nameEn.trim()
  for (;;) {
    const m = n.replace(CLUB_PREFIX, '').replace(CLUB_SUFFIX, '').trim()
    if (m === n || m === '') return n
    n = m
  }
}

export type Filters = {
  /** 이름 규칙과 상관없이 1군으로 보는 팀 */
  firstTeams: ReadonlySet<string>
  /** 이름 규칙과 상관없이 2군으로 보는 팀 */
  reserveTeams: ReadonlySet<string>
  /** 직접 뺄 경력(source_ref) */
  hide: ReadonlySet<string>
  /** 클럽 표시 이름 직접 지정 (team_id → 이름). 없으면 shortClubName(name_en) */
  clubNames?: ReadonlyMap<string, string>
}

const yearOf = (d: string) => Number(d.slice(0, 4))

/** 유스 구간: 경기 수가 없고 만 18세가 되는 해까지 끝난 구간 */
export function isYouth(sp: Row, birthYear: number | null): boolean {
  if (sp.apps !== '' || sp.end_date === '' || birthYear === null) return false
  return yearOf(sp.end_date) <= birthYear + 18
}

/** 1군 프로 경력 줄. 시작·끝 순으로 정렬하고, 중간에 열린 구간은 다음 구간 시작 연도로 닫는다 */
export function careerLines(
  spells: readonly Row[],
  teams: ReadonlyMap<string, Row>,
  birthYear: number | null,
  f: Filters,
): Line[] {
  const kept = spells.filter((sp) => {
    if (!sp.start_date || f.hide.has(sp.source_ref)) return false
    const t = teams.get(sp.team_id)
    if (!t || t.kind !== 'club') return false
    if (f.reserveTeams.has(t.id)) return false
    if (!f.firstTeams.has(t.id) && isReserveName(t.name_en)) return false
    return !isYouth(sp, birthYear)
  })
  const rows = kept.map((sp) => ({
    from: yearOf(sp.start_date),
    to: sp.end_date ? yearOf(sp.end_date) : null,
    team: f.clubNames?.get(sp.team_id) ?? shortClubName(teams.get(sp.team_id)!.name_en),
    loan: sp.loan === 'true',
  }))
  const end = (r: { to: number | null }) => r.to ?? Infinity
  rows.sort((a, b) => a.from - b.from || end(a) - end(b) || a.team.localeCompare(b.team))
  // 열린 구간이 뒤 구간보다 앞에 있으면 닫는다. 임대는 다음 아무 구간, 완전 이적은 다음 완전 이적의 시작으로.
  // 뒤에 임대만 있는 완전 이적(지금 소속 클럽에서 임대 중)은 열어 둔다.
  for (const [i, r] of rows.entries()) {
    if (r.to !== null) continue
    const next = rows.slice(i + 1).find((n) => n.from > r.from && (r.loan || !n.loan))
    if (next) r.to = next.from
  }
  // 같은 클럽·같은 임대 여부의 겹치는 구간(위키데이터 중복 진술)은 하나로 합친다
  const merged: typeof rows = []
  for (const r of rows) {
    const m = merged.find((x) => x.team === r.team && x.loan === r.loan && x.from <= end(r) && r.from <= end(x))
    if (!m) { merged.push({ ...r }); continue }
    m.from = Math.min(m.from, r.from)
    m.to = m.to === null || r.to === null ? null : Math.max(m.to, r.to)
  }
  return merged.map((r) => [r.from, r.to, r.team, r.loan ? 1 : 0])
}

/** 문제가 되는 최소 1군 클럽 수 (원클럽맨도 낸다) */
export const MIN_CLUBS = 1

/** 서로 다른 클럽 수 */
export function clubCount(lines: readonly Line[]): number {
  return new Set(lines.map((l) => l[2])).size
}

/** 같은 문제로 보이는 다른 선수를 찾는 키 (클럽·시작 연도 순서) */
export function lineKey(lines: readonly Line[]): string {
  return lines.map((l) => `${l[2]}@${l[0]}`).join('|')
}

/** 위키데이터 국가 중 iso2가 비었지만 국기가 분명한 곳 (검색 결과 국기용) */
export const NATION_ISO_FIX: Readonly<Record<string, string>> = {
  Q55: 'nl', // Netherlands
  Q756617: 'dk', // Kingdom of Denmark
  Q713750: 'de', // West Germany
  Q216923: 'tw', // Chinese Taipei
  Q3311985: 'gg', // Guernsey
}

/** 국가 QID → [iso2(소문자, 잉글랜드 등은 gb-eng), 한글 이름]. 국기가 없는 곳은 iso2 ''. */
export function nationCodes(nations: readonly Row[]): Record<string, [iso: string, nameKo: string]> {
  const out: Record<string, [string, string]> = {}
  for (const n of [...nations].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    const iso = (n.iso2 || NATION_ISO_FIX[n.id] || '').toLowerCase()
    out[n.id] = [/^[a-z]{2}(-[a-z]{3})?$/.test(iso) ? iso : '', n.name_ko || n.name_en]
  }
  return out
}
