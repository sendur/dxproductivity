import { annualize, currentSalary, detectPromotions } from './transform'
import type {
  Dataset,
  Engineer,
  JobRow,
  MetricDef,
  MetricPoint,
  TeamInfo,
  TeamMetricPoint
} from '../shared/types'

// Deterministic fake org so the app can be explored before any API keys are entered.

function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const FIRST = ['Ava', 'Ben', 'Chen', 'Dara', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai']
const LAST = ['Patel', 'Nguyen', 'Garcia', 'Kim', 'Okafor', 'Silva', 'Cohen', 'Ito', 'Moreau']
const TEAMS: [string, string][] = [
  ['Payments', 'Product Engineering'],
  ['Checkout', 'Product Engineering'],
  ['Growth', 'Product Engineering'],
  ['Mobile Apps', 'Product Engineering'],
  ['Core Platform', 'Platform'],
  ['Data Platform', 'Platform'],
  ['Developer Experience', 'Platform']
]
const ROLES: [string, string][] = [
  ['Frontend Engineer', 'Frontend'],
  ['Backend Engineer', 'Backend'],
  ['Full Stack Engineer', 'Full Stack'],
  ['iOS Engineer', 'Mobile'],
  ['Data Engineer', 'Data / ML'],
  ['Site Reliability Engineer', 'Infrastructure']
]
const LEVELS = ['L3', 'L4', 'L5', 'L6', 'L7']
const LEVEL_TITLE: Record<string, string> = {
  L3: '',
  L4: '',
  L5: 'Senior ',
  L6: 'Staff ',
  L7: 'Principal '
}
const BASE_SALARY: Record<string, number> = {
  L3: 125000,
  L4: 150000,
  L5: 185000,
  L6: 225000,
  L7: 270000
}

const METRICS: Omit<MetricDef, 'feedId' | 'feedName' | 'key' | 'grain'>[] = [
  { name: 'PRs Merged Per Week', category: 'Speed' },
  { name: 'Cycle Time Hours', category: 'Speed' },
  { name: 'Change Failure Rate', category: 'Quality' },
  { name: 'Review Turnaround Hours', category: 'Effectiveness' },
  { name: 'Developer Experience Index', category: 'Effectiveness' },
  { name: 'Time On New Features Pct', category: 'Impact' },
  { name: 'AI Tool Active Days Per Week', category: 'AI' },
  { name: 'AI Assisted Code Pct', category: 'AI' }
]

/** Team-level DORA feed: one row per team per week. */
const DORA_METRICS = [
  'Deployments Per Week',
  'Lead Time For Changes Hours',
  'Change Failure Pct',
  'Time To Restore Hours'
]

/** Per-team baselines: deploys/week, lead time h, change failure %, restore h. */
const DORA_BASE: Record<string, [number, number, number, number]> = {
  Payments: [6, 60, 9, 5],
  Checkout: [12, 30, 6, 2],
  Growth: [18, 20, 14, 3],
  'Mobile Apps': [1.5, 200, 11, 30],
  'Core Platform': [9, 40, 4, 0.8],
  'Data Platform': [4, 90, 8, 10],
  'Developer Experience': [22, 10, 3, 0.6]
}

type Archetype = 'none' | 'effective' | 'ineffective'

export function buildSampleDataset(): Dataset {
  const rand = rng(42)
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const metrics: MetricDef[] = [
    ...METRICS.map((m, i) => ({
      ...m,
      feedId: 'sample',
      feedName: 'Sample feed',
      key: `sample:metric_${i}`,
      grain: 'engineer' as const
    })),
    ...DORA_METRICS.map((name, i) => ({
      name,
      category: 'DORA' as const,
      feedId: 'sample-dora',
      feedName: 'Sample DORA feed',
      key: `sample-dora:metric_${i}`,
      grain: 'team' as const
    }))
  ]

  const teams: TeamInfo[] = [
    { id: 'product', name: 'Product Engineering', path: ['Product Engineering'] },
    { id: 'platform', name: 'Platform', path: ['Platform'] },
    ...TEAMS.map(([name, parent]) => ({ id: name, name, path: [parent, name] }))
  ]

  const engineers: Engineer[] = []
  const points: MetricPoint[] = []
  const archetypesByTeam = new Map<string, Archetype[]>()
  const today = new Date()
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - 7 * (11 - i))
    return d.toISOString().slice(0, 10)
  })

  for (let i = 0; i < 48; i++) {
    const [teamName, parent] = TEAMS[i % TEAMS.length]
    const [roleTitle, roleType] = teamName === 'Mobile Apps' ? ROLES[3] : pick(ROLES)
    const levelIndex = Math.min(4, Math.floor(rand() * rand() * 6))
    const level = LEVELS[levelIndex]
    const contractor = rand() < 0.12
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`
    const email = `${name.toLowerCase().replace(' ', '.')}${i}@example.com`
    const hireYear = 2026 - 1 - Math.floor(rand() * 6)
    const hireDate = `${hireYear}-0${1 + Math.floor(rand() * 9)}-15`

    const jobHistory: JobRow[] = [
      {
        date: hireDate,
        jobTitle: `${LEVEL_TITLE[LEVELS[Math.max(0, levelIndex - 1)]]}${roleTitle}`,
        department: 'Engineering',
        division: parent,
        location: 'Remote'
      }
    ]
    if (levelIndex > 0 && rand() < 0.6) {
      jobHistory.push({
        date: `${Math.max(2025, hireYear + 1)}-0${1 + Math.floor(rand() * 9)}-01`,
        jobTitle: `${LEVEL_TITLE[level]}${roleTitle}`,
        department: 'Engineering',
        division: parent,
        location: 'Remote'
      })
    } else {
      jobHistory[0].jobTitle = `${LEVEL_TITLE[level]}${roleTitle}`
    }
    const base = BASE_SALARY[level] * (0.9 + rand() * 0.2)
    const compensationHistory = jobHistory.map((job, j) => {
      const amount = Math.round((base * (j === jobHistory.length - 1 ? 1 : 0.88)) / 1000) * 1000
      const paidPer = contractor ? 'Hour' : 'Year'
      const raw = contractor ? Math.round(amount / 2080) : amount
      return {
        startDate: job.date,
        amount: raw,
        currency: 'USD',
        paidPer,
        annual: annualize(raw, paidPer),
        reason: j === 0 ? 'New Hire' : 'Promotion',
        type: contractor ? 'Hourly' : 'Salary'
      }
    })

    engineers.push({
      email,
      name,
      teamId: teamName,
      teamName,
      teamPath: [parent, teamName],
      bambooId: String(1000 + i),
      jobTitle: jobHistory[jobHistory.length - 1].jobTitle,
      department: 'Engineering',
      level,
      roleType,
      employmentType: contractor ? 'Contractor' : 'Full-Time',
      hireDate,
      salary: currentSalary(compensationHistory, today.toISOString().slice(0, 10)),
      compensationHistory,
      jobHistory,
      promotions: detectPromotions(jobHistory)
    })

    const skill = 0.7 + rand() * 0.6 + levelIndex * 0.08
    // AI archetypes: ~25% don't use AI, ~45% get faster with it, ~30% use it heavily
    // without a speed gain and ship more defects.
    const archetype: Archetype = rand() < 0.25 ? 'none' : rand() < 0.6 ? 'effective' : 'ineffective'
    archetypesByTeam.set(teamName, [...(archetypesByTeam.get(teamName) ?? []), archetype])
    const adoptionWeek = Math.floor(rand() * 6)
    weeks.forEach((period, w) => {
      const noise = (): number => 0.8 + rand() * 0.4
      const trend = 1 + w * 0.01
      const ramp = archetype === 'none' ? 0 : Math.min(1, Math.max(0, (w - adoptionWeek) / 4))
      const speedup = archetype === 'effective' ? 1 + 0.4 * ramp : 1 - 0.05 * ramp
      const defects = archetype === 'ineffective' ? 1 + 0.8 * ramp : 1
      const aiDays =
        archetype === 'none'
          ? 0
          : Math.min(5, (archetype === 'ineffective' ? 3.5 : 2.5 + rand()) * ramp * noise())
      const values = [
        3.2 * skill * noise() * trend * speedup,
        ((40 / skill) * noise() * (2 - trend)) / speedup,
        Math.max(0, 0.12 / skill) * noise() * defects,
        (14 / skill) * noise() * defects,
        Math.min(100, 62 + skill * 10 * noise()),
        Math.min(100, 45 + skill * 12 * noise()),
        aiDays,
        aiDays * (archetype === 'ineffective' ? 11 : 8) * noise()
      ]
      values.forEach((value, m) =>
        points.push({
          metric: metrics[m].key,
          email,
          period,
          value: Math.round(value * 1000) / 1000
        })
      )
    })
  }

  // DORA per team, nudged by how effectively each team has adopted AI.
  const teamPoints: TeamMetricPoint[] = []
  for (const [team] of TEAMS) {
    const types = archetypesByTeam.get(team) ?? []
    const effective = types.filter((t) => t === 'effective').length / (types.length || 1)
    const ineffective = types.filter((t) => t === 'ineffective').length / (types.length || 1)
    const [deploys, leadTime, cfr, restore] = DORA_BASE[team]
    weeks.forEach((period, w) => {
      const noise = (): number => 0.85 + rand() * 0.3
      const ramp = w / (weeks.length - 1)
      const values = [
        deploys * (1 + 0.5 * effective * ramp) * noise(),
        (leadTime / (1 + 0.6 * effective * ramp)) * noise(),
        cfr * (1 + 0.9 * ineffective * ramp) * noise(),
        restore * noise()
      ]
      values.forEach((value, m) =>
        teamPoints.push({
          metric: `sample-dora:metric_${m}`,
          team,
          period,
          value: Math.round(value * 100) / 100
        })
      )
    })
  }

  return {
    engineers,
    teams,
    metrics,
    points,
    teamPoints,
    lastSyncAt: new Date().toISOString(),
    isSample: true
  }
}
