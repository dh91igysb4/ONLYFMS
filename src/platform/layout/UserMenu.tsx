import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { Avatar } from '../profile/Avatar.tsx'

/** 오른쪽 위 아이디 메뉴: 내 프로필 · 화면 설정 · 로그아웃 */
export function UserMenu({ handle }: { handle: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  function onMenuKey(e: KeyboardEvent) {
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLElement)
    const move = (n: number) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus() }
    switch (e.key) {
      case 'Escape': e.preventDefault(); close(true); break
      case 'ArrowDown': move(i + 1); break
      case 'ArrowUp': move(i < 0 ? list.length - 1 : i - 1); break
      case 'Home': move(0); break
      case 'End': move(list.length - 1); break
      case 'Tab': setOpen(false); break
    }
  }

  const profilePath = `/u/${handle}`
  return (
    <div className="user-menu" ref={rootRef}>
      <button ref={buttonRef} type="button" className="user-menu-button"
        aria-label={`${handle} 계정 메뉴`} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined} onClick={() => setOpen((v) => !v)}>
        <Avatar handle={handle} size="sm" />
        <span className="user-menu-handle">{handle}</span>
        <span className="user-menu-caret" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} className="user-menu-list" role="menu" aria-label="계정" onKeyDown={onMenuKey}>
          <Link role="menuitem" tabIndex={-1} className="user-menu-item" to={profilePath} onClick={() => close(false)}>내 프로필</Link>
          <Link role="menuitem" tabIndex={-1} className="user-menu-item" to={`${profilePath}?tab=settings`} onClick={() => close(false)}>화면 설정</Link>
          <button role="menuitem" tabIndex={-1} type="button" className="user-menu-item user-menu-logout"
            onClick={() => { close(false); void supabase.auth.signOut() }}>로그아웃</button>
        </div>
      )}
    </div>
  )
}
