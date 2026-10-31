/** 아이디 첫 글자 동그라미. 색은 강조 토큰. */
export function Avatar({ handle, size = 'md' }: { handle: string; size?: 'sm' | 'lg' | 'md' }) {
  const letter = (Array.from(handle.trim())[0] ?? '?').toUpperCase()
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{letter}</span>
}
