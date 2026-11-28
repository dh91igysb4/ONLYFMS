import type { Manifest } from '../../games/types.ts'

export const defaultOptions = (m: Manifest): Record<string, string> =>
  Object.fromEntries(m.options.map((o) => [o.key, o.default]))

/** manifest `options` 선택 칸 (대국 만들기·같은 화면 시작에서 함께 쓴다) */
export function OptionSelects({ manifest, value, onChange, rowClass = 'field' }: {
  manifest: Manifest
  /** 칸 하나를 감싸는 label의 클래스. FM 양식 안에서는 'fm-form-row' */
  rowClass?: string
  value: Record<string, string>
  onChange(next: Record<string, string>): void
}) {
  return (
    <>
      {manifest.options.map((o) => (
        <label key={o.key} className={rowClass}>
          <span>{o.label}</span>
          <select className="input" value={value[o.key] ?? o.default}
            onChange={(e) => onChange({ ...value, [o.key]: e.target.value })}>
            {o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      ))}
    </>
  )
}
