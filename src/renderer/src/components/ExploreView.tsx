import { useMemo, useState } from 'react'
import { BarList, TrendChart } from './Charts'
import {
  AGGREGATIONS,
  DIMENSIONS,
  aggregate,
  promotedWithin,
  engineerValues,
  groupBy,
  sortGroups,
  toCsv,
  trend,
  type Aggregation,
  type Dimension,
  type TimeWindow
} from '../utils/analytics'
import { formatMoney, formatNumber } from '../utils/format'
import { METRIC_CATEGORIES, type Dataset, type Engineer } from '../../../shared/types'

interface Props {
  dataset: Dataset
  engineers: Engineer[]
  timeWindow: TimeWindow
  onSelectEngineer: (email: string) => void
}

export function ExploreView({
  dataset,
  engineers,
  timeWindow,
  onSelectEngineer
}: Props): React.JSX.Element {
  const [metricKey, setMetricKey] = useState(dataset.metrics[0]?.key ?? '')
  const [aggregation, setAggregation] = useState<Aggregation>('avg')
  const [dimension, setDimension] = useState<Dimension>('team')

  const metric = dataset.metrics.find((m) => m.key === metricKey) ?? dataset.metrics[0]
  const values = useMemo(
    () =>
      metric ? engineerValues(dataset.points, metric.key, timeWindow) : new Map<string, number>(),
    [dataset.points, metric, timeWindow]
  )
  const groups = useMemo(
    () => sortGroups(groupBy(engineers, dimension, values, aggregation), dimension),
    [engineers, dimension, values, aggregation]
  )
  const trendData = useMemo(
    () =>
      metric
        ? trend(dataset.points, metric.key, new Set(engineers.map((e) => e.email)), aggregation)
        : [],
    [dataset.points, metric, engineers, aggregation]
  )

  if (!metric) return <div className="card muted">No metrics yet. Run a sync from Settings.</div>

  const withValues = engineers.filter((e) => values.has(e.email))
  const overall = aggregate(
    withValues.map((e) => values.get(e.email)!),
    aggregation
  )
  const salaried = engineers.filter((e) => e.salary)
  const today = new Date().toISOString().slice(0, 10)
  const promoted = engineers.filter((e) => promotedWithin(e, 365, today)).length

  const exportCsv = (): void => {
    const header = [
      DIMENSIONS[dimension],
      'Engineers',
      'Engineers with data',
      `${metric.name} (${AGGREGATIONS[aggregation]})`,
      'Avg salary',
      'Promoted last 12 mo'
    ]
    const rows = groups.map((g) => [
      g.key,
      g.engineers.length,
      g.withData,
      g.value,
      g.avgSalary === null ? null : Math.round(g.avgSalary),
      g.promotedLast12mo
    ])
    window.api.exportCsv(`${metric.name} by ${DIMENSIONS[dimension]}.csv`, toCsv(header, rows))
  }

  return (
    <>
      <div className="toolbar">
        <label className="control">
          Metric
          <select value={metric.key} onChange={(e) => setMetricKey(e.target.value)}>
            {METRIC_CATEGORIES.map((category) => {
              const inCategory = dataset.metrics.filter((m) => m.category === category)
              if (!inCategory.length) return null
              return (
                <optgroup key={category} label={category}>
                  {inCategory.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                      {dataset.metrics.filter((o) => o.name === m.name).length > 1
                        ? ` (${m.feedName})`
                        : ''}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </label>
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
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">
            {metric.name} · {AGGREGATIONS[aggregation]}
          </div>
          <div className="value">{formatNumber(overall)}</div>
          <div className="sub">
            <span className="badge">{metric.category}</span> {withValues.length} engineers with data
          </div>
        </div>
        <div className="stat">
          <div className="label">Engineers in view</div>
          <div className="value">{engineers.length}</div>
          <div className="sub">{groups.length} groups</div>
        </div>
        <div className="stat">
          <div className="label">Average salary</div>
          <div className="value comp">
            {formatMoney(
              salaried.length
                ? salaried.reduce((s, e) => s + e.salary!.annual, 0) / salaried.length
                : null,
              salaried[0]?.salary?.currency
            )}
          </div>
          <div className="sub">{salaried.length} with BambooHR comp</div>
        </div>
        <div className="stat">
          <div className="label">Promoted, last 12 months</div>
          <div className="value">{promoted}</div>
          <div className="sub">
            {engineers.length
              ? `${formatNumber((promoted / engineers.length) * 100, 0)}% of engineers in view`
              : '—'}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h2>
              {metric.name} by {DIMENSIONS[dimension].toLowerCase()}
            </h2>
            <span className="muted">{AGGREGATIONS[aggregation]} per group</span>
          </div>
          <BarList
            data={groups
              .filter((g) => g.value !== null)
              .map((g) => ({
                key: dimension === 'engineer' ? g.engineers[0].email : g.key,
                label: g.key,
                value: g.value!,
                details: [
                  [metric.name, formatNumber(g.value)],
                  ['Engineers', `${g.withData} / ${g.engineers.length}`],
                  ['Promoted (12 mo)', String(g.promotedLast12mo)]
                ]
              }))}
            onSelect={dimension === 'engineer' ? onSelectEngineer : undefined}
          />
        </div>
        <div className="card">
          <div className="card-header">
            <h2>Trend</h2>
            <span className="muted">
              {AGGREGATIONS[aggregation]} across the {engineers.length} filtered engineers, all
              history
            </span>
          </div>
          <TrendChart data={trendData} />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Breakdown</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{DIMENSIONS[dimension]}</th>
                <th className="num">Engineers</th>
                <th className="num">With data</th>
                <th className="num">{metric.name}</th>
                <th className="num">Avg salary</th>
                <th className="num">Promoted (12 mo)</th>
                <th className="num">Promotion rate</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.key + g.engineers[0].email}
                  className={dimension === 'engineer' ? 'clickable' : ''}
                  onClick={() => dimension === 'engineer' && onSelectEngineer(g.engineers[0].email)}
                >
                  <td>{g.key}</td>
                  <td className="num">{g.engineers.length}</td>
                  <td className="num">{g.withData}</td>
                  <td className="num">{formatNumber(g.value)}</td>
                  <td className="num comp">
                    {formatMoney(g.avgSalary, g.engineers.find((e) => e.salary)?.salary?.currency)}
                  </td>
                  <td className="num">{g.promotedLast12mo}</td>
                  <td className="num">
                    {formatNumber((g.promotedLast12mo / g.engineers.length) * 100, 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
