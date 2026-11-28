import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, duel, duelErrorMessage, rpc, type DuelCreated } from '../../lib/api.ts'
import { duels, getDuel } from '../../games/index.ts'
import type { Manifest } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { POLL_MS, type DuelList, type DuelListItem } from './data.ts'
import { walletEnabled } from '../wallet/enabled.ts'
import { refreshWallet, useWallet } from '../wallet/useWallet.ts'
import { formatGold } from '../wallet/format.ts'
import { StakePicker } from './StakePicker.tsx'
import { defaultOptions, OptionSelects } from './OptionSelects.tsx'
import { parseStake, stakeOf, stakeProblem } from './stake.ts'
import { recentChips } from '../home/shortcuts.ts'


const gameName = (id: string) => getDuel(id)?.manifest.name ?? id
const fallbackTurn = { choices: [60], default: 60 }
const turnOf = (m: Manifest) => m.duel?.turnSeconds ?? fallbackTurn

function CreateForm({ visible }: { visible: Manifest[] }) {
  const navigate = useNavigate()
  const [gameId, setGameId] = useState(visible[0]?.id ?? '')
  const manifest = visible.find((m) => m.id === gameId) ?? visible[0]
  const [options, setOptions] = useState<Record<string, string>>(() => (manifest ? defaultOptions(manifest) : {}))
  const [rated, setRated] = useState(true)
  const [visibility, setVisibility] = useState<'public' | 'invite'>('public')
  const [turn, setTurn] = useState(() => (manifest ? turnOf(manifest).default : 60))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stakeText, setStakeText] = useState('0')
  const { balance } = useWallet()
  // 판돈은 지갑 게임이 있을 때만(서버도 그때만 > 0을 받는다), 숨김 게임은 0만
  const stakeOn = walletEnabled() && !!manifest && !manifest.hidden
  const stake = stakeOn ? parseStake(stakeText) : 0
  const stakeIssue = stakeOn ? stakeProblem(stake, balance) : null

  function pickGame(id: string) {
    setGameId(id)
    const m = visible.find((x) => x.id === id)
    if (m) {
      setOptions(defaultOptions(m))
      setTurn(turnOf(m).default)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !manifest || stakeIssue !== null || stake === null) return
    setBusy(true)
    setError(null)
    try {
      const r = await duel<DuelCreated>({
        action: 'create', game_id: manifest.id, options, rated, visibility, turn_seconds: turn, stake,
      })
      if (stake > 0) void refreshWallet()
      navigate(`/duel/${r.match_id}`, { state: { inviteCode: r.invite_code } })
    } catch (e2) {
      setError(duelErrorMessage(e2 instanceof ApiError ? e2.code : 'network'))
      setBusy(false)
    }
  }

  if (!manifest) return <p className="muted">아직 열린 대전 게임이 없어요</p>

  return (
    <form className="fm-panel" onSubmit={submit} noValidate aria-label="대국 만들기">
      <h3 className="fm-panel-head">새 대국</h3>
      <div className="fm-form">
        <label className="fm-form-row">
          <span>게임</span>
          <select className="input" value={manifest.id} onChange={(e) => pickGame(e.target.value)}>
            {visible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <OptionSelects manifest={manifest} value={options} onChange={setOptions} rowClass="fm-form-row" />
        <Seg legend="종류" name="rated" value={rated ? 'rated' : 'friendly'}
          choices={[['rated', '랭크'], ['friendly', '친선']]} onPick={(v) => setRated(v === 'rated')} />
        <Seg legend="공개 범위" name="visibility" value={visibility}
          choices={[['public', '공개'], ['invite', '초대 링크로만']]} onPick={(v) => setVisibility(v as 'public' | 'invite')} />
        <label className="fm-form-row">
          <span>턴 시간</span>
          <select className="input" value={String(turn)} onChange={(e) => setTurn(Number(e.target.value))}>
            {turnOf(manifest).choices.map((c) => <option key={c} value={String(c)}>{c}초</option>)}
          </select>
        </label>
        {stakeOn && <StakePicker text={stakeText} onText={setStakeText} balance={balance} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || stakeIssue !== null}>대국 만들기</button>
      </div>
    </form>
  )
}

/** 구분 버튼(라디오 묶음). 화면에는 붙은 버튼, 접근성은 라디오 그대로 */
function Seg({ legend, name, value, choices, onPick }: {
  legend: string
  name: string
  value: string
  choices: [string, string][]
  onPick(v: string): void
}) {
  const id = useId()
  return (
    <div className="fm-form-row" role="radiogroup" aria-label={legend}>
      <span aria-hidden="true">{legend}</span>
      <span className="fm-seg">
        {choices.map(([v, label]) => (
          <Fragment key={v}>
            <input type="radio" id={`${id}-${v}`} name={name} value={v} checked={value === v} onChange={() => onPick(v)} />
            <label htmlFor={`${id}-${v}`}>{label}</label>
          </Fragment>
        ))}
      </span>
    </div>
  )
}

function meta(m: DuelListItem): string {
  const stake = stakeOf(m)
  // 판돈은 실제로 걸린 돈이라 지갑 표시 여부와 무관하게 보여 준다
  return `${gameName(m.game_id)} · ${m.rated ? '랭크' : '친선'} · 턴 ${m.turn_seconds}초${stake > 0 ? ` · 판돈 ${formatGold(stake)}` : ''}`
}

const CHIP_TEXT = { win: '승', draw: '무', loss: '패' } as const

/** 최근 결과 표 한 줄: 결과 칸(홈과 같은 recentChips 판정), 상대, 내 점수 : 상대 점수 */
function ResultRow({ m, myId }: { m: DuelListItem; myId: string }) {
  const seat = m.players.findIndex((p) => p.id === myId)
  const opp = m.players[seat === 0 ? 1 : 0]?.handle ?? '알 수 없음'
  const chip = recentChips([m], myId)[0]
  const score = m.status === 'void' ? '무효'
    : m.final_scores && seat >= 0 ? `${m.final_scores[seat]} : ${m.final_scores[seat === 0 ? 1 : 0]}` : ''
  return (
    <tr>
      <td>{chip && <span className={`fm-chip is-${chip}`}>{CHIP_TEXT[chip]}</span>}</td>
      <td>
        <Link to={`/duel/${m.id}`}>vs {opp}</Link>
        <div className="fm-row-sub">{meta(m)}</div>
      </td>
      <td className="num">{score}</td>
    </tr>
  )
}

export function DuelHomePage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const visible = duels.map((d) => d.manifest).filter((m) => !m.hidden || !!profile?.is_admin)
  const [list, setList] = useState<DuelList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const ticking = useRef(new Set<string>())

  // duel_list는 한 번에 하나. 진행 중에 또 필요해지면 끝난 뒤 한 번만 다시 부른다
  const inflight = useRef(false)
  const rerun = useRef(false)
  const alive = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      rerun.current = true
      return
    }
    inflight.current = true
    try {
      const r = await rpc<DuelList>('duel_list')
      if (!alive.current) return
      setList(r)
      setError(null)
      // 마감 지난 내 대국: 아무도 tick을 안 보내면 멈추므로 여기서 한 번씩 보낸다 (설계 §4.9). 오류는 무시
      for (const id of r.due ?? []) {
        if (ticking.current.has(id)) continue
        ticking.current.add(id)
        duel({ action: 'tick', match_id: id })
          .catch(() => {})
          .finally(() => ticking.current.delete(id))
      }
    } catch (e) {
      if (alive.current) setError(duelErrorMessage(e instanceof ApiError ? e.code : 'network'))
    } finally {
      inflight.current = false
      if (rerun.current && alive.current) {
        rerun.current = false
        void load()
      }
    }
  }, [])

  useEffect(() => {
    alive.current = true
    inflight.current = false
    rerun.current = false
    void load()
    // 대기실은 Realtime 없이 화면이 열려 있는 동안 5초마다 다시 읽는다
    const t = setInterval(() => { void load() }, POLL_MS)
    return () => { alive.current = false; clearInterval(t) }
  }, [load])

  async function join(m: DuelListItem) {
    if (joining) return
    setJoining(m.id)
    setJoinError(null)
    const stake = stakeOf(m)
    try {
      // 목록에서 본 판돈을 함께 보낸다. 다르면 서버가 stake_mismatch
      const v = await duel({ action: 'join', match_id: m.id, stake })
      if (stake > 0) void refreshWallet()
      navigate(`/duel/${v.match_id}`)
    } catch (e) {
      setJoinError(duelErrorMessage(e instanceof ApiError ? e.code : 'network'))
      setJoining(null)
    }
  }

  const myId = profile?.id

  return (
    <div className="stack">
      <h2 className="page-title sr-only">대전</h2>
      <div className="fm-stats">
        <div className="fm-stat"><span className="fm-stat-label">대기실</span><span className="fm-stat-value">{list ? list.lobby.length : '–'}</span></div>
        <div className="fm-stat"><span className="fm-stat-label">내 대국</span><span className="fm-stat-value">{list ? list.mine.length : '–'}</span></div>
      </div>
      {/* 넓은 화면: 왼쪽 대국 만들기·같은 화면, 오른쪽 대기실·내 대국·최근 결과 */}
      <div className="split">
        <div className="stack">
          {/* 관리자 프로필이 늦게 오면 보이는 게임이 바뀌므로 기본값을 다시 잡는다 */}
          <CreateForm key={visible.map((m) => m.id).join()} visible={visible} />

          {visible.some((m) => m.duel?.sameScreen) && (
            <section className="fm-panel" aria-label="같은 화면">
              <h3 className="fm-panel-head">같은 화면으로 둘이서</h3>
              <p className="fm-empty">한 기기를 번갈아 쓰는 대결이에요. 기록과 레이팅은 남지 않아요</p>
              {visible.filter((m) => m.duel?.sameScreen).map((m) => (
                <Link key={m.id} className="fm-row" to={`/duel/local/${m.id}`}>
                  <span className="fm-row-main"><span className="fm-row-title">{m.name} 시작</span></span>
                  <span className="fm-row-go" aria-hidden="true">›</span>
                </Link>
              ))}
            </section>
          )}
        </div>
        <div className="stack">
          {error && <p className="form-error" role="alert">{error}</p>}
          {!error && list === null && <p className="page-note" role="status">불러오는 중…</p>}
          {list && (
            <>
              <section className="fm-panel" aria-label="대기실">
                <h3 className="fm-panel-head">대기실</h3>
                {joinError && <p className="form-error" role="alert">{joinError}</p>}
                {list.lobby.length === 0 && <p className="fm-empty">기다리는 공개 대국이 없어요</p>}
                {list.lobby.map((m) => (
                  <div key={m.id} className="fm-row">
                    <span className="fm-row-main">
                      <span className="fm-row-title">{m.created_by_handle ?? '알 수 없음'} <span className="muted">({m.players[0]?.rating ?? 1000})</span></span>
                      <span className="fm-row-sub">{meta(m)}</span>
                    </span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={joining !== null} onClick={() => void join(m)}>
                      {stakeOf(m) > 0 ? `${formatGold(stakeOf(m))} 걸고 참가` : '참가'}
                    </button>
                  </div>
                ))}
              </section>

              <section className="fm-panel" aria-label="내 대국">
                <h3 className="fm-panel-head">내 대국</h3>
                {list.mine.length === 0 && <p className="fm-empty">진행 중인 대국이 없어요</p>}
                {list.mine.map((m) => {
                  const opp = m.players.find((p) => p.id !== myId)
                  const label = m.status === 'waiting' ? '상대를 기다리는 중' : `vs ${opp?.handle ?? '알 수 없음'}`
                  return (
                    <Link key={m.id} to={`/duel/${m.id}`} className="fm-row">
                      <span className="fm-row-main">
                        <span className="fm-row-title">{label}</span>
                        <span className="fm-row-sub">{meta(m)}{m.visibility === 'invite' ? ' · 초대' : ''}</span>
                      </span>
                      <span className="fm-row-go" aria-hidden="true">›</span>
                    </Link>
                  )
                })}
              </section>

              <section className="fm-panel" aria-label="최근 결과">
                <h3 className="fm-panel-head">최근 결과</h3>
                {list.recent.length === 0 ? <p className="fm-empty">아직 끝난 대국이 없어요</p> : (
                  <table className="fm-table">
                    <thead><tr><th>결과</th><th>상대</th><th className="num">점수</th></tr></thead>
                    <tbody>{list.recent.map((m) => <ResultRow key={m.id} m={m} myId={myId ?? ''} />)}</tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
