export const METRIC_CATEGORIES = [
  'Speed',
  'Quality',
  'Effectiveness',
  'Impact',
  'AI',
  'DORA',
  'Other'
] as const
export type MetricCategory = (typeof METRIC_CATEGORIES)[number]

/** Whether a feed has one row per engineer or one row per team (e.g. DORA metrics). */
export type MetricGrain = 'engineer' | 'team'

/** A saved DX Data Studio query pulled through the queries.datafeed endpoint. */
export interface DxFeedConfig {
  id: string
  name: string
  category: MetricCategory
  grain: MetricGrain
  /** Column holding the engineer's email. Auto-detected (any column containing "email") if blank. */
  emailColumn: string
  /** Team feeds: column holding the DX team name or id. Auto-detected (contains "team") if blank. */
  teamColumn: string
  /** Optional column holding the period (date/week/month) a row belongs to. Blank = the sync date. */
  periodColumn: string
  /** Optional JSON object of Data Studio template variables, e.g. {"start_date":"2026-01-01"}. */
  variables: string
  /** Per-column category overrides, keyed by column name. */
  columnCategories: Record<string, MetricCategory>
  /** True when an encrypted feed token is stored for this feed (the token itself never leaves main). */
  hasToken: boolean
}

export interface RoleRule {
  /** Case-insensitive prefix of a word in the job title. */
  pattern: string
  roleType: string
}

export interface AppSettings {
  syncIntervalMinutes: number
  dx: {
    baseUrl: string
    feeds: DxFeedConfig[]
  }
  bamboo: {
    subdomain: string
    /** BambooHR field holding the engineer level. Blank = derive level from the job title. */
    levelField: string
    /** BambooHR field holding the role type. Blank = use roleRules against the job title. */
    roleTypeField: string
    employmentTypeField: string
    roleRules: RoleRule[]
  }
}

export interface SecretStatus {
  dxApiToken: boolean
  bambooApiKey: boolean
}

export interface SecretsUpdate {
  dxApiToken?: string
  bambooApiKey?: string
  /** feedId -> token. Only feeds present are changed. */
  feedTokens?: Record<string, string>
}

export interface Salary {
  /** Annualized amount. */
  annual: number
  currency: string
  rawAmount: number
  paidPer: string
  effectiveDate: string
  reason: string
}

export interface CompensationRow {
  startDate: string
  amount: number
  currency: string
  paidPer: string
  annual: number
  reason: string
  type: string
}

export interface JobRow {
  date: string
  jobTitle: string
  department: string
  division: string
  location: string
}

export interface Promotion {
  date: string
  fromTitle: string
  toTitle: string
}

export interface Engineer {
  /** Lower-cased work email; the join key between DX and BambooHR. */
  email: string
  name: string
  teamId: string | null
  teamName: string
  /** Root-to-leaf team names. */
  teamPath: string[]
  bambooId: string | null
  jobTitle: string
  department: string
  level: string
  roleType: string
  employmentType: string
  hireDate: string
  salary: Salary | null
  compensationHistory: CompensationRow[]
  jobHistory: JobRow[]
  promotions: Promotion[]
}

export interface MetricDef {
  /** `${feedId}:${column}` */
  key: string
  feedId: string
  feedName: string
  name: string
  category: MetricCategory
  grain: MetricGrain
}

export interface MetricPoint {
  metric: string
  email: string
  /** YYYY-MM-DD */
  period: string
  value: number
}

export interface TeamMetricPoint {
  metric: string
  /** DX team name. */
  team: string
  /** YYYY-MM-DD */
  period: string
  value: number
}

export interface TeamInfo {
  id: string
  name: string
  /** Root-to-leaf team names. */
  path: string[]
}

export interface Dataset {
  engineers: Engineer[]
  teams: TeamInfo[]
  metrics: MetricDef[]
  points: MetricPoint[]
  teamPoints: TeamMetricPoint[]
  lastSyncAt: string | null
  isSample: boolean
}

export interface SyncStatus {
  running: boolean
  stage: string
  lastSyncAt: string | null
  lastError: string | null
  warnings: string[]
  nextSyncAt: string | null
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  /** BambooHR only: available field names, to help pick the level/role fields. */
  fields?: string[]
}
