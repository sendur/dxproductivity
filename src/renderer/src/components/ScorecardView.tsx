import { useMemo, useState } from 'react'
import {
  AGGREGATIONS,
  DIMENSIONS,
  compareLevels,
  engineerValues,
  groupBy,
  toCsv,
  type Aggregation,
  type Dimension,
  type TimeWindow
} from '../utils/analytics'
import { formatMoney, formatNumber } from '../utils/format'
import {
  METRIC_CATEGORIES,
  type Dataset,
  type Engineer,
  type MetricCategory
} from '../../../shared/types'

interface Props {
  dataset: Dataset
  engineers: Engineer[]
  timeWindow: TimeWindow
  onSelectEngineer: (email: string) => void
}

type SortKey = 'group' | 'count' | 'salary' | 'promoted' | string

/** Groups x metrics matrix; each metric column is shaded by its own min..max. */
export function ScorecardView({
  dataset,
  engineers,
  timeWindow,
  onSelectEngineer
}: Props): React.JSX.Element {
  const [dimension, setDimension] = useState<Dimension>('team')
  const [aggregation, setAggregation] = useState<Aggregation>('avg')
  const [categories, setCategories] = useState<MetricCategory[]>([])
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'group', desc: false })

  const presentCategories = METRIC_CATEGORIES.filter((c) =>
    dataset.metrics.some((m) => m.category === c)
  )
  const metrics = useMemo(
    () => dataset.metrics.filter((m) => categories.length === 0 || categories.includes(m.category)),
    [dataset.metrics, categories]
  )

  const table = useMemo(() => {
    const perMetric = metrics.map((m) => {
      const values = engineerValues(dataset.points, m.key, timeWindow)
      const groups = groupBy(engineers, dimension, values, aggregation)
      return new Map(groups.map((g) => [g.key + g.engineers[0].email, g.value]))
    })
    const base = groupBy(engineers, dimension, new Map(), aggregation)
    return base.map((g) => {
      const id = g.key + g.engineers[0].email
      return { group: g, id, cells: perMetric.map((m) => m.get(id) ?? null) }
    })
  }, [metrics, dataset.points, timeWindow, engineers, dimension, aggregation])

  const ranges = metrics.map((_, i) => {
    const vals = table.map((r) => r.cells[i]).filter((v): v is number => v !== null)
    return { min: Math.min(...vals), max: Math.max(...vals) }
  })

  const sorted = [...table].sort((a, b) => {
    let cmp: number
    if (sort.key === 'group') {
      cmp =
        dimension === 'level'
          ? compareLevels(a.group.key, b.group.key)
          : a.group.key.localeCompare(b.group.key)
    } else if (sort.key === 'count') {
      cmp = a.group.engineers.length - b.group.engineers.length
    } else if (sort.key === 'salary') {
      cmp = (a.group.avgSalary ?? -Infinity) - (b.group.avgSalary ?? -Infinity)
    } else if (sort.key === 'promoted') {
      cmp = a.group.promotedLast12mo - b.group.promotedLast12mo
    } else {
      const i = metrics.findIndex((m) => m.key === sort.key)
      cmp = (a.cells[i] ?? -Infinity) - (b.cells[i] ?? -Infinity)
    }
    return sort.desc ? -cmp : cmp
  })

  const header = (key: SortKey, label: string, num = true): React.JSX.Element => (
    <th
      className={num ? 'num' : ''}
      onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'group' })}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const exportCsv = (): void => {
    const head = [
      DIMENSIONS[dimension],
      'Engineers',
      'Avg salary',
      'Promoted last 12 mo',
      ...metrics.map((m) => `${m.name} (${m.category})`)
    ]
    const rows = sorted.map((r) => [
      r.group.key,
      r.group.engineers.length,
      r.group.avgSalary === null ? null : Math.round(r.group.avgSalary),
      r.group.promotedLast12mo,
      ...r.cells
    ])
    window.api.exportCsv(`Scorecard by ${DIMENSIONS[dimension]}.csv`, toCsv(head, rows))
  }

  return (
    <>
      <div className="toolbar">
        <label className="control">
          Group by
          <select value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}>
            {Object.entries(DIMENSIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          Aggregate
          <select
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value as Aggregation)}
          >
            {Object.entries(AGGREGATIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="control">
          Metric category
          <div className="chips">
            <button
              className={`chip${categories.length === 0 ? ' on' : ''}`}
              onClick={() => setCategories([])}
            >
              All
            </button>
            {presentCategories.map((c) => (
              <button
                key={c}
                className={`chip${categories.includes(c) ? ' on' : ''}`}
                onClick={() =>
                  setCategories(
                    categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c]
                  )
                }
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Scorecard by {DIMENSIONS[dimension].toLowerCase()}</h2>
          <span className="muted">
            Shading runs light to dark from each column&apos;s lowest to highest value. It shows
            size, not whether a value is good or bad.
          </span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table>
            <thead>
              <tr>
                {header('group', DIMENSIONS[dimension], false)}
                {header('count', 'Engineers')}
                {header('salary', 'Avg salary')}
                {header('promoted', 'Promoted (12 mo)')}
                {metrics.map((m) => (
                  <th
                    key={m.key}
                    className="num"
                    title={`${m.category} · ${m.feedName}`}
                    onClick={() =>
                      setSort({ key: m.key, desc: sort.key === m.key ? !sort.desc : true })
                    }
                  >
                    {m.name}
                    {sort.key === m.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                    <div className="muted" style={{ fontWeight: 400 }}>
                      {m.category}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className={dimension === 'engineer' ? 'clickable' : ''}
                  onClick={() =>
                    dimension === 'engineer' && onSelectEngineer(r.group.engineers[0].email)
                  }
                >
                  <td>{r.group.key}</td>
                  <td className="num">{r.group.engineers.length}</td>
                  <td className="num comp">
                    {formatMoney(
                      r.group.avgSalary,
                      r.group.engineers.find((e) => e.salary)?.salary?.currency
                    )}
                  </td>
                  <td className="num">{r.group.promotedLast12mo}</td>
                  {r.cells.map((v, i) => {
                    const { min, max } = ranges[i]
                    const t = v === null || max === min ? 0 : (v - min) / (max - min)
                    return (
                      <td
                        key={metrics[i].key}
                        className="heat"
                        style={{
                          background:
                            v === null
                              ? undefined
                              : `color-mix(in srgb, var(--series-1) ${Math.round(8 + t * 47)}%, transparent)`
                        }}
                      >
                        {formatNumber(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
