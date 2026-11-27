import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { now } from '../../lib/serverTime.ts'
import { brandMessages, SITE_NAME } from './brandTicker.ts'

export const BRAND_INTERVAL_MS = 4000
const LEAVE_MS = 400 // theme.css의 brand-leave 애니메이션 길이와 같게

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Brand() {
  const [tick, setTick] = useState(0)
  const [leaving, setLeaving] = useState<string | null>(null)
  const tickRef = useRef(0)
  // 문구 목록은 바뀔 때마다 다시 계산한다. 자정을 넘기면 새로고침 없이 D-n이 줄어든다
  const messages = brandMessages(now())
  const current = messages[tick % messages.length]
  const rotating = messages.length > 1

  useEffect(() => {
    if (!rotating) return
    const id = window.setInterval(() => {
      const list = brandMessages(now())
      const prev = list[tickRef.current % list.length]
      tickRef.current += 1
      setLeaving(prefersReducedMotion() ? null : prev)
      setTick(tickRef.current)
    }, BRAND_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [rotating])

  useEffect(() => {
    if (leaving === null) return
    const id = window.setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [leaving, tick])

  const note = (text: string) => (text === SITE_NAME ? '' : ' app-wordmark--note')

  // 칸 폭은 전역일 문구 폭으로 고정하고(보이지 않는 기준 글자), 사이트 이름은 그 폭에 맞게 줄인다.
  // 문구가 바뀌어도 헤더 폭이 그대로라 작은 화면에서 스크롤바가 생겼다 사라지지 않는다.
  // 글꼴이 기기마다 달라 실제 폭을 재서 비율(--brand-fit, 최대 1)로 줄인다.
  const noteText = messages.find((m) => m !== SITE_NAME) ?? null
  const tickerRef = useRef<HTMLSpanElement>(null)
  const sizerRef = useRef<HTMLSpanElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const ticker = tickerRef.current
    const sizer = sizerRef.current
    const name = nameRef.current
    if (!ticker || !sizer || !name) return
    const fit = () => {
      const w = name.getBoundingClientRect().width
      const f = w > 0 ? Math.min(1, sizer.getBoundingClientRect().width / w) : 1
      ticker.style.setProperty('--brand-fit', f.toFixed(3))
    }
    fit()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(fit) // 웹 글꼴이 늦게 들어와 폭이 바뀌어도 다시 잰다
    ro.observe(sizer)
    ro.observe(name)
    return () => ro.disconnect()
  }, [noteText])

  return (
    <h1 className="app-title" aria-label={SITE_NAME}>
      <img className="app-logo" src="/logo.png" alt="" width={145} height={96} />
      <span className="brand-ticker" aria-hidden="true" ref={tickerRef}>
        {noteText !== null && (
          <>
            {/* 글자는 CSS content(attr)로 그린다: 폭만 차지하고 문서 텍스트에는 두 번 나오지 않게 */}
            <span ref={sizerRef} className="brand-sizer app-wordmark--note" data-text={noteText} />
            <span ref={nameRef} className="brand-sizer brand-sizer-name" data-text={SITE_NAME} />
          </>
        )}
        {leaving !== null && (
          <span key={`l${tick}`} className={`app-wordmark is-leaving${note(leaving)}`}>{leaving}</span>
        )}
        <span key={`c${tick}`} className={`app-wordmark is-current${tick > 0 && leaving !== null ? ' is-entering' : ''}${note(current)}`}>
          {current}
        </span>
      </span>
    </h1>
  )
}
