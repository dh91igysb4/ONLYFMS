import { useRef, useState } from 'react'

/** 초대 링크 표시와 복사. 클립보드가 막히면 텍스트를 선택해 직접 복사하게 한다. */
export function InviteLink({ code }: { code: string }) {
  const url = `${location.origin}/join/${code}`
  const ref = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')

  function copy() {
    const select = () => {
      ref.current?.focus()
      ref.current?.select()
      setMsg('링크를 선택했어요. 복사해 주세요')
    }
    try {
      const p = navigator.clipboard?.writeText(url)
      if (!p) return select()
      p.then(() => setMsg('복사했어요'), select)
    } catch {
      select()
    }
  }

  return (
    <div className="stack">
      <label className="muted" htmlFor="invite-link">초대 링크</label>
      <div className="row">
        <input id="invite-link" ref={ref} className="input grow" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-primary" onClick={copy}>복사</button>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  )
}
