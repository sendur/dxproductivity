import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}

/** Dropdown of checkboxes. Nothing selected = no filter ("All"). */
export function MultiSelect({ label, options, selected, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const visible = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
  const toggle = (option: string): void =>
    onChange(
      selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option]
    )
  const summary =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`

  return (
    <div className="multiselect" ref={ref}>
      <button
        className={`btn multiselect-button${selected.length ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className="label">{label}:</span> {summary} ▾
      </button>
      {open && (
        <div className="popover">
          {options.length > 8 && (
            <input
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          <div className="popover-list">
            {visible.map((option) => (
              <label key={option}>
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggle(option)}
                />
                {option}
              </label>
            ))}
            {visible.length === 0 && <span className="muted">No matches</span>}
          </div>
          <div className="popover-actions">
            <button className="btn small" onClick={() => onChange(visible)}>
              Select shown
            </button>
            <button className="btn small" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
