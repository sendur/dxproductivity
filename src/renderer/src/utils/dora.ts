import { addDays, type Filters, type TimeWindow } from './analytics'
import type { Dataset, MetricDef } from '../../../shared/types'

// DORA's four keys. Values are normalized to deploys/day, hours, and percent so they can be
// rated against the DORA (State of DevOps) performance levels.

export const DORA_KEYS = [
  'deploymentFrequency',
  'leadTime',
  'changeFailureRate',
  'recoveryTime'
] as const
export type DoraKey = (typeof DORA_KEYS)[number]

export const DORA_INFO: Record<
  DoraKey,
  { label: string; higherIsBetter: boolean; units: string[]; help: string }
> = {
  deploymentFrequency: {
    label: 'Deployment frequency',
    higherIsBetter: true,
    units: ['per day', 'per week', 'per month'],
    help: 'How often a team ships to production. Elite: on demand (daily or more).'
  },
  leadTime: {
    label: 'Lead time for changes',
    higherIsBetter: false,
    units: ['minutes', 'hours', 'days'],
    help: 'Commit to production. Elite: under a day.'
  },
  changeFailureRate: {
    label: 'Change failure rate',
    higherIsBetter: false,
    units: ['percent', 'ratio'],
    help: 'Share of deployments causing a failure in production. Elite: 5% or less.'
  },
  recoveryTime: {
    label: 'Failed deployment recovery time',
    higherIsBetter: false,
    units: ['minutes', 'hours', 'days'],
    help: 'Time to restore service after a failed deployment. Elite: under an hour.'
  }
}

export const TIERS = ['Elite', 'High', 'Medium', 'Low'] as const
export type Tier = (typeof TIERS)[number]

export interface DoraMapping {
  /** Metric key, or '' when not mapped. */
  metric: string
  unit: string
}
export type DoraConfig = Record<DoraKey, DoraMapping>

/** Converts a raw metric value to deploys/day, hours, or percent. */
export function normalize(key: DoraKey, unit: string, value: number): number {
  switch (key) {
    case 'deploymentFrequency':
      return unit === 'per week' ? value / 7 : unit === 'per month' ? value / 30 : value
    case 'changeFailureRate':
      return unit === 'ratio' ? value * 100 : value
    default:
      return unit === 'minutes' ? value / 60 : unit === 'days' ? value * 24 : value
  }
}

/** DORA performance levels (State of DevOps benchmarks). */
export function tierOf(key: DoraKey, value: number): Tier {
  switch (key) {
    case 'deploymentFrequency':
      return value >= 1 ? 'Elite' : value >= 1 / 7 ? 'High' : value >= 1 / 30 ? 'Medium' : 'Low'
    case 'leadTime':
      return value < 24 ? 'Elite' : value < 24 * 7 ? 'High' : value < 24 * 30 ? 'Medium' : 'Low'
    case 'changeFailureRate':
      return value <= 5 ? 'Elite' : value <= 10 ? 'High' : value <= 15 ? 'Medium' : 'Low'
    case 'recoveryTime':
      return value < 1 ? 'Elite' : value < 24 ? 'High' : value < 24 * 7 ? 'Medium' : 'Low'
  }
}

/** The middle tier of the ones given, rounding toward the weaker tier. */
export function overallTier(tiers: Tier[]): Tier | null {
  if (tiers.length === 0) return null
  const idx = tiers.map((t) => TIERS.indexOf(t)).sort((a, b) => a - b)
  return TIERS[idx[Math.floor(idx.length / 2)]]
}

const PATTERNS: Record<DoraKey, RegExp> = {
  deploymentFrequency: /deploy/i,
  leadTime: /lead.?time/i,
  changeFailureRate: /change.?fail|\bcfr\b|failure.?rate/i,
  recoveryTime: /restore|recover|mttr/i
}

function guessUnit(key: DoraKey, metric: MetricDef, sampleValues: number[]): string {
  const name = metric.name.toLowerCase()
  if (key === 'deploymentFrequency') {
    return /day|daily/.test(name) ? 'per day' : /month/.test(name) ? 'per month' : 'per week'
  }
  if (key === 'changeFailureRate') {
    if (/pct|percent|%/.test(name)) return 'percent'
    return sampleValues.length && Math.max(...sampleValues) <= 1 ? 'ratio' : 'percent'
  }
  return /min/.test(name) ? 'minutes' : /day/.test(name) ? 'days' : 'hours'
}

/** Finds each DORA key by metric name, preferring team-level metrics. */
export function defaultDoraConfig(
  dataset: Pick<Dataset, 'metrics' | 'points' | 'teamPoints'>
): DoraConfig {
  const ordered = [
    ...dataset.metrics.filter((m) => m.grain === 'team'),
    ...dataset.metrics.filter((m) => m.grain !== 'team')
  ]
  const config = {} as DoraConfig
  for (const key of DORA_KEYS) {
    const metric = ordered.find(
      (m) =>
        PATTERNS[key].test(m.name) &&
        // "Deployments" must not grab a deployment failure metric.
        !(key === 'deploymentFrequency' && /fail/i.test(m.name))
    )
    if (!metric) {
      config[key] = { metric: '', unit: DORA_INFO[key].units[0] }
      continue
    }
    const source = metric.grain === 'team' ? dataset.teamPoints : dataset.points
    const sample = source
      .filter((p) => p.metric === metric.key)
      .slice(0, 200)
      .map((p) => p.value)
    config[key] = { metric: metric.key, unit: guessUnit(key, metric, sample) }
  }
  return config
}

const STORAGE_KEY = 'doraConfig'

export function loadDoraConfig(
  dataset: Pick<Dataset, 'metrics' | 'points' | 'teamPoints'>
): DoraConfig {
  const fallback = defaultDoraConfig(dataset)
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as DoraConfig | null
    if (!stored) return fallback
    const keys = new Set(dataset.metrics.map((m) => m.key))
    const config = {} as DoraConfig
    for (const key of DORA_KEYS) {
      config[key] = stored[key] && keys.has(stored[key].metric) ? stored[key] : fallback[key]
    }
    return config
  } catch {
    return fallback
  }
}

export function saveDoraConfig(config: DoraConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Storage unavailable; the mapping just won't persist.
  }
}

/** Team name -> team group (top of the DX hierarchy), from teams and engineers. */
export function teamGroups(dataset: Pick<Dataset, 'teams' | 'engineers'>): Map<string, string> {
  const groups = new Map<string, string>()
  for (const t of dataset.teams) groups.set(t.name, t.path[0] ?? t.name)
  for (const e of dataset.engineers) {
    if (!groups.has(e.teamName)) groups.set(e.teamName, e.teamPath[0] ?? e.teamName)
  }
  return groups
}

/** Teams that have data for any mapped DORA metric and pass the team / team-group filters. */
export function doraTeams(dataset: Dataset, config: DoraConfig, filters: Filters): string[] {
  const groups = teamGroups(dataset)
  const mapped = new Set(DORA_KEYS.map((k) => config[k].metric).filter(Boolean))
  const names = new Set<string>()
  for (const p of dataset.teamPoints) if (mapped.has(p.metric)) names.add(p.team)
  const engineerMetrics = new Set(
    dataset.metrics.filter((m) => m.grain !== 'team' && mapped.has(m.key)).map((m) => m.key)
  )
  if (engineerMetrics.size) {
    const withData = new Set(
      dataset.points.filter((p) => engineerMetrics.has(p.metric)).map((p) => p.email)
    )
    for (const e of dataset.engineers) if (withData.has(e.email)) names.add(e.teamName)
  }
  return [...names]
    .filter((t) => !filters.team?.length || filters.team.includes(t))
    .filter((t) => !filters.teamGroup?.length || filters.teamGroup.includes(groups.get(t) ?? t))
    .sort()
}

type Series = Map<string, number>

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** How team values in one period combine: deploys add up, the rest take a typical value. */
function combine(key: DoraKey, values: number[]): number {
  if (key === 'deploymentFrequency') return values.reduce((a, b) => a + b, 0)
  return key === 'changeFailureRate' ? mean(values) : median(values)
}

/**
 * Normalized period -> value series for one DORA key, per team. Team-level metrics are used
 * as-is; engineer-level metrics are rolled up across each team's engineers per period.
 */
export function teamSeries(
  dataset: Dataset,
  config: DoraConfig,
  key: DoraKey,
  teams: string[]
): Map<string, Series> {
  const { metric, unit } = config[key]
  const def = dataset.metrics.find((m) => m.key === metric)
  const result = new Map<string, Series>(teams.map((t) => [t, new Map()]))
  if (!def) return result
  if (def.grain === 'team') {
    for (const p of dataset.teamPoints) {
      if (p.metric !== metric) continue
      result.get(p.team)?.set(p.period, normalize(key, unit, p.value))
    }
    return result
  }
  const teamOf = new Map(dataset.engineers.map((e) => [e.email, e.teamName]))
  const buckets = new Map<string, Map<string, number[]>>()
  for (const p of dataset.points) {
    if (p.metric !== metric) continue
    const team = teamOf.get(p.email)
    if (!team || !result.has(team)) continue
    const byPeriod = buckets.get(team) ?? new Map<string, number[]>()
    byPeriod.set(p.period, [...(byPeriod.get(p.period) ?? []), normalize(key, unit, p.value)])
    buckets.set(team, byPeriod)
  }
  for (const [team, byPeriod] of buckets) {
    for (const [period, values] of byPeriod) result.get(team)!.set(period, combine(key, values))
  }
  return result
}

/** The periods of a series that fall in the window. */
export function periodsInWindow(
  periods: string[],
  window: TimeWindow,
  today = new Date().toISOString().slice(0, 10)
): string[] {
  if (window === 'all') return periods
  if (window === 'latest') {
    const latest = periods.reduce((max, p) => (p > max ? p : max), '')
    return periods.filter((p) => p === latest)
  }
  const start = addDays(today, -window)
  return periods.filter((p) => p >= start)
}

/** Mean of a series over the window, or null when it has no periods there. */
export function windowValue(series: Series, window: TimeWindow, today?: string): number | null {
  const periods = periodsInWindow([...series.keys()], window, today)
  return periods.length ? mean(periods.map((p) => series.get(p)!)) : null
}

/** Org-wide series: per period, combine the teams that reported that period. */
export function orgSeries(key: DoraKey, perTeam: Map<string, Series>): Series {
  const byPeriod = new Map<string, number[]>()
  for (const series of perTeam.values()) {
    for (const [period, value] of series) {
      byPeriod.set(period, [...(byPeriod.get(period) ?? []), value])
    }
  }
  return new Map(
    [...byPeriod].sort(([a], [b]) => a.localeCompare(b)).map(([p, v]) => [p, combine(key, v)])
  )
}

export function formatDora(key: DoraKey, value: number | null): string {
  if (value === null) return '—'
  if (key === 'deploymentFrequency') {
    if (value >= 1) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}/day`
    if (value * 7 >= 1) {
      return `${(value * 7).toLocaleString(undefined, { maximumFractionDigits: 1 })}/week`
    }
    return `${(value * 30).toLocaleString(undefined, { maximumFractionDigits: 1 })}/month`
  }
  if (key === 'changeFailureRate') {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  }
  if (value < 1) return `${Math.round(value * 60)} min`
  if (value < 48) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
  return `${(value / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`
}
