import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getGame } from '../../games/index.ts'
import { markPrizesSeen, unseenPrizes, type Prize } from '../../lib/walletStore.ts'
import { formatGold } from './format.ts'
import { usePrizes } from './useWallet.ts'

// 받은 상금 알림 (지갑 3단계, 설계 §8). 정산은 다음 접속 때 일어나므로 처음 보는 상금만 한 번 알린다.
// 게임 이름은 등록부에서 찾는다(게임 분기 아님).

function label(p: Prize): string {
  const game = p.gameId ? getGame(p.gameId)?.manifest.name ?? null : null
  return [game, p.note].filter(Boolean).join(' ')
}

export function PrizeNotice({ uid }: { uid: string }) {
  const prizes = usePrizes()
  const [, bump] = useState(0)
  const unseen = unseenPrizes(uid, prizes)
  if (unseen.length === 0) return null
  const one = unseen.length === 1 ? unseen[0] : null
  const total = unseen.reduce((s, p) => s + p.amount, 0)
  const seen = () => { markPrizesSeen(uid, unseen); bump((n) => n + 1) }
  const head = one ? (one.reason === 'contest_prize' ? '대회 상금이 들어왔어요' : '데일리 상금이 들어왔어요') : '상금이 들어왔어요'
  const what = one ? label(one) : `${unseen.length}건`
  return (
    <div className="prize-notice" role="status">
      <p className="prize-notice-text">
        {head} · {what}{what ? ' ' : ''}<strong>+{formatGold(total)}</strong>
      </p>
      {one && <Link className="btn btn-ghost" to={`/contests/${one.contestId}`} onClick={seen}>보기</Link>}
      <button type="button" className="btn btn-primary" onClick={seen}>확인</button>
    </div>
  )
}
