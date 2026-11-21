import { useRef, useState } from 'react'
import { useWidth } from '../utils/useWidth'
import { formatDate, formatNumber } from '../utils/format'

interface TooltipState {
  x: number
  y: number
  title: string
  rows: [string, string][]
}

function Tooltip({ tip }: { tip: TooltipState | null }): React.JSX.Element | null {
  if (!tip) return null
  // Keep the tooltip on screen near the right/bottom edges.
  const left = Math.min(tip.x + 14, window.innerWidth - 220)
  const top = Math.min(tip.y + 14, window.innerHeight - 40 - tip.rows.length * 18)
  return (
    <div className="tooltip" style={{ left, top }}>
      <div className="t-title">{tip.title}</div>
      {tip.rows.map(([k, v]) => (
        <div className="t-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}

export interface BarDatum {
  key: string
  label: string
  value: number
  details: [string, string][]
}

/** Ranked horizontal bars anchored at zero; one series, so no legend. */
export function BarList({
  data,
  onSelect
}: {
  data: BarDatum[]
  onSelect?: (key: string) => void
}): React.JSX.Element {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const max = Math.max(0, ...data.map((d) => d.value))
  const min = Math.min(0, ...data.map((d) => d.value))
  const span = max - min || 1
  if (data.length === 0) return <div className="muted">No data for this selection.</div>
  return (
    <div className="bar-list" onMouseLeave={() => setTip(null)}>
      {data.map((d) => (
        <div
          key={d.key}
          className="bar-row"
          style={{ cursor: onSelect ? 'pointer' : undefined }}
          onClick={() => onSelect?.(d.key)}
          onMouseMove={(e) =>
            setTip({ x: e.clientX, y: e.clientY, title: d.label, rows: d.details })
          }
        >
          <span className="bar-label" title={d.label}>
            {d.label}
          </span>
          <div className="bar-track">
            <div
              className="bar"
              style={{
                marginLeft: `${((Math.min(0, d.value) - min) / span) * 100}%`,
                width: `${(Math.abs(d.value) / span) * 100}%`
              }}
            />
          </div>
          <span className="bar-value">{formatNumber(d.value)}</span>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  )
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / count)))
  const err = (max - min) / count / step
  const nice = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1)
  const ticks: number[] = []
  for (let v = Math.floor(min / nice) * nice; v <= max + nice * 0.001; v += nice) ticks.push(v)
  return ticks
}

/** Single-series line over periods with a crosshair tooltip. */
export function TrendChart({
  data,
  height = 260,
  formatValue = (v) => formatNumber(v),
  countLabel = 'Engineers'
}: {
  data: { period: string; value: number; n: number }[]
  height?: number
  formatValue?: (v: number) => string
  countLabel?: string
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [tip, setTip] = useState<TooltipState | null>(null)
  const drawable = data.length >= 2
  const [containerRef, width] = useWidth<HTMLDivElement>(600, 240, [drawable])
  if (!drawable) {
    return (
      <div className="muted" ref={containerRef}>
        A trend appears once there are at least two periods of data (each sync adds one if your DX
        query has no period column).
      </div>
    )
  }
  const pad = { top: 10, right: 12, bottom: 24, left: 56 }
  const values = data.map((d) => d.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const ticks = niceTicks(Math.min(0, lo), hi)
  const yMin = Math.min(ticks[0], lo)
  const yMax = Math.max(ticks[ticks.length - 1], hi)
  const x = (i: number): number =>
    pad.left + (i / (data.length - 1)) * (width - pad.left - pad.right)
  const y = (v: number): number =>
    pad.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - pad.top - pad.bottom)
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ')
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(width / 90)))

  const onMove = (e: React.MouseEvent): void => {
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const i = Math.round(((px - pad.left) / (width - pad.left - pad.right)) * (data.length - 1))
    const idx = Math.max(0, Math.min(data.length - 1, i))
    setHover(idx)
    setTip({
      x: e.clientX,
      y: e.clientY,
      title: formatDate(data[idx].period),
      rows: [
        ['Value', formatValue(data[idx].value)],
        [countLabel, String(data[idx].n)]
      ]
    })
  }

  return (
    <div className="trend" ref={containerRef}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null)
          setTip(null)
        }}
        role="img"
        aria-label="Trend over time"
      >
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end">
                {formatValue(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text key={d.period} x={x(i)} y={height - 6} textAnchor="middle">
                {formatDate(d.period).replace(/,? \d{4}$/, '')}
              </text>
            ) : null
          )}
        </g>
        <path className="line" d={path} />
        {hover !== null && (
          <>
            <line
              className="crosshair"
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={height - pad.bottom}
            />
            <circle className="marker" cx={x(hover)} cy={y(data[hover].value)} r={5} />
          </>
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={width - pad.left - pad.right}
          height={height - pad.top - pad.bottom}
          fill="transparent"
        />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

export function Sparkline({
  values,
  width = 160,
  height = 32
}: {
  values: number[]
  width?: number
  height?: number
}): React.JSX.Element | null {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const d = values
    .map((v, i) => {
      const px = (i / (values.length - 1)) * (width - 4) + 2
      const py = height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)
      return `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="sparkline" width={width} height={height} aria-hidden>
      <path d={d} />
    </svg>
  )
}
