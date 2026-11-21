import { describe, expect, it } from 'vitest'
import {
  aiAdoption,
  classify,
  defaultConfig,
  halfOverHalfChange,
  percentileRank,
  type AiConfig
} from '../src/renderer/src/utils/aiSegments'
import type { Engineer, MetricDef, MetricPoint } from '../src/shared/types'

function engineer(email: string, level = 'L4'): Engineer {
  return {
    email,
    name: email,
    teamId: 't',
    teamName: 'Team',
    teamPath: ['Team'],
    bambooId: null,
    jobTitle: '',
    department: '',
    level,
    roleType: 'Backend',
    employmentType: 'Full-Time',
    hireDate: '',
    salary: null,
    compensationHistory: [],
    jobHistory: [],
    promotions: []
  }
}

const metric = (
  key: string,
  name: string,
  category: MetricDef['category'],
  grain: MetricDef['grain'] = 'engineer'
): MetricDef => ({ key, name, category, grain, feedId: 'f', feedName: 'Feed' })

const metrics = [
  metric('d:deploys', 'Deployments Per Week', 'DORA', 'team'),
  metric('f:prs', 'PRs Merged', 'Speed'),
  metric('f:cfr', 'Change Failure Rate', 'Quality'),
  metric('f:dxi', 'Developer Experience Index', 'Effectiveness'),
  metric('f:ai', 'Copilot Active Days', 'Speed')
]

describe('defaultConfig', () => {
  it('finds the AI metric and picks per-engineer velocity + accuracy metrics', () => {
    const config = defaultConfig(metrics)
    expect(config.aiMetric).toBe('f:ai')
    expect(config.perfMetrics).toEqual([
      { key: 'f:prs', higherIsBetter: true },
      { key: 'f:cfr', higherIsBetter: false }
    ])
  })
})

describe('percentileRank', () => {
  it('ranks from 0 (worst) to 100 (best), ties in the middle', () => {
    expect(percentileRank(1, [1, 2, 3])).toBe(0)
    expect(percentileRank(3, [1, 2, 3])).toBe(100)
    expect(percentileRank(2, [1, 2, 3])).toBe(50)
    expect(percentileRank(5, [5, 5, 5])).toBe(50)
    expect(percentileRank(5, [5])).toBe(50)
  })
})

describe('classify', () => {
  const day = '2026-10-01'
  const p = (metricKey: string, email: string, value: number, period = day): MetricPoint => ({
    metric: metricKey,
    email,
    period,
    value
  })
  // fast+accurate AI user, fast but sloppy AI user, slow AI user, strong non-user, weak non-user
  const engineers = ['acc', 'sloppy', 'slow', 'strong', 'weak', 'nodata'].map((e) => engineer(e))
  const points: MetricPoint[] = [
    p('f:prs', 'acc', 10),
    p('f:cfr', 'acc', 0.05),
    p('f:ai', 'acc', 4),
    p('f:prs', 'sloppy', 9),
    p('f:cfr', 'sloppy', 0.4),
    p('f:ai', 'sloppy', 5),
    p('f:prs', 'slow', 2),
    p('f:cfr', 'slow', 0.2),
    p('f:ai', 'slow', 3),
    p('f:prs', 'strong', 8),
    p('f:cfr', 'strong', 0.06),
    p('f:prs', 'weak', 3),
    p('f:cfr', 'weak', 0.3),
    p('f:ai', 'nodata', 2)
  ]
  const config: AiConfig = { ...defaultConfig(metrics), withinLevel: true }

  it('splits engineers into the four quadrants, using accuracy as well as speed', () => {
    const rows = classify(engineers, points, config, 'all')
    const seg = Object.fromEntries(rows.map((r) => [r.engineer.email, r.segment]))
    expect(seg).toEqual({
      acc: 'accelerated',
      sloppy: 'ineffective',
      slow: 'ineffective',
      strong: 'strongNoAi',
      weak: 'noAi',
      nodata: null
    })
  })

  it('treats missing AI data as unknown when configured', () => {
    const rows = classify(engineers, points, { ...config, missingAiIsZero: false }, 'all')
    expect(rows.find((r) => r.engineer.email === 'strong')!.segment).toBeNull()
  })

  it('respects the AI usage threshold', () => {
    const rows = classify(engineers, points, { ...config, aiThreshold: 3.5 }, 'all')
    expect(rows.find((r) => r.engineer.email === 'slow')!.segment).toBe('noAi')
  })

  it('ranks within level, falling back to everyone for tiny cohorts', () => {
    const mixed = [
      engineer('a', 'L3'),
      engineer('b', 'L3'),
      engineer('c', 'L3'),
      engineer('d', 'L7')
    ]
    const pts = [p('f:prs', 'a', 1), p('f:prs', 'b', 2), p('f:prs', 'c', 3), p('f:prs', 'd', 2.5)]
    const rows = classify(
      mixed,
      pts,
      { ...config, perfMetrics: [{ key: 'f:prs', higherIsBetter: true }] },
      'all'
    )
    expect(rows.map((r) => Math.round(r.score!))).toEqual([0, 50, 100, 67])
  })

  it('change mode scores improvement against the engineer’s own baseline', () => {
    const series = [
      p('f:prs', 'acc', 2, '2026-08-01'),
      p('f:prs', 'acc', 2, '2026-08-08'),
      p('f:prs', 'acc', 3, '2026-09-01'),
      p('f:prs', 'acc', 3, '2026-09-08'),
      p('f:ai', 'acc', 4, '2026-09-08')
    ]
    expect(halfOverHalfChange(series, 'f:prs', 'all').get('acc')).toBe(50)
    const rows = classify(
      [engineer('acc')],
      series,
      { ...config, yMode: 'change', perfMetrics: [{ key: 'f:prs', higherIsBetter: true }] },
      'all'
    )
    expect(rows[0]).toMatchObject({ score: 50, segment: 'accelerated' })
  })

  it('computes team AI adoption', () => {
    const values = new Map([
      ['acc', 4],
      ['slow', 0]
    ])
    expect(
      aiAdoption([engineer('acc'), engineer('slow'), engineer('x')], values, config)
    ).toBeCloseTo(33.33, 1)
    expect(
      aiAdoption([engineer('acc'), engineer('slow'), engineer('x')], values, {
        ...config,
        missingAiIsZero: false
      })
    ).toBe(50)
  })
})
