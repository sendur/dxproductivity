import { readJson, writeJson, getFeedToken, removeFeedToken } from './secureStore'
import { DEFAULT_ROLE_RULES } from '../shared/defaults'
import type { AppSettings, DxFeedConfig } from '../shared/types'

const SETTINGS_FILE = 'settings.json'

export const DEFAULT_SETTINGS: AppSettings = {
  syncIntervalMinutes: 60,
  dx: { baseUrl: 'https://api.getdx.com', feeds: [] },
  bamboo: {
    subdomain: '',
    levelField: '',
    roleTypeField: '',
    employmentTypeField: 'employmentHistoryStatus',
    roleRules: DEFAULT_ROLE_RULES
  }
}

type StoredFeed = Omit<DxFeedConfig, 'hasToken'>

export function getSettings(): AppSettings {
  const stored = readJson<Partial<AppSettings>>(SETTINGS_FILE, {})
  const dx = { ...DEFAULT_SETTINGS.dx, ...stored.dx }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    dx: {
      ...dx,
      // Feeds saved before team-level feeds existed default to per-engineer rows.
      feeds: (dx.feeds as StoredFeed[]).map((f) => ({
        ...f,
        grain: f.grain ?? 'engineer',
        teamColumn: f.teamColumn ?? '',
        hasToken: !!getFeedToken(f.id)
      }))
    },
    bamboo: { ...DEFAULT_SETTINGS.bamboo, ...stored.bamboo }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const previous = getSettings()
  const keptIds = new Set(settings.dx.feeds.map((f) => f.id))
  for (const feed of previous.dx.feeds) {
    if (!keptIds.has(feed.id)) removeFeedToken(feed.id)
  }
  const toStore = {
    ...settings,
    syncIntervalMinutes: Math.max(5, Math.round(settings.syncIntervalMinutes) || 60),
    dx: {
      ...settings.dx,
      baseUrl: settings.dx.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.dx.baseUrl,
      // hasToken is derived from the secret store on read; never persist it.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      feeds: settings.dx.feeds.map(({ hasToken, ...rest }) => rest)
    },
    bamboo: {
      ...settings.bamboo,
      subdomain: normalizeSubdomain(settings.bamboo.subdomain)
    }
  }
  writeJson(SETTINGS_FILE, toStore)
  return getSettings()
}

/** Accepts either "acme" or "https://acme.bamboohr.com/..." and returns "acme". */
export function normalizeSubdomain(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/^(?:https?:\/\/)?([^./]+)\.bamboohr\.com/i)
  return (match ? match[1] : trimmed).toLowerCase()
}
