import { useEffect, useRef, useState } from 'react'
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

  return (
    <h1 className="app-title" aria-label={SITE_NAME}>
      <img className="app-logo" src="/logo.png" alt="" width={145} height={96} />
      <span className="brand-ticker" aria-hidden="true">
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
