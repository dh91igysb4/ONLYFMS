// 위키데이터 수집의 순수 부분: SPARQL 문장, 결과 해석, CSV 행 만들기. 입출력 없음 (wikidata.test.ts).
// 열 구성은 설계 §4.1·§5를 따른다. 입출력은 fetch-wikidata.ts가 한다.
import type { League } from './leagues.ts'

// ---------------------------------------------------------------- SPARQL 결과

export type Binding = Record<string, { type: string; value: string }>
/** SPARQL 결과 한 줄. 엔터티·문장 URI는 마지막 경로 조각(QID 등)만 남긴다 */
export type Row = Record<string, string>

export function flat(b: Binding): Row {
  const r: Row = {}
  for (const [k, v] of Object.entries(b)) {
    // '알 수 없는 값'(somevalue)은 .well-known/genid/<해시> 주소로 온다. 값이 없는 것으로 친다
    if (v.type === 'uri' && v.value.startsWith('http://www.wikidata.org/.well-known/genid/')) continue
    r[k] = v.type === 'uri' && v.value.startsWith('http://www.wikidata.org/')
      ? v.value.slice(v.value.lastIndexOf('/') + 1)
      : v.value
  }
  return r
}

// ---------------------------------------------------------------- 상수

/** 직업: 축구 선수 */
const FOOTBALLER = 'Q937857'
/** 이적 방식(P1642) 값: 임대 */
export const LOAN = 'Q2914547'
/** 인스턴스(P31): 축구 클럽 (하위 분류 포함) */
const CLUB = 'Q476028'
/** 인스턴스(P31): 남자 축구 국가대표팀, 축구 국가대표팀(구 분류) */
const NATIONAL_TEAM = ['Q135408445', 'Q6979593']
/** 인스턴스(P31): 연령별 국가대표팀 */
const YOUTH_NATIONAL_TEAM = 'Q21945604'
/** 종목(P641): 축구 */
const FOOTBALL = 'Q2736'

const ids = (qs: readonly string[]) => qs.map((q) => `wd:${q}`).join(' ')
const day = (year: number, md: string) => `"${year}-${md}T00:00:00Z"^^xsd:dateTime`

// ---------------------------------------------------------------- 질의

/** 리그의 시즌별 참가팀(P1923)과 우승팀(P1346). 시즌은 시작일(P580)의 연도이며, 리그마다 자기 창 안의 시즌만 받는다 */
export function qSeasons(windows: ReadonlyMap<string, Window>): string {
  const rows = [...windows].map(([id, w]) => `(wd:${id} ${w.from} ${w.to})`).join(' ')
  return `SELECT ?league ?season ?start ?team ?winner WHERE {
  VALUES (?league ?from ?to) { ${rows} }
  ?season wdt:P3450 ?league ; wdt:P580 ?start .
  FILTER(YEAR(?start) >= ?from && YEAR(?start) <= ?to)
  OPTIONAL { ?season wdt:P1923 ?team . ?team wdt:P31/wdt:P279* wd:${CLUB} }
  OPTIONAL { ?season wdt:P1346 ?winner }
}`
}

/** 지금 그 리그 소속(P118)으로 적힌 클럽. 시즌 정보가 빈 리그의 선수 수집을 보완한다. P118은 선수에게도 붙으므로 클럽만 거른다 */
export function qLeagueClubs(leagues: readonly League[]): string {
  return `SELECT DISTINCT ?league ?team WHERE {
  VALUES ?league { ${ids(leagues.map((l) => l.id))} }
  ?team wdt:P118 ?league ; wdt:P31/wdt:P279* wd:${CLUB} .
}`
}

/**
 * 기간 [from년 7월, to+1년 6월]에 그 팀에 있었던 선수.
 * 날짜가 하나도 없는 구간은 판별할 수 없어 뺀다. 종료일이 없는 오래된 구간(은퇴 선수의 누락)을
 * 거르기 위해 from년에 40세 이하였던 선수만 받는다(생일이 없으면 받는다).
 */
export function qPlayersAtTeams(teams: readonly string[], from: number, to: number): string {
  return `SELECT DISTINCT ?p WHERE {
  VALUES ?team { ${ids(teams)} }
  ?p p:P54 ?st . ?st ps:P54 ?team .
  ?p wdt:P106 wd:${FOOTBALLER} .
  OPTIONAL { ?st pq:P580 ?s } OPTIONAL { ?st pq:P582 ?e }
  FILTER(BOUND(?s) || BOUND(?e))
  FILTER(!BOUND(?e) || ?e >= ${day(from, '07-01')})
  FILTER(!BOUND(?s) || ?s <= ${day(to + 1, '06-30')})
  OPTIONAL { ?p wdt:P569 ?b }
  FILTER(!BOUND(?b) || ?b >= ${day(from - 40, '01-01')})
}`
}

/** 레전드 명단 확인: 직업이 축구 선수(P106)인 항목만 돌려준다 */
export function qOccupation(players: readonly string[]): string {
  return `SELECT DISTINCT ?p WHERE {
  VALUES ?p { ${ids(players)} }
  ?p wdt:P106 wd:${FOOTBALLER} .
}`
}

/** 선수 기본 정보. 값이 여럿인 속성 때문에 선수당 여러 줄이 나온다 (buildPlayers가 합친다) */
export function qPlayerDetails(players: readonly string[]): string {
  return `SELECT ?p ?en ?mul ?ko ?birth ?bprec ?sport ?cit ?posLabel ?footLabel ?height ?links ?tm WHERE {
  VALUES ?p { ${ids(players)} }
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?p rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
  OPTIONAL { ?p rdfs:label ?ko FILTER(LANG(?ko) = "ko") }
  OPTIONAL { ?p p:P569/psv:P569 [ wikibase:timeValue ?birth ; wikibase:timePrecision ?bprec ] }
  OPTIONAL { ?p wdt:P1532 ?sport }
  OPTIONAL { ?p wdt:P27 ?cit }
  OPTIONAL { ?p wdt:P413 ?pos . ?pos rdfs:label ?posLabel FILTER(LANG(?posLabel) = "en") }
  OPTIONAL { ?p wdt:P552 ?foot . ?foot rdfs:label ?footLabel FILTER(LANG(?footLabel) = "en") }
  OPTIONAL { ?p p:P2048/psn:P2048/wikibase:quantityAmount ?height }
  OPTIONAL { ?p wikibase:sitelinks ?links }
  OPTIONAL { ?p wdt:P2446 ?tm }
}`
}

/** 검색용 다른 이름(한국어·영어·다국어 mul) */
export function qAliases(entities: readonly string[]): string {
  return `SELECT ?x ?alias ?lang WHERE {
  VALUES ?x { ${ids(entities)} }
  ?x skos:altLabel ?alias . BIND(LANG(?alias) AS ?lang) FILTER(?lang IN ("ko", "en", "mul"))
}`
}

/** 선수의 전체 팀 경력(P54). 10개 리그 밖 구간도 받는다(Career Path에 필요) */
export function qSpells(players: readonly string[]): string {
  return `SELECT ?p ?st ?team ?s ?sprec ?e ?eprec ?loan ?apps ?goals WHERE {
  VALUES ?p { ${ids(players)} }
  ?p p:P54 ?st . ?st ps:P54 ?team .
  OPTIONAL { ?st pqv:P580 [ wikibase:timeValue ?s ; wikibase:timePrecision ?sprec ] }
  OPTIONAL { ?st pqv:P582 [ wikibase:timeValue ?e ; wikibase:timePrecision ?eprec ] }
  OPTIONAL { ?st pq:P1642 wd:${LOAN} . BIND("1" AS ?loan) }
  OPTIONAL { ?st pq:P1350 ?apps }
  OPTIONAL { ?st pq:P1351 ?goals }
}`
}

/** 팀 정보와 분류용 인스턴스(P31), 엠블럼 색(P6364 → sRGB P465) */
export function qTeams(teams: readonly string[]): string {
  return `SELECT ?t ?en ?mul ?ko ?short ?type ?country ?sport ?hex ?founded WHERE {
  VALUES ?t { ${ids(teams)} }
  OPTIONAL { ?t rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?t rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
  OPTIONAL { ?t rdfs:label ?ko FILTER(LANG(?ko) = "ko") }
  OPTIONAL { ?t wdt:P1813 ?short FILTER(LANG(?short) = "en") }
  OPTIONAL { ?t wdt:P31 ?type }
  OPTIONAL { ?t wdt:P17 ?country }
  OPTIONAL { ?t wdt:P1532 ?sport }
  OPTIONAL { ?t wdt:P6364 ?color . ?color wdt:P465 ?hex }
  OPTIONAL { ?t wdt:P571 ?founded }
}`
}

/** 국가 이름과 국기용 코드. ISO 3166-1(P297)이 없으면 3166-2(P300, 예: GB-ENG) */
export function qNations(nations: readonly string[]): string {
  return `SELECT ?n ?en ?mul ?ko ?iso2 ?iso3166_2 WHERE {
  VALUES ?n { ${ids(nations)} }
  OPTIONAL { ?n rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?n rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
  OPTIONAL { ?n rdfs:label ?ko FILTER(LANG(?ko) = "ko") }
  OPTIONAL { ?n wdt:P297 ?iso2 }
  OPTIONAL { ?n wdt:P300 ?iso3166_2 }
}`
}

/** 선수 개인상(P166) 중 종목이 축구인 상. 연도는 시점(P585) */
export function qAwards(players: readonly string[]): string {
  return `SELECT ?p ?award ?when WHERE {
  VALUES ?p { ${ids(players)} }
  ?p p:P166 ?st . ?st ps:P166 ?award ; pq:P585 ?when .
  ?award wdt:P641 wd:${FOOTBALL} .
}`
}

// ---------------------------------------------------------------- 시즌 창 (설계 2026-11-01 §3.2·§3.3)

/** 수집할 시즌 범위(시작 연도 기준, 양끝 포함) */
export type Window = { from: number; to: number }

/** 현재 시즌: 7월 이후면 올해, 아니면 작년 (시즌 = 시작 연도) */
export function currentSeason(now: Date): number {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
}

/** 리그별 창 [to − seasons + 1, to]. override가 있으면 모든 리그를 그 시즌 수로 */
export function seasonWindows(leagues: readonly League[], to: number, override?: number): Map<string, Window> {
  return new Map(leagues.map((l) => [l.id, { from: to - (override ?? l.seasons) + 1, to }]))
}

/**
 * 팀별 선수 수집 시작 연도: 창 안에서 그 팀이 참가한 리그들, 그리고 지금 소속(P118)으로 적힌 리그들의
 * 창 시작 중 가장 이른 해. 창 밖 참가 기록만 있는 팀은 빠진다. 키는 QID 순.
 */
export function teamStarts(teamComps: readonly TeamCompetition[], leagueClubs: readonly { league: string; team: string }[], windows: ReadonlyMap<string, Window>): Map<string, number> {
  const m = new Map<string, number>()
  const add = (team: string, from: number) => { const cur = m.get(team); if (cur === undefined || from < cur) m.set(team, from) }
  for (const t of teamComps) {
    const w = windows.get(t.competition_id)
    const season = Number(t.season)
    if (w && season >= w.from && season <= w.to) add(t.team_id, w.from)
  }
  for (const r of leagueClubs) {
    const w = windows.get(r.league)
    if (w && r.team) add(r.team, w.from)
  }
  return new Map([...m].sort((a, b) => cmp(a[0], b[0])))
}

/** 레전드 수동 명단(manual/legends.csv)을 찾은 선수에 더한다. QID가 아닌 값은 invalid로 돌려준다 */
export function mergeLegends(found: readonly string[], legends: readonly Row[]): { ids: string[]; added: string[]; invalid: string[] } {
  const have = new Set(found)
  const added = new Set<string>(), invalid = new Set<string>()
  for (const r of legends) {
    const id = (r.player_id ?? '').trim()
    if (!id) continue
    if (!/^Q\d+$/.test(id)) { invalid.add(id); continue }
    if (!have.has(id)) added.add(id)
  }
  const sort = (xs: Iterable<string>) => [...xs].sort(cmp)
  return { ids: sort(new Set([...found, ...added])), added: sort(added), invalid: sort(invalid) }
}

// ---------------------------------------------------------------- 값 해석

export type Precision = 'day' | 'year'
export type DateValue = { date: string; precision: Precision }

/** 위키데이터 시각값과 정밀도(11 = 일, 9·10 = 연·월)를 CSV 날짜로. 일 단위가 아니면 연도만 쓴다 */
export function dateOf(time: string | undefined, prec: string | undefined): DateValue | null {
  const m = time?.match(/^\+?(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const p = Number(prec ?? 11)
  if (p < 9) return null
  return p >= 11 ? { date: `${m[1]}-${m[2]}-${m[3]}`, precision: 'day' } : { date: m[1], precision: 'year' }
}

export const yearOf = (d: string) => Number(d.slice(0, 4))

export type Group = 'GK' | 'DF' | 'MF' | 'FW'
const DETAIL: Record<string, string> = {
  'centre-back': 'CB', 'full-back': 'FB', 'left-back': 'LB', 'right-back': 'RB', 'wing-back': 'WB',
  'defensive midfielder': 'DM', 'central midfielder': 'CM', 'attacking midfielder': 'AM',
  winger: 'W', 'centre-forward': 'CF', striker: 'ST',
}
const GENERIC: Record<string, Group> = { goalkeeper: 'GK', defender: 'DF', midfielder: 'MF', forward: 'FW' }

function groupOfLabel(label: string): Group | null {
  const l = label.toLowerCase()
  if (GENERIC[l]) return GENERIC[l]
  if (/goalkeeper|keeper/.test(l)) return 'GK'
  if (/back|defender|sweeper|libero/.test(l)) return 'DF'
  if (/midfield|wing half|playmaker/.test(l)) return 'MF'
  if (/forward|striker|winger|attacker/.test(l)) return 'FW'
  return null
}

/** 포지션 라벨 여러 개에서 대표 그룹과 세부 포지션을 고른다. 일반 라벨(defender 등)이 있으면 그것을 따른다 */
export function positionOf(labels: readonly string[]): { group: Group | null; detail: string } {
  const sorted = [...new Set(labels)].sort()
  const generic = sorted.map((l) => GENERIC[l.toLowerCase()]).find(Boolean)
  const group = generic ?? sorted.map(groupOfLabel).find(Boolean) ?? null
  const detailLabel = sorted.find((l) => DETAIL[l.toLowerCase()] && (!group || groupOfLabel(l) === group))
  return { group, detail: detailLabel ? DETAIL[detailLabel.toLowerCase()] : '' }
}

export function footOf(labels: readonly string[]): string {
  const l = labels.join(' ').toLowerCase()
  if (/ambidext|both/.test(l)) return 'both'
  if (/left/.test(l)) return 'left'
  if (/right/.test(l)) return 'right'
  return ''
}

/** 유스·2군·연령별·여자 팀 (경력에서 뺀다) */
export function isYouthOrReserve(label: string): boolean {
  return /\bU-?\d{2}\b|under-?\s?\d{2}|\byouth\b|\bjunior\b|\breserves?\b|\bacademy\b|\bII\b|\bB\b|\bjuvenil\b|\bprimavera\b|\bjong\b|\bolympic\b|\bamateurs?\b|\bwomen'?s?\b|\bfemenino\b|\bféminin/i.test(label)
}

export type TeamKind = 'club' | 'national' | 'other'
export function teamKind(types: readonly string[], label: string): TeamKind {
  if (isYouthOrReserve(label) || types.includes(YOUTH_NATIONAL_TEAM)) return 'other'
  if (types.some((t) => NATIONAL_TEAM.includes(t))) return 'national'
  return 'club'
}

/** sitelinks 수의 백분위(0~100). 같은 값은 같은 점수 */
export function popularity(links: ReadonlyMap<string, number>): Map<string, number> {
  const vals = [...links.values()].sort((a, b) => a - b)
  const below = (v: number) => {
    let lo = 0, hi = vals.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < v) lo = mid + 1; else hi = mid }
    return lo
  }
  const out = new Map<string, number>()
  for (const [id, v] of links) out.set(id, vals.length <= 1 ? 100 : Math.round((below(v) / (vals.length - 1)) * 100))
  return out
}

/** 여러 줄로 나온 값을 엔터티별로 모은다 */
export function groupBy(rows: readonly Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>()
  for (const r of rows) {
    const k = r[key]
    if (!k) continue
    const list = m.get(k)
    if (list) list.push(r); else m.set(k, [r])
  }
  return m
}

/** 한 엔터티의 여러 줄에서 변수 하나의 값들(중복 제거, 정렬) */
export function valuesOf(rows: readonly Row[], v: string): string[] {
  return [...new Set(rows.map((r) => r[v]).filter((x): x is string => !!x))].sort()
}
const firstOf = (rows: readonly Row[], v: string) => valuesOf(rows, v)[0] ?? ''
/**
 * 영문 표시 이름: 영어 라벨, 없으면 다국어(mul) 라벨. 위키데이터는 2024년부터 여러 언어에서 같은 이름(주로 인명)을
 * mul 하나로 합치고 영어 라벨을 지우고 있다.
 */
export const nameEnOf = (rows: readonly Row[]) => firstOf(rows, 'en') || firstOf(rows, 'mul')
/** 출전·골 같은 횟수: 0 이상 정수만(소수점 아래 0은 허용). 그 밖은 빈 값 */
export function countOf(v: string | undefined): string {
  return v && /^\d+(\.0+)?$/.test(v) ? String(parseInt(v, 10)) : ''
}

// ---------------------------------------------------------------- CSV 행 만들기

export type Team = { id: string; kind: TeamKind; name_ko: string; name_en: string; short_name: string; nation_id: string; colors: string; founded: string; retired: string }

export function buildTeams(rows: readonly Row[]): Team[] {
  const out: Team[] = []
  for (const [id, rs] of groupBy(rows, 't')) {
    const en = nameEnOf(rs)
    const kind = teamKind(valuesOf(rs, 'type'), en)
    const hex = valuesOf(rs, 'hex')
    out.push({
      id, kind, name_ko: firstOf(rs, 'ko'), name_en: en, short_name: firstOf(rs, 'short'),
      nation_id: kind === 'national' ? firstOf(rs, 'sport') || firstOf(rs, 'country') : firstOf(rs, 'country'),
      // 비율 정보가 없어 같은 비율로 나눈다 (Who Ate All the Pies용은 직접 보정)
      colors: hex.length ? JSON.stringify(hex.map((h) => ({ hex: `#${h.toUpperCase()}`, share: +(1 / hex.length).toFixed(3) }))) : '',
      founded: firstOf(rs, 'founded').slice(0, 4).replace(/^0+/, ''),
      retired: 'false',
    })
  }
  return out.sort(byId)
}

export type Spell = { player_id: string; team_id: string; start_date: string; end_date: string; date_precision: Precision; loan: string; apps: string; goals: string; source_ref: string }

/** 팀 경력. 유스·2군(other), 날짜 없는 구간, 종료일이 시작일보다 앞인 구간은 뺀다. 국가대표 구간은 caps로 따로 모은다 */
export function buildSpells(rows: readonly Row[], teams: ReadonlyMap<string, Team>): { spells: Spell[]; national: Spell[]; dropped: number } {
  const spells: Spell[] = [], national: Spell[] = []
  let dropped = 0
  for (const [st, rs] of groupBy(rows, 'st')) {
    const r = rs[0]
    const team = teams.get(r.team)
    const s = dateOf(r.s, r.sprec), e = dateOf(r.e, r.eprec)
    if (!team || team.kind === 'other' || !s) { dropped++; continue }
    const sp: Spell = {
      player_id: r.p, team_id: r.team, start_date: s.date, end_date: e?.date ?? '',
      date_precision: s.precision === 'day' && (!e || e.precision === 'day') ? 'day' : 'year',
      loan: valuesOf(rs, 'loan').length ? 'true' : 'false', apps: countOf(firstOf(rs, 'apps')), goals: countOf(firstOf(rs, 'goals')), source_ref: st,
    }
    if (sp.date_precision === 'year') { sp.start_date = sp.start_date.slice(0, 4); sp.end_date = sp.end_date.slice(0, 4) }
    // 종료일이 시작일보다 앞인 구간은 원본 오류라 뺀다
    if (sp.end_date && cmp(sp.end_date, sp.start_date) < 0) { dropped++; continue }
    ;(team.kind === 'national' ? national : spells).push(sp)
  }
  return { spells: spells.sort(bySpell), national: national.sort(bySpell), dropped }
}

export type Cap = { player_id: string; team_id: string; caps: string; goals: string; first_year: string; last_year: string }

/** 국가대표 구간을 선수·팀별로 합친다. 출전·골은 아는 값만 더한다 */
export function buildCaps(national: readonly Spell[]): Cap[] {
  const m = new Map<string, Cap>()
  for (const s of national) {
    const k = `${s.player_id}|${s.team_id}`
    const c = m.get(k) ?? { player_id: s.player_id, team_id: s.team_id, caps: '', goals: '', first_year: '', last_year: '' }
    const add = (a: string, b: string) => (b === '' ? a : String((a === '' ? 0 : Number(a)) + Number(b)))
    c.caps = add(c.caps, s.apps)
    c.goals = add(c.goals, s.goals)
    const fy = String(yearOf(s.start_date))
    const ly = s.end_date ? String(yearOf(s.end_date)) : ''
    if (!c.first_year || fy < c.first_year) c.first_year = fy
    if (ly && (!c.last_year || ly > c.last_year)) c.last_year = ly
    m.set(k, c)
  }
  return [...m.values()].sort((a, b) => cmp(a.player_id, b.player_id) || cmp(a.team_id, b.team_id))
}

export type Player = {
  id: string; name_ko: string; name_en: string; birth_date: string; birth_precision: Precision | ''; nation_id: string
  position: Group | ''; position_detail: string; foot: string; height_cm: string; shirt_number: string; popularity: string; retired: string
}

/**
 * 대표 국적: 출전이 가장 많은(같으면 가장 최근) 성인 대표팀의 나라 → 종목 국적(P1532) → 시민권(P27) 순.
 * 시민권이 여럿이면 QID 순 첫 번째라 틀릴 수 있다 (직접 보정 대상).
 */
export function pickNation(caps: readonly Cap[], teams: ReadonlyMap<string, Team>, sport: readonly string[], cit: readonly string[]): string {
  const best = [...caps].sort((a, b) => Number(b.caps || 0) - Number(a.caps || 0) || cmp(b.last_year || '9999', a.last_year || '9999'))[0]
  return (best && teams.get(best.team_id)?.nation_id) || sport[0] || cit[0] || ''
}

export function buildPlayers(rows: readonly Row[], caps: readonly Cap[], teams: ReadonlyMap<string, Team>): { players: Player[]; links: Map<string, number>; transfermarkt: Map<string, string> } {
  const capsBy = new Map<string, Cap[]>()
  for (const c of caps) capsBy.set(c.player_id, [...(capsBy.get(c.player_id) ?? []), c])
  const links = new Map<string, number>(), transfermarkt = new Map<string, string>()
  const players: Player[] = []
  for (const [id, rs] of groupBy(rows, 'p')) {
    // 생일이 여럿이면 일 단위를 우선, 그다음 이른 날짜
    const births = rs.map((r) => dateOf(r.birth, r.bprec)).filter((d): d is DateValue => !!d)
      .sort((a, b) => (a.precision === b.precision ? cmp(a.date, b.date) : a.precision === 'day' ? -1 : 1))
    const pos = positionOf(valuesOf(rs, 'posLabel'))
    const h = Number(firstOf(rs, 'height'))
    links.set(id, Number(firstOf(rs, 'links') || 0))
    const tm = firstOf(rs, 'tm')
    if (tm) transfermarkt.set(id, tm)
    players.push({
      id, name_ko: firstOf(rs, 'ko'), name_en: nameEnOf(rs),
      birth_date: births[0]?.date ?? '', birth_precision: births[0]?.precision ?? '',
      nation_id: pickNation(capsBy.get(id) ?? [], teams, valuesOf(rs, 'sport'), valuesOf(rs, 'cit')),
      position: pos.group ?? '', position_detail: pos.detail, foot: footOf(valuesOf(rs, 'footLabel')),
      // psn 정규화 값은 미터
      height_cm: h > 1 && h < 2.5 ? String(Math.round(h * 100)) : '',
      shirt_number: '', popularity: '', retired: 'false',
    })
  }
  const pop = popularity(links)
  for (const p of players) p.popularity = String(pop.get(p.id) ?? 0)
  return { players: players.sort(byId), links, transfermarkt }
}

export type Nation = { id: string; name_ko: string; name_en: string; iso2: string; confederation: string }

export function buildNations(rows: readonly Row[]): Nation[] {
  return [...groupBy(rows, 'n')].map(([id, rs]) => ({
    id, name_ko: firstOf(rs, 'ko'), name_en: nameEnOf(rs),
    iso2: (firstOf(rs, 'iso2') || firstOf(rs, 'iso3166_2')).toLowerCase(),
    confederation: '',
  })).sort(byId)
}

export type TeamCompetition = { team_id: string; competition_id: string; season: string }
export type Honour = { honour: string; season: string; team_id: string; player_id: string }

/** 시즌 질의 결과 → 시즌별 참가팀과 리그 우승 */
export function buildSeasons(rows: readonly Row[]): { teamComps: TeamCompetition[]; honours: Honour[] } {
  const tc = new Map<string, TeamCompetition>(), hs = new Map<string, Honour>()
  for (const r of rows) {
    const season = String(yearOf(r.start))
    if (r.team) tc.set(`${r.team}|${r.league}|${season}`, { team_id: r.team, competition_id: r.league, season })
    if (r.winner) hs.set(`${r.league}|${season}|${r.winner}`, { honour: r.league, season, team_id: r.winner, player_id: '' })
  }
  return { teamComps: [...tc.values()], honours: [...hs.values()] }
}

export function buildAwards(rows: readonly Row[]): Honour[] {
  const m = new Map<string, Honour>()
  for (const r of rows) {
    const season = String(yearOf(r.when))
    m.set(`${r.award}|${season}|${r.p}`, { honour: `award:${r.award}`, season, team_id: '', player_id: r.p })
  }
  return [...m.values()]
}

export type Alias = { entity_id: string; alias: string; lang: string }

/** 대표 이름과 다른 이름을 검색용 별칭으로 모은다 */
export function buildAliases(named: readonly { id: string; name_ko: string; name_en: string }[], altRows: readonly Row[]): Alias[] {
  const m = new Map<string, Alias>()
  const add = (entity_id: string, alias: string, lang: string) => {
    const a = alias.trim()
    if (a) m.set(`${entity_id}|${a}`, { entity_id, alias: a, lang })
  }
  for (const n of named) { add(n.id, n.name_ko, 'ko'); add(n.id, n.name_en, 'en') }
  for (const r of altRows) add(r.x, r.alias, r.lang)
  return [...m.values()].sort((a, b) => cmp(a.entity_id, b.entity_id) || cmp(a.alias, b.alias))
}

// ---------------------------------------------------------------- 직접 입력 병합

/** manual/names_ko.csv (entity_id,name_ko)로 한글 이름을 덮어쓴다. 다시 수집해도 손본 이름이 지워지지 않게 */
export function applyNamesKo<T extends { id: string; name_ko: string }>(items: T[], manual: readonly Row[]): number {
  const m = new Map(manual.filter((r) => r.entity_id && r.name_ko).map((r) => [r.entity_id, r.name_ko.trim()]))
  let n = 0
  for (const it of items) {
    const ko = m.get(it.id)
    if (ko && ko !== it.name_ko) { it.name_ko = ko; n++ }
  }
  return n
}

/** 시즌 참가팀: 위키데이터 + manual/team_competitions.csv 합집합 */
export function mergeTeamComps(a: readonly TeamCompetition[], manual: readonly Row[]): TeamCompetition[] {
  const m = new Map<string, TeamCompetition>()
  for (const r of [...a, ...manual as unknown as TeamCompetition[]]) {
    if (r.team_id && r.competition_id && r.season) m.set(`${r.team_id}|${r.competition_id}|${r.season}`, { team_id: r.team_id, competition_id: r.competition_id, season: String(r.season) })
  }
  return [...m.values()].sort((x, y) => cmp(x.competition_id, y.competition_id) || cmp(x.season, y.season) || cmp(x.team_id, y.team_id))
}

/**
 * 대상 리그에서 뛴 클럽의 나라를 리그 소재국으로 맞춘다. 위키데이터 P17은 잉글랜드 클럽을 영국(Q145)으로 적어
 * 잉글랜드 대표팀(Q21)과 어긋나기 때문이다. 바꾼 개수를 돌려준다.
 */
export function applyLeagueNations(teams: readonly Team[], teamComps: readonly TeamCompetition[], leagues: readonly League[]): number {
  const nationOf = new Map(leagues.map((l) => [l.id, l.nation_id]))
  const byTeam = new Map(teamComps.map((t) => [t.team_id, nationOf.get(t.competition_id)]))
  let n = 0
  for (const t of teams) {
    const nation = t.kind === 'club' ? byTeam.get(t.id) : undefined
    if (nation && nation !== t.nation_id) { t.nation_id = nation; n++ }
  }
  return n
}

/** 리그별 창 안의 시즌별 참가팀 수. 비었거나 리그 정원(teams)보다 적은 칸(warn)이 직접 채울 대상이다 */
export function coverage(teamComps: readonly TeamCompetition[], leagues: readonly League[], windows: ReadonlyMap<string, Window>): { league: League; from: number; counts: number[]; warn: boolean[] }[] {
  return leagues.map((league) => {
    const w = windows.get(league.id) ?? { from: 0, to: -1 }
    const counts = Array.from({ length: w.to - w.from + 1 }, (_, i) =>
      teamComps.filter((t) => t.competition_id === league.id && Number(t.season) === w.from + i).length)
    return { league, from: w.from, counts, warn: counts.map((n) => n < league.teams) }
  })
}

// ---------------------------------------------------------------- CSV

function cell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T extends object>(header: readonly (keyof T & string)[], rows: readonly T[]): string {
  return [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n'
}

/** RFC 4180 CSV(헤더 있음)를 행 객체로 */
export function parseCsv(text: string): Row[] {
  const recs: string[][] = []
  let rec: string[] = [], f = '', q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false; else f += c
    } else if (c === '"') q = true
    else if (c === ',') { rec.push(f); f = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      rec.push(f); f = ''; recs.push(rec); rec = []
    } else f += c
  }
  if (f !== '' || rec.length) { rec.push(f); recs.push(rec) }
  const [head, ...body] = recs.filter((r) => r.some((x) => x !== ''))
  if (!head) return []
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

// ---------------------------------------------------------------- 정렬

/** 코드 포인트 순 비교. 실행 환경 로캘과 무관하게 같은 순서라 CSV diff가 안정적이다 */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byId = (a: { id: string }, b: { id: string }) => cmp(a.id, b.id)
const bySpell = (a: Spell, b: Spell) => cmp(a.player_id, b.player_id) || cmp(a.start_date, b.start_date) || cmp(a.source_ref, b.source_ref)
