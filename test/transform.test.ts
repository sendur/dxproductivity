import { describe, expect, it } from 'vitest'
import {
  annualize,
  assignTeams,
  currentSalary,
  deriveLevel,
  deriveRoleType,
  detectPromotions,
  extractMetrics,
  mergePoints,
  parseCompensation,
  parseDatafeed,
  parseJobInfo,
  teamResolver
} from '../src/main/transform'
import { DEFAULT_ROLE_RULES } from '../src/shared/defaults'
import type { MetricPoint } from '../src/shared/types'

const feed = {
  id: 'f1',
  name: 'Throughput',
  category: 'Speed' as const,
  emailColumn: '',
  periodColumn: '',
  columnCategories: { cycle_time_hours: 'Quality' as const }
}

describe('parseDatafeed', () => {
  it('zips column names with array rows', () => {
    const rows = parseDatafeed({
      ok: true,
      data: { columns: ['email', 'prs'], rows: [['a@x.com', 3]] }
    })
    expect(rows).toEqual([{ email: 'a@x.com', prs: 3 }])
  })
  it('accepts object rows and column objects', () => {
    expect(parseDatafeed({ data: [{ email: 'a@x.com', prs: 1 }] })).toEqual([
      { email: 'a@x.com', prs: 1 }
    ])
    expect(parseDatafeed({ columns: [{ name: 'email' }], rows: [['b@x.com']] })).toEqual([
      { email: 'b@x.com' }
    ])
  })
  it('returns [] for unexpected shapes', () => {
    expect(parseDatafeed(null)).toEqual([])
    expect(parseDatafeed({ ok: true })).toEqual([])
  })
})

describe('extractMetrics (per engineer)', () => {
  const rows = [
    { user_email: 'A@x.com', team_id: 7, prs_merged: '4', cycle_time_hours: 20.5, note: 'hi' },
    { user_email: 'b@x.com', team_id: 7, prs_merged: 2, cycle_time_hours: null, note: 'yo' },
    { user_email: '', team_id: 7, prs_merged: 9, cycle_time_hours: 1, note: '' }
  ]
  it('auto-detects email, skips id/text columns, and applies category overrides', () => {
    const { metrics, points, warnings } = extractMetrics(feed, rows, '2026-10-19')
    expect(metrics.map((m) => [m.key, m.name, m.category, m.grain])).toEqual([
      ['f1:prs_merged', 'Prs Merged', 'Speed', 'engineer'],
      ['f1:cycle_time_hours', 'Cycle Time Hours', 'Quality', 'engineer']
    ])
    expect(points).toContainEqual({
      metric: 'f1:prs_merged',
      email: 'a@x.com',
      period: '2026-10-19',
      value: 4
    })
    expect(points).toHaveLength(3)
    expect(warnings).toContain('Throughput: skipped 1 rows without an email')
  })
  it('uses the period column when configured', () => {
    const { points } = extractMetrics(
      { ...feed, periodColumn: 'week' },
      [{ email: 'a@x.com', week: '2026-09-01T00:00:00Z', prs: 1 }],
      '2026-10-19'
    )
    expect(points[0].period).toBe('2026-09-01')
  })
  it('warns when the configured email column is missing', () => {
    const { points, warnings } = extractMetrics(
      { ...feed, emailColumn: 'mail' },
      rows,
      '2026-10-19'
    )
    expect(points).toEqual([])
    expect(warnings[0]).toMatch(/email column "mail" not found/)
  })
  it('categorizes AI-tool columns as AI', () => {
    const { metrics: defs } = extractMetrics(
      { ...feed, columnCategories: {} },
      [{ email: 'a@x.com', copilot_active_days: 3, ai_pct: 20, prs_merged: 4, maintain: 1 }],
      '2026-10-19'
    )
    expect(Object.fromEntries(defs.map((d) => [d.name, d.category]))).toEqual({
      'Copilot Active Days': 'AI',
      'Ai Pct': 'AI',
      'Prs Merged': 'Speed',
      Maintain: 'Speed'
    })
  })
})

describe('extractMetrics (per team)', () => {
  const teams = [
    { id: '11', name: 'Payments' },
    { id: '12', name: 'Checkout' }
  ]
  const teamFeed = {
    ...feed,
    id: 'd',
    name: 'DORA',
    grain: 'team' as const,
    teamColumn: '',
    periodColumn: 'week',
    columnCategories: {}
  }
  it('reads team rows, resolves team ids and names, and tags DORA columns', () => {
    const { metrics, points, teamPoints, warnings } = extractMetrics(
      teamFeed,
      [
        {
          team_name: 'payments',
          week: '2026-10-05',
          deploys_per_week: 6,
          lead_time_hours: 30,
          notes: 1
        },
        { team_name: '12', week: '2026-10-05', deploys_per_week: 9, lead_time_hours: 12, notes: 2 },
        {
          team_name: 'Ghost',
          week: '2026-10-05',
          deploys_per_week: 1,
          lead_time_hours: 1,
          notes: 3
        },
        { team_name: '', week: '2026-10-05', deploys_per_week: 1, lead_time_hours: 1, notes: 4 }
      ],
      '2026-10-19',
      teamResolver(teams)
    )
    expect(points).toEqual([])
    expect(metrics.map((m) => [m.name, m.category, m.grain])).toEqual([
      ['Deploys Per Week', 'DORA', 'team'],
      ['Lead Time Hours', 'DORA', 'team'],
      ['Notes', 'Speed', 'team']
    ])
    expect(teamPoints.filter((p) => p.metric === 'd:deploys_per_week')).toEqual([
      { metric: 'd:deploys_per_week', team: 'Payments', period: '2026-10-05', value: 6 },
      { metric: 'd:deploys_per_week', team: 'Checkout', period: '2026-10-05', value: 9 },
      { metric: 'd:deploys_per_week', team: 'Ghost', period: '2026-10-05', value: 1 }
    ])
    expect(warnings).toContain('DORA: skipped 1 rows without a team')
    expect(warnings.some((w) => w.includes("don't match a DX team") && w.includes('Ghost'))).toBe(
      true
    )
  })
})

describe('mergePoints', () => {
  it('replaces same metric/id/period and keeps history', () => {
    const merged = mergePoints<MetricPoint>(
      [
        { metric: 'm', email: 'a', period: '2026-01-01', value: 1 },
        { metric: 'm', email: 'a', period: '2026-01-08', value: 2 }
      ],
      [{ metric: 'm', email: 'a', period: '2026-01-08', value: 5 }],
      (p) => p.email
    )
    expect(merged.map((p) => p.value).sort()).toEqual([1, 5])
  })
})

describe('assignTeams', () => {
  it('picks the deepest team and builds its path', () => {
    const teams = [
      { id: '1', name: 'Eng', parentId: null },
      { id: '2', name: 'Platform', parentId: '1' },
      { id: '3', name: 'Infra', parentId: '2' }
    ]
    const result = assignTeams(teams, new Map([['a@x.com', ['1', '3', '2']]]))
    expect(result.get('a@x.com')).toEqual({
      teamId: '3',
      teamName: 'Infra',
      teamPath: ['Eng', 'Platform', 'Infra']
    })
  })
})

describe('levels and role types', () => {
  it.each([
    ['Software Engineer L4', 'L4'],
    ['IC3 Backend Engineer', 'IC3'],
    ['Senior Software Engineer', 'Senior'],
    ['Sr. Frontend Engineer', 'Senior'],
    ['Staff Engineer', 'Staff'],
    ['Senior Staff Engineer', 'Senior Staff'],
    ['Principal Engineer', 'Principal'],
    ['Engineering Manager', 'Manager'],
    ['Software Engineer II', 'Mid'],
    ['Software Engineer', 'Mid'],
    ['', 'Unknown']
  ])('deriveLevel(%s) = %s', (title, level) => {
    expect(deriveLevel(title)).toBe(level)
  })

  it.each([
    ['Senior Frontend Engineer', 'Frontend'],
    ['Full Stack Engineer', 'Full Stack'],
    ['Backend Engineer', 'Backend'],
    ['iOS Engineer', 'Mobile'],
    ['Site Reliability Engineer', 'Infrastructure'],
    ['ML Engineer', 'Data / ML'],
    ['Build Engineer', 'Other'],
    ['Software Engineer', 'Other']
  ])('deriveRoleType(%s) = %s', (title, role) => {
    expect(deriveRoleType(title, DEFAULT_ROLE_RULES)).toBe(role)
  })
})

describe('compensation and promotions', () => {
  it('annualizes pay rates', () => {
    expect(annualize(50, 'Hour')).toBe(104000)
    expect(annualize(10000, 'Month')).toBe(120000)
    expect(annualize(150000, 'Year')).toBe(150000)
  })

  it('parses compensation rows and picks the current effective salary', () => {
    const history = parseCompensation([
      { startDate: '2027-01-01', rate: { value: '200000.00', currency: 'USD' }, paidPer: 'Year' },
      { startDate: '2024-01-01', rate: '150000.00 USD', paidPer: 'Year', reason: 'New Hire' },
      { startDate: '2025-06-01', rate: { value: '175000', currency: 'USD' }, paidPer: 'Year' },
      { startDate: '2025-07-01', rate: null }
    ])
    expect(history.map((h) => h.amount)).toEqual([150000, 175000, 200000])
    expect(currentSalary(history, '2026-10-19')?.annual).toBe(175000)
  })

  it('treats job title changes as promotions', () => {
    const jobs = parseJobInfo([
      { date: '2025-03-01', jobTitle: 'Senior Engineer', department: 'Eng' },
      { date: '2023-01-01', jobTitle: 'Engineer', department: 'Eng' },
      { date: '2024-01-01', jobTitle: 'Engineer', department: 'Platform' }
    ])
    expect(detectPromotions(jobs)).toEqual([
      { date: '2025-03-01', fromTitle: 'Engineer', toTitle: 'Senior Engineer' }
    ])
  })
})
