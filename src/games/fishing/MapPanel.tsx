// 큰 지도 창. 정보만 보여 준다: 사기·타기·이동 버튼은 없고, 할 수 있는 건 탭 바꾸기뿐이다.
// 축소 그림(<img>, 지역별 캐시) 위에 표시 버튼을 퍼센트 좌표로 띄우고, 아래 상세 칸에 고른 것의 정보를 보인다.
// 안 잡은 물고기는 실루엣·등급·"지금" 칩만(이름·그림·조건은 alt·aria-label 어디에도 없다).
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { OnlinePeer } from '../../platform/world/presence.ts'
import { AREAS, RARITY_NAMES, RODS, rodAtLeast, UNLOCKS, type AreaId } from './data.ts'
import { LOW_TIDE_HOURS, SEASON_NAMES, conditionsAt, formatClock, isSnow, type Conditions } from './clock.ts'
import {
  areaFish, areaRoute, filterFish, firstHop, fishBadge, placeMarkers, spotAnchors, spotAtTile, spotFish, teleporterInfo, unlockPlace,
  type FishFilter, type FishRow, type NotNow, type PlaceMarker,
} from './atlas.ts'
import type { Facing } from './map.ts'
import { mapFor } from './maps/index.ts'
import { placeName } from './isle.ts'
import type { PlaceNames } from './preview.ts'
import { MINIMAP_PX, minimapScale, minimapUrl, spotHighlightUrl } from './minimap.ts'
import { buffLine, conditionLabel, dexItemClass, RarityBadge, SPOT_NAMES } from './Menus.tsx'
import { spriteDataUrl } from './sprites.ts'
import type { View } from './logic.ts'

export type MapLayers = { paths: boolean; spots: boolean; now: boolean; undiscovered: boolean }
export const DEFAULT_LAYERS: MapLayers = { paths: true, spots: true, now: false, undiscovered: false }
export { RARITY_NAMES }

const MARK_SCALE = 2
/** 표시 버튼(28px)·현재 위치(18px)의 반폭 */
const MARK_HALF = 14
const YOU_HALF = 9
const ICON_SCALE = 2
const CHECK_MS = 1000
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const areaName = (id: AreaId) => AREAS.find((a) => a.id === id)?.name ?? id
const spotName = (s: string) => SPOT_NAMES[s] ?? s
/** 썰물 구간 글("2~6시·14~18시") */
const LOW_TIDE_TEXT = LOW_TIDE_HOURS.map(([a, b]) => `${a}~${b}시`).join('·')
/** 자리 상세의 한 줄 안내: 물때 자리(갯골)는 썰물에만 들어가고, 얼음 구멍 자리는 구멍을 뚫는다 */
function spotNote(area: AreaId, spot: string): string | null {
  if (AREAS.find((a) => a.id === area)?.tideSpots?.includes(spot)) return `썰물(${LOW_TIDE_TEXT})에만 걸어 들어가요`
  if (mapFor(area)?.spots.hole === spot) return '얼음에 구멍을 뚫고 낚아요'
  return null
}
/** 해금에 필요한 낚싯대 문구("백골 낚싯대 이상이 있어야 해요"). 요구가 없으면 null */
function rodNeed(area: AreaId): string | null {
  const tier = UNLOCKS[area]?.minRod
  return tier ? `${rodAtLeast(tier)}이 있어야 해요` : null
}

/** 받침 있는 글자인가(ㄹ 받침은 따로) */
function batchim(word: string): 'none' | 'rieul' | 'other' {
  const c = word.charCodeAt(word.length - 1) - 0xac00
  if (c < 0 || c > 11171) return 'none'
  const jong = c % 28
  return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other'
}
/** (으)로 */
const ro = (w: string) => `${w}${batchim(w) === 'other' ? '으로' : '로'}`
/** 은/는 */
const eun = (w: string) => `${w}${batchim(w) === 'none' ? '는' : '은'}`

const DIR_NAMES: Record<string, string> = { n: '북쪽', s: '남쪽', e: '동쪽', w: '서쪽', in: '입구' }
const REASONS: Record<Exclude<NotNow, 'legend-done'>, string> = { needs: '먼저 잡을 전설', rod: '낚싯대', season: '계절', hours: '시간', weather: '날씨' }

type Pick = { kind: 'spot'; spot: string } | { kind: 'mark'; key: string }
const markKey = (m: PlaceMarker): string =>
  m.kind === 'exit' ? `exit:${m.target}` : m.kind === 'gate' ? `gate:${m.area}` : m.kind === 'dock' ? `dock:${m.target}` : m.kind

type MapPanelProps = {
  view: View
  /** 지금 지역과 캐릭터 칸(창을 연 동안 걷지 않는다) */
  here: { area: AreaId; tx: number; ty: number; facing: Facing }
  /** 서버 보정 시각(ms) */
  now(): number
  /** 패널 안쪽 폭(css px). 축소 그림 정수 배율 계산용 */
  innerWidth: number
  layers: MapLayers
  onLayers(next: MapLayers): void
  /** 다른 지역까지 포함한 접속 중 친구(나 제외, 온라인 2단계-1). 탭 인원 수와 지도 위 점 */
  online?: OnlinePeer[]
  /** 섬에 있는 친구의 장소 이름("{아이디}의 섬")에 쓰는 섬 주인 목록 */
  names?: PlaceNames
  /** 내 장소 키(지역 id 또는 isle-<주인 id>). 같은 장소 친구는 "다른 곳"에 넣지 않는다 */
  place?: string
}

/** 머리줄·목록 갱신 단위: 시계 표시(10분) 또는 날짜·계절·날씨가 바뀔 때만 새 값 */
/** 큰 지도 탭: 세계 지도에 그리는 맵이 있는 지역(실내 마을회관 제외) */
// 세계 지도에 그리는 지역만(마을회관 실내·모양별 맵인 내 섬 제외)
const MAP_AREAS = AREAS.filter((a) => mapFor(a.id)?.onWorldMap === true)

const condKey = (c: Conditions) => `${c.gameDay}|${formatClock(c.gameMinute)}|${c.season}|${c.weather}`

export function MapPanel({ view, here, now, innerWidth, layers, onLayers, online = [], names, place }: MapPanelProps) {
  const [tab, setTab] = useState<AreaId>(here.area)
  const [pick, setPick] = useState<Pick | null>(null)
  /** 지금 지역 탭에서 가는 길을 강조할 마지막으로 본 다른 지역 */
  const [lastOther, setLastOther] = useState<AreaId | null>(null)
  const [cond, setCond] = useState<Conditions>(() => conditionsAt(now()))

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = conditionsAt(now())
      setCond((prev) => (condKey(prev) === condKey(next) ? prev : next))
    }, CHECK_MS)
    return () => window.clearInterval(id)
  }, [now])

  // 고른 탭이 가로 스크롤 밖이면 보이게 민다(잠긴 지역 카드의 지도 보기 등으로 바뀔 때)
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  const opened = useMemo(() => new Set<AreaId>(view.areas), [view.areas])
  const filter: FishFilter = { now: layers.now, undiscovered: layers.undiscovered }
  const filtering = filter.now || filter.undiscovered
  // 출현은 시(時) 단위로만 바뀌므로 목록은 시가 바뀔 때만 다시 계산한다
  const hourKey = `${cond.gameDay}|${Math.floor(cond.gameMinute / 60)}|${cond.season}|${cond.weather}`
  const fishView = useMemo(() => ({ dex: view.dex, legends: view.legends ?? [], rodTier: view.rodTier }), [view.dex, view.legends, view.rodTier])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const areaRows = useMemo(() => Object.fromEntries(MAP_AREAS.map((a) => [a.id, areaFish(a.id, fishView, cond)])) as Record<AreaId, FishRow[]>, [fishView, hourKey])

  const goTab = (a: AreaId, nextPick: Pick | null = null) => {
    if (a !== here.area) setLastOther(a)
    setTab(a)
    setPick(nextPick)
  }
  const toggle = (k: keyof MapLayers) => {
    // 레이어를 끄면 그 레이어의 고른 표시도 놓는다(숨은 표시의 상세가 남지 않게)
    if (layers[k] && ((k === 'paths' && pick?.kind === 'mark') || (k === 'spots' && pick?.kind === 'spot'))) setPick(null)
    onLayers({ ...layers, [k]: !layers[k] })
  }

  const rod = RODS.find((r) => r.tier === view.rodTier)?.name ?? ''
  const weather = isSnow(cond) ? '눈' : cond.weather === 'rain' ? '비' : '맑음'
  const map = mapFor(tab)
  const isOpen = opened.has(tab) || tab === here.area

  return (
    <section className="fish-panel-body fish-mapview" aria-label="지도">
      <p className="muted" data-testid="fish-map-now">{`${SEASON_NAMES[cond.season]} · ${weather} · ${formatClock(cond.gameMinute)} · ${rod}`}</p>
      <div className="fish-dex-tabs fish-map-tabs" role="tablist" aria-label="지역" ref={tabsRef}>
        {MAP_AREAS.map((a) => {
          const on = a.id === tab
          const open = opened.has(a.id) || a.id === here.area
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`fish-dex-tab${on ? ' fish-dex-tab-on' : ''}`}
              onClick={() => goTab(a.id)}
            >
              {open ? `${a.name} ${fishBadge(areaRows[a.id], filter)}` : `${a.name} · 잠김`}
              {friendBadge(online, a.id)}
            </button>
          )
        })}
      </div>
      {(() => {
        // 지도 탭에 없는 장소(섬)에 있는 친구
        const away = online.filter((p) => p.area !== place && !MAP_AREAS.some((a) => a.id === p.area))
        if (away.length === 0) return null
        const label = away.map((p) => `${p.handle} ${placeName(p.area, names ?? { selfId: null, players: [] }) ?? ''}`.trim()).join(', ')
        return <p className="muted" data-testid="fish-map-away">{`다른 곳: ${label}`}</p>
      })()}
      <div className="fish-map-chips" role="group" aria-label="보기">
        <span className="fish-map-chip-label">보기</span>
        <Chip on={layers.paths} onClick={() => toggle('paths')}>길</Chip>
        <Chip on={layers.spots} onClick={() => toggle('spots')}>낚시 자리</Chip>
      </div>
      <div className="fish-map-chips" role="group" aria-label="물고기">
        <span className="fish-map-chip-label">물고기</span>
        <Chip on={layers.now} onClick={() => toggle('now')}>지금 잡히는</Chip>
        <Chip on={layers.undiscovered} onClick={() => toggle('undiscovered')}>미발견만</Chip>
      </div>
      {map && isOpen ? (
        <OpenArea
          key={tab}
          area={tab}
          view={view}
          here={here}
          opened={opened}
          cond={cond}
          hourKey={hourKey}
          fishView={fishView}
          areaRows={areaRows[tab]}
          filter={filter}
          filtering={filtering}
          layers={layers}
          innerWidth={innerWidth}
          pick={pick}
          onPick={setPick}
          onTab={goTab}
          lastOther={lastOther}
          friends={online.filter((p) => p.area === tab)}
        />
      ) : (
        <LockedArea area={tab} rows={filterFish(lockedRows(areaRows[tab]), filter)} view={view} onTab={goTab} />
      )}
    </section>
  )
}

/** 잠긴 지역 목록은 등급만: 거기서는 던질 수 없으므로 "지금"도, 안 나오는 이유도 없다 */
/** 탭 이름 뒤 그 지역 친구 수(0이면 없음) */
function friendBadge(online: readonly OnlinePeer[], area: AreaId): string {
  const n = online.filter((p) => p.area === area).length
  return n > 0 ? ` · 친구 ${n}` : ''
}

const lockedRows = (rows: readonly FishRow[]): FishRow[] => rows.map((r) => ({ ...r, now: false, reason: null }))

function Chip({ on, onClick, children }: { on: boolean; onClick(): void; children: string }) {
  return (
    <button type="button" className={`fish-map-chip${on ? ' fish-map-chip-on' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

type OpenProps = {
  area: AreaId
  view: View
  here: MapPanelProps['here']
  opened: ReadonlySet<AreaId>
  cond: Conditions
  hourKey: string
  fishView: { dex: View['dex']; legends: string[]; rodTier: View['rodTier'] }
  areaRows: FishRow[]
  filter: FishFilter
  filtering: boolean
  layers: MapLayers
  innerWidth: number
  pick: Pick | null
  onPick(p: Pick | null): void
  onTab(a: AreaId, p?: Pick | null): void
  lastOther: AreaId | null
  friends: OnlinePeer[]
}

function OpenArea({ area, view, here, opened, cond, hourKey, fishView, areaRows, filter, filtering, layers, innerWidth, pick, onPick, onTab, lastOther, friends }: OpenProps) {
  const map = mapFor(area)!
  const k = minimapScale(innerWidth, map)
  const P = MINIMAP_PX * k
  const url = minimapUrl(map)
  const anchors = spotAnchors(map)
  const marks = placeMarkers(map, opened)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spotRows = useMemo(() => Object.fromEntries(anchors.map((a) => [a.spot, spotFish(area, a.spot, fishView, cond)])) as Record<string, FishRow[]>, [area, fishView, hourKey])
  const atHere = area === here.area
  const route = !atHere ? areaRoute(here.area, area, opened) : null
  const hopRoute = atHere && lastOther && lastOther !== here.area ? areaRoute(here.area, lastOther, opened) : null
  const hop = hopRoute ? firstHop(map, hopRoute.path, hopRoute.unlockAt ? lastOther : null, opened) : null
  const hopKey = hop ? markKey(hop) : null
  // 가장자리 표시(출구 등)가 그림 밖으로 삐져나오지 않게 표시 반폭(half px)만큼 안쪽으로 묶는다
  const pos = (tx: number, ty: number, half = MARK_HALF) => ({
    left: `clamp(${half}px, ${((tx + 0.5) / map.w) * 100}%, calc(100% - ${half}px))`,
    top: `clamp(${half}px, ${((ty + 0.5) / map.h) * 100}%, calc(100% - ${half}px))`,
  })
  const pickedSpot = pick?.kind === 'spot' ? pick.spot : null
  const highlight = pickedSpot ? spotHighlightUrl(map, pickedSpot) : null

  const pickedMark = pick?.kind === 'mark' ? marks.find((m) => markKey(m) === pick.key) ?? null : null
  const pickedRows = pickedSpot ? spotRows[pickedSpot] : undefined
  // 상세 맨 윗줄. 이 줄만 aria-live라 고를 때 목록 전체가 아니라 제목만 읽힌다
  const detailTitle = pickedRows
    ? `${spotName(pickedSpot!)} · 지금 ${pickedRows.filter((r) => r.now).length}종 · 미발견 ${pickedRows.filter((r) => !r.found).length}종`
    : pickedMark ? markTitle(pickedMark, area, view, here.area) : areaName(area)

  const onMapClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const tx = Math.floor(((e.clientX - r.left) / r.width) * map.w)
    const ty = Math.floor(((e.clientY - r.top) / r.height) * map.h)
    const spot = spotAtTile(map, tx, ty)
    if (spot && anchors.some((a) => a.spot === spot)) onPick({ kind: 'spot', spot })
  }

  return (
    <>
      <div className="fish-map" style={{ width: map.w * P, aspectRatio: `${map.w} / ${map.h}` }} onClick={onMapClick} data-testid="fish-map">
        {url && <img className="fish-map-img" src={url} alt="" />}
        {highlight && <img className="fish-map-img" src={highlight} alt="" />}
        {layers.spots && anchors.map((a) => {
          const rows = spotRows[a.spot]
          const badge = fishBadge(rows, filter)
          const dim = filtering && filterFish(rows, filter).length === 0
          const on = pickedSpot === a.spot
          return (
            <button
              key={`spot:${a.spot}`}
              type="button"
              className={`fish-map-marker${dim ? ' fish-map-marker-dim' : ''}${on ? ' fish-map-marker-on' : ''}`}
              style={pos(a.tx, a.ty)}
              aria-label={`${spotName(a.spot)} 낚시 자리 ${badge}`}
              aria-pressed={on}
              onClick={() => onPick(on ? null : { kind: 'spot', spot: a.spot })}
            >
              <img src={spriteDataUrl('map-spot', MARK_SCALE)} alt="" />
              <span className="fish-map-badge">{badge}</span>
            </button>
          )
        })}
        {layers.paths && marks.map((m) => {
          const key = markKey(m)
          const on = pick?.kind === 'mark' && pick.key === key
          return (
            <button
              key={key}
              type="button"
              className={`fish-map-marker${on ? ' fish-map-marker-on' : ''}${key === hopKey ? ' fish-map-marker-hop' : ''}`}
              style={pos(m.tx, m.ty)}
              aria-label={markLabel(m)}
              aria-pressed={on}
              onClick={() => onPick(on ? null : { kind: 'mark', key })}
            >
              <img src={spriteDataUrl(`map-${m.kind === 'teleporter' ? 'teleporter' : m.kind}`, MARK_SCALE)} alt="" />
            </button>
          )
        })}
        {friends.map((f) => (
          <div key={f.id} className="fish-map-friend" style={pos(f.tx, f.ty, YOU_HALF)} role="img" aria-label={`${f.handle} 위치`}>
            <span className="fish-map-friend-name">{f.handle}</span>
          </div>
        ))}
        {atHere && (
          <div className={`fish-map-you fish-map-you-${here.facing}`} style={pos(here.tx, here.ty, YOU_HALF)} role="img" aria-label="현재 위치">
            <img src={spriteDataUrl('map-you', MARK_SCALE)} alt="" />
          </div>
        )}
      </div>
      {layers.spots && anchors.length > 0 && (
        <div className="fish-map-chips" role="group" aria-label="낚시 자리">
          <span className="fish-map-chip-label">자리</span>
          {anchors.map((a) => (
            <Chip key={a.spot} on={pickedSpot === a.spot} onClick={() => onPick(pickedSpot === a.spot ? null : { kind: 'spot', spot: a.spot })}>
              {`${spotName(a.spot)} ${fishBadge(spotRows[a.spot], filter)}`}
            </Chip>
          ))}
        </div>
      )}
      <div className="fish-map-detail">
        <h4 className="fish-map-detail-title" aria-live="polite">{detailTitle}</h4>
        {pickedSpot && spotNote(area, pickedSpot) && <p className="muted">{spotNote(area, pickedSpot)}</p>}
        {pickedSpot && spotRows[pickedSpot] ? (
          <FishList rows={filterFish(spotRows[pickedSpot], filter)} view={view} />
        ) : pickedMark ? (
          <MarkDetail mark={pickedMark} area={area} view={view} here={here.area} onTab={onTab} />
        ) : (
          <AreaSummary rows={areaRows} route={route} tpFee={route ? teleporterInfo(area, view, here.area)?.feeFromHere ?? null : null} />
        )}
      </div>
    </>
  )
}

function markLabel(m: PlaceMarker): string {
  switch (m.kind) {
    case 'exit': return `${ro(areaName(m.target))} 가는 길`
    case 'gate': return `잠긴 문 · ${UNLOCKS[m.area]?.name ?? areaName(m.area)}`
    case 'dock': return `선착장 · ${areaName(m.target)}`
    case 'shop': return '상점'
    case 'teleporter': return '순간이동기'
  }
}

/** 가는 길 문구: 배로 건너는 구간 앞에 (배) */
/** 고른 표시의 상세 제목 */
function markTitle(m: PlaceMarker, area: AreaId, view: View, here: AreaId): string {
  switch (m.kind) {
    case 'exit': return `${ro(areaName(m.target))} 가는 길 · ${DIR_NAMES[m.dir]}`
    case 'gate': return `잠긴 문 · ${UNLOCKS[m.area]?.name ?? areaName(m.area)}`
    case 'dock': {
      const u = UNLOCKS[m.target]
      return view.areas.includes(m.target) || !u ? `${ro(areaName(m.target))} 가는 배 · 무료 왕복` : `선착장 · ${u.name}`
    }
    case 'shop': return '상점'
    case 'teleporter': {
      const info = teleporterInfo(area, view, here)
      return info ? `순간이동기 · ${info.open ? '켜짐' : '꺼짐'}` : '순간이동기'
    }
  }
}

function routeText(path: readonly AreaId[]): string {
  return path.map((a, i) => {
    if (i === 0) return areaName(a)
    const prev = mapFor(path[i - 1])
    const byBoat = !!prev && prev.docks.some((d) => d.target === a) && !prev.exits.some((e) => e.target === a)
    return `${byBoat ? '(배) ' : ''}${areaName(a)}`
  }).join(' → ')
}

function AreaSummary({ rows, route, tpFee }: { rows: FishRow[]; route: ReturnType<typeof areaRoute> | null; tpFee: number | null }) {
  const found = rows.filter((r) => r.found).length
  const now = rows.filter((r) => r.now).length
  return (
    <>
      {route && (
        <p className="fish-map-route">{route.path ? `가는 길: ${routeText(route.path)}` : '지금은 가는 길이 없어요'}</p>
      )}
      {tpFee !== null && <p className="muted">{`순간이동기로도 갈 수 있어요 · ${gold(tpFee)}`}</p>}
      <p className="muted">{`물고기 ${rows.length}종 중 ${found}종 찾음 · 지금 잡히는 ${now}종`}</p>
      <p className="muted">낚시 자리를 누르면 그 자리 물고기를 볼 수 있어요</p>
    </>
  )
}

export function FishList({ rows, view }: { rows: FishRow[]; view: View }) {
  if (rows.length === 0) return <p className="muted">조건에 맞는 물고기가 없어요</p>
  return (
    <ul className="fish-dex" aria-label="물고기 목록">
      {rows.map((r) => {
        const s = r.species
        const entry = r.found ? view.dex[s.id] : undefined
        return (
          <li key={s.id} className={dexItemClass(s)}>
            <img src={spriteDataUrl(`fish-${s.id}`, ICON_SCALE, { silhouette: !r.found })} alt={r.found ? s.name : '미발견 물고기'} />
            <span className="fish-dex-info">
              {r.found ? (
                <strong>
                  {s.name}
                  <RarityBadge s={s} />
                </strong>
              ) : (
                <strong className="muted">???</strong>
              )}
              <span className="muted">
                {RARITY_NAMES[s.rarity]}
                {entry ? ` · 최대 ${entry.maxCm}cm` : ''}
              </span>
              {r.found && <span className="muted">{conditionLabel(s)}</span>}
              {r.found && buffLine(s) && <span className="fish-dex-buff">{buffLine(s)}</span>}
              {r.now ? (
                <span className="fish-map-now-chip">지금</span>
              ) : r.found && r.legendDone ? (
                <span className="muted">세이브당 한 마리, 이미 잡았어요</span>
              ) : r.found && r.reason && r.reason !== 'legend-done' ? (
                <span className="fish-shop-note">{`지금은 안 나와요 · ${REASONS[r.reason]}`}</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function MarkDetail({ mark, area, view, here, onTab }: { mark: PlaceMarker; area: AreaId; view: View; here: AreaId; onTab(a: AreaId, p?: Pick | null): void }) {
  const goto = (a: AreaId) => (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab(a)}>
      {`${areaName(a)} 지도 보기`}
    </button>
  )
  switch (mark.kind) {
    case 'exit':
      return (
        <>
          {goto(mark.target)}
        </>
      )
    case 'gate': {
      const u = UNLOCKS[mark.area]
      return (
        <>
          {u && <p className="fish-unlock-price">{gold(u.price)}</p>}
          <p className="muted">{`보유 ${gold(view.gold)} · 문 앞에서 열 수 있어요`}</p>
          <p className="muted">{`열면 ${ro(areaName(mark.area))} 갈 수 있어요`}</p>
          {goto(mark.area)}
        </>
      )
    }
    case 'dock': {
      const open = view.areas.includes(mark.target)
      const u = UNLOCKS[mark.target]
      return (
        <>
          {open || !u ? null : (
            <>
              <p className="fish-unlock-price">{gold(u.price)}</p>
              <p className="muted">{`보유 ${gold(view.gold)} · 선착장에서 살 수 있어요`}</p>
              {rodNeed(mark.target) && <p className="muted">{rodNeed(mark.target)}</p>}
            </>
          )}
          {goto(mark.target)}
        </>
      )
    }
    case 'shop':
      return <p>물고기 팔기, 낚싯대·가방·찌</p>
    case 'teleporter': {
      // 켜짐 판정·요금은 서버와 같은 teleporterOpen·teleportFee(atlas의 어댑터). 이동은 이동기 앞에서만 한다
      const info = teleporterInfo(area, view, here)
      if (!info) return null
      if (info.open) {
        return (
          <>
            {info.feeFromHere !== null && <p className="muted">{`${areaName(here)} 이동기에서 오면 ${gold(info.feeFromHere)}`}</p>}
            <p className="muted">켜진 다른 순간이동기와 오갈 수 있어요</p>
          </>
        )
      }
      return (
        <>
          {info.challenge ? (
            <>
              <p>{info.challenge.title}</p>
              <p className="muted">{info.challenge.desc}</p>
              <p className="muted">{`진행 ${info.challenge.progress}/${info.challenge.count}`}</p>
              {!view.areas.includes(area) && <p className="muted">지역을 열어야 켤 수 있어요</p>}
            </>
          ) : (
            <p className="muted">아직 꺼져 있어요</p>
          )}
        </>
      )
    }
  }
}

function LockedArea({ area, rows, view, onTab }: { area: AreaId; rows: FishRow[]; view: View; onTab(a: AreaId, p?: Pick | null): void }) {
  const u = UNLOCKS[area]
  const place = unlockPlace(area)
  return (
    <>
      <div className="fish-rod fish-map-locked">
        <div className="fish-rod-info">
          <strong>{`${eun(areaName(area))} 아직 못 가요`}</strong>
          {u && <span>{`${u.name} · `}<span className="fish-unlock-price">{gold(u.price)}</span></span>}
          {rodNeed(area) && <span className="muted">{rodNeed(area)}</span>}
          {place && (
            <span className="muted">{`${areaName(place.area)}의 ${place.kind === 'gate' ? '잠긴 문' : '선착장'} 앞에서 열 수 있어요`}</span>
          )}
          <span className="muted">{`보유 ${gold(view.gold)}`}</span>
        </div>
      </div>
      {place && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onTab(place.area, { kind: 'mark', key: place.kind === 'gate' ? `gate:${area}` : `dock:${area}` })}
        >
          {`${areaName(place.area)} 지도 보기`}
        </button>
      )}
      <FishList rows={rows} view={view} />
    </>
  )
}
