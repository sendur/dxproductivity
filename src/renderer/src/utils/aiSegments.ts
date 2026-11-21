import { engineerValues, pointsInWindow, type TimeWindow } from './analytics'
import type { Engineer, MetricDef, MetricPoint } from '../../../shared/types'

export const SEGMENTS = {
  accelerated: {
    label: 'AI-accelerated',
    blurb: 'Uses AI and outperforms peers'
  },
  ineffective: {
    label: 'AI, not yet effective',
    blurb: 'Uses AI but trails peers on speed or quality'
  },
  strongNoAi: {
    label: 'Not using AI · strong',
    blurb: 'No AI usage, outperforms peers'
  },
  noAi: {
    label: 'Not using AI',
    blurb: 'No AI usage, trails peers'
  }
} as const
export type Segment = keyof typeof SEGMENTS
export const SEGMENT_ORDER: Segment[] = ['accelerated', 'ineffective', 'strongNoAi', 'noAi']

export interface PerfMetric {
  key: string
  higherIsBetter: boolean
}

export interface AiConfig {
  aiMetric: string
  /** An engineer counts as using AI when their AI metric is above this value. */
  aiThreshold: number
  /** Engineers DX reports no AI data for count as non-users (DX AI feeds often omit them). */
  missingAiIsZero: boolean
  perfMetrics: PerfMetric[]
  /**
   * peers: percentile vs. peers (0-100, cut at 50).
   * change: % change of the performance metrics from the first to second half of the window (cut at 0).
   */
  yMode: 'peers' | 'change'
  /** Rank engineers only against others at the same level (peers mode). */
  withinLevel: boolean
}

export interface AiRow {
  engineer: Engineer
  aiUsage: number | null
  /** Peers mode: 0-100 percentile. Change mode: percent change, positive = better. */
  score: number | null
  /** Raw per-metric values (window mean), keyed by metric key. */
  values: Record<string, number | null>
  segment: Segment | null
}

const AI_NAME = /\b(ai|copilot|cursor|claude|llm|genai|gpt|codeium|tabnine|windsurf)\b/i
const LOWER_IS_BETTER =
  /\b(hours?|minutes|cycle time|lead time|fail|failures?|reverts?|incidents?|bugs?|defects?|rework|latency|turnaround)\b/i

export function isAiMetric(m: MetricDef): boolean {
  return m.category === 'AI' || AI_NAME.test(m.name)
}

export function defaultHigherIsBetter(m: MetricDef): boolean {
  return !LOWER_IS_BETTER.test(m.name)
}

/** Picks sensible defaults from the metric names so the view works before any configuration. */
export function defaultConfig(metrics: MetricDef[]): AiConfig {
  const engineerMetrics = metrics.filter((m) => m.grain !== 'team')
  const ai = engineerMetrics.find(isAiMetric)
  const nonAi = engineerMetrics.filter((m) => !isAiMetric(m))
  const speed =
    nonAi.find((m) => /pr|merge|throughput|deploy|diff|commit/i.test(m.name)) ??
    nonAi.find((m) => m.category === 'Speed') ??
    nonAi[0]
  const quality =
    nonAi.find((m) => /fail|revert|incident|bug|defect|rework/i.test(m.name)) ??
    nonAi.find((m) => m.category === 'Quality')
  return {
    aiMetric: ai?.key ?? '',
    aiThreshold: 0,
    missingAiIsZero: true,
    perfMetrics: [speed, quality]
      .filter((m): m is MetricDef => !!m)
      .map((m) => ({ key: m.key, higherIsBetter: defaultHigherIsBetter(m) })),
    yMode: 'peers',
    withinLevel: true
  }
}

const STORAGE_KEY = 'aiImpactConfig'

/** The AI Impact view's saved method, falling back to defaults for missing metrics. */
export function loadAiConfig(metrics: MetricDef[]): AiConfig {
  const fallback = defaultConfig(metrics)
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as AiConfig | null
    if (!stored) return fallback
    const keys = new Set(metrics.map((m) => m.key))
    const perfMetrics = stored.perfMetrics.filter((m) => keys.has(m.key))
    return {
      ...fallback,
      ...stored,
      aiMetric: keys.has(stored.aiMetric) ? stored.aiMetric : fallback.aiMetric,
      perfMetrics: perfMetrics.length ? perfMetrics : fallback.perfMetrics
    }
  } catch {
    return fallback
  }
}

export function saveAiConfig(config: AiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Storage unavailable; the setting just won't persist.
  }
}

/** Fraction (0-100) of the population below `value`, counting ties as half. */
export function percentileRank(value: number, population: number[]): number {
  if (population.length <= 1) return 50
  let below = 0
  let equal = 0
  for (const v of population) {
    if (v < value) below++
    else if (v === value) equal++
  }
  // Exclude the value itself so a lone best scores 100 and a lone worst scores 0.
  return ((below + (equal - 1) / 2) / (population.length - 1)) * 100
}

/** Per-engineer % change from the first half of their periods to the second half. */
export function halfOverHalfChange(
  points: MetricPoint[],
  metric: string,
  window: TimeWindow,
  today = new Date().toISOString().slice(0, 10)
): Map<string, number> {
  // 'latest' is a single period, so change mode always looks back at least 90 days.
  const effective: TimeWindow = window === 'latest' ? 90 : window
  const byEmail = new Map<string, MetricPoint[]>()
  for (const p of pointsInWindow(points, metric, effective, today)) {
    byEmail.set(p.email, [...(byEmail.get(p.email) ?? []), p])
  }
  const result = new Map<string, number>()
  for (const [email, list] of byEmail) {
    const sorted = list.sort((a, b) => a.period.localeCompare(b.period))
    if (sorted.length < 2) continue
    const mid = Math.floor(sorted.length / 2)
    const mean = (xs: MetricPoint[]): number => xs.reduce((s, p) => s + p.value, 0) / xs.length
    const early = mean(sorted.slice(0, mid))
    const late = mean(sorted.slice(sorted.length - mid))
    if (early === 0) continue
    result.set(email, ((late - early) / Math.abs(early)) * 100)
  }
  return result
}

export function scoreCut(config: AiConfig): number {
  return config.yMode === 'peers' ? 50 : 0
}

/** Share (0-100) of engineers whose AI metric is above the threshold, or null without data. */
export function aiAdoption(
  engineers: Engineer[],
  aiValues: Map<string, number>,
  config: AiConfig
): number | null {
  const known = engineers.filter((e) => config.missingAiIsZero || aiValues.has(e.email))
  if (!config.aiMetric || known.length === 0) return null
  const users = known.filter((e) => (aiValues.get(e.email) ?? 0) > config.aiThreshold)
  return (users.length / known.length) * 100
}

export function classify(
  engineers: Engineer[],
  points: MetricPoint[],
  config: AiConfig,
  window: TimeWindow,
  today = new Date().toISOString().slice(0, 10)
): AiRow[] {
  const aiValues = config.aiMetric
    ? engineerValues(points, config.aiMetric, window)
    : new Map<string, number>()
  const raw = config.perfMetrics.map((m) => engineerValues(points, m.key, window))
  const changes =
    config.yMode === 'change'
      ? config.perfMetrics.map((m) => halfOverHalfChange(points, m.key, window, today))
      : []

  const cohortKey = (e: Engineer): string => (config.withinLevel ? e.level : '*')
  // Population per metric per cohort, drawn from the engineers in view (so filters apply).
  const populations = config.perfMetrics.map((_, i) => {
    const byCohort = new Map<string, number[]>()
    for (const e of engineers) {
      const v = raw[i].get(e.email)
      if (v === undefined) continue
      byCohort.set(cohortKey(e), [...(byCohort.get(cohortKey(e)) ?? []), v])
    }
    return byCohort
  })
  const allValues = raw.map((m) =>
    engineers.map((e) => m.get(e.email)).filter((v): v is number => v !== undefined)
  )

  const cut = scoreCut(config)
  return engineers.map((engineer) => {
    const values: Record<string, number | null> = {}
    const parts: number[] = []
    config.perfMetrics.forEach((m, i) => {
      const v = raw[i].get(engineer.email)
      values[m.key] = v ?? null
      if (config.yMode === 'peers') {
        if (v === undefined) return
        const cohort = populations[i].get(cohortKey(engineer)) ?? []
        // Cohorts under 3 people can't rank meaningfully; fall back to everyone in view.
        const population = cohort.length >= 3 ? cohort : allValues[i]
        const pct = percentileRank(v, population)
        parts.push(m.higherIsBetter ? pct : 100 - pct)
      } else {
        const c = changes[i].get(engineer.email)
        if (c !== undefined) parts.push(m.higherIsBetter ? c : -c)
      }
    })
    const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null

    const aiRaw = aiValues.get(engineer.email)
    const aiUsage = aiRaw ?? (config.missingAiIsZero && config.aiMetric ? 0 : null)
    let segment: Segment | null = null
    if (score !== null && aiUsage !== null) {
      const usesAi = aiUsage > config.aiThreshold
      const strong = score >= cut
      segment = usesAi ? (strong ? 'accelerated' : 'ineffective') : strong ? 'strongNoAi' : 'noAi'
    }
    return { engineer, aiUsage, score, values, segment }
  })
}
