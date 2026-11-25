// 메인 화면 밸리 미리보기(메인 미리보기 설계 §5). 플랫폼 HomePage가 getWorldPreview로 찾는다.
// 조작 없음: 마지막 자리에 지금 옷차림으로 서 있는 캐릭터를 게임 시계의 낮밤·날씨와 함께 그린다.
// 맑은 날은 게임 10분(실제 10초)마다, 비·눈이면 100ms마다 다시 그리고, 탭이 숨거나 화면 밖이면 멈춘다.
// 캔버스 내부 색은 낚시 캔버스 예외. 링크·접근 이름은 부모(HomePage)가 단다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { worldPlayers, type WorldPlayer } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import type { WorldPreviewProps } from '../ui.ts'
import { conditionsAt, tideAt } from './clock.ts'
import { mapFor } from './maps/index.ts'
import { VILLAGE } from './maps/village.ts'
import { loadPosition } from './position.ts'
import { PREVIEW_ISLE_KEY } from './logic.ts'
import { onlineSummary, previewScale, previewState, redrawDelayMs } from './preview.ts'
import { drawWorld, releaseSceneCache } from './scene.ts'
import { cameraFor } from './walk.ts'

export function Preview({ userId, records, size, onFail, online }: WorldPreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useMemo(() => previewState(loadPosition(userId), records), [userId, records])
  const scale = previewScale(size)
  const side = Math.max(1, Math.floor(size / scale))
  const failRef = useRef(onFail)
  failRef.current = onFail
  // 섬에 있는 친구를 "{아이디}의 섬"으로 쓰려고 섬 주인 목록을 한 번 받는다(실패하면 "누군가의 섬")
  const [players, setPlayers] = useState<readonly WorldPlayer[]>([])
  useEffect(() => {
    let live = true
    worldPlayers('fishing', PREVIEW_ISLE_KEY).then((p) => { if (live) setPlayers(p) }, () => {})
    return () => { live = false }
  }, [])

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d') ?? null
    if (!canvas || !ctx) {
      failRef.current()
      return
    }
    ctx.imageSmoothingEnabled = false
    const map = mapFor(st.area, st.isle, st.isleCleared) ?? VILLAGE
    const view = { w: side, h: side }
    let timer: ReturnType<typeof setTimeout> | null = null
    let onScreen = true
    let dead = false

    const stop = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const shown = () => onScreen && !document.hidden

    const draw = () => {
      timer = null
      if (dead || !shown()) return
      const t = now()
      const cond = conditionsAt(t)
      try {
        drawWorld(ctx, {
          map,
          phase: 'idle',
          tMs: t,
          gauge: 0,
          player: st.player,
          camera: cameraFor(map, { x: Math.round(st.player.pos.x), y: Math.round(st.player.pos.y) }, view),
          bobber: null,
          bar: null,
          barParams: null,
          caughtSpecies: null,
          cond,
          hudTop: 0,
          fade: 0,
          opened: st.opened,
          teleporterOn: false,
          outfit: st.outfit,
          dyn: { tide: tideAt(cond.gameMinute), holes: new Set<string>() },
          drill: null,
          mythicFlashMs: null,
        }, view)
      } catch {
        dead = true
        failRef.current()
        return
      }
      timer = setTimeout(draw, redrawDelayMs(cond, t))
    }
    const resume = () => {
      stop()
      draw()
    }

    const onVisibility = () => (document.hidden ? stop() : resume())
    document.addEventListener('visibilitychange', onVisibility)
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        const next = entries.some((e) => e.isIntersecting)
        if (next === onScreen) return
        onScreen = next
        if (next) resume()
        else stop()
      })
      : null
    io?.observe(canvas)
    draw()

    return () => {
      dead = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      io?.disconnect()
      releaseSceneCache()
    }
  }, [st, side, scale])

  const summary = onlineSummary(online ?? [], { selfId: userId, players })
  return (
    <>
      {summary && <p className="home-valley-online">{summary}</p>}
      <canvas
      ref={ref}
      className="fish-preview-canvas"
      width={side}
      height={side}
      style={{ width: side * scale, height: side * scale, imageRendering: 'pixelated', display: 'block' }}
      aria-hidden="true"
      />
    </>
  )
}
