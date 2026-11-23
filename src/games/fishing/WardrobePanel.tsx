// 옷장 창(설계 2026-11-24-fishing-wardrobe §9). 값과 규칙은 서버 view와 공용 wardrobe.ts를 그대로 쓰고, 행동은 콜백으로만 올린다.
// 미리보기·작은 그림은 캔버스(캔버스 내부 색은 낚시 캔버스 예외). 캔버스 밖 색은 theme 토큰만.
import { useEffect, useRef, useState } from 'react'
import type { View } from './logic.ts'
import { composePose, normalizeOutfit, outfitKey, playerSprites } from './outfit.ts'
import { drawSpriteData, type Sprite } from './sprites.ts'
import { isShopItem, ownsWear, SLOT_NAMES, unlockText, WEAR, WEAR_SLOTS, type Outfit, type WearItem, type WearSlot } from './wardrobe.ts'

const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const PREVIEW_SCALE = 5
const THUMB_SCALE = 2
/** 미리보기 배경(풀밭). 캔버스 내부 색 */
const PREVIEW_BG = '#6fa85a'
/** 돌려 보기 순서: 앞 → 오른쪽 → 뒤 → 왼쪽 */
const TURNS: { pose: string; flipX: boolean; label: string }[] = [
  { pose: 'player-idle-down', flipX: false, label: '앞' },
  { pose: 'player-idle-side', flipX: false, label: '오른쪽' },
  { pose: 'player-idle-up', flipX: false, label: '뒤' },
  { pose: 'player-idle-side', flipX: true, label: '왼쪽' },
]

const thumbCache = new Map<string, string>()
/** 품목 하나를 입혀 본 앞모습 PNG. (옷차림, 배율)마다 한 번만 만든다. 캔버스가 없으면(테스트) 빈 문자열 */
function thumbUrl(outfit: Outfit): string {
  const key = `${outfitKey(outfit)}|${THUMB_SCALE}`
  const hit = thumbCache.get(key)
  if (hit !== undefined) return hit
  const sp = composePose('player-idle-down', outfit)
  const canvas = document.createElement('canvas')
  canvas.width = sp.w * THUMB_SCALE
  canvas.height = sp.h * THUMB_SCALE
  const ctx = canvas.getContext('2d')
  const url = ctx ? (drawSpriteData(ctx, sp, 0, 0, THUMB_SCALE), canvas.toDataURL('image/png')) : ''
  thumbCache.set(key, url)
  return url
}

/** 큰 미리보기: 옷차림이 바뀔 때만 다시 그린다(그림은 playerSprites 캐시) */
function Preview({ outfit, turn }: { outfit: Outfit; turn: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const t = TURNS[turn]
  const sp: Sprite = playerSprites(outfit)[t.pose]
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = PREVIEW_BG
    ctx.fillRect(0, 0, (sp.w + 4) * PREVIEW_SCALE, (sp.h + 2) * PREVIEW_SCALE)
    drawSpriteData(ctx, sp, 2 * PREVIEW_SCALE, PREVIEW_SCALE, PREVIEW_SCALE, t.flipX ? { flipX: true } : undefined)
  }, [sp, t.flipX])
  return (
    <canvas
      ref={ref}
      className="fish-wear-preview"
      width={(sp.w + 4) * PREVIEW_SCALE}
      height={(sp.h + 2) * PREVIEW_SCALE}
      aria-label={`캐릭터 미리보기 (${t.label})`}
      role="img"
    />
  )
}

type Props = {
  view: View
  /** 상점 문 앞인가. 아니면 사기 버튼을 끄고 어디서 사는지 알려 준다 */
  atShop: boolean
  busy: boolean
  onWear(slot: WearSlot, id: string): void
  onBuy(slot: WearSlot, id: string): void
}

export function WardrobePanel({ view, atShop, busy, onWear, onBuy }: Props) {
  const [slot, setSlot] = useState<WearSlot>('hat')
  const [picked, setPicked] = useState<string | null>(null)
  const [turn, setTurn] = useState(0)
  // 옛 서버 응답(옷장 필드 없음)에도 죽지 않게 기본값으로 읽는다
  const facts = { wardrobe: view.wardrobe ?? [], legends: view.legends ?? [], challenges: view.challenges ?? {}, dex: view.dex ?? {} }
  const worn = normalizeOutfit(view.outfit)
  const items = WEAR.filter((w) => w.slot === slot)
  const pickedItem = items.find((w) => w.id === picked) ?? null
  const preview: Outfit = pickedItem ? { ...worn, [slot]: pickedItem.id } : worn

  const status = (w: WearItem) => {
    if (worn[w.slot] === w.id) return <span className="fish-rod-state">입는 중</span>
    if (ownsWear(facts, w.slot, w.id)) {
      return (
        <button type="button" className="btn btn-primary btn-sm" aria-label={`${w.name} 입기`} disabled={busy} onClick={() => onWear(w.slot, w.id)}>
          입기
        </button>
      )
    }
    if (w.unlock) return <span className="muted fish-wear-lock">업적</span>
    return (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        aria-label={`${w.name} 사기`}
        disabled={busy || !atShop || view.gold < w.price}
        onClick={() => onBuy(w.slot, w.id)}
      >
        사기
      </button>
    )
  }

  return (
    <section className="fish-panel-body" aria-label="옷장">
      <div className="fish-wear-top">
        <Preview outfit={preview} turn={turn} />
        <div className="fish-wear-side">
          <strong>{pickedItem ? pickedItem.name : '지금 옷차림'}</strong>
          {pickedItem && worn[slot] !== pickedItem.id && <span className="muted">입혀 보는 중</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTurn((n) => (n + 1) % TURNS.length)}>
            돌려 보기
          </button>
          <span className="muted">보유 {gold(view.gold)}</span>
        </div>
      </div>
      {!atShop && <p className="fish-shop-note">옷은 상점에서 살 수 있어요 · 가진 옷은 어디서나 입어요</p>}
      <div className="fish-dex-tabs" role="tablist" aria-label="부위">
        {WEAR_SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === slot}
            className={`fish-dex-tab${s === slot ? ' fish-dex-tab-on' : ''}`}
            onClick={() => {
              setSlot(s)
              setPicked(null)
            }}
          >
            {SLOT_NAMES[s]}
          </button>
        ))}
      </div>
      <ul className="fish-rods" aria-label={`${SLOT_NAMES[slot]} 목록`}>
        {items.map((w) => {
          const owned = ownsWear(facts, w.slot, w.id)
          const thumb = thumbUrl({ ...worn, [w.slot]: w.id })
          return (
            <li key={w.id} className={`fish-rod${w.id === picked ? ' fish-wear-picked' : ''}`}>
              <button
                type="button"
                className="fish-wear-pick"
                aria-pressed={w.id === picked}
                aria-label={`${w.name} 입혀 보기`}
                onClick={() => setPicked(w.id === picked ? null : w.id)}
              >
                {thumb && <img src={thumb} alt="" />}
                <span className="fish-rod-info">
                  <strong>{w.name}</strong>
                  {owned ? (
                    <span className="muted">{w.price === 0 && !w.unlock ? '기본' : '보유'}</span>
                  ) : w.unlock ? (
                    <span className="muted">{unlockText(w.unlock)}</span>
                  ) : (
                    <span className="muted">{gold(w.price)}</span>
                  )}
                  {!owned && isShopItem(w) && atShop && view.gold < w.price && <span className="fish-shop-note">골드가 부족해요</span>}
                </span>
              </button>
              {status(w)}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
