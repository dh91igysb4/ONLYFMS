// 명예의 전당 게시판(마을회관 설계 §4). RPC hall_of_fame 결과를 등록부·manifest로 화면용 게시판 목록으로 만든다.
// 게임 id로 분기하지 않는다: 어떤 기록을 어떻게 보일지는 manifest(records·freeStats)가 정한다.
import { rpc } from '../../lib/api.ts'
import { duels, games, worlds } from '../../games/index.ts'
import { formatFreeScore } from '../games/score.ts'

export type FameRow = { handle: string; text: string; detail: string | null; avatar: string | null }
export type FameBoard = { gameId: string; group: 'record' | 'free' | 'duel'; key: string; title: string; label: string; rows: FameRow[] }
/** records: 지속형 게임 기록 게시판(manifest records 순서), site: 자유 플레이 게임(등록부 순서) 다음 대전 게임 */
export type HallOfFame = { records: FameBoard[]; site: FameBoard[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** raw[key] 배열에서 모양이 맞는(handle·game_id가 문자열) 항목만 */
function items(raw: unknown, key: string): Obj[] {
  const arr = isObj(raw) ? raw[key] : null
  return Array.isArray(arr) ? arr.filter((x): x is Obj => isObj(x) && !!str(x.handle) && !!str(x.game_id)) : []
}

const row = (x: Obj, text: string, detail: string | null = null): FameRow => ({ handle: str(x.handle)!, text, detail, avatar: str(x.avatar) })

export function buildHallOfFame(raw: unknown, isAdmin: boolean): HallOfFame {
  const visible = (m: { hidden: boolean }) => isAdmin || !m.hidden
  const recs = items(raw, 'records')
  const free = items(raw, 'free')
  const duel = items(raw, 'duel')

  const records: FameBoard[] = worlds.filter((w) => visible(w.manifest)).flatMap((w) =>
    (w.manifest.records ?? []).map((r) => ({
      gameId: w.manifest.id, group: 'record' as const, key: r.key, title: w.manifest.name, label: r.label,
      rows: recs.filter((x) => x.game_id === w.manifest.id && x.key === r.key && num(x.value) !== null)
        .map((x) => row(x, `${num(x.value)!.toLocaleString('ko-KR')}${r.unit ?? ''}`, str(x.detail))),
    })),
  )

  const freeBoards: FameBoard[] = games.filter((g) => g.manifest.modes.free && visible(g.manifest)).map((g) => {
    const id = g.manifest.id
    const score = g.manifest.freeStats === 'score'
    const rows = free.filter((x) => x.game_id === id && x.by === (score ? 'best' : 'wins'))
      .map((x) => (score ? row(x, `${formatFreeScore(id, num(x.best_score))}점`) : row(x, `${num(x.wins) ?? 0}번 · ${num(x.plays) ?? 0}판`)))
    return { gameId: id, group: 'free' as const, key: 'free', title: g.manifest.name, label: score ? '최고 점수' : '맞힌 수', rows }
  })

  const duelBoards: FameBoard[] = duels.filter((d) => visible(d.manifest)).map((d) => ({
    gameId: d.manifest.id, group: 'duel' as const, key: 'duel', title: d.manifest.name, label: '레이팅',
    rows: duel.filter((x) => x.game_id === d.manifest.id && num(x.rating) !== null).map((x) => row(x, String(num(x.rating)))),
  }))

  return { records, site: [...freeBoards, ...duelBoards] }
}

/** 명예의 전당을 불러온다. avatarGame: 얼굴로 쓸 캐릭터 기록(game_records 키 avatar)의 게임 */
export async function loadHallOfFame(avatarGame: string, isAdmin: boolean): Promise<HallOfFame> {
  const raw = await rpc<unknown>('hall_of_fame', { p_avatar_game: avatarGame })
  return buildHallOfFame(raw, isAdmin)
}
