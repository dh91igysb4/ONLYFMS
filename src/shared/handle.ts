/** 아이디 비교용 정규화: 앞뒤 공백 제거, NFC, 소문자 */
export const normalizeHandle = (s: string) => s.trim().normalize('NFC').toLowerCase()
