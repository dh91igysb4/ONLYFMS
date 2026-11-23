// 터치 조작: 왼쪽 아래 조이스틱, 오른쪽 아래 행동 버튼. 캔버스 위에 겹쳐 뜬다.
// 두 조작은 각자 잡은 손가락(pointerId)만 따라가므로 한 손가락으로 걸으면서 다른 손가락으로 누를 수 있다.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { joystickVector, type MoveInput } from './walk.ts'

/** 조이스틱을 끝까지 미는 거리(CSS px). 손잡이도 이만큼까지만 따라간다. */
const STICK_RADIUS = 36
const STOP: MoveInput = { x: 0, y: 0 }

export type ActionState = { label: '낚시' | '상점'; enabled: true } | { label: '낚시'; enabled: false }

type Props = {
  /** 조이스틱 입력(길이 ≤ 1). 놓으면 {0,0} */
  onMove(v: MoveInput): void
  action: ActionState
  onActionDown(): void
  onActionUp(): void
}

function capture(e: ReactPointerEvent<HTMLElement>): void {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    /* 포인터 캡처를 못 해도 입력은 받는다 */
  }
}

export function Controls({ onMove, action, onActionDown, onActionUp }: Props) {
  // 조이스틱: 누른 자리가 중심. 새 손가락이 누르면 그 손가락으로 넘어간다(떼는 알림을 놓쳐도 갇히지 않게).
  const stickId = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const actionId = useRef<number | null>(null)
  const [pressed, setPressed] = useState(false)

  // 최신 콜백을 창 이벤트·정리 함수에서 부르기 위해
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const resetStick = () => {
    stickId.current = null
    setKnob({ x: 0, y: 0 })
    onMoveRef.current(STOP)
  }

  // 창이 초점을 잃으면 손가락을 뗀 알림이 오지 않을 수 있다. 화면을 떠날 때도 멈춘다.
  useEffect(() => {
    const onBlur = () => {
      if (stickId.current !== null) resetStick()
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      if (stickId.current !== null) onMoveRef.current(STOP)
    }
  }, [])

  const stickDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    capture(e)
    stickId.current = e.pointerId
    origin.current = { x: e.clientX, y: e.clientY }
    setKnob({ x: 0, y: 0 })
  }
  const stickMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current) return
    const dx = e.clientX - origin.current.x
    const dy = e.clientY - origin.current.y
    const len = Math.hypot(dx, dy)
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1
    setKnob({ x: dx * k, y: dy * k })
    onMove(joystickVector(dx, dy, STICK_RADIUS))
  }
  const stickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current) return
    resetStick()
  }

  const actionDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    capture(e)
    actionId.current = e.pointerId
    setPressed(true)
    onActionDown()
  }
  const actionUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== actionId.current) return
    actionId.current = null
    setPressed(false)
    onActionUp()
  }

  return (
    <div className="fish-controls">
      <div
        className="fish-stick"
        data-testid="fish-stick"
        aria-hidden="true"
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        <span className="fish-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button
        type="button"
        className={`fish-action${pressed && action.enabled ? ' fish-action-on' : ''}`}
        data-testid="fish-action"
        disabled={!action.enabled}
        onPointerDown={actionDown}
        onPointerUp={actionUp}
        onPointerCancel={actionUp}
        // 길게 눌러도 메뉴가 뜨지 않게
        onContextMenu={(e) => e.preventDefault()}
      >
        {action.label}
      </button>
    </div>
  )
}
