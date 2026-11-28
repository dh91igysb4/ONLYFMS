// 낚시 게임 화면. 규칙·가격·난수는 모두 서버에 있고, 화면은 행동을 보내고 돌아온 view를 그린다.
// 바 미니게임과 마을 걷기만 브라우저에서 돈다(서버는 검증하지 않는다). 단계 전환은 타이머, 그리기·미니게임·걷기는 rAF 한 개.
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { ApiError, errorMessage, world, worldPlayers, worldVisit, type WorldPlayer, type WorldView } from '../../lib/api.ts'
import { useAuth } from '../../platform/auth/AuthProvider.tsx'
import type { WorldGameProps } from '../ui.ts'
import { getWorld } from '../index.ts'
import { joinWorldRoom, type WorldRoom } from '../../platform/world/room.ts'
import { joinWorldPresence, type OnlinePeer, type WorldPresence } from '../../platform/world/presence.ts'
import { syncTags, type Tag } from './peerTags.ts'
import { BRAG_MS, bragCard, CHAT_GAP_MS, CHAT_MAX, CHAT_MS, cleanChat, EMOTE_MS, EMOTES, encodeBrag, encodeChat, encodeEmote, parseShow, type EmoteId, type Show } from './show.ts'
import { SPRITES } from './sprites.ts'
import { AREAS, BAGS, bagSize, BUFFS, CHALLENGES, DEFAULT_AREAS, HOOK_WINDOW_MS, MIN_FIGHT_MS, rodAtLeast, RODS, SHOES, shoeSpeed, SPECIES, UNLOCKS, type AreaId, type BuffId, type IsleLayoutId, type TackleId } from './data.ts'
import { canDecorate, isleArrival, isleZoneTiles, placeKey, placeName, type IsleShape } from './isle.ts'
import { canPlace, type FurnId, type Placed } from './home.ts'
import { BoatPanel, DecoPanel, FurnPanel, IsleChoosePanel, WorkbenchPanel } from './IslePanels.tsx'
import type { DecoId, DecoPlaced } from './deco.ts'
import { ISLE_ZONES, type ToolId } from './isleEcon.ts'
import { BAIT_RECIPES, LICENSE_PRICE, featureOn, type BaitKind } from './research.ts'
import { EconSection, econOf, type CastBait } from './EconPanel.tsx'
import { GalleryPanel, galleryOf } from './GalleryPanel.tsx'
import { CALM_BAR, potionOn, stageB } from './gallery.ts'
import { galleryScene } from './scene.ts'
import { facilityScene } from './facility.ts'
import { HALL_ELEVATOR_ENTRY } from './maps/hall.ts'
import { PREVIEW_ISLE_KEY, fishSellPrice, kstDay, teleporterOpen, type Action, type DiscardAt, type Fish, type PendingView, type View } from './logic.ts'
import { barParams, barResult, gaugeAt, initBar, stepBar, type Bar, type BarParams } from './minigame.ts'
import { conditionsAt, nextTideChange, tideAt, type Conditions } from './clock.ts'
import { drawWorld, releaseSceneCache, SCENE_H, SCENE_W, type Phase, type ScenePeer } from './scene.ts'
import { spriteDataUrl } from './sprites.ts'
import {
  addHole, castTarget, interactionAt, MAX_HOLES, nearestDryTile, openExitAt, STATIC_DYNAMIC, standTile, TILE, tileOf,
  type Facing, type FameSlot, type Interaction, type MapDef, type MapDynamic, type Opened, type TileFacing, type Vec,
} from './map.ts'
import { mapFor } from './maps/index.ts'
import { VILLAGE } from './maps/village.ts'
import { cameraFor, feetBlocked, keysVector, stepWalk, type MoveInput, type Player } from './walk.ts'
import { loadPosition, savePosition, startPosition } from './position.ts'
import { Controls, type ActionLabel, type ActionState } from './Controls.tsx'
import { BagPanel, ChallengePanel, DexPanel, ShopPanel, TeleportPanel, UnlockPanel } from './Menus.tsx'
import { DEFAULT_LAYERS, MapPanel, type MapLayers } from './MapPanel.tsx'
import { WardrobePanel } from './WardrobePanel.tsx'
import { ElevatorPanel, FamePanel } from './HallPanels.tsx'
import { FridgePanel } from './FridgePanel.tsx'
import { allBoards, boardIndexFor, fameFrames, type FameFrame } from './fame.ts'
import { loadHallOfFame, type HallOfFame } from '../../platform/world/hallOfFame.ts'
import { releaseMinimapCache } from './minimap.ts'
import { decodeOutfit, normalizeOutfit } from './outfit.ts'
import { DEFAULT_OUTFIT, type Outfit, type WearSlot } from './wardrobe.ts'
import './fishing.css'

const OUTCOME_MS = 1200
/** 전설은 세이브당 한 번뿐이라 알림을 더 오래 보여 준다 */
const LEGEND_OUTCOME_MS = 2500
/** 신화는 새 힘 줄까지 있어 더 오래 */
const MYTHIC_OUTCOME_MS = 3500
const MAX_SCALE = 4
/** 장면 논리 크기 상한. 그리는 양을 묶고, 큰 모니터에서 장면이 물바다가 되지 않게 한다. */
const MAX_SCENE_W = 320
const MAX_SCENE_H = 480
/** 상점·해금 창이 열린 뒤 이 시간 동안은 누르기·클릭을 받지 않는다(여는 손가락의 클릭이 구매 버튼에 떨어지지 않게) */
const PANEL_GUARD_MS = 300
/** 캐릭터 그림 높이(scene.ts PLAYER_H와 같다). 이름표를 머리 위에 띄울 때 쓴다 */
const PEER_H = 24
/** 무대 아래 요소를 재고도 남겨 두는 여유 높이 */
const FIT_MARGIN = 8

/** 주어진 너비·높이에 들어가는 가장 큰 정수 배율 (1~4). 픽셀이 뭉개지지 않게 정수 배만 쓴다. */
export function canvasScale(availW: number, availH: number): number {
  const fit = Math.min(Math.floor(availW / SCENE_W), Math.floor(availH / SCENE_H))
  return Math.max(1, Math.min(MAX_SCALE, fit))
}

export type SceneFit = { scale: number; w: number; h: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sizeOrZero = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

/**
 * 쓸 수 있는 영역에 맞춘 캔버스: 정수 배율과, 그 배율로 영역을 채우는 장면 논리 크기(160~320 × 240~480).
 * 장면은 늘이지 않고 더 넓게 그린다(카메라가 맵을 더 넓게 보여 준다).
 */
export function fitScene(availW: number, availH: number): SceneFit {
  const aw = sizeOrZero(availW)
  const ah = sizeOrZero(availH)
  const scale = canvasScale(aw, ah)
  return {
    scale,
    w: clamp(Math.floor(aw / scale), SCENE_W, MAX_SCENE_W),
    h: clamp(Math.floor(ah / scale), SCENE_H, MAX_SCENE_H),
  }
}

/**
 * 터치 안내 줄(.fish-hint-top)이 캔버스 위쪽에 차지하는 띠(CSS px): 위 여백 8 + 한 줄 높이 32(줄 20 + 위아래 6) + 틈 4.
 * 안내 줄은 한 줄로 고정한다(white-space: nowrap).
 */
export const TOUCH_HINT_BAND = 44

/** HUD 시계를 둘 맨 위 y(논리 px). 터치는 낚시 내내 위쪽에 뜨는 안내 줄 아래, 데스크톱은 0. */
export function hudTopFor(touch: boolean, scale: number): number {
  return touch ? Math.ceil(TOUCH_HINT_BAND / Math.max(1, scale)) : 0
}

/** 캔버스에 쓸 수 있는 높이: 창 높이 - 문서 맨 위에서 무대까지 - 무대 아래 요소 - 여유. 음수일 수 있다. */
export function availableHeight(innerH: number, stageTop: number, belowH: number): number {
  return innerH - stageTop - belowH - FIT_MARGIN
}

/** unlock: 잠긴 문·선착장 앞에서 연 지역 해금 창, teleport: 순간이동기 앞에서 연 창, challenges: 도전과제 목록, map: 큰 지도 */
type Menu = 'gallery' | 'bag' | 'shop' | 'dex' | 'unlock' | 'teleport' | 'challenges' | 'map' | 'wardrobe' | 'fame' | 'elevator' | 'fridge' | 'trash' | 'boat' | 'isle' | 'workbench' | 'furn' | 'deco'
/** 열린 뒤 잠깐 누르기·클릭을 막는 창(서 있는 자리에서 행동으로 여는 창) */
const outfitMemo = new WeakMap<object, Outfit>()
/** 서버 view의 옷차림(모르는 id는 기본값). view 객체마다 한 번만 정리해 매 프레임 새 객체를 만들지 않는다 */
function outfitOf(view: View | null): Outfit {
  if (!view) return DEFAULT_OUTFIT
  const hit = outfitMemo.get(view)
  if (hit) return hit
  const o = normalizeOutfit(view.outfit)
  outfitMemo.set(view, o)
  return o
}
const GUARDED: ReadonlySet<Menu> = new Set<Menu>(['shop', 'unlock', 'teleport', 'wardrobe', 'fame', 'elevator', 'fridge', 'trash', 'boat', 'isle', 'workbench', 'furn', 'deco'])
const MENU_LABELS = { bag: '가방', dex: '도감', challenges: '과제', map: '지도' } as const
/** 컴퓨터 단축키(e.code → 할 일) */
const HOTKEYS: Record<string, 'map' | 'bag' | 'dex' | 'challenges' | 'chat' | 'emote'> = {
  KeyM: 'map', KeyE: 'bag', KeyQ: 'dex', KeyG: 'challenges', KeyT: 'chat', KeyY: 'emote',
}
const HOTKEY_LABEL = { map: 'M', bag: 'E', dex: 'Q', challenges: 'G', chat: 'T', emote: 'Y' } as const
/** 메뉴 창(.fish-panel) 좌우 안쪽 여백(css px). 큰 지도 배율 계산용 */
const PANEL_PAD = 12
type Outcome =
  | { kind: 'caught'; fish: Fish; isNew: boolean; buff?: BuffId }
  | { kind: 'lost'; early: boolean }
type Notice = { kind: 'bag_full' } | { kind: 'error'; text: string } | { kind: 'info'; text: string }
type Keys = { up: boolean; down: boolean; left: boolean; right: boolean }
/** 누르기를 보낸 곳. 낚시 시작(충전·던지기)과 상점·문·선착장은 행동(버튼·스페이스)으로만, 챔·감기는 캔버스로도 된다. */
type Source = 'action' | 'canvas'
// 누르고 있는 것마다 다른 열쇠: 행동 버튼 'button', 스페이스 'space', 캔버스 `canvas:<id>`, 조이스틱 자리 `stick:<id>`

/** 렌더와 무관하게 프레임·타이머가 읽고 쓰는 진행 상태 */
/** 섬으로 가는 전환: 모양·치운 구역 수·주인(내 섬이면 null) */
type IsleGo = IsleShape & { owner: string | null }
type IsleLike = { layout: IsleLayoutId; cleared?: number; house?: number; placed?: readonly Placed[]; deco?: readonly DecoPlaced[] } | null | undefined
/** 서버 섬 값(내 view.isle 또는 남의 publicView.isle) → 맵을 정하는 값. 옛 응답의 빠진 값은 0·없음 */
const shapeOf = (i: IsleLike): IsleShape | null => (i ? { layout: i.layout, cleared: i.cleared ?? 0, house: i.house ?? 0, placed: i.placed ?? [], deco: i.deco ?? [] } : null)
type Runtime = {
  phase: Phase
  busy: boolean
  /** 지금 누르고 있는 것들의 열쇠. 하나라도 있으면 미니게임 바가 올라간다 */
  held: Set<string>
  /** 충전을 시작한 누르기. 그것을 뗄 때만 던진다 */
  chargeKey: string | null
  /**
   * 상점 문·잠긴 문·선착장 앞에서 누른 행동(열쇠와 그때의 상호작용 열쇠).
   * 그것을 뗄 때 아직 같은 자리면 상점·해금 창을 열거나 배를 탄다
   */
  openPress: { key: string; at: string } | null
  chargeStart: number
  gauge: number
  castPower: number
  player: Player
  /** 조이스틱 입력. 0이 아니면 키보드보다 먼저 */
  stick: MoveInput
  keys: Keys
  /** 지금 서 있는 자리의 상호작용 (화면 상태와 비교해 바뀔 때만 다시 그린다) */
  hereKey: string
  castSpot: string
  /** 던진 찌의 월드 위치 */
  bobber: Vec | null
  /** 서버 시각 - 로컬 시각 (마지막 응답 기준) */
  offset: number
  hookServerNow: number
  bar: Bar | null
  params: BarParams | null
  settling: boolean
  caughtSpecies: string | null
  lastFrame: number
  /** 지금 걷는 지역의 맵 (출구를 지나면 바뀐다) */
  map: MapDef
  /**
   * 지역 전환 중(출구·배): 페이드 아웃 → 맵 교체 → 페이드 인. 끝나면 null.
   * say: 도착 알림을 지역 이름 대신 이 문구로(밀물에 같은 맵 안에서 옮길 때, 남의 섬 "{아이디}의 섬")
   * isle: 내 섬·남의 섬으로 갈 때 섬 모양과 주인(내 섬이면 owner null)
   */
  trans: { target: AreaId; entry: TileFacing; ms: number; swapped: boolean; say?: string; isle?: IsleGo } | null
  /** 남의 섬에 있으면 그 주인 id, 아니면 null(내 섬 설계 §5.6) */
  owner: string | null
  /** 남의 섬 구경 값(publicView: 섬 모양·옷차림). 남의 섬이 아니면 null */
  isleView: { isle: IsleLike; outfit: unknown; facilities?: unknown } | null
  /** 지역 전환 페이드 알파(0~1) */
  fade: number
  /** 이 방문에 뚫은 얼음 구멍("tx,ty", 오래된 순). 맵을 떠나면 비운다 */
  holes: string[]
  holeSet: ReadonlySet<string>
  /** 얼음 구멍을 뚫는 중(칸과 지난 시간) */
  drill: { tx: number; ty: number; ms: number } | null
  /** "곧 밀물이에요"를 이미 알린 썰물(게임 날짜-끝 분) */
  tideWarnKey: string | null
  /** 신화를 잡은 시각(performance.now). 장면이 캐릭터 둘레에 빛고리를 그린다 */
  mythicAt: number | null
}
/** 지역 전환 페이드 한 방향의 길이 */
const FADE_MS = 150
/** 전환 한 프레임이 더할 수 있는 최대 시간(약 30fps 한 프레임) */
const TRANSITION_STEP_MAX_MS = 34
/** 도착한 지역 이름을 보이는 시간 */
const AREA_NOTICE_MS = 1500
/** 얼음 구멍 하나를 뚫는 시간 */
export const DRILL_MS = 1200
/** 썰물이 끝나기 이만큼(게임 분) 전에 "곧 밀물이에요" */
const TIDE_WARN_MIN = 30
const TIDE_WARN_TEXT = '곧 밀물이에요'
const TIDE_IN_TEXT = '밀물이 들어와 물가로 나왔어요'
const REFROZE_TEXT = '구멍이 다시 얼었어요'
const TIDE_NOTICE_MS = 3000

/** 전체화면 요청·해제는 실패해도(거절·미지원) 조용히 넘긴다. */
function ignoreRejection(fn: () => Promise<void> | void): void {
  try {
    void Promise.resolve(fn()).catch(() => {})
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}

/** 화면 목록이 서버와 어긋났다는 뜻의 오류: 다시 불러온다 */
const STALE_CODES: ReadonlySet<string> = new Set(['bag_changed', 'fridge_changed', 'fridge_full', 'bag_full'])
const codeOf = (e: unknown): string => (e instanceof ApiError ? e.code : 'network')
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id
/** 전설·신화 어종인가(legend 필드). 모르는 어종(더 새 서버)은 아니다 */
const isLegend = (id: string) => !!SPECIES.find((s) => s.id === id)?.legend
const isMythic = (id: string) => SPECIES.find((s) => s.id === id)?.rarity === 'mythic'
/** 화면용 가격(실제로 팔리는 값, 버프 포함): 모르는 어종이면 null(price는 모르는 id에 throw한다) */
const safePrice = (f: Fish, buffs: readonly BuffId[] = []): number | null => (SPECIES.some((s) => s.id === f.species) ? fishSellPrice(f, buffs) : null)
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
// 결과를 모르는 실패: 오류 화면 없이 view를 다시 불러와 맞춘다.
const SILENT_CODES = new Set(['network', 'no_pending'])

const RETRY = '다시 시도해 주세요'
// 낚시 로직의 오류 코드 문구. 플랫폼 공통 문구(MESSAGES)에 넣지 않고 여기서만 쓴다.
/** need_rod: 낚싯대 요구가 있는 해금(난파선 앞바다)의 가장 낮은 단계 이름으로 만든다("백골 낚싯대 이상이 있어야 해요") */
const NEED_ROD_TIER = Math.min(...Object.values(UNLOCKS).flatMap((u) => (u?.minRod ? [u.minRod] : [])), ...AREAS.flatMap((a) => (a.minRod ? [a.minRod] : [])))
const NEED_ROD = `${rodAtLeast(NEED_ROD_TIER)}이 있어야 해요`
const FISHING_MESSAGES: Record<string, string> = {
  bag_empty: '팔 물고기가 없어요',
  not_enough_gold: '골드가 부족해요',
  price_changed: '가격이 바뀌었어요. 새로고침한 뒤 다시 해 주세요',
  bag_changed: '가방이 바뀌었어요. 다시 골라 주세요',
  fridge_full: '냉장고가 가득 찼어요',
  bag_full: '가방이 가득 찼어요',
  gathered: '오늘은 다 캤어요',
  mats_full: '재료가 가득 찼어요(최대 999)',
  not_enough_mats: '재료가 모자라요',
  need_tool: '도구 단계가 모자라요',
  node_locked: '아직 갈 수 없는 곳이에요',
  no_isle: '먼저 내 섬을 골라 주세요',
  bad_node: '캘 수 없는 곳이에요. 새로고침해 주세요',
  bad_zone: '개간 순서가 바뀌었어요. 새로고침해 주세요',
  bad_tool: '없는 도구예요. 새로고침해 주세요',
  bad_level: '집 단계가 바뀌었어요. 새로고침해 주세요',
  need_clear: '개간을 더 해야 지을 수 있어요',
  no_house: '집을 먼저 지어 주세요',
  no_furn: '보관함에 그 가구가 없어요',
  bad_spot: '거기는 놓을 수 없어요',
  room_full: '방에 더 놓을 수 없어요',
  no_furn_here: '거기에 가구가 없어요',
  furn_full: '보관함이 가득 찼어요(종류마다 최대 99)',
  bad_furn: '없는 가구예요. 새로고침해 주세요',
  bad_deco: '없는 꾸미기예요. 새로고침해 주세요',
  deco_full: '보관함이 가득 찼어요(종류마다 최대 99)',
  no_deco: '보관함에 그 꾸미기가 없어요',
  isle_full: '섬에 더 놓을 수 없어요(최대 150개)',
  no_deco_here: '거기에 꾸미기가 없어요',
  fridge_changed: '냉장고가 바뀌었어요. 다시 골라 주세요',
  locked: '잠긴 물고기는 버릴 수 없어요',
  bad_tier: '이전 단계를 먼저 사야 해요',
  too_early: RETRY,
  too_late: RETRY,
  not_hooked: RETRY,
  bad_action: RETRY,
  bad_area: RETRY,
  bad_power: RETRY,
  bad_tackle: RETRY,
  already_owned: '이미 가지고 있어요',
  not_owned: RETRY,
  too_many: '칸이 모자라요',
  already_open: '이미 열려 있어요',
  busy: '낚시 중에는 바꿀 수 없어요',
  bad_teleporter: RETRY,
  same: RETRY,
  not_open: '아직 켜지지 않은 순간이동기예요',
  bad_wear: RETRY,
  not_for_sale: '업적으로만 얻을 수 있어요',
  need_rod: NEED_ROD,
  spot_closed: '물이 들어와 갯골에 갈 수 없어요',
  // 경제 P1(v27)
  feature_off: '아직 열리지 않은 기능이에요',
  no_bait: '미끼가 없어요',
  no_meal: '어분이 모자라요',
  no_license: '연구 해금이 필요해요',
  owned: '이미 해금했어요',
  need_legend: '전설을 하나 이상 발견해야 해요',
  not_discovered: '아직 발견하지 않은 물고기예요',
  not_ordinary: '전설·신화는 어분으로 만들 수 없어요',
  wrong_place: '그 물고기가 사는 지역·자리에서 던져 주세요',
  need_power: '더 세게 던져야 해요',
  bad_target: RETRY,
  // 경제 P2~P4(v27)
  not_recatch: '연구로 다시 잡은 물고기만 기증할 수 있어요',
  exhibited: '이미 전시했어요',
  donated_full: '이미 2마리를 기증했어요',
  need_donation: '같은 물고기를 2마리 기증해야 전시할 수 있어요',
  need_mythic_exhibit: '첫 신화를 전시하면 열려요',
  need_all_exhibits: '13종을 모두 전시하면 열려요',
  potion_full: '포션 시간이 가득 찼어요',
  no_potion: '보관한 포션이 없어요',
  stock_full: '보관함이 가득 찼어요',
}
const fishingMessage = (code: string) => FISHING_MESSAGES[code] ?? errorMessage(code)
/** 서버에 낚시(pending)가 남아 있어 지역을 못 열 때. 다시 던졌다 거두면 풀린다 */
const UNLOCK_BUSY = '낚시를 마친 뒤에 열 수 있어요'
/** 서버에 낚시(pending)가 남아 있어 순간이동을 못 할 때 */
const TELEPORT_BUSY = '낚시를 마친 뒤에 이동할 수 있어요'
const areaNameOf = (id: AreaId) => AREAS.find((a) => a.id === id)?.name ?? id

const DESKTOP_IDLE_HINT = '방향키로 이동 · 스페이스로 낚시/상점'
/** 잠긴 문·선착장 앞에서 행동이 하는 일(행동 버튼 글자, 데스크톱 안내) */
const GATE_ACTION = '살펴보기'
const DOCK_ACTION = '배 타기'
/** 순간이동기 앞: 켜졌으면 순간이동, 꺼졌으면 살펴보기(켜는 과제를 보여 준다) */
const TELEPORT_ACTION = '순간이동'
/** 뚫을 수 있는 얼음 앞 */
const DRILL_ACTION = '구멍 뚫기'
/** 지역을 연 뒤 알림 */
const UNLOCK_NOTICES: Partial<Record<AreaId, string>> = {
  lake: '산 호수 가는 다리를 고쳤어요',
  cave: '동굴 입구를 치웠어요',
  island: '배를 샀어요 — 선착장에서 섬으로 갈 수 있어요',
  tideflat: '통나무 더미를 치웠어요 — 서쪽 갯벌로 갈 수 있어요',
  swamp: '덩굴을 걷어 냈어요 — 서쪽 늪지로 갈 수 있어요',
  summit: '눈더미를 치웠어요 — 북쪽 산정 호수로 갈 수 있어요',
  wreck: '원양 어선을 샀어요 — 섬 남쪽 선착장에서 난파선 앞바다로 갈 수 있어요',
}
const HINTS: Partial<Record<Phase, string>> = {
  charging: '떼면 던져요',
  waiting: '입질을 기다리는 중…',
  bite: '지금 눌러요!',
  fighting: '누르고 있으면 막대가 올라가요',
}

const STOP: MoveInput = { x: 0, y: 0 }
const NO_KEYS: Keys = { up: false, down: false, left: false, right: false }
/** 방향키와 WASD. e.code(자판 위치)로 읽어 한글 입력 상태에서도 된다. */
const MOVE_KEYS: Record<string, keyof Keys> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
}
/** 터치 입력이 하나라도 있으면(마우스가 함께 있는 터치 노트북·태블릿 포함) 터치 조작을 보인다 */
const COARSE_QUERY = '(any-pointer: coarse)'
const coarseQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_QUERY) : null

/** 서 있는 자리에서 할 수 있는 일(앞 타일·고정물로 정한다, interactionAt) */
function interactionFor(map: MapDef, p: Pick<Player, 'pos' | 'facing'>, opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC): Interaction {
  return interactionAt(map, p.pos, p.facing, opened, dyn)
}
/** 큰 지도에 보일 내 자리. 세계 지도 밖 맵(실내·섬)이면 첫 출구(없으면 첫 선착장)가 나가는 자리(마을회관 → 마을 문 앞) */
function mapHere(map: MapDef, p: Pick<Player, 'pos' | 'facing'>, resolve: (area: AreaId) => MapDef | null): { area: AreaId; tx: number; ty: number; facing: Facing } {
  // 세계 지도 밖 맵은 나가는 길을 따라 세계 지도 맵에 닿을 때까지 간다(집 안 → 섬 → 마을 선착장 앞). 선착장을 먼저 본다
  let m = map
  let here: { area: AreaId; tx: number; ty: number; facing: Facing } = { area: map.id, ...standTile(map, p.pos), facing: p.facing }
  for (let i = 0; i < 4 && !m.onWorldMap; i++) {
    const out = m.docks[0] ?? m.exits[0]
    if (!out) break
    here = { area: out.target, tx: out.entry.tx, ty: out.entry.ty, facing: out.entry.facing }
    const next = resolve(out.target)
    if (!next) break
    m = next
  }
  return here
}
/** 고정물 행동(가게·안내판 등). 남의 섬에서는 고정물 행동을 하지 않는다 */
const isFixtureAct = (i: Interaction): boolean =>
  !!i && i.kind !== 'fish' && i.kind !== 'gate' && i.kind !== 'dock' && i.kind !== 'teleporter' && i.kind !== 'drill'
function interactionKey(i: Interaction): string {
  if (!i) return ''
  if (i.kind === 'fish') return `fish-${i.spot}`
  if (i.kind === 'gate') return `gate-${i.area}`
  if (i.kind === 'dock') return `dock-${i.target}`
  if (i.kind === 'teleporter') return 'teleporter'
  if (i.kind === 'drill') return 'drill'
  if (i.kind === 'node') return `node-${i.id}`
  if (i.kind === 'furn') return `furn-${i.tx},${i.ty}`
  if (i.kind === 'furnSpot') return `spot-${i.tx},${i.ty}`
  if (i.kind === 'decoSpot') return `dspot-${i.tx},${i.ty}`
  if (i.kind === 'decoHere') return `deco-${i.tx},${i.ty}`
  if (i.kind === 'notice') return `notice-${i.text}`
  if (i.kind === 'fame') return i.slot.group === 'record' ? `fame-record-${i.slot.key}` : `fame-site-${i.slot.index}`
  return i.kind
}
/** 마을회관 고정물 앞 행동 버튼 이름 */
const FIXTURE_ACTION: Readonly<Partial<Record<NonNullable<Interaction>['kind'], ActionLabel>>> = {
  wardrobe: '옷 가게', laptop: '노트북', elevator: '엘리베이터', fame: '보기', notice: '살펴보기', fridge: '냉장고', trash: '쓰레기통', workbench: '작업대', gallery: '전시관',
}
/** 개간 구역 나무·바위 앞 안내 */
const ZONE_TREE_NOTICE = '작업대에서 개간하면 치울 수 있어요. 사과나무·흰 줄무늬 바위·주황 광석 바위를 캐 주세요'
/** 재료 이름(캐기 안내) */
const MAT_NAMES = { wood: '나무', stone: '돌', iron: '철' } as const
/** 지역 순간이동기가 켜져 있는가. 옛 서버 응답(challenges 없음)은 꺼진 것으로 본다 */
const tpOpen = (view: View | null, area: AreaId): boolean =>
  !!view && teleporterOpen({ areas: view.areas, challenges: view.challenges ?? {} }, area)
/** 열린 지역: 기본 지역(마을·강·숲)과 서버 상태의 areas. 아직 못 받았으면 기본 지역만 */
// 마을회관 2층(hall2)은 서버 areas에 없다: 기능 플래그 exhibit가 켜져 있으면 화면이 연다
const openedOf = (view: View | null): Opened => new Set<AreaId>([...DEFAULT_AREAS, ...(view?.areas ?? []), ...(featureOn('exhibit') ? (['hall2'] as const) : [])])

export function Game({ gameId, onOpenGames }: WorldGameProps) {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  // 온라인(같은 지역 친구, 설계 2026-11-24-fishing-online-design.md): 숨김 게임이면 관리자만 방에 들어간다
  const canOnline = !!profile?.id && !!profile?.handle && !(getWorld(gameId)?.manifest.hidden && !profile?.is_admin)
  const roomRef = useRef<{ area: string; room: WorldRoom } | null>(null)
  /** 지금 내 자랑·이모트(설계 2026-11-25-fishing-brag-discard). until은 Date.now() 기준 끝 시각 */
  const showRef = useRef<{ code: string; show: Show; until: number } | null>(null)
  const [emoteOpen, setEmoteOpen] = useState(false)
  /** 말풍선 입력칸(설계 2026-11-25-fishing-chat) */
  const [chatOpen, setChatOpen] = useState(false)
  const [chatText, setChatText] = useState('')
  const [chatHint, setChatHint] = useState<string | null>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const lastChatAt = useRef(-Infinity)
  const tagsRef = useRef<HTMLDivElement>(null)
  const peerOutfits = useRef(new Map<string, Outfit>())
  // 다른 지역까지 포함한 접속 중 친구(온라인 2단계-1): 게임 전체 프레즌스, 지역과 무관하게 한 번 들어간다
  const presenceRef = useRef<WorldPresence | null>(null)
  const [onlinePeers, setOnlinePeers] = useState<OnlinePeer[]>([])
  const [view, setView] = useState<View | null>(null)
  /** 마을회관 명예의 전당(플랫폼 게시판). 회관에 들어갈 때·창을 열 때 불러온다 */
  const [hof, setHof] = useState<HallOfFame | null>(null)
  const [hofError, setHofError] = useState(false)
  const fameFramesRef = useRef<FameFrame[]>(fameFrames(null, gameId))
  const [fameSlot, setFameSlot] = useState<FameSlot | null>(null)
  const onOpenGamesRef = useRef(onOpenGames)
  onOpenGamesRef.current = onOpenGames
  const refreshFame = () => {
    loadHallOfFame(gameId, !!profile?.is_admin).then(
      (h) => {
        fameFramesRef.current = fameFrames(h, gameId)
        setHof(h)
        setHofError(false)
      },
      () => setHofError(true),
    )
  }
  const hofRef = useRef<HallOfFame | null>(null)
  hofRef.current = hof
  /** 불러온 게시판에 없는 액자 칸(빈 벽): 행동 없음 */
  const deadFame = (i: Interaction): boolean =>
    i?.kind === 'fame' && hofRef.current !== null && boardIndexFor(hofRef.current, gameId, i.slot) === null
  /** 명예의 전당 액자가 있는 맵에 들어왔으면 새로 불러온다 */
  const enteredMap = (m: MapDef) => {
    if (m.fixtures.some((f) => f.act.kind === 'fame')) refreshFame()
  }
  const opened = useMemo(() => openedOf(view), [view])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [menu, setMenuState] = useState<Menu | null>(null)
  /** 다음 투척에 쓸 미끼(경제 P1). 미끼가 다 떨어지면 비운다. 투척 함수가 최신 값을 읽게 ref도 둔다 */
  const [castBait, setCastBaitState] = useState<CastBait | null>(null)
  const castBaitRef = useRef<CastBait | null>(null)
  const setCastBait = (b: CastBait | null) => {
    castBaitRef.current = b
    setCastBaitState(b)
  }
  const [notice, setNotice] = useState<Notice | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [fit, setFit] = useState<SceneFit>({ scale: 1, w: SCENE_W, h: SCENE_H })
  const [fullscreen, setFullscreen] = useState(false)
  /** 큰 지도 레이어·필터(창을 닫아도 접속 동안 유지) */
  const [mapLayers, setMapLayers] = useState<MapLayers>(DEFAULT_LAYERS)

  const rootRef = useRef<HTMLElement>(null)
  /** 사용자가 지금 전체화면을 원하는지, 요소 전체화면 요청이 아직 끝나지 않았는지 */
  const wantFullscreen = useRef(false)
  const fullscreenPending = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const menuRef = useRef<Menu | null>(null)
  /** 해금 창이 보여 주는 지역 */
  const [unlockTarget, setUnlockTarget] = useState<AreaId | null>(null)
  /** 순간이동 창을 연 이동기의 지역(창이 열린 동안은 걷지 않으므로 그대로다) */
  const [tpArea, setTpArea] = useState<AreaId>('village')
  const panelOpenedAt = useRef(0)
  /** 마지막 위치. 첫 서버 상태(열린 지역)를 받은 뒤에야 쓸 수 있는지 보고 자리를 잡는다 */
  const savedStart = useRef(userId !== null ? loadPosition(userId) : null)
  /** 첫 서버 상태로 시작 자리를 잡았는가. 그 전에는 위치를 저장하지 않는다(저장 위치를 덮어쓰지 않게) */
  const placed = useRef(false)
  const alive = useRef(true)
  const timers = useRef(new Set<number>())
  const [rt] = useState<Runtime>(() => {
    // 첫 서버 상태를 받기 전까지 쓰는 자리(그리지 않는다). 실제 시작 자리는 place가 정한다
    const map = VILLAGE
    const player: Player = { pos: { ...VILLAGE.spawn.pos }, facing: VILLAGE.spawn.facing, moving: false, walkMs: 0 }
    return {
      phase: 'idle', busy: false, held: new Set(), chargeKey: null, openPress: null, chargeStart: 0, gauge: 0, castPower: 0,
      player, stick: STOP, keys: { ...NO_KEYS }, hereKey: interactionKey(interactionFor(map, player, openedOf(null))), castSpot: 'shore', bobber: null,
      offset: 0, hookServerNow: 0, bar: null, params: null, settling: false, caughtSpecies: null, lastFrame: 0, map, trans: null, fade: 0,
      holes: [], holeSet: new Set(), drill: null, tideWarnKey: null, mythicAt: null, owner: null, isleView: null,
    }
  })
  const [here, setHere] = useState<Interaction>(() => interactionFor(rt.map, rt.player, openedOf(null)))
  /** 서버 보정 시각. 큰 지도에도 넘기므로 같은 함수를 유지한다(지도 타이머를 다시 걸지 않게) */
  const serverNow = useCallback(() => Date.now() + rt.offset, [rt])
  const [touch, setTouch] = useState(() => coarseQuery()?.matches ?? false)

  // ------------------------------------------------------------ 도우미
  const setPhase = (p: Phase) => {
    rt.phase = p
    setPhaseState(p)
  }
  /** 지금 맵의 움직이는 상태: 서버 보정 시각의 물때와 이 방문의 얼음 구멍 */
  const dynAt = (cond: Conditions): MapDynamic => ({ tide: tideAt(cond.gameMinute), holes: rt.holeSet })
  const dynNow = (): MapDynamic => dynAt(conditionsAt(Date.now() + rt.offset))
  const setHoles = (holes: string[]) => {
    rt.holes = holes
    rt.holeSet = new Set(holes)
  }
  /** 오류 알림을 덮지 않는 잠깐 안내 */
  const flashInfo = (text: string, ms: number) => {
    setNotice((n) => (n && n.kind !== 'info' ? n : { kind: 'info', text }))
    later(() => setNotice((n) => (n?.kind === 'info' && n.text === text ? null : n)), ms)
  }
  /** 걷기 입력을 모두 놓는다. 키를 뗀 알림은 창이 초점을 잃으면 오지 않을 수 있다. */
  const clearMove = () => {
    rt.stick = STOP
    rt.keys = { ...NO_KEYS }
  }
  /**
   * 창이 초점을 잃거나 가려졌다: 뗀 알림이 오지 않을 수 있으므로 누르고 있던 것을 모두 놓는다.
   * 아직 던지지 않은 충전은 던지지 않고 대기로 돌아간다(던지는 요청이 이미 나갔으면 그대로 둔다).
   */
  const dropInput = () => {
    clearMove()
    rt.held.clear()
    rt.chargeKey = null
    rt.openPress = null
    if (rt.phase === 'charging' && !rt.busy) setPhase('idle')
  }
  /** 초점을 게임으로 돌려 스페이스(던지기)가 방금 누른 버튼을 다시 누르지 않게 한다 */
  const focusGame = () => rootRef.current?.focus({ preventScroll: true })
  /** 지금 자리의 상호작용. 남의 섬에서는 고정물(텐트 안내 등) 행동이 없다 */
  const hereAt = (areas: Opened, dyn: MapDynamic): Interaction => {
    const at = interactionFor(rt.map, rt.player, areas, dyn)
    if (rt.owner !== null && isFixtureAct(at)) return null
    // 집 안 빈 칸: 규칙(canPlace)에 맞는 칸만 놓기
    if (at?.kind === 'furnSpot') {
      const sh = shapeOf(viewRef.current?.isle)
      if (!sh || !canPlace(sh.house ?? 0, sh.placed ?? [], at.tx, at.ty)) return null
    }
    // 꾸미기 모드(내 섬, 다른 행동이 없을 때): 앞 칸의 꾸미기는 치우기, 놓을 수 있는 땅은 놓기
    if (!at && decoModeRef.current && rt.map.id === 'isle' && rt.owner === null) {
      const sh = shapeOf(viewRef.current?.isle)
      const { tx, ty } = standTile(rt.map, rt.player.pos)
      const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[rt.player.facing]
      const fx = tx + dx
      const fy = ty + dy
      if (sh?.deco?.some((d) => d.tx === fx && d.ty === fy)) return { kind: 'decoHere', tx: fx, ty: fy }
      if (sh && canDecorate(sh, fx, fy, 'path')) return { kind: 'decoSpot', tx: fx, ty: fy }
    }
    // 내 섬의 개간 구역 나무·바위(자원 칸 아님): 왜 못 캐는지 알려 준다
    if (!at && rt.map.id === 'isle' && rt.owner === null) {
      const sh = shapeOf(viewRef.current?.isle)
      const { tx, ty } = tileOf(rt.player.pos)
      const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[rt.player.facing]
      const zone = sh ? isleZoneTiles(sh.layout).get(`${tx + dx},${ty + dy}`) : undefined
      if (sh && zone !== undefined && zone > (sh.cleared ?? 0)) return { kind: 'notice', text: ZONE_TREE_NOTICE }
    }
    return at
  }
  /** 위치 저장. 남의 섬 위치는 저장하지 않는다(다음 접속은 그 전 저장 위치에서) */
  const savePlayer = () => {
    const id = userIdRef.current
    if (id !== null && placed.current && rt.owner === null) savePosition(id, { area: rt.map.id, pos: rt.player.pos, facing: rt.player.facing })
  }
  /**
   * 첫 서버 상태를 받았다: 열린 지역으로 저장 위치를 다시 보고 시작 자리를 잡는다.
   * 그 지역이 안 열렸거나 아직 잠긴 문 칸이면 마을 시작 위치(상점 문 앞).
   */
  const place = (v: View) => {
    const areas = openedOf(v)
    const shape = shapeOf(v.isle)
    const start = startPosition(savedStart.current, areas, shape)
    rt.map = mapFor(start.area, shape) ?? VILLAGE
    rt.player = { pos: { ...start.pos }, facing: start.facing, moving: false, walkMs: 0 }
    syncOwnIsle()
    enteredMap(rt.map)
    const at = hereAt(areas, dynNow())
    rt.hereKey = interactionKey(at)
    setHere(at)
    placed.current = true
  }
  const setMenu = (m: Menu | null) => {
    if (m) {
      clearMove()
      rt.held.clear()
      rt.chargeKey = null
      rt.openPress = null
      if (GUARDED.has(m)) panelOpenedAt.current = performance.now()
    }
    menuRef.current = m
    setMenuState(m)
  }
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }
  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current.clear()
  }
  const resetFight = () => {
    rt.bar = null
    rt.params = null
    rt.settling = false
  }

  async function send<R>(body: Parameters<typeof world>[0]): Promise<WorldView<View, R>> {
    rt.busy = true
    setBusy(true)
    try {
      const res = await world<View, R>(body)
      if (alive.current) {
        rt.offset = res.server_now - Date.now()
        // 첫 프레임(첫 view가 그려진 뒤 시작)보다 먼저 시작 자리를 잡는다
        if (!placed.current) place(res.view)
        viewRef.current = res.view
        setView(res.view)
      }
      return res
    } finally {
      rt.busy = false
      if (alive.current) setBusy(false)
    }
  }
  const act = <R,>(payload: Action) => send<R>({ game: gameId, action: 'act', payload })

  async function load() {
    setLoadError(null)
    try {
      await send({ game: gameId, action: 'load' })
    } catch (e) {
      if (alive.current) setLoadError(errorMessage(codeOf(e)))
    }
  }

  /** 서버 상태를 모르게 된 실패: 진행을 접고 view를 다시 불러온 뒤 idle. */
  async function recover(code: string) {
    clearTimers()
    resetFight()
    setOutcome(null)
    setPhase('idle')
    if (!SILENT_CODES.has(code)) setNotice({ kind: 'error', text: fishingMessage(code) })
    try {
      await send({ game: gameId, action: 'load' })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  function showOutcome(o: Outcome) {
    resetFight()
    rt.caughtSpecies = o.kind === 'caught' ? o.fish.species : null
    const mythic = o.kind === 'caught' && isMythic(o.fish.species)
    if (mythic) rt.mythicAt = performance.now()
    setOutcome(o)
    setPhase(o.kind)
    later(() => {
      rt.caughtSpecies = null
      setOutcome(null)
      setPhase('idle')
    }, mythic ? MYTHIC_OUTCOME_MS : o.kind === 'caught' && isLegend(o.fish.species) ? LEGEND_OUTCOME_MS : OUTCOME_MS)
  }

  // ------------------------------------------------------------ 단계
  async function cast(power: number) {
    rt.castPower = power
    rt.bobber = castTarget(rt.map, rt.player.pos, rt.player.facing, power, dynNow())
    let res: WorldView<View, PendingView>
    try {
      // 고른 미끼가 남아 있으면 같이 보낸다(경제 P1, 플래그가 꺼져 있으면 고를 수 없다)
      const sel = castBaitRef.current
      const have = sel ? econOf(viewRef.current ?? {}).baits[sel.bait] : 0
      const bait = sel && have > 0 ? { bait: sel.bait, ...(sel.target ? { target: sel.target } : {}) } : {}
      res = await act<PendingView>({ type: 'cast', area: rt.map.id, power, spot: rt.castSpot, ...bait })
      if (sel && econOf(res.view).baits[sel.bait] < 1) setCastBait(null)
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      setPhase('idle')
      setNotice(code === 'bag_full' ? { kind: 'bag_full' } : { kind: 'error', text: fishingMessage(code) })
      return
    }
    if (!alive.current) return
    const p = res.result ?? res.view.pending
    if (!p) {
      setPhase('idle')
      return
    }
    setPhase('waiting')
    const biteAt = p.startedAt + p.biteDelayMs
    later(() => {
      setPhase('bite')
      later(() => void lose(false), HOOK_WINDOW_MS)
    }, Math.max(0, biteAt - serverNow()))
  }

  /** 너무 일찍 챘거나 챔 창을 놓쳤다. 어종은 모른 채 끝낸다. */
  async function lose(early: boolean) {
    clearTimers()
    try {
      await act({ type: 'resolve', success: false, perfect: false })
    } catch (e) {
      if (alive.current) await recover(codeOf(e))
      return
    }
    if (alive.current) showOutcome({ kind: 'lost', early })
  }

  async function hook() {
    clearTimers()
    let res: WorldView<View, { species: string; sizeCm: number }>
    try {
      res = await act<{ species: string; sizeCm: number }>({ type: 'hook' })
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      if (code === 'too_early' || code === 'too_late') await lose(code === 'too_early')
      else await recover(code)
      return
    }
    if (!alive.current) return
    if (!res.result) {
      await recover('network')
      return
    }
    rt.hookServerNow = res.server_now
    rt.bar = initBar()
    rt.params = barParams(res.result.species, res.view.rodTier, res.view.equipped ?? [], res.view.buffs ?? [])
    // 안정 포션(경제 P2): 켜져 있으면 바 기본폭 ×1.10(화면만)
    if (featureOn('alchemy') && potionOn(galleryOf(res.view), 'calm')) rt.params = { ...rt.params, barSize: rt.params.barSize * CALM_BAR }
    rt.settling = false
    setPhase('fighting')
  }

  /** 미니게임이 끝났다. 서버는 챈 뒤 MIN_FIGHT_MS 전의 성공을 거절하므로 그때까지 기다렸다 보낸다. */
  function endFight(success: boolean, perfect: boolean) {
    rt.settling = true
    const wait = success ? Math.max(0, rt.hookServerNow + MIN_FIGHT_MS - serverNow()) : 0
    later(() => void finishFight(success, success && perfect), wait)
  }

  async function finishFight(success: boolean, perfect: boolean) {
    const before = viewRef.current
    let res: WorldView<View, { caught: Fish | null; completed?: string[]; buff?: BuffId }>
    try {
      res = await act<{ caught: Fish | null; completed?: string[]; buff?: BuffId }>({ type: 'resolve', success, perfect })
    } catch (e) {
      if (alive.current) await recover(codeOf(e))
      return
    }
    if (!alive.current) return
    const fish = res.result?.caught ?? null
    const buff = BUFFS.find((b) => b.id === res.result?.buff)?.id
    if (fish) showOutcome({ kind: 'caught', fish, isNew: !before?.dex[fish.species], ...(buff ? { buff } : {}) })
    else showOutcome({ kind: 'lost', early: false })
    // 이번 잡이로 깬 과제(서버가 정한다): 첫 과제를 알린다. 나머지는 과제 목록에서 보인다
    const done = CHALLENGES.find((c) => res.result?.completed?.includes(c.id))
    if (done) setNotice({ kind: 'info', text: `도전과제 완료! ${done.title} — ${areaNameOf(done.area)} 순간이동기가 켜졌어요` })
  }

  // ------------------------------------------------------------ 입력
  function press(source: Source, key: string) {
    rt.held.add(key)
    if (rt.busy || rt.trans || rt.drill || menuRef.current || !viewRef.current) return
    switch (rt.phase) {
      case 'idle': {
        if (source !== 'action') break
        const at = hereAt(opened, dynNow())
        if (!at) break
        if (at.kind !== 'fish') {
          // 상점·해금 창과 배는 뗄 때 연다: 누를 때 열면 같은 손가락의 클릭이 방금 뜬 창의 버튼에 떨어진다
          rt.openPress = { key, at: interactionKey(at) }
          break
        }
        // 충전부터는 걷지 않으므로 자리와 방향이 그대로 고정된다.
        // 뗀 알림을 잃은 상점 누르기가 남아 있으면 버린다(같은 열쇠의 떼기를 상점 쪽이 가로채지 않게).
        setNotice(null)
        rt.openPress = null
        rt.chargeKey = key
        rt.castSpot = at.spot
        rt.chargeStart = performance.now()
        rt.gauge = 0
        setPhase('charging')
        break
      }
      case 'waiting':
        void lose(true)
        break
      case 'bite':
        void hook()
        break
      default:
        break
    }
  }

  function release(key: string) {
    rt.held.delete(key)
    if (key === rt.openPress?.key) {
      const pressedAt = rt.openPress.at
      rt.openPress = null
      // 아직 대기 중이고 누를 때와 같은 자리(상점 문·잠긴 문·선착장 앞)일 때만
      if (rt.phase !== 'idle' || rt.busy || rt.trans || rt.drill || menuRef.current) return
      const at = hereAt(opened, dynNow())
      if (!at || interactionKey(at) !== pressedAt) return
      if (at.kind === 'drill') {
        startDrill()
      } else if (at.kind === 'shop') {
        setNotice(null)
        setMenu('shop')
      } else if (at.kind === 'gate') {
        openUnlock(at.area)
      } else if (at.kind === 'dock') {
        // 마을 선착장은 목적지 창(섬·내 섬·친구 섬, 내 섬 설계 §5.3). 그 밖은 열렸으면 배를 타고, 아니면 배 구매 창
        if (rt.map.id === 'village') openBoat()
        else if (opened.has(at.target)) sail(at.target)
        else openUnlock(at.target)
      } else if (at.kind === 'teleporter') {
        setNotice(null)
        setTpArea(rt.map.id)
        setMenu('teleport')
      } else if (at.kind === 'wardrobe') {
        setNotice(null)
        setMenu('wardrobe')
      } else if (at.kind === 'fridge' || at.kind === 'trash') {
        setNotice(null)
        setMenu(at.kind)
      } else if (at.kind === 'elevator') {
        setNotice(null)
        setMenu('elevator')
      } else if (at.kind === 'gallery') {
        setNotice(null)
        setMenu('gallery')
      } else if (at.kind === 'fame') {
        if (deadFame(at)) return
        setNotice(null)
        setFameSlot(at.slot)
        refreshFame()
        setMenu('fame')
      } else if (at.kind === 'laptop') {
        onOpenGamesRef.current?.()
      } else if (at.kind === 'notice') {
        flashInfo(at.text, TIDE_NOTICE_MS)
      } else if (at.kind === 'node') {
        void gatherNode(at.id)
      } else if (at.kind === 'furnSpot') {
        setNotice(null)
        furnSpotRef.current = { tx: at.tx, ty: at.ty }
        setMenu('furn')
      } else if (at.kind === 'furn') {
        void pickUpFurn(at.tx, at.ty)
      } else if (at.kind === 'decoSpot') {
        setNotice(null)
        furnSpotRef.current = { tx: at.tx, ty: at.ty }
        setMenu('deco')
      } else if (at.kind === 'decoHere') {
        void ownAct({ type: 'undecorate', tx: at.tx, ty: at.ty })
      } else if (at.kind === 'workbench') {
        setNotice(null)
        setMenu('workbench')
      }
      return
    }
    // 충전은 시작한 누르기를 뗄 때만 던진다. 다른 손가락을 떼도 끊기지 않는다.
    if (key !== rt.chargeKey || rt.phase !== 'charging' || rt.busy) return
    rt.chargeKey = null
    const power = gaugeAt(performance.now() - rt.chargeStart)
    rt.gauge = power
    void cast(power)
  }

  /** 보고 있는 얼음 칸에 구멍을 뚫기 시작한다(DRILL_MS 뒤 구멍. 그동안 걷지 않는다) */
  function startDrill() {
    const { tx, ty } = standTile(rt.map, rt.player.pos, dynNow())
    const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[rt.player.facing]
    setNotice(null)
    rt.drill = { tx: tx + step[0], ty: ty + step[1], ms: 0 }
  }

  /** 뚫기를 DRILL_MS만큼 진행했으면 구멍을 낸다. 넷째 구멍이면 가장 오래된 구멍이 다시 언다 */
  function stepDrill(dt: number) {
    const d = rt.drill
    if (!d) return
    d.ms += Math.min(Math.max(dt, 0), TRANSITION_STEP_MAX_MS)
    if (d.ms < DRILL_MS) return
    rt.drill = null
    const before = rt.holes
    const next = addHole(before, d.tx, d.ty)
    setHoles(next)
    if (before.length >= MAX_HOLES && !before.includes(`${d.tx},${d.ty}`)) flashInfo(REFROZE_TEXT, TIDE_NOTICE_MS)
    // 발 사각형이 새 구멍에 걸쳐 있으면 서 있던 칸 가운데로 당긴다(그 칸은 늘 걸을 수 있다)
    const { pos } = rt.player
    if (feetBlocked(rt.map, pos.x, pos.y, opened, dynNow())) {
      const t = standTile(rt.map, pos, dynNow())
      rt.player = { ...rt.player, pos: { x: t.tx * TILE + TILE / 2, y: t.ty * TILE + TILE / 2 } }
    }
  }

  /**
   * 물때 맵: 썰물이 끝나 진흙이 물이 되면, 낚시 중이 아닐 때 페이드와 함께 가장 가까운 늘 걷는 칸으로 옮긴다
   * (낚시 중이면 끝난 뒤에). 썰물 끝 TIDE_WARN_MIN분 전에 한 번 "곧 밀물이에요".
   */
  function stepTide(cond: Conditions, dyn: MapDynamic) {
    if (!rt.map.tidal || rt.trans) return
    const gm = cond.gameMinute
    if (dyn.tide === 'low') {
      const end = nextTideChange(gm)
      const left = (((end - gm) % 1440) + 1440) % 1440
      const key = `${cond.gameDay}-${end}`
      if (left <= TIDE_WARN_MIN && rt.tideWarnKey !== key) {
        rt.tideWarnKey = key
        flashInfo(TIDE_WARN_TEXT, TIDE_NOTICE_MS)
      }
      return
    }
    // 창이 열려 있으면 닫은 뒤에 옮긴다
    if (rt.phase !== 'idle' || rt.busy || rt.drill || menuRef.current) return
    const { pos } = rt.player
    if (!feetBlocked(rt.map, pos.x, pos.y, opened, dyn)) return
    // 진흙으로 이어진 땅이 없으면(맵 데이터 실수) 그 맵 시작 위치로: 물 위에 갇히지 않게
    const dry = nearestDryTile(rt.map, standTile(rt.map, pos, dyn), opened) ?? tileOf(rt.map.spawn.pos)
    startTransition(rt.map.id, { tx: dry.tx, ty: dry.ty, facing: rt.player.facing }, TIDE_IN_TEXT)
  }

  /** 해금 창을 연다(잠긴 문 앞, 또는 안 연 지역으로 가는 선착장 앞) */
  function openUnlock(area: AreaId) {
    setNotice(null)
    setUnlockTarget(area)
    setMenu('unlock')
  }

  /** 선착장에서 배를 탄다: 출구와 같은 페이드로 대상 지역 선착장 쪽(dock.entry)에 내린다 */
  function sail(target: AreaId) {
    const dock = rt.map.docks.find((d) => d.target === target)
    if (dock && mapFor(target)) startTransition(target, dock.entry)
  }

  /** 출구에 닿았거나 배를 탔다: 입력을 잠그고 페이드 아웃을 시작한다. entry는 도착 맵(target)에서 설 칸과 방향 */
  function startTransition(target: AreaId, entry: TileFacing, say?: string, isle?: IsleGo) {
    // 조이스틱·방향키는 놓지 않는다: 누른 채 도착하면 페이드 뒤에 이어서 걷는다(걷기는 전환 중 막혀 있다)
    rt.held.clear()
    rt.openPress = null
    rt.player = { ...rt.player, moving: false, walkMs: 0 }
    rt.trans = { target, entry, ms: 0, swapped: false, ...(say ? { say } : {}), ...(isle ? { isle } : {}) }
  }

  // ------------------------------------------------------------ 내 섬(내 섬 설계 §5.3)
  const [boatFriends, setBoatFriends] = useState<readonly WorldPlayer[] | null>(null)
  const [boatNote, setBoatNote] = useState<string | null>(null)
  /** 섬 이름("{아이디}의 섬")에 쓰는 섬 주인 목록. 접속할 때 한 번, 친구 섬 목록을 열 때 다시 받는다 */
  const [islePlayers, setIslePlayers] = useState<readonly WorldPlayer[]>([])
  function openBoat() {
    setNotice(null)
    setBoatFriends(null)
    setBoatNote(null)
    setMenu('boat')
  }
  /** 섬으로 출발: 창을 닫고 페이드 뒤 배에서 내리는 칸에 선다. 남의 섬이면 도착 알림이 "{아이디}의 섬" */
  function goIsle(shape: IsleShape, owner: string | null, handle?: string) {
    if (menuRef.current) closeMenu()
    startTransition('isle', isleArrival(shape.layout), owner && handle ? `${handle}의 섬` : undefined, { ...shape, owner })
  }
  /** 지금 있는(또는 갈) 섬·집의 맵 값: 남의 섬이면 구경 값, 아니면 내 서버 상태 */
  /** 내 섬에서 오늘 아직 안 캔 자원 칸(맵에 드러난 칸만). 날짜는 서버와 같은 한국 시간 하루 */
  const readyNodesHere = (now: number) => {
    const g = viewRef.current?.isle?.gathered
    const done = g && g.day === kstDay(now) ? g.ids : []
    return rt.map.nodes.filter((n) => !done.includes(n.id))
  }
  /** 지금 섬(내 섬 또는 구경하는 섬)의 시설 외형. 남의 섬은 publicView의 facilities(옛 서버면 없음) */
  const facilitiesHere = () => {
    if (rt.owner !== null) {
      const v = rt.isleView
      return v?.isle && Array.isArray(v.facilities) ? facilityScene(v.isle.layout, v.facilities) : []
    }
    const v = viewRef.current
    return v?.isle ? facilityScene(v.isle.layout, galleryOf(v).projects) : []
  }
  const shapeNow = (): IsleShape | null => (rt.owner !== null ? shapeOf(rt.isleView?.isle) : shapeOf(viewRef.current?.isle))
  /** 내 섬·집에서 서버 상태가 바뀌었으면(짓기·놓기·치우기) 페이드 없이 맵만 바꾼다(서 있는 칸은 그대로 걸을 수 있다) */
  const refreshOwnPlace = () => {
    if (rt.owner !== null || (rt.map.id !== 'isle' && rt.map.id !== 'home') || rt.trans) return
    const next = mapFor(rt.map.id, shapeNow())
    if (next) rt.map = next
  }
  function boatIsland() {
    if (opened.has('island')) {
      closeMenu()
      sail('island')
    } else openUnlock('island')
  }
  function boatMine() {
    const shape = shapeOf(viewRef.current?.isle)
    if (shape) goIsle(shape, null)
    else setMenu('isle')
  }
  async function boatFriendList() {
    setBoatNote(null)
    try {
      const list = await worldPlayers(gameId, PREVIEW_ISLE_KEY)
      if (!alive.current) return
      setIslePlayers(list)
      setBoatFriends(list)
    } catch {
      if (alive.current) setBoatNote('친구 목록을 불러오지 못했어요')
    }
  }
  async function visitFriend(p: WorldPlayer) {
    setBoatNote(null)
    rt.busy = true
    setBusy(true)
    try {
      const res = await worldVisit<{ isle: IsleLike; outfit: unknown; facilities?: unknown }>(gameId, p.id)
      if (!alive.current) return
      const shape = shapeOf(res.view?.isle)
      if (!shape) {
        setBoatNote('섬에 갈 수 없어요')
        return
      }
      // 기다리는 동안 창을 닫았거나 다른 곳으로 가는 중이면 출발하지 않는다
      if (menuRef.current !== 'boat' || rt.trans) return
      rt.isleView = res.view
      goIsle(shape, p.id, res.owner?.handle || p.handle)
    } catch {
      if (alive.current) setBoatNote('섬에 갈 수 없어요')
    } finally {
      rt.busy = false
      if (alive.current) setBusy(false)
    }
  }
  // ------------------------------------------------------------ 내 섬 B(설계 2026-11-26-my-isle-b §5.5)
  async function gatherNode(id: string) {
    setNotice(null)
    try {
      const res = await act<{ res: 'wood' | 'stone' | 'iron'; n: number }>({ type: 'gather', id })
      if (!alive.current || !res.result) return
      flashInfo(`${MAT_NAMES[res.result.res]} +${res.result.n}`, TIDE_NOTICE_MS)
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }
  async function craftTool(tool: ToolId, tier: number, price: number) {
    setNotice(null)
    try {
      await act({ type: 'craft', tool, tier, price })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }
  /** 다음 구역 개간: 창을 닫고 같은 자리에서 페이드로 넓어진 섬을 그린다 */
  async function clearIsle(zone: number, price: number) {
    setNotice(null)
    try {
      const res = await act({ type: 'clear', zone, price })
      if (!alive.current) return
      const isle = res.view.isle
      if (!isle) return
      if (menuRef.current === 'workbench') closeMenu()
      if (rt.map.id !== 'isle' || rt.owner !== null || rt.trans) return
      const { tx, ty } = standTile(rt.map, rt.player.pos)
      startTransition('isle', { tx, ty, facing: rt.player.facing }, `개간했어요 (${isle.cleared}/${ISLE_ZONES})`, { ...shapeOf(isle)!, owner: null })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  // ------------------------------------------------------------ 내 섬 C: 집(설계 2026-11-26-my-isle-c §4.5)
  /** 가구 놓기 창을 연 빈 칸 */
  const furnSpotRef = useRef<{ tx: number; ty: number } | null>(null)
  /** 서버 상태를 바꾸는 집 행동: 성공하면 내 섬·집 맵을 새 상태로 */
  async function ownAct(payload: Action, after?: () => void) {
    setNotice(null)
    try {
      await act(payload)
      if (!alive.current) return
      refreshOwnPlace()
      after?.()
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }
  /** 앞 칸이 막혔을 때 발이 걸치지 않게 서 있는 칸 가운데로 옮긴다(가구·꾸미기를 놓은 뒤) */
  const snapToTile = () => {
    const t = standTile(rt.map, rt.player.pos)
    rt.player = { ...rt.player, pos: { x: t.tx * TILE + TILE / 2, y: t.ty * TILE + TILE / 2 }, moving: false, walkMs: 0 }
  }
  const placeFurn = (id: FurnId) => {
    const spot = furnSpotRef.current
    if (!spot) return
    void ownAct({ type: 'place', id, tx: spot.tx, ty: spot.ty }, () => {
      snapToTile()
      if (menuRef.current === 'furn') closeMenu()
    })
  }
  const pickUpFurn = (tx: number, ty: number) => void ownAct({ type: 'pickUp', tx, ty })
  // 내 섬 D: 꾸미기 모드(내 섬에서만 버튼이 보인다)
  const decoModeRef = useRef(false)
  const [decoMode, setDecoMode] = useState(false)
  const [onOwnIsle, setOnOwnIsle] = useState(false)
  const syncOwnIsle = () => {
    const own = rt.map.id === 'isle' && rt.owner === null
    setOnOwnIsle(own)
    if (!own && decoModeRef.current) {
      decoModeRef.current = false
      setDecoMode(false)
    }
  }
  const placeDeco = (id: DecoId) => {
    const spot = furnSpotRef.current
    if (!spot) return
    void ownAct({ type: 'decorate', id, tx: spot.tx, ty: spot.ty }, () => {
      snapToTile()
      if (menuRef.current === 'deco') closeMenu()
    })
  }

  async function chooseIsle(layout: IsleLayoutId) {
    setNotice(null)
    try {
      const res = await act({ type: 'isleChoose', layout })
      if (!alive.current) return
      const got = res.view.isle
      // 고른 섬은 저장됐다. 기다리는 동안 창을 닫았거나 다른 곳으로 가는 중이면 출발만 하지 않는다(다음 "내 섬"에서 출발)
      if (got && menuRef.current === 'isle' && !rt.trans) goIsle(shapeOf(got)!, null)
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      if (code === 'already_chosen') await reload()
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(code) })
    }
  }

  /** 페이드 아웃 → 맵·위치·방향 교체와 저장 → 페이드 인. 끝나는 프레임에는 출구를 다시 보지 않는다. */
  function stepTransition(dt: number) {
    const tr = rt.trans
    if (!tr) return
    // 맵을 바꾸는 프레임의 멈칫이 다음 dt에 실려 와도 페이드 인이 통째로 건너뛰어지지 않게 한 걸음을 줄인다
    tr.ms += Math.min(dt, TRANSITION_STEP_MAX_MS)
    if (!tr.swapped && tr.ms >= FADE_MS) {
      // 같은 맵 안에서 옮기기(밀물)는 맵을 그대로 두고 얼음 구멍도 남긴다
      // 섬·집으로 가는 출구(섬 ↔ 집 안)는 지금 장소의 주인·상태를 그대로 쓴다
      const ownPlace = tr.target === 'isle' || tr.target === 'home'
      const go: IsleGo | null = tr.isle ?? (ownPlace ? (() => { const sh = shapeNow(); return sh && { ...sh, owner: rt.owner } })() : null)
      const next = tr.target === rt.map.id && tr.say && !tr.isle ? rt.map : mapFor(tr.target, go)
      if (!next) {
        // 맵이 없는 지역으로 가는 출구는 만들지 않지만, 있다면 전환을 접는다
        rt.trans = null
        rt.fade = 0
        return
      }
      tr.swapped = true
      const { tx, ty, facing } = tr.entry
      const owner = go?.owner ?? null
      const changed = next !== rt.map || owner !== rt.owner
      rt.owner = owner
      if (owner === null) rt.isleView = null
      if (changed) {
        setHoles([])
        rt.drill = null
      }
      rt.map = next
      syncOwnIsle()
      if (changed) enteredMap(next)
      rt.player = { pos: { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }, facing, moving: false, walkMs: 0 }
      savePlayer()
      // 섬·집 안 이름은 주인으로(내 섬·내 집·{아이디}의 집)
      const placeLabel = (next.id === 'isle' || next.id === 'home') && go
        ? go.owner === null ? (next.id === 'isle' ? '내 섬' : '내 집') : placeName(placeKey(next.id, go.owner), { selfId: userIdRef.current, players: islePlayers })
        : null
      const name = tr.say ?? placeLabel ?? AREAS.find((a) => a.id === next.id)?.name
      if (name) {
        // 오류 알림이 떠 있으면 덮지 않는다
        setNotice((n) => (n && n.kind !== 'info' ? n : { kind: 'info', text: name }))
        later(() => setNotice((n) => (n?.kind === 'info' && n.text === name ? null : n)), AREA_NOTICE_MS)
      }
    }
    if (tr.ms >= FADE_MS * 2) {
      rt.trans = null
      rt.fade = 0
      return
    }
    rt.fade = tr.ms < FADE_MS ? tr.ms / FADE_MS : 1 - (tr.ms - FADE_MS) / FADE_MS
  }

  /** 서 있는 자리의 상호작용이 바뀌었을 때만 화면 상태를 고친다. */
  function syncHere(dyn: MapDynamic) {
    const at = hereAt(opened, dyn)
    const k = interactionKey(at)
    if (k === rt.hereKey) return
    rt.hereKey = k
    setHere(at)
  }

  function frame(ctx: CanvasRenderingContext2D, now: number) {
    const dt = now - rt.lastFrame
    rt.lastFrame = now
    // 걷기는 대기 중이고 메뉴가 닫혀 있을 때만. 충전부터 결과 표시까지는 자리·방향이 고정된다.
    const wasMoving = rt.player.moving
    let started = false
    const cond = conditionsAt(Date.now() + rt.offset)
    const dyn = dynAt(cond)
    stepDrill(dt)
    if (rt.trans) {
      stepTransition(dt)
    } else if (rt.phase === 'idle' && !menuRef.current && !rt.drill) {
      const input = rt.stick.x !== 0 || rt.stick.y !== 0 ? rt.stick : keysVector(rt.keys)
      rt.player = stepWalk(rt.map, rt.player, input, dt, opened, dyn, shoeSpeed(viewRef.current?.shoesTier ?? 1))
      // 걷는 중에만 출구를 본다(낚시 단계·메뉴·전환 중에는 보지 않는다). 안 연 지역·맵이 없는 지역으로 가는 출구는 무시한다
      const exit = openExitAt(rt.map, rt.player.pos, opened)
      if (exit && mapFor(exit.target, shapeNow())) {
        startTransition(exit.target, exit.entry)
        started = true
      }
    } else if (rt.player.moving) {
      rt.player = { ...rt.player, moving: false, walkMs: 0 }
    }
    // 전환을 시작한 프레임의 출구 칸 위치는 저장하지 않는다(도착 위치만 저장)
    if (wasMoving && !rt.player.moving && !started) savePlayer()
    if (!started) stepTide(cond, dynAt(cond))
    syncHere(dynAt(cond))

    if (rt.phase === 'charging' && !rt.busy) rt.gauge = gaugeAt(now - rt.chargeStart)
    if (rt.phase === 'fighting' && rt.bar && rt.params && !rt.settling) {
      rt.bar = stepBar(rt.bar, rt.held.size > 0, dt, rt.params, Math.random)
      const r = barResult(rt.bar)
      if (r !== 'playing') endFight(r === 'caught', rt.bar.perfect)
    }
    const size = { w: fit.w, h: fit.h }
    const fishing = rt.phase === 'waiting' || rt.phase === 'bite' || rt.phase === 'fighting' || rt.phase === 'lost'
    const { pos } = rt.player
    const camera = cameraFor(rt.map, { x: Math.round(pos.x), y: Math.round(pos.y) }, size)
    // 자랑·이모트 끝내기: 시간이 지나면, 자랑은 걷거나 낚시를 시작하면 바로
    const sh = showRef.current
    const castingNow = rt.phase === 'charging' || rt.phase === 'waiting' || rt.phase === 'bite' || rt.phase === 'fighting'
    if (sh && (Date.now() >= sh.until || (sh.show.kind === 'brag' && (rt.player.moving || castingNow || rt.trans || rt.drill)))) showRef.current = null
    const others = stepOnline(camera)
    drawWorld(ctx, {
      map: rt.map,
      phase: rt.phase,
      tMs: now,
      gauge: rt.gauge,
      player: rt.player,
      // 캐릭터는 반올림한 자리에 그려지므로 카메라도 반올림한 자리를 따라간다(홀수 폭에서 1px 흔들림 방지)
      camera,
      bobber: fishing ? rt.bobber : null,
      bar: rt.bar,
      barParams: rt.params,
      caughtSpecies: rt.caughtSpecies,
      cond,
      hudTop: hudTopFor(touch, fit.scale),
      fade: rt.fade,
      opened,
      teleporterOn: tpOpen(viewRef.current, rt.map.id),
      outfit: outfitOf(viewRef.current),
      dyn: dynAt(cond),
      drill: rt.drill,
      mythicFlashMs: rt.mythicAt === null ? null : now - rt.mythicAt,
      others,
      holding: showRef.current?.show.kind === 'brag' ? showRef.current.show.species : null,
      fame: rt.map.id === 'hall' ? fameFramesRef.current : undefined,
      gallery: rt.map.id === 'hall2' && viewRef.current ? galleryScene(galleryOf(viewRef.current)) : undefined,
      facilities: rt.map.id === 'isle' ? facilitiesHere() : undefined,
      readyNodes: rt.map.id === 'isle' && rt.owner === null ? readyNodesHere(now) : undefined,
    }, size)
  }

  /**
   * 같은 지역 친구: 지금 지역 방에 있게 맞추고(전환 중·첫 상태 전에는 방 없음), 내 상태를 보내고, 친구 목록과 이름표를 돌려준다.
   * 실시간 값은 그리기에만 쓴다. 시계는 Date.now()(방이 받은 시각과 같은 시계).
   */
  function stepOnline(camera: Vec): ScenePeer[] {
    // 장소 키: 지역 id, 섬이면 isle-<주인 id>(내 섬이면 내 id: 손님과 같은 방)
    const place = placeKey(rt.map.id, rt.map.id === 'isle' || rt.map.id === 'home' ? rt.owner ?? profile?.id ?? null : null)
    const want = canOnline && viewRef.current && !rt.trans ? place : null
    const cur = roomRef.current
    if (cur && cur.area !== want) {
      cur.room.leave()
      roomRef.current = null
    }
    if (want && !roomRef.current && profile?.id) roomRef.current = { area: want, room: joinWorldRoom(gameId, want, profile.id) }
    if (canOnline && viewRef.current && !presenceRef.current && profile?.id) {
      const pres = joinWorldPresence(gameId, profile.id, false)
      pres.onChange(() => setOnlinePeers(pres.peers()))
      presenceRef.current = pres
    }
    const room = roomRef.current?.room
    const tags: Tag[] = []
    const out: ScenePeer[] = []
    const mine = showRef.current
    /** 이름표 자리(머리 위, 자랑으로 든 물고기가 있으면 그 위)와 카드·이모트 */
    const tagFor = (id: string, handle: string, x0: number, y0: number, show: Show | null): Tag => {
      const fish = show?.kind === 'brag' ? SPRITES[`fish-${show.species}`] : undefined
      const x = (Math.round(x0) - Math.round(camera.x)) * fit.scale
      const y = (Math.round(y0) - PEER_H - (fish ? fish.h * 2 + 4 : 0) - Math.round(camera.y)) * fit.scale
      const t: Tag = { id, handle, x, y, visible: x >= 0 && x <= fit.w * fit.scale && y >= 0 && y <= fit.h * fit.scale }
      if (show?.kind === 'brag') t.card = bragCard(show)
      if (show?.kind === 'emote') t.emote = show.char
      if (show?.kind === 'chat') t.say = show.text
      return t
    }
    // 내 자랑·이모트는 친구가 없어도 내 화면에 보인다(이름표도 그동안만)
    if (mine && profile?.id && profile.handle && !rt.trans) tags.push(tagFor(profile.id, profile.handle, rt.player.pos.x, rt.player.pos.y, mine.show))
    if (room && profile?.id && profile.handle) {
      const t = Date.now()
      const p = rt.player
      const act = rt.phase === 'charging' || rt.phase === 'waiting' || rt.phase === 'bite' || rt.phase === 'fighting' ? 'fish' : 'walk'
      presenceRef.current?.update({ id: profile.id, handle: profile.handle, area: place, act, ...standTile(rt.map, p.pos) }, t)
      room.tick(t, {
        id: profile.id, handle: profile.handle, x: p.pos.x, y: p.pos.y, facing: p.facing, moving: p.moving, act,
        outfit: JSON.stringify(outfitOf(viewRef.current)),
        ...(mine ? { show: mine.code } : {}),
      })
      const memo = peerOutfits.current
      for (const o of room.peers(t)) {
        let outfit = memo.get(o.outfit)
        if (!outfit) {
          outfit = decodeOutfit(o.outfit)
          if (memo.size > 64) memo.clear()
          memo.set(o.outfit, outfit)
        }
        const show = parseShow(o.show)
        const holding = show?.kind === 'brag' ? show.species : null
        out.push({ pos: { x: o.x, y: o.y }, facing: o.facing, moving: o.moving, walkMs: o.moving ? t : 0, act: o.act, outfit, holding })
        tags.push(tagFor(o.id, o.handle, o.x, o.y, show))
      }
    }
    if (tagsRef.current) syncTags(tagsRef.current, tags)
    return out
  }

  // 이벤트·프레임 콜백이 늘 최신 함수를 부르게 한다
  /** 큰 지도 열고 닫기. 첫 서버 상태 전·지역 전환(페이드) 중에는 열지 않는다(닫기는 늘 된다) */
  const toggleMap = () => {
    if (menuRef.current !== 'map' && (!viewRef.current || rt.trans)) return
    toggleMenu('map')
  }
  const closeMap = () => {
    if (menuRef.current === 'map') closeMenu()
  }
  /** 단축키: 가방·도감·과제는 열고 닫기, 말은 열고 입력칸에 초점, 이모트는 열고 닫기 */
  const hotkey = (k: 'bag' | 'dex' | 'challenges' | 'chat' | 'emote') => {
    if (k === 'chat') {
      setChatHint(null)
      if (chatOpen) chatInputRef.current?.focus()
      else setChatOpen(true)
    } else if (k === 'emote') setEmoteOpen((o) => !o)
    else toggleMenu(k)
  }
  const handlers = useRef({ press, release, frame, toggleMap, closeMap, hotkey })
  handlers.current = { press, release, frame, toggleMap, closeMap, hotkey }

  // ------------------------------------------------------------ 효과
  useEffect(() => {
    alive.current = true
    void load()
    // 섬 이름용 섬 주인 목록(실패하면 "누군가의 섬")
    worldPlayers(gameId, PREVIEW_ISLE_KEY).then((list) => { if (alive.current) setIslePlayers(list) }, () => {})
    const pending = timers.current
    return () => {
      alive.current = false
      for (const id of pending) window.clearTimeout(id)
      pending.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // 화면을 떠나면 장면 배경 캐시(오프스크린 캔버스)를 놓아 준다
  useEffect(() => releaseSceneCache, [])
  // 화면을 떠나면 실시간 방을 나간다
  useEffect(() => () => {
    roomRef.current?.room.leave()
    roomRef.current = null
    presenceRef.current?.leave()
    presenceRef.current = null
  }, [])
  useEffect(() => releaseMinimapCache, [])

  // 마지막 위치: 걸음이 멈출 때(프레임), 탭이 가려질 때, 화면을 떠날 때 저장한다.
  // 창이 초점을 잃거나 가려지면 키·손가락을 뗀 알림을 놓칠 수 있으므로 누르고 있던 입력을 모두 놓는다.
  useEffect(() => {
    const onBlur = () => dropInput()
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      dropInput()
      savePlayer()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      savePlayer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 터치 입력이 있는 기기((any-pointer: coarse))에서만 조이스틱·행동 버튼을 보인다
  useEffect(() => {
    const mq = coarseQuery()
    if (!mq || typeof mq.addEventListener !== 'function') return
    const onChange = () => setTouch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const loaded = view !== null

  // rAF 루프: 마운트돼 있고 탭이 보일 때만 하나 돈다
  useEffect(() => {
    if (!loaded) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    let raf = 0
    let running = false
    const loop = () => {
      raf = requestAnimationFrame(loop)
      handlers.current.frame(ctx, performance.now())
    }
    const start = () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      rt.lastFrame = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    // 숨은 탭은 프레임이 멈춰 위치를 못 보내므로 실시간 방에서도 나간다(남아 있으면 친구가 혼자인데도 보내게 된다).
    // 돌아오면 다음 프레임이 다시 들어간다
    const leaveRoom = () => {
      roomRef.current?.room.leave()
      roomRef.current = null
      presenceRef.current?.leave()
      presenceRef.current = null
      setOnlinePeers([])
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        leaveRoom()
      } else start()
    }
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loaded, rt])

  // 캔버스 크기: 무대 너비와 남은 화면 높이로 fitScene(정수 배율 + 그 배율로 채우는 장면 크기).
  // 무대 위(사이트 머리·제목·골드 줄)는 무대의 문서 위치로, 무대 아래는 늘 있는 가방·메뉴 줄과 간격만 잰다.
  // 안내 줄과 메뉴 창은 캔버스 위에 겹쳐 뜨고, 잠깐 뜨는 알림은 재지 않아 캔버스 크기가 흔들리지 않는다.
  // 캔버스 자신의 높이는 쓰지 않으므로 크기가 바뀌어도 다시 재는 값은 그대로다.
  // 전체화면에서는 화면을 채우는 캔버스 칸(무대) 자신의 상자를 잰다.
  useEffect(() => {
    const el = stageRef.current
    if (!loaded || !el) return
    const available = (): [number, number] => {
      if (fullscreen) return [el.clientWidth, el.clientHeight]
      const bottom = bottomRef.current
      const root = el.parentElement
      const gap = root ? parseFloat(getComputedStyle(root).rowGap) || 0 : 0
      const belowH = (bottom?.offsetHeight ?? 0) + gap
      const stageTop = el.getBoundingClientRect().top + window.scrollY
      return [el.clientWidth, availableHeight(window.innerHeight, stageTop, belowH)]
    }
    const measure = () => {
      const next = fitScene(...available())
      setFit((prev) => (prev.scale === next.scale && prev.w === next.w && prev.h === next.h ? prev : next))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [loaded, fullscreen])

  // 전체화면: 게임 전체가 화면을 덮는 고정 덮개가 된다(아이폰 사파리처럼 요소 전체화면이 없어도 동작).
  // 있는 동안 페이지 스크롤을 막고, Esc(메뉴 창이 없을 때)나 브라우저 전체화면 종료로 나간다.
  // 나가거나 페이지를 떠나면 스크롤을 되돌리고 브라우저 전체화면도 끝낸다.
  // 요소 전체화면 요청이 끝나기 전에 알림이 와도(전체화면 요소 없음) 덮개는 그대로 둔다.
  useEffect(() => {
    if (!fullscreen) return
    const root = rootRef.current
    const html = document.documentElement
    const prevOverflow = html.style.overflow
    html.style.overflow = 'hidden'
    const leave = () => {
      wantFullscreen.current = false
      setFullscreen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !menuRef.current) leave()
    }
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !fullscreenPending.current) leave()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      wantFullscreen.current = false
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      html.style.overflow = prevOverflow
      if (root && document.fullscreenElement === root && typeof document.exitFullscreen === 'function') {
        ignoreRejection(() => document.exitFullscreen())
      }
    }
  }, [fullscreen])

  // 스페이스 키 = 행동. 버튼·입력칸에 초점이 있으면 그쪽 동작에 맡긴다.
  // 방향키·WASD = 걷기. 입력칸에서 칠 때와 메뉴가 열려 있을 때(창 스크롤)는 건드리지 않는다. 떼기는 늘 받는다.
  useEffect(() => {
    const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' '
    const onControl = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.closest('button, a, input, textarea, select') !== null
    const onTextField = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select') !== null)
    const down = (e: KeyboardEvent) => {
      const dir = MOVE_KEYS[e.code]
      if (dir) {
        if (e.ctrlKey || e.metaKey || e.altKey || onTextField(e.target) || menuRef.current) return
        e.preventDefault()
        rt.keys = { ...rt.keys, [dir]: true }
        return
      }
      if (!isSpace(e) || onControl(e.target)) return
      e.preventDefault()
      if (!e.repeat) handlers.current.press('action', 'space')
    }
    const up = (e: KeyboardEvent) => {
      const dir = MOVE_KEYS[e.code]
      if (dir) {
        rt.keys = { ...rt.keys, [dir]: false }
        return
      }
      if (!isSpace(e) || onControl(e.target)) return
      e.preventDefault()
      handlers.current.release('space')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [rt])

  // M 키 = 큰 지도 열고 닫기(e.code라 한글 입력 상태에서도). 입력칸·낚시 중·다른 창이 열려 있으면 무시한다.
  // Esc = 열린 지도 닫기. 캡처 단계에서 받아 멈추므로 전체화면 나가기 등 다른 Esc 처리로 새지 않는다.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || menuRef.current !== 'map') return
      e.preventDefault()
      e.stopImmediatePropagation()
      handlers.current.closeMap()
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  // 단축키(e.code라 한글 입력 상태에서도): M 지도, E 가방, Q 도감, G 과제(다시 누르면 닫기), T 말 입력칸, Y 이모트.
  // 입력칸에서 칠 때·낚시 중·다른 창이 열려 있을 때는 무시한다(말·이모트는 창이 열려 있어도 된다)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = HOTKEYS[e.code]
      if (!k || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select') !== null)) return
      if (rt.phase === 'charging' || rt.phase === 'waiting' || rt.phase === 'bite' || rt.phase === 'fighting') return
      if (k === 'chat' || k === 'emote') {
        e.preventDefault()
        handlers.current.hotkey(k)
        return
      }
      if (menuRef.current && menuRef.current !== k) return
      e.preventDefault()
      if (k === 'map') handlers.current.toggleMap()
      else handlers.current.hotkey(k)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [rt])

  // ------------------------------------------------------------ 메뉴 행동
  async function sell() {
    setNotice(null)
    try {
      const res = await act<{ earned: number }>({ type: 'sell' })
      // 판 금액은 판매 마릿수 감쇠(v15)를 넣은 값이다. 2026-11-25부터 낚시는 사이트 하루 상한을 받지 않아 gold_capped는
      // 보통 오지 않지만, 플랫폼 필드라 오면 들어온 양을 함께 적는다(HUD·헤더는 응답의 지갑 잔액을 쓴다)
      if (alive.current && res.result) {
        const c = res.gold_capped
        const got = c ? ` · 오늘 상한으로 ${gold(c.got)}만 들어왔어요` : ''
        setNotice({ kind: 'info', text: `${gold(res.result.earned)}어치를 팔았어요${got}` })
      }
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  /** 자랑하기: 가방을 닫고 BRAG_MS 동안 든다. 걷거나 던지면 frame이 끝낸다 */
  function brag(index: number) {
    const f = viewRef.current?.bag[index]
    if (!f) return
    const code = encodeBrag(f)
    const show = parseShow(code)
    if (!show) return
    showRef.current = { code, show, until: Date.now() + BRAG_MS }
    closeMenu()
  }

  function emote(id: EmoteId) {
    const code = encodeEmote(id)
    const show = parseShow(code)
    if (show) showRef.current = { code, show, until: Date.now() + EMOTE_MS }
    setEmoteOpen(false)
  }

  /** 말하기: 정리한 말이 비면 무시, 3초에 한 번. 보낸 뒤 입력칸은 비우고 열어 둔다 */
  function chat() {
    const text = cleanChat(chatText)
    if (!text) {
      // 빈 채로 엔터 = 입력칸 닫기(게임으로 초점을 돌려 바로 걷게)
      setChatOpen(false)
      setChatText('')
      setChatHint(null)
      focusGame()
      return
    }
    const now = Date.now()
    if (now - lastChatAt.current < CHAT_GAP_MS) {
      setChatHint('잠시 뒤에 다시 말할 수 있어요')
      return
    }
    const code = encodeChat(text)
    const show = parseShow(code)
    if (!show) return
    lastChatAt.current = now
    showRef.current = { code, show, until: now + CHAT_MS }
    setChatText('')
    setChatHint(null)
  }

  /** 여러 마리 버리기(v21): 요청 한 번 */
  async function discard(indices: number[], fee: number, at: DiscardAt) {
    setNotice(null)
    const bag = viewRef.current?.bag ?? []
    const items = indices.flatMap((index) => (bag[index] ? [{ index, id: bag[index].id, species: bag[index].species, sizeCm: bag[index].sizeCm }] : []))
    if (items.length === 0 || items.length !== indices.length) return
    try {
      const res = await act<{ fee: number; n?: number }>({ type: 'discardMany', items, fee, at })
      if (alive.current && res.result) {
        const n = res.result.n ?? items.length
        setNotice({ kind: 'info', text: `${n > 1 ? `${n}마리 ` : ''}버렸어요 · 환경부담금 ${gold(res.result.fee)}` })
      }
    } catch (e) {
      await failMove(codeOf(e))
    }
  }

  /** 어분 만들기(경제 P1): 고른 일반 물고기를 한 번에 */
  async function grind(indices: number[]) {
    setNotice(null)
    const bag = viewRef.current?.bag ?? []
    const items = indices.flatMap((index) => (bag[index] ? [{ index, id: bag[index].id }] : []))
    if (items.length === 0 || items.length !== indices.length) return
    try {
      const res = await act<{ meal: number }>({ type: 'grind', items })
      if (alive.current && res.result) setNotice({ kind: 'info', text: `어분 ${res.result.meal}개를 만들었어요` })
    } catch (e) {
      await failMove(codeOf(e))
    }
  }

  /** 미끼 만들기·연구 해금(경제 P1). 화면이 본 가격을 함께 보낸다(다르면 price_changed) */
  async function econAct(a: Action, done: string) {
    setNotice(null)
    try {
      await act(a)
      if (alive.current) setNotice({ kind: 'info', text: done })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }
  /** 재포획 기증(경제 P2): 칸 하나 */
  async function donate(index: number) {
    const f = viewRef.current?.bag[index]
    if (!f) return
    setNotice(null)
    try {
      const res = await act<{ donated: number }>({ type: 'donate', index, id: f.id })
      if (alive.current && res.result) setNotice({ kind: 'info', text: `${speciesName(f.species)} 기증 ${res.result.donated}/2` })
    } catch (e) {
      await failMove(codeOf(e))
    }
  }
  /** 지역 재료 추출(경제 P2): 고른 일반 물고기를 한 번에 */
  async function extract(indices: number[]) {
    setNotice(null)
    const bag = viewRef.current?.bag ?? []
    const items = indices.flatMap((index) => (bag[index] ? [{ index, id: bag[index].id }] : []))
    if (items.length === 0 || items.length !== indices.length) return
    try {
      await act({ type: 'extract', items })
      if (alive.current) setNotice({ kind: 'info', text: `${items.length}마리를 재료로 바꿨어요` })
    } catch (e) {
      await failMove(codeOf(e))
    }
  }
  // 1개는 count를 보내지 않는다(옛 서버와 같은 행동)
  const makeBait = (kind: BaitKind, count = 1) => void econAct(
    { type: 'makeBait', kind, price: BAIT_RECIPES[kind].gold, ...(count > 1 ? { count } : {}) },
    count > 1 ? `미끼 ${count}개를 만들었어요` : '미끼를 만들었어요',
  )
  const buyLicense = () => void econAct({ type: 'buyLicense', price: LICENSE_PRICE }, '연구를 해금했어요')

  /** 마을회관 냉장고: 가방 칸 넣기(store)·냉장고 칸 꺼내기(takeOut) */
  async function moveFish(type: 'store' | 'takeOut', index: number) {
    setNotice(null)
    const v = viewRef.current
    const f = type === 'store' ? v?.bag[index] : v?.fridge?.[index]
    if (!f) return
    try {
      await act({ type, index, id: f.id, species: f.species, sizeCm: f.sizeCm })
    } catch (e) {
      await failMove(codeOf(e))
    }
  }

  /** 가방·냉장고 칸 행동 실패: 화면이 본 목록이 서버와 다르면(다른 탭 등) 다시 불러온 뒤 알린다 */
  async function failMove(code: string) {
    if (STALE_CODES.has(code)) await reload()
    if (alive.current) setNotice({ kind: 'error', text: fishingMessage(code) })
  }

  async function lockFish(index: number, locked: boolean) {
    setNotice(null)
    try {
      await act({ type: 'lock', index, id: viewRef.current?.bag[index]?.id, locked })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyRod(tier: number) {
    setNotice(null)
    try {
      await act({ type: 'buyRod', tier, price: RODS.find((r) => r.tier === tier)?.price ?? -1 })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyBag(tier: number) {
    setNotice(null)
    try {
      await act({ type: 'buyBag', tier, price: BAGS.find((b) => b.tier === tier)?.price ?? -1 })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyShoes(tier: number) {
    setNotice(null)
    try {
      await act({ type: 'buyShoes', tier, price: SHOES.find((s) => s.tier === tier)?.price ?? -1 })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyTackle(id: TackleId) {
    setNotice(null)
    try {
      await act({ type: 'buyTackle', id })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyWear(slot: WearSlot, id: string) {
    setNotice(null)
    try {
      await act({ type: 'buyWear', slot, id })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function wear(slot: WearSlot, id: string) {
    setNotice(null)
    try {
      await act({ type: 'wear', slot, id })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function unlock(area: AreaId) {
    setNotice(null)
    try {
      const res = await act({ type: 'unlockArea', area, price: UNLOCKS[area]?.price ?? -1 })
      if (!alive.current) return
      if (!res.view.areas.includes(area)) {
        // 성공 응답인데 지역이 없다: 창을 열어 둔 채 다시 시도하라고 알린다
        setNotice({ kind: 'error', text: RETRY })
        return
      }
      // 열렸다: 창을 닫는다. 문은 다음 프레임부터 열린 지역으로 그려지고 걸을 수 있다
      if (menuRef.current === 'unlock') closeMenu()
      setNotice({ kind: 'info', text: UNLOCK_NOTICES[area] ?? '새 지역을 열었어요' })
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      if (code === 'already_open') {
        // 다른 기기에서 이미 열었다: 창을 닫고 상태를 다시 불러와 문을 연다
        if (menuRef.current === 'unlock') closeMenu()
        setNotice({ kind: 'info', text: fishingMessage(code) })
        await reload()
        return
      }
      // 창은 열어 둔 채 오류만 알린다(상점 구매와 같은 표시). busy는 장비 문구 대신 해금 문구
      setNotice({ kind: 'error', text: code === 'busy' ? UNLOCK_BUSY : fishingMessage(code) })
    }
  }

  /** 순간이동: 서버가 요금을 받으면 창을 닫고 지역 전환(페이드)으로 도착 맵 이동기 앞에 선다 */
  async function teleport(to: AreaId) {
    const from = tpArea
    setNotice(null)
    try {
      await act({ type: 'teleport', from, to })
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      // 창은 열어 둔 채 오류만 알린다
      setNotice({ kind: 'error', text: code === 'busy' ? TELEPORT_BUSY : fishingMessage(code) })
      return
    }
    if (!alive.current) return
    if (menuRef.current === 'teleport') closeMenu()
    const dest = mapFor(to)?.teleporter
    if (!dest) return
    // 요금은 이미 냈으니 도착 자리를 바로 저장한다(맵을 바꾸기 전 새로고침해도 출발지로 돌아가지 않게)
    const id = userIdRef.current
    const { tx, ty, facing } = dest.front
    if (id !== null && placed.current) savePosition(id, { area: to, pos: { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }, facing })
    startTransition(to, dest.front)
  }

  /** 진행 중인 낚시는 건드리지 않고 view만 다시 불러온다. 실패하면 오류 알림 */
  async function reload() {
    try {
      await send({ game: gameId, action: 'load' })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function equip(ids: TackleId[]) {
    setNotice(null)
    try {
      await act({ type: 'equip', ids })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  /** 상점·해금 창이 막 열렸으면 누르기·클릭을 버린다(여는 손가락의 유령 클릭 방지) */
  const guardPanel = (e: SyntheticEvent) => {
    const m = menuRef.current
    if (m && GUARDED.has(m) && performance.now() - panelOpenedAt.current < PANEL_GUARD_MS) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const toggleMenu = (m: Menu) => {
    focusGame()
    setMenu(menuRef.current === m ? null : m)
  }
  const closeMenu = () => {
    focusGame()
    setMenu(null)
  }

  function toggleFullscreen() {
    const root = rootRef.current
    focusGame()
    if (fullscreen) {
      wantFullscreen.current = false
      setFullscreen(false)
      return
    }
    wantFullscreen.current = true
    setFullscreen(true)
    // 데스크톱·안드로이드에서는 브라우저 화면 요소까지 숨긴다. 거절돼도 덮개는 그대로 쓴다.
    // 요청이 끝나기 전에 나갔으면(또는 화면을 떠났으면) 끝난 뒤 브라우저 전체화면도 끝낸다.
    if (root && typeof root.requestFullscreen === 'function') {
      fullscreenPending.current = true
      const settle = () => {
        fullscreenPending.current = false
      }
      ignoreRejection(() =>
        Promise.resolve(root.requestFullscreen()).then(() => {
          settle()
          if (!wantFullscreen.current && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
            ignoreRejection(() => document.exitFullscreen())
          }
        }, settle),
      )
    }
  }

  // ------------------------------------------------------------ 그리기
  if (!view) {
    if (loadError) {
      return (
        <section className="fish">
          <p className="notice" role="alert">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            다시 시도
          </button>
        </section>
      )
    }
    return <p className="muted">불러오는 중…</p>
  }

  const notices = notice && (
    <>
      {notice.kind === 'bag_full' && (
        <p className="notice" role="alert">가방이 가득 찼어요. 상점에 가서 팔아 주세요</p>
      )}
      {notice.kind === 'error' && <p className="notice" role="alert">{notice.text}</p>}
      {notice.kind === 'info' && <p className="fish-info">{notice.text}</p>}
    </>
  )
  const menuLocked = phase === 'charging' || phase === 'waiting' || phase === 'bite' || phase === 'fighting'
  // 전체화면에서는 알림이 캔버스에 겹쳐 뜨므로(데스크톱은 아래쪽, 터치는 조작을 가리지 않게 위쪽) 그동안 안내 줄은 숨긴다.
  // 터치에서는 아래쪽에 조작이 있으므로 안내 줄을 위에 띄우고, 대기 중 안내는 데스크톱에만 둔다.
  const placeAction = here?.kind === 'gate' ? GATE_ACTION
    : here?.kind === 'dock' ? DOCK_ACTION
      : here?.kind === 'teleporter' ? (tpOpen(view, rt.map.id) ? TELEPORT_ACTION : GATE_ACTION)
        : here?.kind === 'drill' ? DRILL_ACTION
          : here?.kind === 'node' ? (here.res === 'tree' ? '베기' : '캐기')
            : here?.kind === 'furnSpot' || here?.kind === 'decoSpot' ? '놓기'
              : here?.kind === 'furn' || here?.kind === 'decoHere' ? '치우기'
            : here && !deadFame(here) ? FIXTURE_ACTION[here.kind] ?? null
            : null
  const idleHint = touch ? undefined : placeAction ? `방향키로 이동 · 스페이스로 ${placeAction}` : DESKTOP_IDLE_HINT
  const hint = menu || (fullscreen && notices) ? null : phase === 'idle' ? idleHint : HINTS[phase]
  const atShop = here?.kind === 'shop'
  const atWardrobe = here?.kind === 'wardrobe'
  // 낚시가 시작되면(충전~결과) 챔·감기를 위해 늘 누를 수 있다
  const action: ActionState =
    phase !== 'idle' ? { label: '낚시', enabled: true }
      : atShop ? { label: '상점', enabled: true }
        : placeAction ? { label: placeAction, enabled: true }
          : here?.kind === 'fish' ? { label: '낚시', enabled: true }
            : { label: '낚시', enabled: false }
  const unlockName = unlockTarget ? AREAS.find((a) => a.id === unlockTarget)?.name ?? unlockTarget : ''
  const PANEL_TITLES: Record<Menu, string> = {
    gallery: '전시관', bag: '가방', shop: '상점', wardrobe: '옷장', fame: '명예의 전당', elevator: '엘리베이터', fridge: '냉장고', trash: '쓰레기통', boat: '배', isle: '섬 고르기', workbench: '작업대', furn: '가구 놓기', deco: '꾸미기 놓기', unlock: unlockName, dex: '도감', challenges: '도전과제', map: '지도', teleport: `${areaNameOf(tpArea)} 순간이동기`,
  }
  const panelTitle = menu ? PANEL_TITLES[menu] : ''

  return (
    <section className={fullscreen ? 'fish fish-full' : 'fish'} ref={rootRef} tabIndex={-1}>
      <div className="fish-top">
        <strong className="fish-gold">{gold(view.gold)}</strong>
      </div>

      <div className="fish-stage" ref={stageRef}>
        <div className="fish-frame" style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }}>
          <canvas
            ref={canvasRef}
            className="fish-canvas"
            aria-label="낚시터"
            width={fit.w}
            height={fit.h}
            style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }}
            onPointerDown={(e) => {
              e.preventDefault()
              try {
                e.currentTarget.setPointerCapture?.(e.pointerId)
              } catch {
                /* 포인터 캡처를 못 해도 입력은 받는다 */
              }
              handlers.current.press('canvas', `canvas:${e.pointerId}`)
            }}
            onPointerUp={(e) => handlers.current.release(`canvas:${e.pointerId}`)}
            onPointerCancel={(e) => handlers.current.release(`canvas:${e.pointerId}`)}
            onLostPointerCapture={(e) => handlers.current.release(`canvas:${e.pointerId}`)}
          />
          <div className="fish-peer-tags" ref={tagsRef} aria-hidden="true" />
          {touch && !menu && (
            <Controls
              onMove={(v) => {
                rt.stick = v
              }}
              action={action}
              onActionDown={() => handlers.current.press('action', 'button')}
              onActionUp={() => handlers.current.release('button')}
              // 결과 표시 중에 잡은 조이스틱은 걷기로 잡아 두면 대기로 돌아오자마자 걷는다(프레임은 대기에서만 걷는다)
              walking={phase === 'idle' || phase === 'caught' || phase === 'lost'}
              // 입질 전(대기)에는 조이스틱을 만지작거려도 일찍 챈 것으로 치지 않는다. 챔·감기는 입질·싸움에서만
              onTapDown={(id) => {
                if (rt.phase !== 'waiting') handlers.current.press('canvas', `stick:${id}`)
              }}
              onTapUp={(id) => handlers.current.release(`stick:${id}`)}
            />
          )}
          {outcome && (
            <div className={`fish-toast${outcome.kind === 'caught' && isLegend(outcome.fish.species) ? ' fish-toast-wrap' : ''}`} aria-live="polite">
              {outcome.kind === 'caught' ? (
                <>
                  {isMythic(outcome.fish.species) ? (
                    <strong className="fish-new fish-toast-mythic">
                      <img src={spriteDataUrl('mythic-badge', 2)} alt="" />
                      신화의 물고기!
                    </strong>
                  ) : isLegend(outcome.fish.species) ? (
                    <strong className="fish-new fish-toast-legend">전설의 물고기!</strong>
                  ) : (
                    outcome.isNew && <strong className="fish-new">새로운 물고기!</strong>
                  )}
                  <span>
                    {speciesName(outcome.fish.species)} {outcome.fish.sizeCm}cm
                    {outcome.fish.perfect ? ' · 완벽!' : ''}
                  </span>
                  {isLegend(outcome.fish.species) && <span className="muted">세이브당 한 마리 · 가방에 잠가 뒀어요</span>}
                  {outcome.buff && (() => {
                    const b = BUFFS.find((x) => x.id === outcome.buff)!
                    return <span className="fish-toast-buff">{`새 힘: ${b.name} — ${b.desc}`}</span>
                  })()}
                  {safePrice(outcome.fish, view.buffs ?? []) !== null && <span className="fish-toast-price">{gold(safePrice(outcome.fish, view.buffs ?? [])!)}</span>}
                </>
              ) : (
                <span>{outcome.early ? '너무 일찍 챘어요' : '놓쳤어요'}</span>
              )}
            </div>
          )}
          {hint && !outcome && <p className={touch ? 'fish-hint fish-hint-top' : 'fish-hint'}>{hint}</p>}
          {menu && (
            <div
              className="fish-panel"
              onPointerDownCapture={guardPanel}
              onPointerUpCapture={guardPanel}
              onClickCapture={guardPanel}
            >
              <div className="fish-panel-head">
                <h3 className="fish-panel-title">{panelTitle}</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeMenu}>
                  닫기
                </button>
              </div>
              {menu === 'bag' && (
                <BagPanel
                  view={view}
                  atShop={atShop}
                  busy={busy}
                  onEquip={(ids) => void equip(ids)}
                  onLock={(i, l) => void lockFish(i, l)}
                  onWardrobe={() => setMenu('wardrobe')}
                  onBrag={brag}
                  onDiscard={(is, fee, at) => void discard(is, fee, at)}
                  {...(featureOn('bait')
                    ? {
                        onGrind: (is: number[]) => void grind(is),
                        ...(featureOn('exhibit') ? { onDonate: (i: number) => void donate(i) } : {}),
                        ...(featureOn('alchemy') && stageB(galleryOf(view)) ? { onExtract: (is: number[]) => void extract(is) } : {}),
                        econ: (
                          <EconSection
                            view={view}
                            busy={busy}
                            research={featureOn('research')}
                            selected={castBait}
                            onSelect={setCastBait}
                            onMake={makeBait}
                            onLicense={buyLicense}
                            {...(featureOn('exhibit') ? { onOpenGallery: () => setMenu('gallery') } : {})}
                          />
                        ),
                      }
                    : {})}
                />
              )}
              {menu === 'gallery' && featureOn('exhibit') && <GalleryPanel view={view} busy={busy} onAct={(a, done) => void econAct(a, done)} />}
              {menu === 'trash' && (
                <BagPanel view={view} atShop={false} busy={busy} discardAt="trash" onEquip={(ids) => void equip(ids)} onLock={(i, l) => void lockFish(i, l)} onDiscard={(is, fee, at) => void discard(is, fee, at)} />
              )}
              {menu === 'fridge' && (
                <FridgePanel view={view} busy={busy} onStore={(i) => void moveFish('store', i)} onTakeOut={(i) => void moveFish('takeOut', i)} />
              )}
              {menu === 'shop' && (
                <ShopPanel
                  view={view}
                  busy={busy}
                  onSell={() => void sell()}
                  onBuy={(t) => void buyRod(t)}
                  onBuyBag={(t) => void buyBag(t)}
                  onBuyShoes={(t) => void buyShoes(t)}
                  onBuyTackle={(id) => void buyTackle(id)}
                />
              )}
              {menu === 'wardrobe' && (
                <WardrobePanel view={view} canBuy={atWardrobe} busy={busy} onWear={(sl, id) => void wear(sl, id)} onBuy={(sl, id) => void buyWear(sl, id)} />
              )}
              {menu === 'fame' && (
                <FamePanel
                  key={`${fameSlot ? JSON.stringify(fameSlot) : ''}-${hof ? 1 : 0}`}
                  boards={hof ? allBoards(hof, gameId) : null}
                  start={hof && fameSlot ? boardIndexFor(hof, gameId, fameSlot) ?? 0 : 0}
                  error={hofError}
                />
              )}
              {menu === 'elevator' && <ElevatorPanel here={rt.map.id} canGo={(a) => opened.has(a)} onGo={(a) => { closeMenu(); startTransition(a, HALL_ELEVATOR_ENTRY) }} />}
              {menu === 'boat' && (
                <BoatPanel
                  busy={busy}
                  friends={boatFriends}
                  note={boatNote}
                  onIsland={boatIsland}
                  onMine={boatMine}
                  onFriends={() => void boatFriendList()}
                  onFriend={(p) => void visitFriend(p)}
                />
              )}
              {menu === 'isle' && <IsleChoosePanel busy={busy} onChoose={(l) => void chooseIsle(l)} />}
              {menu === 'deco' && (
                <DecoPanel
                  box={view.isle?.decoBox ?? {}}
                  busy={busy}
                  allowed={(id) => {
                    const sh = shapeOf(view.isle)
                    const sp = furnSpotRef.current
                    return !!sh && !!sp && canDecorate(sh, sp.tx, sp.ty, id)
                  }}
                  onPick={placeDeco}
                />
              )}
              {menu === 'furn' && <FurnPanel furniture={view.isle?.furniture ?? {}} busy={busy} onPick={placeFurn} />}
              {menu === 'workbench' && view.isle && !(view.isle.tools && view.isle.mats && view.isle.furniture && view.isle.decoBox && typeof view.isle.house === 'number') && (
                <p className="muted">게임이 새 버전으로 바뀌는 중이에요. 잠시 뒤 새로고침해 주세요</p>
              )}
              {menu === 'workbench' && view.isle?.tools && view.isle.mats && view.isle.furniture && view.isle.decoBox && typeof view.isle.house === 'number' && (
                <WorkbenchPanel
                  isle={view.isle}
                  gold={view.gold}
                  busy={busy}
                  onCraft={(t, tier, p) => void craftTool(t, tier, p)}
                  onClear={(z, p) => void clearIsle(z, p)}
                  onBuild={(level, price) => void ownAct({ type: 'build', level, price })}
                  onMake={(id, price) => void ownAct({ type: 'makeFurn', id, price })}
                  onMakeDeco={(id, price) => void ownAct({ type: 'makeDeco', id, price })}
                />
              )}
              {menu === 'unlock' && unlockTarget && (
                <UnlockPanel view={view} area={unlockTarget} busy={busy} onUnlock={() => void unlock(unlockTarget)} />
              )}
              {menu === 'dex' && <DexPanel view={view} currentArea={rt.map.id} />}
              {menu === 'challenges' && <ChallengePanel view={view} />}
              {menu === 'map' && (
                <MapPanel
                  view={view}
                  here={mapHere(rt.map, rt.player, (a) => mapFor(a, shapeNow()))}
                  now={serverNow}
                  innerWidth={fit.w * fit.scale - 2 * PANEL_PAD}
                  layers={mapLayers}
                  onLayers={setMapLayers}
                  online={onlinePeers}
                  names={{ selfId: userId, players: islePlayers }}
                  place={placeKey(rt.map.id, rt.map.id === 'isle' ? rt.owner ?? userId : null)}
                />
              )}
              {menu === 'teleport' && (
                <TeleportPanel view={view} area={tpArea} busy={busy} onTeleport={(to) => void teleport(to)} />
              )}
            </div>
          )}
          {fullscreen && notices && <div className={touch ? 'fish-notices fish-notices-top' : 'fish-notices'}>{notices}</div>}
        </div>
      </div>

      {!fullscreen && notices}

      <div className="fish-bottom" ref={bottomRef}>
        {chatOpen && (
          <form
            className="fish-chat"
            onSubmit={(e) => {
              e.preventDefault()
              chat()
            }}
          >
            <input
              ref={chatInputRef}
              autoFocus
              className="input"
              type="text"
              aria-label="할 말"
              placeholder="같은 지역 친구에게 5초 동안 보여요"
              maxLength={CHAT_MAX}
              value={chatText}
              enterKeyHint="send"
              autoComplete="off"
              onChange={(e) => setChatText(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm">
              보내기
            </button>
            {chatHint && <p className="fish-shop-note" role="status">{chatHint}</p>}
          </form>
        )}
        {emoteOpen && (
          <div className="fish-emotes" role="group" aria-label="이모트">
            {EMOTES.map((e) => (
              <button key={e.id} type="button" className="btn btn-ghost btn-sm" onClick={() => emote(e.id)}>
                {e.char}
              </button>
            ))}
          </div>
        )}
        <span className="fish-bag-count">
          가방 <strong>{view.bag.length}/{bagSize(view.bagTier)}</strong>
        </span>
        <div className="fish-menu">
          {(['bag', 'dex', 'challenges', 'map'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${menu === m ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={menu === m}
              disabled={menuLocked}
              title={`단축키 ${HOTKEY_LABEL[m]}`}
              aria-keyshortcuts={HOTKEY_LABEL[m]}
              onClick={() => (m === 'map' ? toggleMap() : toggleMenu(m))}
            >
              {MENU_LABELS[m]}
            </button>
          ))}
          <button
            type="button"
            className={`btn btn-sm ${chatOpen ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={chatOpen}
            aria-expanded={chatOpen}
            title="단축키 T"
            aria-keyshortcuts="T"
            onClick={() => {
              setChatOpen((o) => !o)
              setChatHint(null)
            }}
          >
            말
          </button>
          {onOwnIsle && (
            <button
              type="button"
              className={`btn btn-sm ${decoMode ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={decoMode}
              onClick={() => {
                decoModeRef.current = !decoModeRef.current
                setDecoMode(decoModeRef.current)
                focusGame()
              }}
            >
              꾸미기
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${emoteOpen ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={emoteOpen}
            aria-expanded={emoteOpen}
            title="단축키 Y"
            aria-keyshortcuts="Y"
            onClick={() => setEmoteOpen((o) => !o)}
          >
            이모트
          </button>
          <button
            type="button"
            className={`btn btn-sm ${fullscreen ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={fullscreen}
            disabled={phase === 'fighting'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? '나가기' : '전체화면'}
          </button>
        </div>
      </div>
    </section>
  )
}
