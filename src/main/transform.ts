// Pure data-shaping helpers (no Electron imports) so they can be unit tested.
import type {
  CompensationRow,
  DxFeedConfig,
  JobRow,
  MetricCategory,
  MetricDef,
  MetricPoint,
  Promotion,
  RoleRule,
  Salary,
  TeamMetricPoint
} from '../shared/types'

export type Row = Record<string, unknown>

/**
 * Normalizes the queries.datafeed response into an array of objects. DX returns
 * `{ data: { columns, rows } }` with rows as arrays; older/alternate shapes (rows as
 * objects, or the table at the top level) are accepted too.
 */
export function parseDatafeed(body: unknown): Row[] {
  const root = (body ?? {}) as Record<string, unknown>
  const table = (
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root
  ) as Record<string, unknown>
  const rows = (Array.isArray(root.data) ? root.data : table.rows) as unknown[] | undefined
  if (!Array.isArray(rows)) return []
  const columns = Array.isArray(table.columns)
    ? (table.columns as unknown[]).map((c) =>
        typeof c === 'string' ? c : String((c as { name?: unknown })?.name ?? '')
      )
    : null
  return rows.map((row) => {
    if (Array.isArray(row)) {
      const out: Row = {}
      row.forEach((value, i) => (out[columns?.[i] ?? `column_${i}`] = value))
      return out
    }
    return (row ?? {}) as Row
  })
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/[,$%\s]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Coerces dates/timestamps/"2026-03"-style strings to YYYY-MM-DD where possible. */
export function toPeriod(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10)
}

function humanize(column: string): string {
  return column
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Columns named after AI tools are categorized as AI unless the user overrides it. */
const AI_COLUMN =
  /(^|[_\s-])(ai|copilot|cursor|claude|llm|genai|gpt|codeium|tabnine|windsurf)([_\s-]|$)/i

/** DORA's four keys, recognized by column name. */
const DORA_COLUMN =
  /deploy|lead_?time|change_?fail|cfr|restore|recovery|mttr|time_?to_?(restore|recover)/i

const NON_METRIC_COLUMN = /(^|_)(id|ids|email|name|team|title|level|uuid)$/i

type FeedShape = Pick<DxFeedConfig, 'id' | 'name' | 'category' | 'emailColumn' | 'periodColumn'> & {
  grain?: DxFeedConfig['grain']
  teamColumn?: string
  columnCategories?: Record<string, MetricCategory>
}

/**
 * Turns one feed's rows into metric definitions plus per-engineer points (engineer feeds)
 * or per-team points (team feeds). `resolveTeam` maps a team cell (name or id) to the DX
 * team name; unresolved values are kept as written.
 */
export function extractMetrics(
  feed: FeedShape,
  rows: Row[],
  syncDate: string,
  resolveTeam: (raw: string) => string | null = () => null
): {
  metrics: MetricDef[]
  points: MetricPoint[]
  teamPoints: TeamMetricPoint[]
  warnings: string[]
} {
  const warnings: string[] = []
  const empty = { metrics: [], points: [], teamPoints: [] }
  if (rows.length === 0) return { ...empty, warnings: [`${feed.name}: no rows`] }
  const grain = feed.grain ?? 'engineer'
  const columns = Object.keys(rows[0])
  const keyColumn =
    grain === 'team'
      ? feed.teamColumn?.trim() || columns.find((c) => /team/i.test(c)) || columns[0]
      : feed.emailColumn.trim() || columns.find((c) => /email/i.test(c)) || columns[0]
  if (!columns.includes(keyColumn)) {
    const what = grain === 'team' ? 'team' : 'email'
    warnings.push(`${feed.name}: ${what} column "${keyColumn}" not found in ${columns.join(', ')}`)
    return { ...empty, warnings }
  }
  const periodColumn = feed.periodColumn.trim()
  if (periodColumn && !columns.includes(periodColumn)) {
    warnings.push(`${feed.name}: period column "${periodColumn}" not found; using sync date`)
  }
  const metricColumns = columns.filter(
    (c) =>
      c !== keyColumn &&
      c !== periodColumn &&
      !NON_METRIC_COLUMN.test(c) &&
      rows.some((r) => toNumber(r[c]) !== null)
  )
  if (metricColumns.length === 0) warnings.push(`${feed.name}: no numeric columns found`)
  if (rows.length >= 1000) {
    warnings.push(`${feed.name}: returned 1000 rows (the DX datafeed limit); data may be truncated`)
  }

  const metrics: MetricDef[] = metricColumns.map((column) => ({
    key: `${feed.id}:${column}`,
    feedId: feed.id,
    feedName: feed.name,
    name: humanize(column),
    grain,
    category:
      feed.columnCategories?.[column] ??
      (AI_COLUMN.test(column)
        ? 'AI'
        : grain === 'team' && DORA_COLUMN.test(column)
          ? 'DORA'
          : feed.category)
  }))
  const points: MetricPoint[] = []
  const teamPoints: TeamMetricPoint[] = []
  let skipped = 0
  const unknownTeams = new Set<string>()
  for (const row of rows) {
    const raw = String(row[keyColumn] ?? '').trim()
    const period = columns.includes(periodColumn) ? toPeriod(row[periodColumn], syncDate) : syncDate
    if (grain === 'team') {
      if (!raw) {
        skipped++
        continue
      }
      const team = resolveTeam(raw)
      if (!team) unknownTeams.add(raw)
      for (const column of metricColumns) {
        const value = toNumber(row[column])
        if (value !== null) {
          teamPoints.push({ metric: `${feed.id}:${column}`, team: team ?? raw, period, value })
        }
      }
      continue
    }
    const email = raw.toLowerCase()
    if (!email.includes('@')) {
      skipped++
      continue
    }
    for (const column of metricColumns) {
      const value = toNumber(row[column])
      if (value !== null) points.push({ metric: `${feed.id}:${column}`, email, period, value })
    }
  }
  if (skipped > 0) {
    const what = grain === 'team' ? 'a team' : 'an email'
    warnings.push(`${feed.name}: skipped ${skipped} rows without ${what}`)
  }
  if (unknownTeams.size > 0) {
    warnings.push(
      `${feed.name}: ${unknownTeams.size} team value(s) don't match a DX team (e.g. "${[...unknownTeams][0]}")`
    )
  }
  return { metrics, points, teamPoints, warnings }
}

/** Replaces points with the same identity + period and keeps everything else (history). */
export function mergePoints<T extends { metric: string; period: string }>(
  existing: T[],
  incoming: T[],
  idOf: (p: T) => string
): T[] {
  const byKey = new Map<string, T>()
  for (const p of existing) byKey.set(`${p.metric}|${idOf(p)}|${p.period}`, p)
  for (const p of incoming) byKey.set(`${p.metric}|${idOf(p)}|${p.period}`, p)
  return [...byKey.values()]
}

// ---- Teams ----

export interface DxTeam {
  id: string
  name: string
  parentId: string | null
}

/** Root-to-leaf names for every team. */
export function teamPaths(teams: DxTeam[]): Map<string, string[]> {
  const byId = new Map(teams.map((t) => [t.id, t]))
  const result = new Map<string, string[]>()
  for (const team of teams) {
    const path: string[] = []
    const seen = new Set<string>()
    let current: DxTeam | undefined = team
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      path.unshift(current.name)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    result.set(team.id, path)
  }
  return result
}

/** Picks the deepest team an engineer belongs to and returns its root-to-leaf path. */
export function assignTeams(
  teams: DxTeam[],
  membership: Map<string, string[]>
): Map<string, { teamId: string; teamName: string; teamPath: string[] }> {
  const byId = new Map(teams.map((t) => [t.id, t]))
  const paths = teamPaths(teams)
  const result = new Map<string, { teamId: string; teamName: string; teamPath: string[] }>()
  for (const [email, teamIds] of membership) {
    let best: { teamId: string; teamName: string; teamPath: string[] } | null = null
    for (const id of teamIds) {
      const path = paths.get(id) ?? []
      if (!best || path.length > best.teamPath.length) {
        best = { teamId: id, teamName: byId.get(id)?.name ?? id, teamPath: path }
      }
    }
    if (best) result.set(email, best)
  }
  return result
}

/** Resolves a team cell from a datafeed (DX team id or name, any case) to the team name. */
export function teamResolver(
  teams: { id: string; name: string }[]
): (raw: string) => string | null {
  const byId = new Map(teams.map((t) => [t.id, t.name]))
  const byName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.name]))
  return (raw) => byId.get(raw) ?? byName.get(raw.trim().toLowerCase()) ?? null
}

// ---- BambooHR ----

const LEVEL_KEYWORDS: [RegExp, string][] = [
  [/\bintern\b/i, 'Intern'],
  [/\bdistinguished\b|\bfellow\b/i, 'Distinguished'],
  [/\bprincipal\b/i, 'Principal'],
  [/\bsenior staff\b|\bsr\.? staff\b/i, 'Senior Staff'],
  [/\bstaff\b/i, 'Staff'],
  [/\bdirector\b|\bvp\b|\bhead of\b/i, 'Director+'],
  [/\bmanager\b|\bem\b/i, 'Manager'],
  [/\bsenior\b|\bsr\.?\b/i, 'Senior'],
  [/\bjunior\b|\bjr\.?\b|\bassociate\b|\bentry\b/i, 'Junior'],
  [/\bIII\b/, 'Senior'],
  [/\bII\b/, 'Mid'],
  [/\bI\b/, 'Junior']
]

/** Uses an explicit level code (L4, IC3, E5, P2) when present, otherwise title keywords. */
export function deriveLevel(jobTitle: string): string {
  const code = jobTitle.match(/\b(L|IC|E|P|SWE)\s?-?(\d{1,2})\b/i)
  if (code) return `${code[1].toUpperCase()}${code[2]}`
  for (const [re, level] of LEVEL_KEYWORDS) if (re.test(jobTitle)) return level
  return jobTitle ? 'Mid' : 'Unknown'
}

export function deriveRoleType(jobTitle: string, rules: RoleRule[]): string {
  const title = jobTitle.toLowerCase()
  for (const rule of rules) {
    const pattern = rule.pattern.trim().toLowerCase()
    if (!pattern) continue
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9])${escaped}`).test(title)) return rule.roleType
  }
  return 'Other'
}

const PERIODS_PER_YEAR: Record<string, number> = {
  hour: 2080,
  day: 260,
  week: 52,
  month: 12,
  quarter: 4,
  year: 1
}

export function annualize(amount: number, paidPer: string): number {
  const key = paidPer.trim().toLowerCase().replace(/ly$/, '')
  return amount * (PERIODS_PER_YEAR[key] ?? 1)
}

/** BambooHR money values come back as `{ value, currency }` or "120000.00 USD". */
function parseMoney(rate: unknown): { amount: number; currency: string } | null {
  if (rate && typeof rate === 'object') {
    const r = rate as { value?: unknown; currency?: unknown }
    const amount = toNumber(r.value)
    return amount === null ? null : { amount, currency: String(r.currency ?? 'USD') }
  }
  if (typeof rate === 'string') {
    const amount = toNumber(rate.replace(/[A-Z]{3}/g, ''))
    const currency = rate.match(/[A-Z]{3}/)?.[0] ?? 'USD'
    return amount === null ? null : { amount, currency }
  }
  return null
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

export function parseCompensation(rows: Row[]): CompensationRow[] {
  const out: CompensationRow[] = []
  for (const row of rows) {
    const money = parseMoney(row.rate)
    if (!money) continue
    const paidPer = str(row.paidPer) || 'Year'
    out.push({
      startDate: str(row.startDate),
      amount: money.amount,
      currency: money.currency,
      paidPer,
      annual: annualize(money.amount, paidPer),
      reason: str(row.reason),
      type: str(row.type)
    })
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** The latest compensation row that has already taken effect. */
export function currentSalary(history: CompensationRow[], today: string): Salary | null {
  const effective = history.filter((r) => !r.startDate || r.startDate <= today)
  const row = effective[effective.length - 1]
  if (!row) return null
  return {
    annual: row.annual,
    currency: row.currency,
    rawAmount: row.amount,
    paidPer: row.paidPer,
    effectiveDate: row.startDate,
    reason: row.reason
  }
}

export function parseJobInfo(rows: Row[]): JobRow[] {
  return rows
    .map((row) => ({
      date: str(row.date),
      jobTitle: str(row.jobTitle),
      department: str(row.department),
      division: str(row.division),
      location: str(row.location)
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** A promotion is any change of job title between consecutive Job Information rows. */
export function detectPromotions(history: JobRow[]): Promotion[] {
  const promotions: Promotion[] = []
  let previous: JobRow | null = null
  for (const row of history) {
    if (!row.jobTitle) continue
    if (previous && previous.jobTitle.toLowerCase() !== row.jobTitle.toLowerCase()) {
      promotions.push({ date: row.date, fromTitle: previous.jobTitle, toTitle: row.jobTitle })
    }
    previous = row
  }
  return promotions
}
