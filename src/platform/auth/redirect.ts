// 같은 사이트 안의 경로만 허용한다. 하나의 /로 시작하고(//, /\ 제외), 공백·제어 문자가 없으며
// (%XX로 인코딩된 것 포함) 기준 주소에 붙였을 때 다른 출처로 가지 않아야 한다.
const BASE = 'https://x.invalid'
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\s\x00-\x1f\x7f-\x9f\\]/ // \s는 유니코드 공백·줄 구분 문자도 포함한다

function sameOrigin(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || BAD_CHARS.test(path)) return false
  try {
    return new URL(path, BASE).origin === BASE
  } catch {
    return false
  }
}

export function safeRedirect(raw: string | null | undefined): string {
  if (!raw) return '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return '/'
  }
  return sameOrigin(raw) && sameOrigin(decoded) ? raw : '/'
}
