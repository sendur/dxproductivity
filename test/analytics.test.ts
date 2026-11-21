import { describe, expect, it } from 'vitest'
import {
  aggregate,
  applyFilters,
  compareLevels,
  engineerValues,
  groupBy,
  pointsInWindow,
  toCsv,
  trend
} from '../src/renderer/src/utils/analytics'
import type { Engineer, MetricPoint } from '../src/shared/types'

function engineer(email: string, patch: Partial<Engineer> = {}): Engineer {
  return {
    email,
    name: email,
    teamId: 't',
    teamName: 'Payments',
    teamPath: ['Product', 'Payments'],
    bambooId: null,
    jobTitle: '',
    department: '',
    level: 'L4',
    roleType: 'Backend',
    employmentType: 'Full-Time',
    hireDate: '',
    salary: null,
    compensationHistory: [],
    jobHistory: [],
    promotions: [],
    ...patch
  }
}

const points: MetricPoint[] = [
  { metric: 'm', email: 'a', period: '2026-10-01', value: 2 },
  { metric: 'm', email: 'a', period: '2026-10-08', value: 4 },
  { metric: 'm', email: 'b', period: '2026-10-08', value: 10 },
  { metric: 'm', email: 'b', period: '2025-01-01', value: 100 },
  { metric: 'other', email: 'a', period: '2026-10-08', value: 99 }
]

describe('aggregate', () => {
  it('computes each aggregation', () => {
    const v = [1, 2, 3, 10]
    expect(aggregate(v, 'avg')).toBe(4)
    expect(aggregate(v, 'sum')).toBe(16)
    expect(aggregate(v, 'median')).toBe(2.5)
    expect(aggregate(v, 'p75')).toBe(4.75)
    expect(aggregate(v, 'min')).toBe(1)
    expect(aggregate(v, 'max')).toBe(10)
    expect(aggregate([], 'avg')).toBeNull()
  })
})

describe('time windows', () => {
  it('latest keeps only the newest period', () => {
    expect(pointsInWindow(points, 'm', 'latest').map((p) => p.value)).toEqual([4, 10])
  })
  it('trailing days are relative to today', () => {
    expect(pointsInWindow(points, 'm', 30, '2026-10-19')).toHaveLength(3)
  })
  it('engineer value is the mean of their periods in the window', () => {
    const values = engineerValues(points, 'm', 'all')
    expect(values.get('a')).toBe(3)
    expect(values.get('b')).toBe(55)
  })
})

describe('filtering and grouping', () => {
  const engineers = [
    engineer('a', {
      level: 'L5',
      salary: {
        annual: 200000,
        currency: 'USD',
        rawAmount: 200000,
        paidPer: 'Year',
        effectiveDate: '',
        reason: ''
      },
      promotions: [{ date: '2026-03-01', fromTitle: 'x', toTitle: 'y' }]
    }),
    engineer('b', { teamName: 'Growth', teamPath: ['Product', 'Growth'] }),
    engineer('c', { employmentType: 'Contractor' })
  ]

  it('filters across dimensions (AND between dimensions, OR within one)', () => {
    expect(applyFilters(engineers, { team: ['Payments'] }).map((e) => e.email)).toEqual(['a', 'c'])
    expect(
      applyFilters(engineers, {
        team: ['Payments', 'Growth'],
        employmentType: ['Full-Time']
      }).map((e) => e.email)
    ).toEqual(['a', 'b'])
  })

  it('groups with metric, salary and promotion rollups', () => {
    const groups = groupBy(
      engineers,
      'team',
      engineerValues(points, 'm', 'all'),
      'avg',
      '2026-10-19'
    )
    const payments = groups.find((g) => g.key === 'Payments')!
    expect(payments.engineers).toHaveLength(2)
    expect(payments.withData).toBe(1)
    expect(payments.value).toBe(3)
    expect(payments.avgSalary).toBe(200000)
    expect(payments.promotedLast12mo).toBe(1)
    expect(groups.find((g) => g.key === 'Product')).toBeUndefined()
    expect(groupBy(engineers, 'teamGroup', new Map(), 'avg')[0].key).toBe('Product')
  })

  it('trend aggregates per period for the chosen engineers', () => {
    expect(trend(points, 'm', new Set(['a', 'b']), 'sum')).toEqual([
      { period: '2025-01-01', value: 100, n: 1 },
      { period: '2026-10-01', value: 2, n: 1 },
      { period: '2026-10-08', value: 14, n: 2 }
    ])
  })
})

describe('compareLevels', () => {
  it('sorts level codes numerically and keywords by seniority', () => {
    expect(['L10', 'L3', 'L4'].sort(compareLevels)).toEqual(['L3', 'L4', 'L10'])
    expect(['Staff', 'Junior', 'Senior', 'Unknown'].sort(compareLevels)).toEqual([
      'Junior',
      'Senior',
      'Staff',
      'Unknown'
    ])
  })
})

describe('toCsv', () => {
  it('quotes cells that need it', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', null],
          ['say "hi"', 3]
        ]
      )
    ).toBe('a,b\n"x,y",\n"say ""hi""",3')
  })
})
