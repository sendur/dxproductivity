import { useMemo, useState } from 'react'
import { useWidth } from '../utils/useWidth'
import {
  SEGMENTS,
  SEGMENT_ORDER,
  classify,
  defaultHigherIsBetter,
  isAiMetric,
  loadAiConfig,
  saveAiConfig,
  scoreCut,
  type AiConfig,
  type AiRow,
  type Segment
} from '../utils/aiSegments'
import {
  DIMENSIONS,
  compareLevels,
  dimensionValue,
  toCsv,
  type Dimension,
  type TimeWindow
} from '../utils/analytics'
import { formatNumber } from '../utils/format'
import type { Dataset, Engineer } from '../../../shared/types'

interface Props {
  dataset: Dataset
  engineers: Engineer[]
  timeWindow: TimeWindow
  onSelectEngineer: (email: string) => void
}

function formatScore(score: number | null, config: AiConfig): string {
  if (score === null) return '—'
  return config.yMode === 'peers'
    ? `${formatNumber(score, 0)}th pct`
    : `${score >= 0 ? '+' : ''}${formatNumber(score, 1)}%`
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Stable 0..1 jitter per engineer so non-AI dots don't stack on one spot. */
function jitter(email: string, salt: number): number {
  let h = salt
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

function QuadrantChart({
  rows,
  config,
  aiMetricName,
  selected,
  onSelectEngineer
}: {
  rows: AiRow[]
  config: AiConfig
  aiMetricName: string
  selected: Segment | null
  onSelectEngineer: (email: string) => void
}): React.JSX.Element {
  const [containerRef, width] = useWidth<HTMLDivElement>(640, 320)
  const [hover, setHover] = useState<{ row: AiRow; x: number; y: number } | null>(null)

  const height = 440
  const pad = { top: 16, right: 16, bottom: 44, left: 52 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  // Left band holds non-AI users (x isn't meaningful for them); the rest is a linear AI-usage axis.
  const bandW = Math.max(56, plotW * 0.16)
  const gap = 10
  const classified = rows.filter((r) => r.segment && r.aiUsage !== null && r.score !== null)
  const users = classified.filter((r) => r.aiUsage! > config.aiThreshold)
  const xMax = Math.max(config.aiThreshold + 1e-9, ...users.map((r) => r.aiUsage!)) * 1.04
  const xUser = (v: number): number =>
    pad.left +
    bandW +
    gap +
    ((v - config.aiThreshold) / (xMax - config.aiThreshold || 1)) * (plotW - bandW - gap)

  const cut = scoreCut(config)
  let yMin = 0
  let yMax = 100
  if (config.yMode === 'change') {
    const extent = Math.min(100, Math.max(10, ...classified.map((r) => Math.abs(r.score!))) * 1.1)
    yMin = -extent
    yMax = extent
  }
  const y = (v: number): number =>
    pad.top + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * plotH
  const xOf = (r: AiRow): number =>
    r.aiUsage! > config.aiThreshold
      ? xUser(r.aiUsage!)
      : pad.left + 8 + jitter(r.engineer.email, 7) * (bandW - 16)

  const xTicks = [0.25, 0.5, 0.75, 1].map(
    (t) => config.aiThreshold + t * (xMax / 1.04 - config.aiThreshold)
  )
  const yTicks =
    config.yMode === 'peers' ? [0, 25, 50, 75, 100] : [yMin, yMin / 2, 0, yMax / 2, yMax]
  const divX = pad.left + bandW + gap / 2
  const count = (s: Segment): number => classified.filter((r) => r.segment === s).length

  const quadrants: { seg: Segment; x: number; y: number; w: number; h: number }[] = [
    { seg: 'strongNoAi', x: pad.left, y: pad.top, w: divX - pad.left, h: y(cut) - pad.top },
    { seg: 'noAi', x: pad.left, y: y(cut), w: divX - pad.left, h: pad.top + plotH - y(cut) },
    { seg: 'accelerated', x: divX, y: pad.top, w: pad.left + plotW - divX, h: y(cut) - pad.top },
    {
      seg: 'ineffective',
      x: divX,
      y: y(cut),
      w: pad.left + plotW - divX,
      h: pad.top + plotH - y(cut)
    }
  ]

  return (
    <div className="quadrant" ref={containerRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="AI usage versus performance, one dot per engineer"
      >
        {quadrants.map((q) => (
          <rect
            key={q.seg}
            className={`quad-bg${selected === q.seg ? ' on' : ''}`}
            x={q.x}
            y={q.y}
            width={Math.max(0, q.w)}
            height={Math.max(0, q.h)}
          />
        ))}
        <g className="axis">
          {yTicks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end">
                {config.yMode === 'peers'
                  ? formatNumber(t, 0)
                  : `${t > 0 ? '+' : ''}${formatNumber(t, 0)}%`}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={xUser(t)} y={pad.top + plotH + 16} textAnchor="middle">
              {formatNumber(t)}
            </text>
          ))}
          <text x={pad.left + bandW / 2} y={pad.top + plotH + 16} textAnchor="middle">
            No AI
          </text>
          <text
            className="axis-title"
            x={pad.left + bandW + gap + (plotW - bandW - gap) / 2}
            y={height - 6}
            textAnchor="middle"
          >
            {aiMetricName} →
          </text>
          <text
            className="axis-title"
            transform={`translate(14 ${pad.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {config.yMode === 'peers'
              ? 'Performance vs. peers (percentile) →'
              : 'Change in performance over window →'}
          </text>
        </g>
        <line className="divider" x1={divX} x2={divX} y1={pad.top} y2={pad.top + plotH} />
        <line className="divider" x1={pad.left} x2={pad.left + plotW} y1={y(cut)} y2={y(cut)} />
        {quadrants.map((q) => {
          const top = q.seg === 'accelerated' || q.seg === 'strongNoAi'
          const right = q.seg === 'accelerated' || q.seg === 'ineffective'
          return (
            <text
              key={q.seg}
              className="quad-label"
              x={right ? q.x + q.w - 8 : q.x + 6}
              y={top ? q.y + 16 : q.y + q.h - 8}
              textAnchor={right ? 'end' : 'start'}
            >
              {right
                ? `${SEGMENTS[q.seg].label} · ${count(q.seg)}`
                : `${top ? 'Strong' : 'Trailing'} · ${count(q.seg)}`}
            </text>
          )
        })}
        {classified.map((r) => (
          <circle
            key={r.engineer.email}
            className={`dot-mark seg-${r.segment}${selected && selected !== r.segment ? ' dim' : ''}`}
            cx={xOf(r)}
            cy={y(r.score!)}
            r={hover?.row === r ? 7 : 5}
            onMouseMove={(e) => setHover({ row: r, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelectEngineer(r.engineer.email)}
          />
        ))}
      </svg>
      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 240),
            top: Math.min(hover.y + 14, window.innerHeight - 160)
          }}
        >
          <div className="t-title">{hover.row.engineer.name}</div>
          <div className="t-row">
            <span>Segment</span>
            <b>{SEGMENTS[hover.row.segment!].label}</b>
          </div>
          <div className="t-row">
            <span>
              {hover.row.engineer.teamName} · {hover.row.engineer.level}
            </span>
          </div>
          <div className="t-row">
            <span>{aiMetricName}</span>
            <b>{formatNumber(hover.row.aiUsage)}</b>
          </div>
          <div className="t-row">
            <span>Performance</span>
            <b>{formatScore(hover.row.score, config)}</b>
          </div>
        </div>
      )}
    </div>
  )
}

function SegmentBar({ counts, total }: { counts: number[]; total: number }): React.JSX.Element {
  return (
    <div className="seg-bar" aria-hidden>
      {counts.map((c, i) =>
        c > 0 ? (
          <span
            key={SEGMENT_ORDER[i]}
            className={`seg-${SEGMENT_ORDER[i]}`}
            style={{ width: `${(c / total) * 100}%` }}
          />
        ) : null
      )}
    </div>
  )
}

export function AiImpactView({
  dataset,
  engineers,
  timeWindow,
  onSelectEngineer
}: Props): React.JSX.Element {
  const [config, setConfig] = useState<AiConfig>(() => loadAiConfig(dataset.metrics))
  const [selected, setSelected] = useState<Segment | null>(null)
  const [dimension, setDimension] = useState<Dimension>('team')
  const [showConfig, setShowConfig] = useState(false)

  const update = (patch: Partial<AiConfig>): void => {
    const next = { ...config, ...patch }
    setConfig(next)
    saveAiConfig(next)
  }

  const rows = useMemo(
    () => classify(engineers, dataset.points, config, timeWindow),
    [engineers, dataset.points, config, timeWindow]
  )
  const metricName = (key: string): string =>
    dataset.metrics.find((m) => m.key === key)?.name ?? key
  const aiMetricName = config.aiMetric ? metricName(config.aiMetric) : 'AI usage'
  const classified = useMemo(() => rows.filter((r) => r.segment), [rows])
  const unclassified = rows.length - classified.length
  const primary = config.perfMetrics[0]

  const groups = useMemo(() => {
    const map = new Map<string, AiRow[]>()
    for (const r of classified) {
      const key = dimension === 'engineer' ? r.engineer.name : dimensionValue(r.engineer, dimension)
      map.set(key, [...(map.get(key) ?? []), r])
    }
    const list = [...map].map(([key, members]) => ({
      key,
      members,
      counts: SEGMENT_ORDER.map((s) => members.filter((m) => m.segment === s).length)
    }))
    return dimension === 'level'
      ? list.sort((a, b) => compareLevels(a.key, b.key))
      : list.sort((a, b) => b.counts[0] / b.members.length - a.counts[0] / a.members.length)
  }, [classified, dimension])

  const listed = classified
    .filter((r) => !selected || r.segment === selected)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  if (!config.aiMetric) {
    return (
      <div className="card empty">
        <h2>No AI usage metric found</h2>
        <p>
          Add a DX datafeed with a per-engineer AI usage column, such as AI tool active days, % of
          AI-assisted code or Copilot/Cursor/Claude Code sessions. Columns with AI tool names are
          categorized as <b>AI</b> automatically. Or pick any metric below.
        </p>
        <select value="" onChange={(e) => update({ aiMetric: e.target.value })}>
          <option value="">Choose the AI usage metric…</option>
          {dataset.metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.category} · {m.name}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const exportCsv = (): void => {
    window.api.exportCsv(
      'AI impact segments.csv',
      toCsv(
        [
          'Engineer',
          'Email',
          'Team',
          'Level',
          'Segment',
          aiMetricName,
          config.yMode === 'peers' ? 'Performance percentile' : 'Performance change %',
          ...config.perfMetrics.map((m) => metricName(m.key))
        ],
        classified.map((r) => [
          r.engineer.name,
          r.engineer.email,
          r.engineer.teamName,
          r.engineer.level,
          SEGMENTS[r.segment!].label,
          r.aiUsage,
          r.score === null ? null : Math.round(r.score * 10) / 10,
          ...config.perfMetrics.map((m) => r.values[m.key])
        ])
      )
    )
  }

  return (
    <>
      <div className="toolbar">
        <div className="secondary" style={{ maxWidth: 760 }}>
          Engineers are split by whether they use AI (<b>{aiMetricName}</b> above{' '}
          {formatNumber(config.aiThreshold)}) and by how they perform on{' '}
          {config.perfMetrics.map((m) => metricName(m.key)).join(' + ') || 'no metrics'}{' '}
          {config.yMode === 'peers'
            ? config.withinLevel
              ? 'compared with others at the same level'
              : 'compared with everyone in view'
            : 'compared with their own earlier performance'}
          .
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowConfig(!showConfig)}>
          {showConfig ? 'Hide method' : 'Adjust method'}
        </button>
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {showConfig && (
        <div className="card">
          <div className="ai-config">
            <label className="control">
              AI usage metric
              <select
                value={config.aiMetric}
                onChange={(e) => update({ aiMetric: e.target.value })}
              >
                {dataset.metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.category} · {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              Counts as using AI when above
              <input
                type="number"
                step="any"
                min={0}
                value={config.aiThreshold}
                onChange={(e) => update({ aiThreshold: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="control">
              Performance measured as
              <select
                value={config.yMode}
                onChange={(e) => update({ yMode: e.target.value as AiConfig['yMode'] })}
              >
                <option value="peers">Percentile vs. peers</option>
                <option value="change">Change over the time window</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.withinLevel}
                disabled={config.yMode !== 'peers'}
                onChange={(e) => update({ withinLevel: e.target.checked })}
              />
              Compare within the same level
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.missingAiIsZero}
                onChange={(e) => update({ missingAiIsZero: e.target.checked })}
              />
              No AI data = not using AI
            </label>
          </div>
          <div className="control">
            Performance metrics (velocity and accuracy)
            <div className="perf-metrics">
              {dataset.metrics
                .filter((m) => m.key !== config.aiMetric && !isAiMetric(m))
                .map((m) => {
                  const chosen = config.perfMetrics.find((p) => p.key === m.key)
                  return (
                    <div key={m.key} className={`perf-metric${chosen ? ' on' : ''}`}>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={!!chosen}
                          onChange={(e) =>
                            update({
                              perfMetrics: e.target.checked
                                ? [
                                    ...config.perfMetrics,
                                    { key: m.key, higherIsBetter: defaultHigherIsBetter(m) }
                                  ]
                                : config.perfMetrics.filter((p) => p.key !== m.key)
                            })
                          }
                        />
                        {m.name} <span className="badge">{m.category}</span>
                      </label>
                      {chosen && (
                        <select
                          value={chosen.higherIsBetter ? 'higher' : 'lower'}
                          onChange={(e) =>
                            update({
                              perfMetrics: config.perfMetrics.map((p) =>
                                p.key === m.key
                                  ? { ...p, higherIsBetter: e.target.value === 'higher' }
                                  : p
                              )
                            })
                          }
                        >
                          <option value="higher">Higher is better</option>
                          <option value="lower">Lower is better</option>
                        </select>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
          <span className="muted">
            Pick at least one velocity metric (e.g. PRs merged) and one accuracy metric (e.g. change
            failure rate) so &quot;fast but sloppy&quot; AI use falls into &quot;not yet
            effective&quot;. The score is the average of the selected metrics.{' '}
            {config.yMode === 'peers'
              ? 'Each engineer is ranked against peers, and the dividing line is the median (50th percentile).'
              : "It's the % change from the first half of the window to the second, so the dividing line is no change. Use a window of 90 days or more."}
          </span>
        </div>
      )}

      <div className="seg-tiles">
        {SEGMENT_ORDER.map((s) => {
          const members = classified.filter((r) => r.segment === s)
          const primaryMedian = primary
            ? median(
                members.map((r) => r.values[primary.key]).filter((v): v is number => v !== null)
              )
            : null
          return (
            <button
              key={s}
              className={`stat seg-tile${selected === s ? ' on' : ''}`}
              onClick={() => setSelected(selected === s ? null : s)}
              aria-pressed={selected === s}
            >
              <div className="label">
                <span className={`swatch seg-${s}`} aria-hidden /> {SEGMENTS[s].label}
              </div>
              <div className="value">
                {members.length}{' '}
                <span className="sub">
                  {classified.length
                    ? `${formatNumber((members.length / classified.length) * 100, 0)}%`
                    : ''}
                </span>
              </div>
              <div className="sub">{SEGMENTS[s].blurb}</div>
              {primary && (
                <div className="sub">
                  Median {metricName(primary.key)}: <b>{formatNumber(primaryMedian)}</b>
                </div>
              )}
            </button>
          )
        })}
      </div>
      {unclassified > 0 && (
        <span className="muted">
          {unclassified} engineer{unclassified === 1 ? '' : 's'} in view couldn&apos;t be classified
          (no data for the performance metrics
          {config.missingAiIsZero ? '' : ' or the AI metric'} in this time window).
        </span>
      )}

      <div className="card">
        <div className="card-header">
          <h2>AI usage × performance</h2>
          <span className="muted">One dot per engineer · click for details</span>
        </div>
        <QuadrantChart
          rows={rows}
          config={config}
          aiMetricName={aiMetricName}
          selected={selected}
          onSelectEngineer={onSelectEngineer}
        />
        <span className="muted">
          Dots in the &quot;No AI&quot; column are spread out sideways so they don&apos;t overlap.
          Their horizontal position there has no meaning. This shows correlation, not causation, so
          use it to start a conversation, not to judge a person.
        </span>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 style={{ flex: 'none' }}>Segment mix by</h2>
          <select value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}>
            {Object.entries(DIMENSIONS)
              .filter(([k]) => k !== 'engineer')
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label.toLowerCase()}
                </option>
              ))}
          </select>
        </div>
        <div className="legend">
          {SEGMENT_ORDER.map((s) => (
            <span key={s}>
              <span className={`swatch seg-${s}`} aria-hidden /> {SEGMENTS[s].label}
            </span>
          ))}
        </div>
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table>
            <thead>
              <tr>
                <th>{DIMENSIONS[dimension]}</th>
                <th className="num">Engineers</th>
                <th style={{ width: '30%' }}>Mix</th>
                {SEGMENT_ORDER.map((seg) => (
                  <th key={seg} className="num">
                    {SEGMENTS[seg].label}
                  </th>
                ))}
                <th className="num">AI adoption</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.key}</td>
                  <td className="num">{g.members.length}</td>
                  <td>
                    <SegmentBar counts={g.counts} total={g.members.length} />
                  </td>
                  {g.counts.map((c, i) => (
                    <td key={SEGMENT_ORDER[i]} className="num">
                      {c}
                    </td>
                  ))}
                  <td className="num">
                    {formatNumber(((g.counts[0] + g.counts[1]) / g.members.length) * 100, 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{selected ? SEGMENTS[selected].label : 'All classified engineers'}</h2>
          {selected && (
            <button className="btn small" onClick={() => setSelected(null)}>
              Show all
            </button>
          )}
          <span className="muted">{listed.length} engineers · sorted by performance</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>Engineer</th>
                <th>Segment</th>
                <th>Team</th>
                <th>Level</th>
                <th className="num">{aiMetricName}</th>
                <th className="num">Performance</th>
                {config.perfMetrics.map((m) => (
                  <th key={m.key} className="num">
                    {metricName(m.key)} {m.higherIsBetter ? '↑' : '↓'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.map((r) => (
                <tr
                  key={r.engineer.email}
                  className="clickable"
                  onClick={() => onSelectEngineer(r.engineer.email)}
                >
                  <td>{r.engineer.name}</td>
                  <td>
                    <span className={`swatch seg-${r.segment}`} aria-hidden />{' '}
                    {SEGMENTS[r.segment!].label}
                  </td>
                  <td>{r.engineer.teamName}</td>
                  <td>{r.engineer.level}</td>
                  <td className="num">{formatNumber(r.aiUsage)}</td>
                  <td className="num">{formatScore(r.score, config)}</td>
                  {config.perfMetrics.map((m) => (
                    <td key={m.key} className="num">
                      {formatNumber(r.values[m.key])}
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
