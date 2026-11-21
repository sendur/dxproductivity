import { describe, expect, it } from 'vitest'
import {
  defaultDoraConfig,
  doraTeams,
  formatDora,
  normalize,
  orgSeries,
  overallTier,
  periodsInWindow,
  teamSeries,
  tierOf,
  windowValue,
  type DoraConfig
} from '../src/renderer/src/utils/dora'
import type { Dataset, Engineer, MetricDef } from '../src/shared/types'

const def = (key: string, name: string, grain: MetricDef['grain']): MetricDef => ({
  key,
  name,
  grain,
  category: 'DORA',
  feedId: key.split(':')[0],
  feedName: 'F'
})

function engineer(email: string, teamName: string): Engineer {
  return {
    email,
    name: email,
    teamId: teamName,
    teamName,
    teamPath: ['Eng', teamName],
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
    promotions: []
  }
}

const dataset: Dataset = {
  engineers: [engineer('a@x', 'Payments'), engineer('b@x', 'Payments'), engineer('c@x', 'Growth')],
  teams: [
    { id: '1', name: 'Payments', path: ['Eng', 'Payments'] },
    { id: '2', name: 'Growth', path: ['Eng', 'Growth'] },
    { id: '3', name: 'Infra', path: ['Platform', 'Infra'] }
  ],
  metrics: [
    def('d:deploys', 'Deployments Per Week', 'team'),
    def('d:lead', 'Lead Time For Changes Hours', 'team'),
    def('d:cfr', 'Change Failure Rate', 'team'),
    def('e:restore', 'Time To Restore Minutes', 'engineer'),
    def('e:deploy_failures', 'Deploy Failures', 'engineer')
  ],
  points: [
    { metric: 'e:restore', email: 'a@x', period: '2026-10-05', value: 30 },
    { metric: 'e:restore', email: 'b@x', period: '2026-10-05', value: 90 },
    { metric: 'e:restore', email: 'c@x', period: '2026-10-05', value: 600 }
  ],
  teamPoints: [
    { metric: 'd:deploys', team: 'Payments', period: '2026-09-28', value: 7 },
    { metric: 'd:deploys', team: 'Payments', period: '2026-10-05', value: 14 },
    { metric: 'd:deploys', team: 'Growth', period: '2026-10-05', value: 3.5 },
    { metric: 'd:deploys', team: 'Infra', period: '2026-10-05', value: 1 },
    { metric: 'd:lead', team: 'Payments', period: '2026-10-05', value: 20 },
    { metric: 'd:lead', team: 'Growth', period: '2026-10-05', value: 200 },
    { metric: 'd:cfr', team: 'Payments', period: '2026-10-05', value: 0.04 },
    { metric: 'd:cfr', team: 'Growth', period: '2026-10-05', value: 0.2 }
  ],
  lastSyncAt: null,
  isSample: false
}

describe('units and DORA levels', () => {
  it('normalizes to deploys/day, hours and percent', () => {
    expect(normalize('deploymentFrequency', 'per week', 14)).toBe(2)
    expect(normalize('deploymentFrequency', 'per month', 3)).toBeCloseTo(0.1)
    expect(normalize('leadTime', 'days', 2)).toBe(48)
    expect(normalize('recoveryTime', 'minutes', 30)).toBe(0.5)
    expect(normalize('changeFailureRate', 'ratio', 0.12)).toBe(12)
  })

  it('rates each key against the DORA benchmarks', () => {
    expect(tierOf('deploymentFrequency', 2)).toBe('Elite')
    expect(tierOf('deploymentFrequency', 0.5)).toBe('High')
    expect(tierOf('deploymentFrequency', 0.05)).toBe('Medium')
    expect(tierOf('deploymentFrequency', 0.01)).toBe('Low')
    expect(tierOf('leadTime', 12)).toBe('Elite')
    expect(tierOf('leadTime', 100)).toBe('High')
    expect(tierOf('leadTime', 400)).toBe('Medium')
    expect(tierOf('leadTime', 1000)).toBe('Low')
    expect(tierOf('changeFailureRate', 5)).toBe('Elite')
    expect(tierOf('changeFailureRate', 9)).toBe('High')
    expect(tierOf('changeFailureRate', 15)).toBe('Medium')
    expect(tierOf('changeFailureRate', 30)).toBe('Low')
    expect(tierOf('recoveryTime', 0.5)).toBe('Elite')
    expect(tierOf('recoveryTime', 5)).toBe('High')
    expect(tierOf('recoveryTime', 50)).toBe('Medium')
    expect(tierOf('recoveryTime', 500)).toBe('Low')
  })

  it('overall level is the middle tier, rounding toward the weaker one', () => {
    expect(overallTier(['Elite', 'Elite', 'Low', 'High'])).toBe('High')
    expect(overallTier(['Elite', 'Medium'])).toBe('Medium')
    expect(overallTier([])).toBeNull()
  })

  it('formats in readable units', () => {
    expect(formatDora('deploymentFrequency', 2)).toBe('2/day')
    expect(formatDora('deploymentFrequency', 0.5)).toBe('3.5/week')
    expect(formatDora('deploymentFrequency', 0.02)).toBe('0.6/month')
    expect(formatDora('leadTime', 0.25)).toBe('15 min')
    expect(formatDora('leadTime', 30)).toBe('30 h')
    expect(formatDora('leadTime', 72)).toBe('3 days')
    expect(formatDora('changeFailureRate', 12.345)).toBe('12.3%')
  })
})

describe('defaultDoraConfig', () => {
  it('maps each key by name, prefers team metrics, and guesses units', () => {
    expect(defaultDoraConfig(dataset)).toEqual({
      deploymentFrequency: { metric: 'd:deploys', unit: 'per week' },
      leadTime: { metric: 'd:lead', unit: 'hours' },
      changeFailureRate: { metric: 'd:cfr', unit: 'ratio' },
      recoveryTime: { metric: 'e:restore', unit: 'minutes' }
    })
  })
})

describe('team and org rollups', () => {
  const config: DoraConfig = defaultDoraConfig(dataset)

  it('lists teams with DORA data, honoring team-group filters', () => {
    expect(doraTeams(dataset, config, {})).toEqual(['Growth', 'Infra', 'Payments'])
    expect(doraTeams(dataset, config, { teamGroup: ['Eng'] })).toEqual(['Growth', 'Payments'])
    expect(doraTeams(dataset, config, { team: ['Infra'] })).toEqual(['Infra'])
  })

  it('uses team metrics directly and rolls up engineer metrics by team', () => {
    const teams = ['Payments', 'Growth']
    const deploys = teamSeries(dataset, config, 'deploymentFrequency', teams)
    expect([...deploys.get('Payments')!]).toEqual([
      ['2026-09-28', 1],
      ['2026-10-05', 2]
    ])
    // Engineer-level recovery time (minutes): Payments median of 30 and 90 min = 1 h.
    const restore = teamSeries(dataset, config, 'recoveryTime', teams)
    expect(restore.get('Payments')!.get('2026-10-05')).toBe(1)
    expect(restore.get('Growth')!.get('2026-10-05')).toBe(10)
  })

  it('sums deploys across teams and averages over the window', () => {
    const perTeam = teamSeries(dataset, config, 'deploymentFrequency', ['Payments', 'Growth'])
    const org = orgSeries('deploymentFrequency', perTeam)
    expect([...org]).toEqual([
      ['2026-09-28', 1],
      ['2026-10-05', 2.5]
    ])
    expect(windowValue(org, 'all')).toBe(1.75)
    expect(windowValue(org, 'latest')).toBe(2.5)
    expect(windowValue(org, 30, '2026-10-30')).toBe(2.5)
    expect(periodsInWindow(['2026-01-01'], 30, '2026-10-30')).toEqual([])
  })
})
