import { useMemo, useState } from 'react'
import { compareLevels, engineerValues, toCsv, type TimeWindow } from '../utils/analytics'
import { formatDate, formatMoney, formatNumber } from '../utils/format'
import type { Dataset, Engineer } from '../../../shared/types'

interface Props {
  dataset: Dataset
  engineers: Engineer[]
  timeWindow: TimeWindow
  onSelectEngineer: (email: string) => void
}

type Column = {
  key: string
  label: string
  num?: boolean
  comp?: boolean
  value: (e: Engineer) => string | number | null
  render?: (e: Engineer) => React.ReactNode
}

export function EngineersView({
  dataset,
  engineers,
  timeWindow,
  onSelectEngineer
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [metricKey, setMetricKey] = useState(dataset.metrics[0]?.key ?? '')
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'name', desc: false })

  const metric = dataset.metrics.find((m) => m.key === metricKey)
  const values = useMemo(
    () =>
      metric ? engineerValues(dataset.points, metric.key, timeWindow) : new Map<string, number>(),
    [dataset.points, metric, timeWindow]
  )

  const columns: Column[] = [
    { key: 'name', label: 'Engineer', value: (e) => e.name },
    { key: 'team', label: 'Team', value: (e) => e.teamName },
    { key: 'title', label: 'Job title', value: (e) => e.jobTitle },
    { key: 'level', label: 'Level', value: (e) => e.level },
    { key: 'role', label: 'Role type', value: (e) => e.roleType },
    { key: 'employment', label: 'Employment', value: (e) => e.employmentType },
    {
      key: 'salary',
      label: 'Salary (annual)',
      num: true,
      comp: true,
      value: (e) => e.salary?.annual ?? null,
      render: (e) => formatMoney(e.salary?.annual, e.salary?.currency)
    },
    {
      key: 'lastPromo',
      label: 'Last promotion',
      value: (e) => e.promotions[e.promotions.length - 1]?.date ?? null,
      render: (e) => formatDate(e.promotions[e.promotions.length - 1]?.date)
    },
    { key: 'promos', label: 'Promotions', num: true, value: (e) => e.promotions.length },
    ...(metric
      ? [
          {
            key: 'metric',
            label: metric.name,
            num: true,
            value: (e: Engineer) => values.get(e.email) ?? null,
            render: (e: Engineer) => formatNumber(values.get(e.email))
          }
        ]
      : [])
  ]

  const q = query.trim().toLowerCase()
  const visible = engineers.filter(
    (e) =>
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.email.includes(q) ||
      e.jobTitle.toLowerCase().includes(q) ||
      e.teamName.toLowerCase().includes(q)
  )
  const sortColumn = columns.find((c) => c.key === sort.key) ?? columns[0]
  const sorted = [...visible].sort((a, b) => {
    const va = sortColumn.value(a)
    const vb = sortColumn.value(b)
    let cmp: number
    if (va === null || vb === null) cmp = va === vb ? 0 : va === null ? 1 : -1
    else if (sortColumn.key === 'level') cmp = compareLevels(String(va), String(vb))
    else if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else cmp = String(va).localeCompare(String(vb))
    // Missing values always sink to the bottom regardless of direction.
    return va === null || vb === null ? cmp : sort.desc ? -cmp : cmp
  })

  const exportCsv = (): void => {
    window.api.exportCsv(
      'Engineers.csv',
      toCsv(
        ['Email', ...columns.map((c) => c.label)],
        sorted.map((e) => [e.email, ...columns.map((c) => c.value(e))])
      )
    )
  }

  return (
    <>
      <div className="toolbar">
        <label className="control" style={{ flex: 1, maxWidth: 360 }}>
          Search
          <input
            type="search"
            placeholder="Name, email, title or team"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {dataset.metrics.length > 0 && (
          <label className="control">
            Metric column
            <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
              {dataset.metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.category} · {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      <div className="card">
        <div className="card-header">
          <h2>Engineers</h2>
          <span className="muted">
            {sorted.length} shown · click a row to see compensation, promotions and metric history
          </span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 290px)' }}>
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={c.num ? 'num' : ''}
                    onClick={() =>
                      setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : !!c.num })
                    }
                  >
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.email} className="clickable" onClick={() => onSelectEngineer(e.email)}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[c.num ? 'num' : '', c.comp ? 'comp' : ''].join(' ')}
                    >
                      {c.render ? c.render(e) : (c.value(e) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
