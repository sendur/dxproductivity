import type { Engineer, MetricPoint } from '../../../shared/types'

export const DIMENSIONS = {
  engineer: 'Engineer',
  teamGroup: 'Team group',
  team: 'Team',
  level: 'Level',
  roleType: 'Role type',
  employmentType: 'Employment type'
} as const
export type Dimension = keyof typeof DIMENSIONS
export type FilterDimension = Exclude<Dimension, 'engineer'>
export const FILTER_DIMENSIONS: FilterDimension[] = [
  'teamGroup',
  'team',
  'level',
  'roleType',
  'employmentType'
]

export type Filters = Partial<Record<FilterDimension, string[]>>

export const AGGREGATIONS = {
  avg: 'Average',
  median: 'Median',
  p75: '75th percentile',
  sum: 'Total',
  min: 'Min',
  max: 'Max'
} as const
export type Aggregation = keyof typeof AGGREGATIONS

/** 'latest' = most recent period only; a number = trailing days; 'all' = everything stored. */
export type TimeWindow = 'latest' | 30 | 90 | 180 | 365 | 'all'
export const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: 'latest', label: 'Latest period' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last 12 months' },
  { value: 'all', label: 'All history' }
]

export function dimensionValue(engineer: Engineer, dimension: Dimension): string {
  switch (dimension) {
    case 'engineer':
      return engineer.name
    case 'teamGroup':
      return engineer.teamPath[0] ?? engineer.teamName
    case 'team':
      return engineer.teamName
    case 'level':
      return engineer.level || 'Unknown'
    case 'roleType':
      return engineer.roleType || 'Other'
    case 'employmentType':
      return engineer.employmentType || 'Unknown'
  }
}

export function applyFilters(engineers: Engineer[], filters: Filters): Engineer[] {
  const active = FILTER_DIMENSIONS.filter((d) => filters[d]?.length)
  if (active.length === 0) return engineers
  return engineers.filter((e) => active.every((d) => filters[d]!.includes(dimensionValue(e, d))))
}

const LEVEL_ORDER = [
  'Intern',
  'Junior',
  'Mid',
  'Senior',
  'Staff',
  'Senior Staff',
  'Principal',
  'Distinguished',
  'Manager',
  'Director+',
  'Unknown'
]

/** Orders levels like L3 < L4 < L10 and Junior < Senior < Staff instead of alphabetically. */
export function compareLevels(a: string, b: string): number {
  const code = (s: string): [string, number] | null => {
    const m = s.match(/^([A-Za-z]+)\s?-?(\d+)$/)
    return m ? [m[1].toUpperCase(), Number(m[2])] : null
  }
  const ca = code(a)
  const cb = code(b)
  if (ca && cb) return ca[0] === cb[0] ? ca[1] - cb[1] : ca[0].localeCompare(cb[0])
  if (ca) return -1
  if (cb) return 1
  const ia = LEVEL_ORDER.indexOf(a)
  const ib = LEVEL_ORDER.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b)
}

export function distinctValues(engineers: Engineer[], dimension: FilterDimension): string[] {
  const values = [...new Set(engineers.map((e) => dimensionValue(e, dimension)))]
  return dimension === 'level' ? values.sort(compareLevels) : values.sort()
}

export function aggregate(values: number[], how: Aggregation): number | null {
  if (values.length === 0) return null
  switch (how) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    case 'median':
      return quantile(values, 0.5)
    case 'p75':
      return quantile(values, 0.75)
  }
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Points for one metric that fall inside the window. */
export function pointsInWindow<T extends { metric: string; period: string }>(
  points: T[],
  metric: string,
  window: TimeWindow,
  today = new Date().toISOString().slice(0, 10)
): T[] {
  const forMetric = points.filter((p) => p.metric === metric)
  if (window === 'all') return forMetric
  if (window === 'latest') {
    const latest = forMetric.reduce((max, p) => (p.period > max ? p.period : max), '')
    return forMetric.filter((p) => p.period === latest)
  }
  const start = addDays(today, -window)
  return forMetric.filter((p) => p.period >= start)
}

/** Each engineer's value for a metric: the mean of their periods inside the window. */
export function engineerValues(
  points: MetricPoint[],
  metric: string,
  window: TimeWindow
): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>()
  for (const p of pointsInWindow(points, metric, window)) {
    const s = sums.get(p.email) ?? { total: 0, n: 0 }
    s.total += p.value
    s.n++
    sums.set(p.email, s)
  }
  return new Map([...sums].map(([email, s]) => [email, s.total / s.n]))
}

export interface GroupRow {
  key: string
  engineers: Engineer[]
  /** Engineers in the group that have a value for the metric. */
  withData: number
  value: number | null
  avgSalary: number | null
  /** Engineers promoted in the last 12 months. */
  promotedLast12mo: number
}

export function promotedWithin(engineer: Engineer, days: number, today: string): boolean {
  const since = addDays(today, -days)
  return engineer.promotions.some((p) => p.date >= since && p.date <= today)
}

export function groupBy(
  engineers: Engineer[],
  dimension: Dimension,
  values: Map<string, number>,
  how: Aggregation,
  today = new Date().toISOString().slice(0, 10)
): GroupRow[] {
  const groups = new Map<string, Engineer[]>()
  for (const e of engineers) {
    const key = dimension === 'engineer' ? e.email : dimensionValue(e, dimension)
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  return [...groups].map(([key, members]) => {
    const metricValues = members.map((e) => values.get(e.email)).filter((v) => v !== undefined)
    const salaries = members.map((e) => e.salary?.annual).filter((v) => v !== undefined)
    return {
      key: dimension === 'engineer' ? members[0].name : key,
      engineers: members,
      withData: metricValues.length,
      value: aggregate(metricValues as number[], how),
      avgSalary: aggregate(salaries as number[], 'avg'),
      promotedLast12mo: members.filter((e) => promotedWithin(e, 365, today)).length
    }
  })
}

export function sortGroups(rows: GroupRow[], dimension: Dimension): GroupRow[] {
  if (dimension === 'level') return [...rows].sort((a, b) => compareLevels(a.key, b.key))
  return [...rows].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
}

/** Per-period aggregate across the given engineers, for trend lines. */
export function trend(
  points: MetricPoint[],
  metric: string,
  emails: Set<string>,
  how: Aggregation
): { period: string; value: number; n: number }[] {
  const byPeriod = new Map<string, number[]>()
  for (const p of points) {
    if (p.metric !== metric || !emails.has(p.email)) continue
    byPeriod.set(p.period, [...(byPeriod.get(p.period) ?? []), p.value])
  }
  return [...byPeriod]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, value: aggregate(vals, how)!, n: vals.length }))
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n')
}
