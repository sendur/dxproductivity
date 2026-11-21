import { MultiSelect } from './MultiSelect'
import {
  DIMENSIONS,
  FILTER_DIMENSIONS,
  TIME_WINDOWS,
  distinctValues,
  type FilterDimension,
  type Filters,
  type TimeWindow
} from '../utils/analytics'
import type { Engineer } from '../../../shared/types'

interface Props {
  engineers: Engineer[]
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  timeWindow: TimeWindow
  onWindowChange: (window: TimeWindow) => void
  /** Right-aligned summary, e.g. "12 of 48 engineers". */
  summary: string
  /** Filters shown; defaults to all of them. */
  dimensions?: FilterDimension[]
}

export function FilterBar({
  engineers,
  filters,
  onFiltersChange,
  timeWindow,
  onWindowChange,
  summary,
  dimensions = FILTER_DIMENSIONS
}: Props): React.JSX.Element {
  const anyActive = FILTER_DIMENSIONS.some((d) => filters[d]?.length)
  return (
    <div className="filter-bar">
      <select
        value={String(timeWindow)}
        onChange={(e) => {
          const v = e.target.value
          onWindowChange(v === 'latest' || v === 'all' ? v : (Number(v) as TimeWindow))
        }}
        aria-label="Time window"
      >
        {TIME_WINDOWS.map((w) => (
          <option key={String(w.value)} value={String(w.value)}>
            {w.label}
          </option>
        ))}
      </select>
      {dimensions.map((dimension) => (
        <MultiSelect
          key={dimension}
          label={DIMENSIONS[dimension]}
          options={distinctValues(engineers, dimension)}
          selected={filters[dimension] ?? []}
          onChange={(selected) => onFiltersChange({ ...filters, [dimension]: selected })}
        />
      ))}
      {anyActive && (
        <button className="btn link" onClick={() => onFiltersChange({})}>
          Clear filters
        </button>
      )}
      <span className="spacer" style={{ flex: 1 }} />
      <span className="muted">{summary}</span>
    </div>
  )
}
