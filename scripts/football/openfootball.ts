// openfootball(퍼블릭 도메인) 경기 일정에서 리그·시즌별 참가팀 이름을 뽑아 우리 팀 ID(위키데이터 QID)에 잇는다.
// 순수 함수만. 수집은 fetch-openfootball.ts. 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.5.
//
// 위키데이터의 시즌별 참가팀(P1923)이 빈 시즌이 많아(2026-11-02 첫 수집) 경기 일정에 나온 팀으로 채운다.
// 이름 → ID 연결은 이미 수집한 teams.csv·aliases.csv에서 찾고, 못 찾거나 애매하면 manual/openfootball_teams.csv로 정한다.
import { cmp, type Row, type TeamCompetition } from './wikidata.ts'

const RAW = 'https://raw.githubusercontent.com/openfootball'

/** 리그 QID → openfootball 파일. json은 football.json 저장소의 리그 코드, txt는 json이 없는 시즌의 대안(europe 저장소) */
export const OF_SOURCES: Readonly<Record<string, { json: string; txt?: (folder: string) => string }>> = {
  Q9448: { json: 'en.1' },
  Q19510: { json: 'en.2' },
  Q324867: { json: 'es.1' },
  Q15804: { json: 'it.1' },
  Q82595: { json: 'de.1' },
  Q13394: { json: 'fr.1' },
  Q182994: { json: 'pt.1' },
  Q216022: { json: 'be.1' },
  Q167541: { json: 'nl.1', txt: (f) => `europe/master/netherlands/${f}_nl1.txt` },
  Q485568: { json: 'tr.1', txt: (f) => `europe/master/turkey/${f}_tr1.txt` },
}

/** 시즌 시작 연도 → openfootball 폴더 이름 (2024 → 2024-25) */
export const seasonFolder = (season: number) => `${season}-${String(season + 1).slice(2)}`

/** 받아 볼 주소 목록(앞쪽 우선). 경로는 캐시 파일 이름으로도 쓴다 */
export function sourceUrls(competitionId: string, season: number): { path: string; url: string; kind: 'json' | 'txt' }[] {
  const s = OF_SOURCES[competitionId]
  if (!s) return []
  const f = seasonFolder(season)
  const out: { path: string; kind: 'json' | 'txt' }[] = [{ path: `football.json/master/${f}/${s.json}.json`, kind: 'json' }]
  if (s.txt) out.push({ path: s.txt(f), kind: 'txt' })
  return out.map((x) => ({ ...x, url: `${RAW}/${x.path}` }))
}

// ---------------------------------------------------------------- 파싱

const uniqSorted = (xs: Iterable<string>) => [...new Set([...xs].map((x) => x.trim()).filter(Boolean))].sort(cmp)

/** football.json 형식: { name, matches: [{ team1, team2, ... }] } */
export function parseJsonTeams(text: string): string[] {
  const d = JSON.parse(text) as { matches?: { team1?: unknown; team2?: unknown }[] }
  const name = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object' && 'name' in t ? String((t as { name: unknown }).name) : '')
  return uniqSorted((d.matches ?? []).flatMap((m) => [name(m.team1), name(m.team2)]))
}

// 경기 줄: [시각] 홈 (v | 점수) 원정 [점수]. 옛 형식은 "홈   v 원정   1-0 (0-0)", 새 형식은 "홈  1-0 (0-0)  원정" 또는 "홈   v   원정"
const TIME = /^\s*(?:\d{1,2}[:.]\d{2}\s+)?/
const SCORE = String.raw`\d+-\d+(?:\s*(?:\([^)]*\)|a\.?e\.?t\.?|pen\.?(?:\s*\d+-\d+)?))*`
const MATCH = new RegExp(String.raw`^(.+?)\s+(?:v|${SCORE})\s+(.+?)(?:\s{2,}.*)?$`)

/** football.txt 형식(europe 저장소). declared는 머리말 "# Teams N" (검사용) */
export function parseTxtTeams(text: string): { teams: string[]; declared: number | null } {
  const names: string[] = []
  let declared: number | null = null
  for (const raw of text.split(/\r?\n/)) {
    const h = /^#\s*Teams\s+(\d+)/.exec(raw)
    if (h) { declared = Number(h[1]); continue }
    if (/^\s*[#=▪[(]/.test(raw) || !raw.trim()) continue
    const m = MATCH.exec(raw.replace(TIME, '').replace(/\s+$/, ''))
    if (m) names.push(m[1], m[2].replace(new RegExp(String.raw`\s+${SCORE}$`), ''))
  }
  return { teams: uniqSorted(names), declared }
}

// ---------------------------------------------------------------- 이름 정규화

// 클럽 이름의 흔한 접두·접미어. 지워서 'FC Barcelona'와 'Barcelona'를 같게 본다(느슨한 비교에서만)
const GENERIC = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ssc', 'sv', 'vfl', 'vfb', 'tsg', 'fk', 'sk', 'bk', 'ss', 'us', 'cd', 'ud', 'rcd', 'rc', 'sd', 'ca',
  'club', 'de', 'del', 'la', 'le', 'calcio', 'fsv', 'bsc', 'kv', 'krc', 'rsc', 'kaa', 'cfc', 'ogc', 'sl', 'gd', 'sad', 'jk', 'and',
  'football', 'futbol', 'clube', 'cp', 'hsc', 'aj', 'sco', 'kas', 'kvc', 'rfc',
])

/** 소문자·악센트 제거, 마침표·따옴표는 붙이고 나머지 구두점에서 나눈 단어 목록 */
export function nameTokens(s: string): string[] {
  const t = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ı/g, 'i').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/&/g, ' and ')
    .replace(/[.'’`]/g, '') // F.C. → fc, Twente '65 → twente 65
  return t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** 엄격한 키(단어 그대로)와 느슨한 키(흔한 접사·숫자 제거). 느슨한 키가 비면 엄격한 키 */
export function nameKeys(s: string): { exact: string; loose: string } {
  const tokens = nameTokens(s)
  const exact = tokens.join(' ')
  const loose = tokens.filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w)).join(' ')
  return { exact, loose: loose || exact }
}

// ---------------------------------------------------------------- 연결

export type TeamRef = { id: string; nation_id: string; names: readonly string[] }

export type TeamIndex = {
  exact: Map<string, Set<string>>
  loose: Map<string, Set<string>>
  nation: Map<string, string>
  /** 팀별 경력 수(같은 이름 후보 중 큰 팀을 고르는 데 쓴다) */
  spells: Map<string, number>
  /** 팀별 이미 참가 기록이 있는 리그 */
  leagues: Map<string, Set<string>>
}

/** 클럽만 넣는다. names는 name_en·short_name·별칭 */
export function buildIndex(teams: readonly TeamRef[], spellsByTeam: ReadonlyMap<string, number>, teamComps: readonly TeamCompetition[]): TeamIndex {
  const idx: TeamIndex = { exact: new Map(), loose: new Map(), nation: new Map(), spells: new Map(spellsByTeam), leagues: new Map() }
  const add = (m: Map<string, Set<string>>, k: string, id: string) => { if (k) (m.get(k) ?? m.set(k, new Set()).get(k)!).add(id) }
  for (const t of teams) {
    idx.nation.set(t.id, t.nation_id)
    for (const n of t.names) {
      const k = nameKeys(n)
      add(idx.exact, k.exact, t.id)
      add(idx.loose, k.loose, t.id)
    }
  }
  for (const tc of teamComps) (idx.leagues.get(tc.team_id) ?? idx.leagues.set(tc.team_id, new Set()).get(tc.team_id)!).add(tc.competition_id)
  return idx
}

// 리그 소재국과 클럽 국적이 달라도 같은 리그에서 뛰는 경우(위키데이터 P17이 영국 Q145, 웨일스 클럽, 모나코)
const NATION_OK: Readonly<Record<string, readonly string[]>> = { Q21: ['Q145', 'Q25'], Q142: ['Q235'] }

export type League = { id: string; nation_id: string }
export type Match =
  | { status: 'ok'; team_id: string; via: 'manual' | 'exact' | 'loose' }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'missing'; candidates: string[] }

/**
 * 이름 하나를 팀 ID에 잇는다. 직접 지정(overrides) → 엄격한 이름 → 느슨한 이름 순.
 * 후보가 여럿이면 (그 리그 참가 기록, 국적 일치, 경력 수) 순으로 고르고, 셋 다 같으면 애매(ambiguous)로 둔다.
 * 그 리그 참가 기록도 국적 일치도 없는 후보는 다른 나라의 같은 이름 팀일 수 있어 쓰지 않는다(missing, candidates에 남김).
 * 경력 수가 가장 많은 후보의 1/10 미만인 후보는 먼저 뺀다. 위키데이터에는 클럽과 이름이 같은 별도 항목(Q979xxxxx, 경력 0~1)이
 * 시즌 참가팀으로 적혀 있어, 참가 기록을 먼저 보면 실제 클럽 대신 그 항목이 뽑혔다(2026-11-05, 분데스리가 장크트 파울리·홀슈타인 킬 등).
 */
export function matchTeam(name: string, league: League, idx: TeamIndex, overrides: ReadonlyMap<string, string>): Match {
  const manual = overrides.get(overrideKey(league.id, name)) ?? overrides.get(overrideKey('', name))
  if (manual) return { status: 'ok', team_id: manual, via: 'manual' }
  const k = nameKeys(name)
  for (const via of ['exact', 'loose'] as const) {
    const all = [...(idx[via].get(k[via]) ?? [])]
    if (!all.length) continue
    const most = Math.max(...all.map((id) => idx.spells.get(id) ?? 0))
    const ids = all.filter((id) => (idx.spells.get(id) ?? 0) * 10 >= most)
    const score = (id: string) => [
      idx.leagues.get(id)?.has(league.id) ? 1 : 0,
      idx.nation.get(id) === league.nation_id || NATION_OK[league.nation_id]?.includes(idx.nation.get(id) ?? '') ? 1 : 0,
      idx.spells.get(id) ?? 0,
    ]
    const ranked = ids.map((id) => ({ id, s: score(id) })).sort((a, b) => b.s[0] - a.s[0] || b.s[1] - a.s[1] || b.s[2] - a.s[2] || cmp(a.id, b.id))
    const [top, second] = ranked
    if (top.s[0] === 0 && top.s[1] === 0) return { status: 'missing', candidates: ranked.map((r) => r.id) }
    if (second && second.s.every((v, i) => v === top.s[i])) return { status: 'ambiguous', candidates: ranked.filter((r) => r.s.every((v, i) => v === top.s[i])).map((r) => r.id) }
    return { status: 'ok', team_id: top.id, via }
  }
  return { status: 'missing', candidates: [] }
}

// ---------------------------------------------------------------- 합치기

export type SeasonInfo = { competition_id: string; season: string; teams: string; matched: string }

/** openfootball 명단이 전부 이어진 리그·시즌 키(`리그|시즌`) */
export function completeSeasons(info: readonly SeasonInfo[]): Set<string> {
  return new Set(info.filter((i) => Number(i.teams) > 0 && i.teams === i.matched).map((i) => `${i.competition_id}|${i.season}`))
}

/**
 * 위키데이터 참가팀과 openfootball 참가팀을 합친다.
 * - openfootball 명단이 전부 이어진 시즌(complete): openfootball이 기준. 위키데이터에만 있는 팀은 뺀다(dropped).
 *   2026-11-02 첫 수집에서 분데스리가 2020~2025의 위키데이터 참가팀이 실제 클럽이 아닌 별도 항목(경력 0)이었다.
 * - 나머지 시즌: 합집합.
 * 뺀 팀이 같은 시즌 openfootball 쪽에 이름이 같은 다른 ID로 있으면 remap(뺀 ID → 그 ID)에 적는다. 우승 기록 ID를 옮길 때 쓴다.
 */
export function combineTeamComps(
  wd: readonly TeamCompetition[], of: readonly TeamCompetition[], complete: ReadonlySet<string>,
  namesOf: (id: string) => readonly string[] = () => [],
): { rows: TeamCompetition[]; dropped: TeamCompetition[]; remap: Map<string, string> } {
  const key = (t: TeamCompetition) => `${t.competition_id}|${t.season}`
  const out = new Map<string, TeamCompetition>()
  const put = (t: TeamCompetition) => out.set(`${t.team_id}|${key(t)}`, { team_id: t.team_id, competition_id: t.competition_id, season: String(t.season) })
  const dropped: TeamCompetition[] = []
  for (const t of of) put(t)
  for (const t of wd) {
    if (!complete.has(key(t)) || out.has(`${t.team_id}|${key(t)}`)) put(t)
    else dropped.push(t)
  }
  // 같은 이름: 느슨한 키의 단어 집합 하나가 다른 하나에 들어 있다(작은 쪽 2단어 이상, 또는 같음). 'BV Borussia 09 Dortmund' ⊇ 'Borussia Dortmund'
  const words = (id: string) => namesOf(id).map((n) => new Set(nameKeys(n).loose.split(' ')))
  const within = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w))
  const same = (x: Set<string>, y: Set<string>) => {
    const [small, big] = x.size <= y.size ? [x, y] : [y, x]
    return within(small, big) && (small.size >= 2 || small.size === big.size)
  }
  const remap = new Map<string, string>()
  for (const d of dropped) {
    const mine = words(d.team_id)
    if (!mine.length || remap.has(d.team_id)) continue
    const wdIds = new Set(wd.filter((t) => key(t) === key(d)).map((t) => t.team_id))
    const hits = of.filter((t) => key(t) === key(d) && !wdIds.has(t.team_id) && words(t.team_id).some((x) => mine.some((y) => same(x, y))))
    const ids = [...new Set(hits.map((t) => t.team_id))]
    if (ids.length === 1) remap.set(d.team_id, ids[0])
  }
  const rows = [...out.values()].sort((x, y) => cmp(x.competition_id, y.competition_id) || cmp(x.season, y.season) || cmp(x.team_id, y.team_id))
  return { rows, dropped, remap }
}

export const overrideKey =(competitionId: string, name: string) => `${competitionId}|${nameKeys(name).exact}`

/** manual/openfootball_teams.csv (competition_id,name,team_id). competition_id가 비면 모든 리그에 적용 */
export function readOverrides(rows: readonly Row[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows) if (r.name && r.team_id) m.set(overrideKey((r.competition_id ?? '').trim(), r.name), r.team_id.trim())
  return m
}
