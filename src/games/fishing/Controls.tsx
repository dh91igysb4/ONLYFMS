// 터치 조작: 왼쪽 아래 조이스틱, 오른쪽 아래 행동 버튼. 캔버스 위에 겹쳐 뜬다.
// 두 조작은 각자 잡은 손가락(pointerId)만 따라가므로 한 손가락으로 걸으면서 다른 손가락으로 누를 수 있다.
// 손가락을 떼거나, 취소되거나, 포인터 캡처를 잃으면 모두 뗀 것으로 친다(걷기가 멈추지 않는 일이 없게).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { joystickVector, type MoveInput } from './walk.ts'

/** 조이스틱을 끝까지 미는 거리(CSS px). 손잡이도 이만큼까지만 따라간다. */
const STICK_RADIUS = 36
const STOP: MoveInput = { x: 0, y: 0 }

export type ActionLabel = '낚시' | '상점' | '살펴보기' | '배 타기' | '순간이동' | '구멍 뚫기' | '옷 가게' | '노트북' | '엘리베이터' | '보기' | '냉장고' | '쓰레기통' | '베기' | '캐기' | '작업대' | '놓기' | '치우기' | '전시관'
export type ActionState = { label: ActionLabel; enabled: true } | { label: '낚시'; enabled: false }

type Props = {
  /** 조이스틱 입력(길이 ≤ 1). 놓으면 {0,0} */
  onMove(v: MoveInput): void
  action: ActionState
  onActionDown(): void
  onActionUp(): void
  /** 조이스틱을 걷기로 잡는 때(대기·결과 표시)인가. 아니면 조이스틱 자리를 누르는 것은 캔버스를 누르는 것과 같다(챔·감기). */
  walking: boolean
  onTapDown(pointerId: number): void
  onTapUp(pointerId: number): void
}

type Vec = { x: number; y: number }

function capture(e: ReactPointerEvent<HTMLElement>): void {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    /* 포인터 캡처를 못 해도 입력은 받는다 */
  }
}

export function Controls({ onMove, action, onActionDown, onActionUp, walking, onTapDown, onTapUp }: Props) {
  // 조이스틱: 누른 자리가 중심. 새 손가락이 누르면 그 손가락으로 넘어간다(떼는 알림을 놓쳐도 갇히지 않게).
  // 누를 때 걸을 수 있으면 'walk'(방향 입력), 아니면 'tap'(누르기)으로 그 손가락이 뗄 때까지 간다.
  const stickId = useRef<number | null>(null)
  const stickMode = useRef<'walk' | 'tap'>('walk')
  const origin = useRef<{ client: Vec; local: Vec }>({ client: { x: 0, y: 0 }, local: { x: 0, y: 0 } })
  /** 손잡이 중심(받침 안 좌표). null이면 받침 가운데 */
  const [knob, setKnob] = useState<Vec | null>(null)
  const actionId = useRef<number | null>(null)
  const [pressed, setPressed] = useState(false)

  // 최신 콜백을 창 이벤트·정리 함수에서 부르기 위해
  const latest = useRef({ onMove, onActionUp, onTapUp })
  latest.current = { onMove, onActionUp, onTapUp }

  const endStick = () => {
    const id = stickId.current
    if (id === null) return
    stickId.current = null
    if (stickMode.current === 'tap') latest.current.onTapUp(id)
    else {
      setKnob(null)
      latest.current.onMove(STOP)
    }
  }
  /** notify가 false면 화면 쪽에 떼기를 알리지 않고 손가락만 놓는다 */
  const endAction = (notify = true) => {
    if (actionId.current === null) return
    actionId.current = null
    setPressed(false)
    if (notify) latest.current.onActionUp()
  }

  // 창이 초점을 잃으면 손가락을 뗀 알림이 오지 않을 수 있으므로 두 조작을 모두 놓는다.
  // 행동 버튼은 떼기를 알리지 않는다: 초점을 잃은 것은 뗀 것이 아니고(충전 중이면 던지지 않는다),
  // 누르고 있던 입력은 화면이 창 blur에서 직접 정리한다. 화면을 떠날 때도 놓는다.
  useEffect(() => {
    const onBlur = () => {
      endStick()
      endAction(false)
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      endStick()
      endAction()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stickDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    capture(e)
    endStick()
    stickId.current = e.pointerId
    if (!walking) {
      stickMode.current = 'tap'
      onTapDown(e.pointerId)
      return
    }
    stickMode.current = 'walk'
    const box = e.currentTarget.getBoundingClientRect()
    const local = { x: e.clientX - box.left, y: e.clientY - box.top }
    origin.current = { client: { x: e.clientX, y: e.clientY }, local }
    setKnob(local)
  }
  const stickMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current || stickMode.current !== 'walk') return
    const dx = e.clientX - origin.current.client.x
    const dy = e.clientY - origin.current.client.y
    const len = Math.hypot(dx, dy)
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1
    setKnob({ x: origin.current.local.x + dx * k, y: origin.current.local.y + dy * k })
    onMove(joystickVector(dx, dy, STICK_RADIUS))
  }
  const stickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stickId.current) endStick()
  }

  const actionDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    // 비활성(aria-disabled)일 때 누르기는 버린다. disabled 속성을 쓰지 않아 떼기 알림은 늘 온다.
    if (!action.enabled) return
    capture(e)
    actionId.current = e.pointerId
    setPressed(true)
    onActionDown()
  }
  const actionUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerId === actionId.current) endAction()
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
        onLostPointerCapture={stickUp}
      >
        <span className="fish-stick-knob" style={knob ? { left: knob.x, top: knob.y } : undefined} />
      </div>
      <button
        type="button"
        className={`fish-action${pressed && action.enabled ? ' fish-action-on' : ''}`}
        data-testid="fish-action"
        aria-disabled={!action.enabled}
        onPointerDown={actionDown}
        onPointerUp={actionUp}
        onPointerCancel={actionUp}
        onLostPointerCapture={actionUp}
        // 길게 눌러도 메뉴가 뜨지 않게
        onContextMenu={(e) => e.preventDefault()}
      >
        {action.label}
      </button>
    </div>
  )
}
