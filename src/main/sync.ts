import * as dataStore from './dataStore'
import * as dxApi from './dxApi'
import * as bambooApi from './bambooApi'
import { mapLimit } from './http'
import { getSettings } from './settingsStore'
import { getBambooApiKey, getDxApiToken, getFeedToken } from './secureStore'
import {
  assignTeams,
  currentSalary,
  deriveLevel,
  deriveRoleType,
  detectPromotions,
  extractMetrics,
  mergePoints,
  parseCompensation,
  parseJobInfo,
  teamPaths,
  teamResolver,
  type Row
} from './transform'
import type {
  Engineer,
  MetricDef,
  MetricPoint,
  SyncStatus,
  TeamInfo,
  TeamMetricPoint
} from '../shared/types'

/** BambooHR compensation/job tables change rarely; scheduled syncs re-pull them at most this often. */
const HR_TABLE_TTL_MS = 12 * 60 * 60 * 1000

let status: SyncStatus = {
  running: false,
  stage: '',
  lastSyncAt: dataStore.getMetrics().lastSyncAt,
  lastError: null,
  warnings: [],
  nextSyncAt: null
}
let timer: NodeJS.Timeout | null = null
let listener: (status: SyncStatus) => void = () => {}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  listener(status)
}

export function getStatus(): SyncStatus {
  return status
}

export function onStatus(fn: (status: SyncStatus) => void): void {
  listener = fn
}

/** (Re)starts the continuous sync loop using the saved interval. */
export function schedule(runSoon = false): void {
  if (timer) clearTimeout(timer)
  const intervalMs = getSettings().syncIntervalMinutes * 60 * 1000
  const delay = runSoon ? 5_000 : intervalMs
  setStatus({
    nextSyncAt: isConfigured() ? new Date(Date.now() + delay).toISOString() : null
  })
  timer = setTimeout(async () => {
    if (isConfigured()) await runSync(false).catch(() => {})
    schedule()
  }, delay)
}

export function stop(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

export function isConfigured(): boolean {
  const settings = getSettings()
  return !!getDxApiToken() && settings.dx.feeds.some((f) => f.hasToken)
}

export async function runSync(force: boolean): Promise<SyncStatus> {
  if (status.running) return status
  setStatus({ running: true, stage: 'Starting', lastError: null, warnings: [] })
  const warnings: string[] = []
  try {
    await syncOnce(force, warnings, (stage) => setStatus({ stage }))
    setStatus({
      running: false,
      stage: '',
      lastSyncAt: new Date().toISOString(),
      warnings
    })
  } catch (err) {
    setStatus({ running: false, stage: '', lastError: (err as Error).message, warnings })
  }
  return status
}

async function syncOnce(
  force: boolean,
  warnings: string[],
  stage: (s: string) => void
): Promise<void> {
  const settings = getSettings()
  const dxToken = getDxApiToken()
  if (!dxToken) throw new Error('Add your DX API token in Settings')
  const feeds = settings.dx.feeds.filter((f) => f.hasToken)
  if (feeds.length === 0) throw new Error('Add at least one DX datafeed in Settings')

  const previousMetrics = dataStore.getMetrics()
  const previousPeople = dataStore.getPeople()
  // Sample data never mixes with real data.
  const fresh = previousMetrics.isSample
  const basePoints = fresh ? [] : previousMetrics.points
  const baseTeamPoints = fresh ? [] : previousMetrics.teamPoints
  const baseDefs = fresh ? [] : previousMetrics.metrics
  const previousByEmail = new Map((fresh ? [] : previousPeople.engineers).map((e) => [e.email, e]))
  const today = new Date().toISOString().slice(0, 10)
  const baseUrl = settings.dx.baseUrl

  // 1. Teams
  stage('Loading DX teams')
  let teams: TeamInfo[] = fresh ? [] : previousMetrics.teams
  let teamByEmail = new Map<string, { teamId: string; teamName: string; teamPath: string[] }>()
  let dxNames = new Map<string, string>()
  try {
    const dxTeams = await dxApi.listTeams(baseUrl, dxToken)
    const paths = teamPaths(dxTeams)
    teams = dxTeams.map((t) => ({ id: t.id, name: t.name, path: paths.get(t.id) ?? [t.name] }))
    stage(`Loading members of ${dxTeams.length} DX teams`)
    const { membership, names } = await dxApi.teamMembership(baseUrl, dxToken, dxTeams)
    teamByEmail = assignTeams(dxTeams, membership)
    dxNames = names
  } catch (err) {
    warnings.push(`Teams not refreshed: ${(err as Error).message}`)
    for (const e of previousByEmail.values()) {
      if (e.teamId) {
        teamByEmail.set(e.email, { teamId: e.teamId, teamName: e.teamName, teamPath: e.teamPath })
      }
    }
  }
  const resolveTeam = teamResolver(teams)

  // 2. Metric feeds
  const configuredFeedIds = new Set(settings.dx.feeds.map((f) => f.id))
  const refreshedFeedIds = new Set<string>()
  const newDefs: MetricDef[] = []
  let newPoints: MetricPoint[] = []
  let newTeamPoints: TeamMetricPoint[] = []
  for (const feed of feeds) {
    stage(`Pulling DX datafeed "${feed.name}"`)
    try {
      const rows = await dxApi.fetchDatafeed(
        baseUrl,
        dxToken,
        getFeedToken(feed.id) ?? '',
        feed.variables
      )
      const result = extractMetrics(feed, rows, today, resolveTeam)
      warnings.push(...result.warnings)
      newDefs.push(...result.metrics)
      newPoints = newPoints.concat(result.points)
      newTeamPoints = newTeamPoints.concat(result.teamPoints)
      refreshedFeedIds.add(feed.id)
    } catch (err) {
      warnings.push(`${feed.name}: ${(err as Error).message}`)
    }
  }
  if (refreshedFeedIds.size === 0) {
    throw new Error(`No DX datafeeds could be pulled. ${warnings.join(' · ')}`)
  }
  const feedOf = (metricKey: string): string => metricKey.slice(0, metricKey.indexOf(':'))
  const metrics = [
    ...baseDefs.filter((d) => configuredFeedIds.has(d.feedId) && !refreshedFeedIds.has(d.feedId)),
    ...newDefs
  ]
  const liveKeys = new Set(metrics.map((m) => m.key))
  const keep = <T extends { metric: string }>(p: T): boolean =>
    configuredFeedIds.has(feedOf(p.metric))
  const points = mergePoints(basePoints.filter(keep), newPoints, (p) => p.email).filter((p) =>
    liveKeys.has(p.metric)
  )
  const teamPoints = mergePoints(baseTeamPoints.filter(keep), newTeamPoints, (p) => p.team).filter(
    (p) => liveKeys.has(p.metric)
  )

  // 3. Engineers = everyone on a DX team or with metrics
  const emails = new Set<string>([...teamByEmail.keys(), ...points.map((p) => p.email)])
  const engineers = new Map<string, Engineer>()
  for (const email of emails) {
    const prev = previousByEmail.get(email)
    const team = teamByEmail.get(email)
    engineers.set(email, {
      email,
      name: dxNames.get(email) ?? prev?.name ?? email.split('@')[0],
      teamId: team?.teamId ?? null,
      teamName: team?.teamName ?? 'No team',
      teamPath: team?.teamPath ?? [],
      bambooId: prev?.bambooId ?? null,
      jobTitle: prev?.jobTitle ?? '',
      department: prev?.department ?? '',
      level: prev?.level ?? 'Unknown',
      roleType: prev?.roleType ?? 'Other',
      employmentType: prev?.employmentType ?? 'Unknown',
      hireDate: prev?.hireDate ?? '',
      salary: prev?.salary ?? null,
      compensationHistory: prev?.compensationHistory ?? [],
      jobHistory: prev?.jobHistory ?? [],
      promotions: prev?.promotions ?? []
    })
  }

  // 4. BambooHR enrichment
  let hrTablesFetchedAt = fresh ? null : previousPeople.hrTablesFetchedAt
  const bambooKey = getBambooApiKey()
  const { subdomain, levelField, roleTypeField, employmentTypeField, roleRules } = settings.bamboo
  if (bambooKey && subdomain) {
    try {
      stage('Loading BambooHR employees')
      const optionalFields = [levelField, roleTypeField, employmentTypeField].filter(Boolean)
      const report = await bambooApi.employeeReport(subdomain, bambooKey, [
        'displayName',
        'firstName',
        'lastName',
        'workEmail',
        'jobTitle',
        'department',
        'hireDate',
        ...optionalFields
      ])
      const byEmail = new Map<string, Row>()
      for (const row of report) {
        const email = String(row.workEmail ?? '')
          .trim()
          .toLowerCase()
        if (email) byEmail.set(email, row)
      }
      const field = (row: Row, name: string): string =>
        name && row[name] !== null && row[name] !== undefined ? String(row[name]).trim() : ''

      const matched: Engineer[] = []
      for (const engineer of engineers.values()) {
        const row = byEmail.get(engineer.email)
        if (!row) continue
        matched.push(engineer)
        engineer.bambooId = String(row.id)
        engineer.name =
          field(row, 'displayName') ||
          `${field(row, 'firstName')} ${field(row, 'lastName')}`.trim() ||
          engineer.name
        engineer.jobTitle = field(row, 'jobTitle')
        engineer.department = field(row, 'department')
        engineer.hireDate = field(row, 'hireDate')
        engineer.level = field(row, levelField) || deriveLevel(engineer.jobTitle)
        engineer.roleType =
          field(row, roleTypeField) || deriveRoleType(engineer.jobTitle, roleRules)
        engineer.employmentType = field(row, employmentTypeField) || 'Unknown'
      }
      const unmatched = engineers.size - matched.length
      if (unmatched > 0) {
        warnings.push(`${unmatched} DX engineers have no BambooHR record with the same work email`)
      }

      const stale =
        !hrTablesFetchedAt || Date.now() - Date.parse(hrTablesFetchedAt) > HR_TABLE_TTL_MS
      if (force || stale) {
        let compDenied = false
        let jobDenied = false
        let done = 0
        await mapLimit(matched, 4, async (engineer) => {
          const id = engineer.bambooId!
          const [comp, jobs] = await Promise.all([
            bambooApi.employeeTable(subdomain, bambooKey, id, 'compensation'),
            bambooApi.employeeTable(subdomain, bambooKey, id, 'jobInfo')
          ])
          if (comp === null) compDenied = true
          if (jobs === null) jobDenied = true
          engineer.compensationHistory = parseCompensation(comp ?? [])
          engineer.salary = currentSalary(engineer.compensationHistory, today)
          engineer.jobHistory = parseJobInfo(jobs ?? [])
          engineer.promotions = detectPromotions(engineer.jobHistory)
          stage(`Loading BambooHR salaries & promotions (${++done}/${matched.length})`)
        })
        if (compDenied) warnings.push('BambooHR API key cannot read the Compensation table')
        if (jobDenied) warnings.push('BambooHR API key cannot read the Job Information table')
        hrTablesFetchedAt = new Date().toISOString()
      }
    } catch (err) {
      warnings.push(`BambooHR not refreshed: ${(err as Error).message}`)
    }
  } else {
    warnings.push('BambooHR is not configured — levels, salaries and promotions are unavailable')
  }

  stage('Saving')
  dataStore.save(
    {
      teams,
      metrics,
      points,
      teamPoints,
      lastSyncAt: new Date().toISOString(),
      isSample: false
    },
    {
      engineers: [...engineers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      hrTablesFetchedAt
    }
  )
}
