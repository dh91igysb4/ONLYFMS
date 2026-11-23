import { useEffect } from 'react'

const CLASS = 'game-screen'
/** 지금 게임 화면을 띄운 곳의 수. 둘이 겹쳐도 마지막이 떠날 때만 표시를 지운다. */
let users = 0

/**
 * 게임 화면을 띄우는 동안 <html>에 game-screen을 붙인다(theme.css: 길게 눌러도 글자 선택·복사 메뉴가 뜨지 않게).
 * 입력칸은 theme.css가 예외로 둔다. active가 false면 아무것도 하지 않는다.
 */
export function useGameScreen(active = true): void {
  useEffect(() => {
    if (!active) return
    users++
    document.documentElement.classList.add(CLASS)
    return () => {
      users--
      if (users === 0) document.documentElement.classList.remove(CLASS)
    }
  }, [active])
}
