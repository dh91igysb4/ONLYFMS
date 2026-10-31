import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import { games } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { syncServerTime } from './clock.ts'
import { InviteLink } from './InviteLink.tsx'
import { validateContest, type ContestItemInput } from './validate.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const KST_MS = 9 * 3_600_000
// datetime-local 값 ('YYYY-MM-DDTHH:mm')을 한국 시간 기준으로 만든다
function toKstInput(ms: number): string {
  const d = new Date(ms + KST_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
// 입력값을 KST 벽시계 시각으로 읽는다 (한국은 서머타임이 없다)
function parseKstInput(v: string): Date {
  return new Date(`${v}:00+09:00`)
}

const FIELD_OF: Record<string, string> = {
  title_invalid: 'title',
  start_too_soon: 'startsAt',
  start_too_far: 'startsAt',
  duration_invalid: 'durationMin',
  items_invalid: 'items',
  game_not_allowed: 'items',
}

function defaultOptions(gameId: string): Record<string, string> {
  const g = games.find((x) => x.manifest.id === gameId)
  return Object.fromEntries((g?.manifest.options ?? []).map((o) => [o.key, o.default]))
}

type Created = { id: string; code: string | null }

export function ContestNewPage() {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const allowed = games.filter((g) => g.manifest.modes.contest && (!g.manifest.hidden || isAdmin))

  const [title, setTitle] = useState('')
  const [start, setStart] = useState(() => toKstInput(now() + 30 * 60_000))
  const [duration, setDuration] = useState('30')
  const [visibility, setVisibility] = useState<'public' | 'invite'>('public')
  const [official, setOfficial] = useState(false)
  const [items, setItems] = useState<ContestItemInput[]>(() =>
    allowed[0] ? [{ game_id: allowed[0].manifest.id, options: defaultOptions(allowed[0].manifest.id), count: 1 }] : [],
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)

  const [startTouched, setStartTouched] = useState(false)
  // 서버 시각과 맞춘 뒤, 사용자가 건드리지 않았다면 기본 시작 시각을 다시 잡는다
  useEffect(() => {
    let alive = true
    void syncServerTime().then(() => {
      if (alive && !startTouched) setStart(toKstInput(now() + 30 * 60_000))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = items.reduce((s, it) => s + (Number.isFinite(it.count) ? it.count : 0), 0)
  const patchItem = (i: number, p: Partial<ContestItemInput>) =>
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...p } : it)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setFormError(null)
    const input = {
      title, startsAt: parseKstInput(start), durationMin: Number(duration), visibility, items, official: isAdmin && official,
    }
    const errs = validateContest(input, now())
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    try {
      const res = await rpc<{ id: string; invite_code: string | null }[] | { id: string; invite_code: string | null }>(
        'create_contest',
        {
          p_title: title.trim(), p_starts_at: input.startsAt.toISOString(), p_duration_min: input.durationMin,
          p_visibility: visibility, p_items: items, p_official: input.official,
        },
      )
      const row = Array.isArray(res) ? res[0] : res
      setCreated({ id: row.id, code: row.invite_code ?? null })
    } catch (e2) {
      const code = e2 instanceof ApiError ? e2.code : 'network'
      const field = FIELD_OF[code]
      if (field) setErrors({ [field]: errorMessage(code) })
      else setFormError(errorMessage(code))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="stack">
        <h2 className="page-title">대회를 만들었어요</h2>
        {created.code && (
          <>
            <p className="muted">이 링크를 받은 사람만 참가할 수 있어요. 링크를 친구들에게 보내 주세요.</p>
            <InviteLink code={created.code} />
          </>
        )}
        <Link className="btn btn-primary btn-link" to={`/contests/${created.id}`}>대회 페이지로 가기</Link>
      </div>
    )
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h2 className="page-title">대회 만들기</h2>

      <label className="field">
        <span>제목</span>
        <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        {errors.title && <span className="form-error">{errors.title}</span>}
      </label>

      <label className="field">
        <span>시작 시각 (한국 시간 기준)</span>
        <input className="input" type="datetime-local" value={start} onChange={(e) => { setStartTouched(true); setStart(e.target.value) }} />
        <span className="muted">지금부터 5분 뒤 ~ 30일 안</span>
        {errors.startsAt && <span className="form-error">{errors.startsAt}</span>}
      </label>

      <label className="field">
        <span>제한 시간 (분)</span>
        <input className="input" type="number" inputMode="numeric" min={5} max={180} value={duration}
          onChange={(e) => setDuration(e.target.value)} />
        {errors.durationMin && <span className="form-error">{errors.durationMin}</span>}
      </label>

      <fieldset className="field">
        <legend>공개 범위</legend>
        <label className="radio"><input type="radio" name="vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개</label>
        <label className="radio"><input type="radio" name="vis" checked={visibility === 'invite'} onChange={() => setVisibility('invite')} /> 초대 링크로만</label>
      </fieldset>

      {isAdmin && (
        <label className="radio">
          <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} /> 공식 대회
        </label>
      )}

      <fieldset className="field">
        <legend>문제 구성 (모두 {total}문제)</legend>
        {items.map((it, i) => {
          const g = games.find((x) => x.manifest.id === it.game_id)
          return (
            <div key={i} className="card item-card">
              <label className="field">
                <span>게임</span>
                <select className="input" value={it.game_id}
                  onChange={(e) => patchItem(i, { game_id: e.target.value, options: defaultOptions(e.target.value) })}>
                  {allowed.map((a) => <option key={a.manifest.id} value={a.manifest.id}>{a.manifest.name}</option>)}
                </select>
              </label>
              {g?.manifest.options.map((o) => (
                <label key={o.key} className="field">
                  <span>{o.label}</span>
                  <select className="input" value={it.options[o.key] ?? o.default}
                    onChange={(e) => patchItem(i, { options: { ...it.options, [o.key]: e.target.value } })}>
                    {o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
              ))}
              <label className="field">
                <span>문제 수</span>
                <input className="input" type="number" inputMode="numeric" min={1} max={10} value={Number.isFinite(it.count) ? it.count : ''}
                  onChange={(e) => patchItem(i, { count: e.target.value === '' ? NaN : Number(e.target.value) })} />
              </label>
              {items.length > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => setItems((prev) => prev.filter((_, k) => k !== i))}>
                  이 항목 삭제
                </button>
              )}
            </div>
          )
        })}
        {errors.items && <span className="form-error">{errors.items}</span>}
        {allowed.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() =>
            setItems((prev) => [...prev, { game_id: allowed[0].manifest.id, options: defaultOptions(allowed[0].manifest.id), count: 1 }])}>
            문제 항목 추가
          </button>
        )}
      </fieldset>

      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '만드는 중…' : '대회 만들기'}</button>
    </form>
  )
}
