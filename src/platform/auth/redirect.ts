// 같은 사이트 안의 경로(/로 시작, //나 \ 제외)만 허용한다.
export function safeRedirect(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  return raw
}
