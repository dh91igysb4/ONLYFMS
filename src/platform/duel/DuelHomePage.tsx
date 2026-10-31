import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, duel, duelErrorMessage, rpc, type DuelCreated } from '../../lib/api.ts'
import { duels, getDuel } from '../../games/index.ts'
import type { Manifest } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { POLL_MS, type DuelList, type DuelListItem } from './data.ts'


const gameName = (id: string) => getDuel(id)?.manifest.name ?? id
const fallbackTurn = { choices: [60], default: 60 }
const turnOf = (m: Manifest) => m.duel?.turnSeconds ?? fallbackTurn
const defaultOptions = (m: Manifest) => Object.fromEntries(m.options.map((o) => [o.key, o.default]))

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
    if (busy || !manifest) return
    setBusy(true)
    setError(null)
    try {
      const r = await duel<DuelCreated>({
        action: 'create', game_id: manifest.id, options, rated, visibility, turn_seconds: turn,
      })
      navigate(`/duel/${r.match_id}`, { state: { inviteCode: r.invite_code } })
    } catch (e2) {
      setError(duelErrorMessage(e2 instanceof ApiError ? e2.code : 'network'))
      setBusy(false)
    }
  }

  if (!manifest) return <p className="muted">아직 열린 대전 게임이 없어요</p>

  return (
    <form className="card" onSubmit={submit} noValidate aria-label="대국 만들기">
      <h3 className="card-title">대국 만들기</h3>
      <label className="field">
        <span>게임</span>
        <select className="input" value={manifest.id} onChange={(e) => pickGame(e.target.value)}>
          {visible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      {manifest.options.map((o) => (
        <label key={o.key} className="field">
          <span>{o.label}</span>
          <select className="input" value={options[o.key] ?? o.default}
            onChange={(e) => setOptions((prev) => ({ ...prev, [o.key]: e.target.value }))}>
            {o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      ))}
      <fieldset className="field">
        <legend>종류</legend>
        <label className="radio"><input type="radio" name="duel-rated" checked={rated} onChange={() => setRated(true)} /> 랭크</label>
        <label className="radio"><input type="radio" name="duel-rated" checked={!rated} onChange={() => setRated(false)} /> 친선</label>
      </fieldset>
      <fieldset className="field">
        <legend>공개 범위</legend>
        <label className="radio"><input type="radio" name="duel-vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개</label>
        <label className="radio"><input type="radio" name="duel-vis" checked={visibility === 'invite'} onChange={() => setVisibility('invite')} /> 초대 링크로만</label>
      </fieldset>
      <label className="field">
        <span>턴 시간</span>
        <select className="input" value={String(turn)} onChange={(e) => setTurn(Number(e.target.value))}>
          {turnOf(manifest).choices.map((c) => <option key={c} value={String(c)}>{c}초</option>)}
        </select>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>대국 만들기</button>
    </form>
  )
}

function meta(m: DuelListItem): string {
  return `${gameName(m.game_id)} · ${m.rated ? '랭크' : '친선'} · 턴 ${m.turn_seconds}초`
}

function resultText(m: DuelListItem, myId: string | undefined): string {
  if (m.status === 'void') return '무효'
  const seat = m.players.findIndex((p) => p.id === myId)
  const opp = m.players[seat === 0 ? 1 : 0]?.handle ?? '알 수 없음'
  let r = '무'
  if (m.winner !== null) r = m.winner === seat ? '승' : '패'
  const score = m.final_scores && seat >= 0
    ? ` ${m.final_scores[seat]} : ${m.final_scores[seat === 0 ? 1 : 0]}`
    : ''
  return `${r} vs ${opp}${score}`
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

  async function join(id: string) {
    if (joining) return
    setJoining(id)
    setJoinError(null)
    try {
      const v = await duel({ action: 'join', match_id: id })
      navigate(`/duel/${v.match_id}`)
    } catch (e) {
      setJoinError(duelErrorMessage(e instanceof ApiError ? e.code : 'network'))
      setJoining(null)
    }
  }

  const myId = profile?.id

  return (
    <div className="stack">
      <h2 className="page-title">대전</h2>
      {/* 관리자 프로필이 늦게 오면 보이는 게임이 바뀌므로 기본값을 다시 잡는다 */}
      <CreateForm key={visible.map((m) => m.id).join()} visible={visible} />

      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && list === null && <p className="page-note" role="status">불러오는 중…</p>}
      {list && (
        <>
          <section className="stack" aria-label="대기실">
            <h3 className="section-title">대기실</h3>
            {joinError && <p className="form-error" role="alert">{joinError}</p>}
            {list.lobby.length === 0 && <p className="muted">기다리는 공개 대국이 없어요</p>}
            <ul className="list">
              {list.lobby.map((m) => (
                <li key={m.id} className="list-row">
                  <div className="row between">
                    <span>{m.created_by_handle ?? '알 수 없음'} <span className="muted">({m.players[0]?.rating ?? 1000})</span></span>
                    <button type="button" className="btn btn-primary" disabled={joining !== null} onClick={() => void join(m.id)}>참가</button>
                  </div>
                  <span className="muted">{meta(m)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="stack" aria-label="내 대국">
            <h3 className="section-title">내 대국</h3>
            {list.mine.length === 0 && <p className="muted">진행 중인 대국이 없어요</p>}
            <ul className="list">
              {list.mine.map((m) => {
                const opp = m.players.find((p) => p.id !== myId)
                const label = m.status === 'waiting' ? '상대를 기다리는 중' : `vs ${opp?.handle ?? '알 수 없음'}`
                return (
                  <li key={m.id} className="list-row">
                    <Link to={`/duel/${m.id}`}>{label}</Link>
                    <span className="muted">{meta(m)}{m.visibility === 'invite' ? ' · 초대' : ''}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="stack" aria-label="최근 결과">
            <h3 className="section-title">최근 결과</h3>
            {list.recent.length === 0 && <p className="muted">아직 끝난 대국이 없어요</p>}
            <ul className="list">
              {list.recent.map((m) => (
                <li key={m.id} className="list-row">
                  <Link to={`/duel/${m.id}`}>{resultText(m, myId)}</Link>
                  <span className="muted">{meta(m)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
