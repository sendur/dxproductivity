import { useEffect, useState } from 'react'
import { DEFAULT_ROLE_RULES } from '../../../shared/defaults'
import {
  METRIC_CATEGORIES,
  type AppSettings,
  type ConnectionTestResult,
  type Dataset,
  type DxFeedConfig,
  type MetricCategory,
  type MetricGrain,
  type SecretStatus
} from '../../../shared/types'

interface Props {
  dataset: Dataset
  onSaved: () => void
}

function TestResult({
  result
}: {
  result: ConnectionTestResult | null | 'pending'
}): React.JSX.Element | null {
  if (!result) return null
  if (result === 'pending') return <span className="test-result muted">Testing…</span>
  return (
    <span className={`test-result ${result.ok ? 'ok' : 'fail'}`}>
      {result.ok ? '✓ ' : '✕ '}
      {result.message}
    </span>
  )
}

function newFeed(): DxFeedConfig {
  return {
    id: crypto.randomUUID(),
    name: 'New metrics feed',
    category: 'Speed',
    grain: 'engineer',
    emailColumn: '',
    teamColumn: '',
    periodColumn: '',
    variables: '',
    columnCategories: {},
    hasToken: false
  }
}

export function SettingsView({ dataset, onSaved }: Props): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [secretStatus, setSecretStatus] = useState<SecretStatus>({
    dxApiToken: false,
    bambooApiKey: false
  })
  const [dxToken, setDxToken] = useState('')
  const [bambooKey, setBambooKey] = useState('')
  const [feedTokens, setFeedTokens] = useState<Record<string, string>>({})
  const [tests, setTests] = useState<Record<string, ConnectionTestResult | null | 'pending'>>({})
  const [bambooFields, setBambooFields] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.settings.secretStatus().then(setSecretStatus)
  }, [])

  if (!settings) return <div className="muted">Loading settings…</div>

  const update = (patch: Partial<AppSettings>): void => setSettings({ ...settings, ...patch })
  const updateBamboo = (patch: Partial<AppSettings['bamboo']>): void =>
    update({ bamboo: { ...settings.bamboo, ...patch } })
  const updateFeed = (id: string, patch: Partial<DxFeedConfig>): void =>
    update({
      dx: {
        ...settings.dx,
        feeds: settings.dx.feeds.map((f) => (f.id === id ? { ...f, ...patch } : f))
      }
    })

  const runTest = async (
    key: string,
    fn: () => Promise<ConnectionTestResult>
  ): Promise<ConnectionTestResult> => {
    setTests((t) => ({ ...t, [key]: 'pending' }))
    const result = await fn()
    setTests((t) => ({ ...t, [key]: result }))
    return result
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.api.settings.save(settings, {
        dxApiToken: dxToken,
        bambooApiKey: bambooKey,
        feedTokens
      })
      setSettings(saved)
      setSecretStatus(await window.api.settings.secretStatus())
      setDxToken('')
      setBambooKey('')
      setFeedTokens({})
      setSavedAt(Date.now())
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const clearAll = async (): Promise<void> => {
    if (!confirm('Remove all stored API keys, feed tokens and synced data from this computer?')) {
      return
    }
    await window.api.settings.clearAll()
    setSecretStatus(await window.api.settings.secretStatus())
    setSettings(await window.api.settings.get())
    onSaved()
  }

  const savedPlaceholder = (has: boolean, fallback: string): string =>
    has ? '•••••••• saved — type to replace' : fallback

  return (
    <div className="settings content" style={{ padding: 0, overflow: 'visible' }}>
      <div className="banner">
        <span className="grow">
          API keys and feed tokens are encrypted with your OS keychain and stored only on this
          computer. Synced salary and job history are encrypted at rest too.
        </span>
        {savedAt && <span className="saved-flash">Saved ✓</span>}
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <div className="card">
        <h2>DX</h2>
        <div className="form-grid">
          <label htmlFor="dx-token">API token</label>
          <div className="row">
            <input
              id="dx-token"
              type="password"
              value={dxToken}
              placeholder={savedPlaceholder(secretStatus.dxApiToken, 'DX Web API bearer token')}
              onChange={(e) => setDxToken(e.target.value)}
            />
            <button
              className="btn"
              onClick={() => runTest('dx', () => window.api.test.dx(settings.dx.baseUrl, dxToken))}
            >
              Test
            </button>
          </div>
          <span className="hint">
            In DX: Settings → Web API → create a token with <code>snapshots:read</code> (teams) and
            query access. <TestResult result={tests.dx ?? null} />
          </span>
          <label htmlFor="dx-base">API base URL</label>
          <input
            id="dx-base"
            type="text"
            value={settings.dx.baseUrl}
            onChange={(e) => update({ dx: { ...settings.dx, baseUrl: e.target.value } })}
          />
          <label htmlFor="interval">Sync every (minutes)</label>
          <input
            id="interval"
            type="number"
            min={5}
            value={settings.syncIntervalMinutes}
            onChange={(e) => update({ syncIntervalMinutes: Number(e.target.value) })}
            style={{ width: 120 }}
          />
          <span className="hint">
            The app keeps pulling in the background while it&apos;s open. Minimum 5 minutes.
          </span>
        </div>

        <div className="card-header">
          <h3>Metric datafeeds</h3>
          <button
            className="btn"
            onClick={() =>
              update({ dx: { ...settings.dx, feeds: [...settings.dx.feeds, newFeed()] } })
            }
          >
            + Add feed
          </button>
        </div>
        <span className="muted">
          Each feed is a saved DX Data Studio query (Data Studio → query → Share → Datafeed). Every
          numeric column becomes a metric. Per-engineer feeds need an email column. Per-team feeds
          (for DORA: deployments, lead time, change failure rate, time to restore) need a column
          with the DX team name or id.
        </span>
        {settings.dx.feeds.length === 0 && (
          <span className="muted">No feeds yet. Add one to start pulling metrics.</span>
        )}
        {settings.dx.feeds.map((feed) => {
          const synced = dataset.metrics.filter((m) => m.feedId === feed.id)
          return (
            <div className="feed" key={feed.id}>
              <div className="feed-grid">
                <label className="control">
                  Name
                  <input
                    type="text"
                    value={feed.name}
                    onChange={(e) => updateFeed(feed.id, { name: e.target.value })}
                  />
                </label>
                <label className="control">
                  Feed token
                  <input
                    type="password"
                    value={feedTokens[feed.id] ?? ''}
                    placeholder={savedPlaceholder(
                      feed.hasToken,
                      'feed_token from the datafeed URL'
                    )}
                    onChange={(e) => setFeedTokens({ ...feedTokens, [feed.id]: e.target.value })}
                  />
                </label>
                <label className="control">
                  Rows are
                  <select
                    value={feed.grain}
                    onChange={(e) => {
                      const grain = e.target.value as MetricGrain
                      updateFeed(feed.id, {
                        grain,
                        // DORA metrics are team-level, so a new team feed starts there.
                        category:
                          grain === 'team' && feed.category === 'Speed' ? 'DORA' : feed.category
                      })
                    }}
                  >
                    <option value="engineer">One per engineer</option>
                    <option value="team">One per team (e.g. DORA)</option>
                  </select>
                </label>
                <label className="control">
                  Default metric category
                  <select
                    value={feed.category}
                    onChange={(e) =>
                      updateFeed(feed.id, { category: e.target.value as MetricCategory })
                    }
                  >
                    {METRIC_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {feed.grain === 'team' ? (
                  <label className="control">
                    Team column (blank = auto-detect)
                    <input
                      type="text"
                      value={feed.teamColumn}
                      placeholder="team"
                      onChange={(e) => updateFeed(feed.id, { teamColumn: e.target.value })}
                    />
                  </label>
                ) : (
                  <label className="control">
                    Email column (blank = auto-detect)
                    <input
                      type="text"
                      value={feed.emailColumn}
                      placeholder="email"
                      onChange={(e) => updateFeed(feed.id, { emailColumn: e.target.value })}
                    />
                  </label>
                )}
                <label className="control">
                  Period column (blank = sync date)
                  <input
                    type="text"
                    value={feed.periodColumn}
                    placeholder="e.g. week"
                    onChange={(e) => updateFeed(feed.id, { periodColumn: e.target.value })}
                  />
                </label>
                <label className="control">
                  Template variables (JSON, optional)
                  <input
                    type="text"
                    value={feed.variables}
                    placeholder='{"weeks": 12}'
                    onChange={(e) => updateFeed(feed.id, { variables: e.target.value })}
                  />
                </label>
              </div>
              {synced.length > 0 && (
                <div className="control">
                  Metric categories (per column)
                  <div className="chips">
                    {synced.map((m) => {
                      const column = m.key.slice(m.key.indexOf(':') + 1)
                      return (
                        <label key={m.key} className="chip" style={{ cursor: 'default' }}>
                          {m.name}{' '}
                          <select
                            value={feed.columnCategories[column] ?? m.category}
                            onChange={(e) =>
                              updateFeed(feed.id, {
                                columnCategories: {
                                  ...feed.columnCategories,
                                  [column]: e.target.value as MetricCategory
                                }
                              })
                            }
                          >
                            {METRIC_CATEGORIES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="row">
                <button
                  className="btn"
                  onClick={() =>
                    runTest(`feed:${feed.id}`, () =>
                      window.api.test.feed({
                        baseUrl: settings.dx.baseUrl,
                        feedId: feed.id,
                        feedToken: feedTokens[feed.id] ?? '',
                        variables: feed.variables
                      })
                    )
                  }
                >
                  Test feed
                </button>
                <TestResult result={tests[`feed:${feed.id}`] ?? null} />
                <span className="spacer" style={{ flex: 1 }} />
                <button
                  className="btn danger"
                  onClick={() =>
                    update({
                      dx: {
                        ...settings.dx,
                        feeds: settings.dx.feeds.filter((f) => f.id !== feed.id)
                      }
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h2>BambooHR</h2>
        <div className="form-grid">
          <label htmlFor="bamboo-sub">Company subdomain</label>
          <input
            id="bamboo-sub"
            type="text"
            value={settings.bamboo.subdomain}
            placeholder="acme  (from https://acme.bamboohr.com)"
            onChange={(e) => updateBamboo({ subdomain: e.target.value })}
          />
          <label htmlFor="bamboo-key">API key</label>
          <div className="row">
            <input
              id="bamboo-key"
              type="password"
              value={bambooKey}
              placeholder={savedPlaceholder(secretStatus.bambooApiKey, 'BambooHR API key')}
              onChange={(e) => setBambooKey(e.target.value)}
            />
            <button
              className="btn"
              onClick={async () => {
                const result = await runTest('bamboo', () =>
                  window.api.test.bamboo(settings.bamboo.subdomain, bambooKey)
                )
                if (result.fields) setBambooFields(result.fields)
              }}
            >
              Test &amp; load fields
            </button>
          </div>
          <span className="hint">
            In BambooHR: your avatar → API Keys → Add New Key. The key acts as you, so you need
            access to the Compensation and Job Information tables.{' '}
            <TestResult result={tests.bamboo ?? null} />
          </span>
          <label htmlFor="level-field">Level field</label>
          <input
            id="level-field"
            type="text"
            list="bamboo-fields"
            value={settings.bamboo.levelField}
            placeholder="blank = derive from job title (L4, Senior, Staff…)"
            onChange={(e) => updateBamboo({ levelField: e.target.value })}
          />
          <label htmlFor="role-field">Role type field</label>
          <input
            id="role-field"
            type="text"
            list="bamboo-fields"
            value={settings.bamboo.roleTypeField}
            placeholder="blank = use the job-title rules below"
            onChange={(e) => updateBamboo({ roleTypeField: e.target.value })}
          />
          <label htmlFor="emp-field">Employment type field</label>
          <input
            id="emp-field"
            type="text"
            list="bamboo-fields"
            value={settings.bamboo.employmentTypeField}
            onChange={(e) => updateBamboo({ employmentTypeField: e.target.value })}
          />
          <span className="hint">
            Field names are BambooHR aliases (e.g. <code>employmentHistoryStatus</code>) or custom
            field IDs (e.g. <code>4047</code>). Use &quot;Test &amp; load fields&quot; for
            suggestions.
          </span>
          <datalist id="bamboo-fields">
            {bambooFields.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>

        <div className="card-header">
          <h3>Role type rules</h3>
          <button
            className="btn small"
            onClick={() => updateBamboo({ roleRules: DEFAULT_ROLE_RULES })}
          >
            Reset to defaults
          </button>
          <button
            className="btn small"
            onClick={() =>
              updateBamboo({
                roleRules: [...settings.bamboo.roleRules, { pattern: '', roleType: '' }]
              })
            }
          >
            + Add rule
          </button>
        </div>
        <span className="muted">
          Used when no role type field is set. Rules are checked top to bottom. The first word in
          the job title that starts with the pattern decides the role type. Titles that match
          nothing are &quot;Other&quot;.
        </span>
        <div className="rules">
          {settings.bamboo.roleRules.map((rule, i) => (
            <div className="row" key={i}>
              <input
                type="text"
                value={rule.pattern}
                placeholder="title contains…"
                onChange={(e) =>
                  updateBamboo({
                    roleRules: settings.bamboo.roleRules.map((r, j) =>
                      j === i ? { ...r, pattern: e.target.value } : r
                    )
                  })
                }
              />
              <span className="muted">→</span>
              <input
                type="text"
                value={rule.roleType}
                placeholder="role type"
                onChange={(e) =>
                  updateBamboo({
                    roleRules: settings.bamboo.roleRules.map((r, j) =>
                      j === i ? { ...r, roleType: e.target.value } : r
                    )
                  })
                }
              />
              <button
                className="btn small danger"
                aria-label="Remove rule"
                onClick={() =>
                  updateBamboo({ roleRules: settings.bamboo.roleRules.filter((_, j) => j !== i) })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Data</h2>
        <div className="row">
          <button className="btn" onClick={() => window.api.data.loadSample()}>
            Load sample data
          </button>
          <button className="btn" onClick={() => window.api.data.clear()}>
            Clear synced data
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn danger" onClick={clearAll}>
            Remove all keys &amp; data
          </button>
        </div>
      </div>
    </div>
  )
}
