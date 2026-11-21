import { readJson, writeJson, readEncryptedJson, writeEncryptedJson } from './secureStore'
import type {
  Dataset,
  Engineer,
  MetricDef,
  MetricPoint,
  TeamInfo,
  TeamMetricPoint
} from '../shared/types'

// Metrics are stored as plain JSON; people data (salaries, job history) is encrypted at rest.
const METRICS_FILE = 'metrics.json'
const PEOPLE_FILE = 'people.json'

export interface MetricsFile {
  teams: TeamInfo[]
  metrics: MetricDef[]
  points: MetricPoint[]
  teamPoints: TeamMetricPoint[]
  lastSyncAt: string | null
  isSample: boolean
}

export interface PeopleFile {
  engineers: Engineer[]
  /** When compensation/job tables were last pulled from BambooHR. */
  hrTablesFetchedAt: string | null
}

const EMPTY_METRICS: MetricsFile = {
  teams: [],
  metrics: [],
  points: [],
  teamPoints: [],
  lastSyncAt: null,
  isSample: false
}
const EMPTY_PEOPLE: PeopleFile = { engineers: [], hrTablesFetchedAt: null }

export function getMetrics(): MetricsFile {
  const stored = { ...EMPTY_METRICS, ...readJson<Partial<MetricsFile>>(METRICS_FILE, {}) }
  // Metric definitions saved before team-level feeds existed are per-engineer.
  return { ...stored, metrics: stored.metrics.map((m) => ({ ...m, grain: m.grain ?? 'engineer' })) }
}

export function getPeople(): PeopleFile {
  return { ...EMPTY_PEOPLE, ...readEncryptedJson<Partial<PeopleFile>>(PEOPLE_FILE, {}) }
}

export function save(metrics: MetricsFile, people: PeopleFile): void {
  writeJson(METRICS_FILE, metrics)
  writeEncryptedJson(PEOPLE_FILE, people)
}

export function getDataset(): Dataset {
  return { ...getMetrics(), engineers: getPeople().engineers }
}

export function clear(): void {
  save(EMPTY_METRICS, EMPTY_PEOPLE)
}
