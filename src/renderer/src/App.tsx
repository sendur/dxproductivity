import { useCallback, useEffect, useMemo, useState } from 'react'
import { FilterBar } from './components/FilterBar'
import { ExploreView } from './components/ExploreView'
import { ScorecardView } from './components/ScorecardView'
import { EngineersView } from './components/EngineersView'
import { EngineerDetail } from './components/EngineerDetail'
import { SettingsView } from './components/SettingsView'
import { AiImpactView } from './components/AiImpactView'
import { DoraView } from './components/DoraView'
import { applyFilters, type Filters, type TimeWindow } from './utils/analytics'
import { formatRelative } from './utils/format'
import type { Dataset, SyncStatus } from '../../shared/types'

type View = 'explore' | 'ai' | 'dora' | 'scorecard' | 'engineers' | 'settings'
const VIEWS: { id: View; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'ai', label: 'AI Impact' },
  { id: 'dora', label: 'DORA' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'engineers', label: 'Engineers' },
  { id: 'settings', label: 'Settings' }
]

function SyncIndicator({
  status,
  onSync
}: {
  status: SyncStatus | null
  onSync: () => void
}): React.JSX.Element {
  // Re-render every 30s so the relative times stay fresh.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const state = !status
    ? 'idle'
    : status.running
      ? 'running'
      : status.lastError
        ? 'error'
        : status.lastSyncAt
          ? 'ok'
          : 'idle'
  return (
    <div className="sync-indicator">
      <span className={`dot ${state}`} aria-hidden />
      <span>
        {status?.running
          ? status.stage || 'Syncing…'
          : status?.lastError
            ? 'Last sync failed'
            : `Synced ${formatRelative(status?.lastSyncAt ?? null)}`}
        {!status?.running && status?.nextSyncAt && (
          <span className="muted"> · next {formatRelative(status.nextSyncAt)}</span>
        )}
      </span>
      <button className="btn small" onClick={onSync} disabled={status?.running}>
        Sync now
      </button>
    </div>
  )
}

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('explore')
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [filters, setFilters] = useState<Filters>({})
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(90)
  const [selected, setSelected] = useState<string | null>(null)
  const [hideComp, setHideComp] = useState(false)
  const [warningsOpen, setWarningsOpen] = useState(false)

  const reload = useCallback(() => {
    window.api.data.get().then(setDataset)
  }, [])

  useEffect(() => {
    reload()
    window.api.sync.status().then(setStatus)
    const offData = window.api.data.onUpdated(reload)
    const offStatus = window.api.sync.onStatus(setStatus)
    return () => {
      offData()
      offStatus()
    }
  }, [reload])

  const engineers = useMemo(
    () => (dataset ? applyFilters(dataset.engineers, filters) : []),
    [dataset, filters]
  )
  // Every view except DORA works per engineer, so team-level metrics are hidden there.
  const engineerDataset = useMemo(
    () => dataset && { ...dataset, metrics: dataset.metrics.filter((m) => m.grain !== 'team') },
    [dataset]
  )
  const selectedEngineer = dataset?.engineers.find((e) => e.email === selected) ?? null
  const hasData = !!dataset && (dataset.engineers.length > 0 || dataset.teamPoints.length > 0)
  const analysisView = view !== 'settings'

  const syncNow = (): void => {
    window.api.sync.now().then(setStatus)
  }

  return (
    <div className={`app${hideComp ? ' hide-comp' : ''}`}>
      <nav className="sidebar">
        <div className="brand">
          DX Productivity
          <small>Engineering metrics × BambooHR</small>
        </div>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`nav-item${view === v.id ? ' active' : ''}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
        <div className="sidebar-footer">
          <label className="checkbox" title="Blur salaries, e.g. while screen sharing">
            <input
              type="checkbox"
              checked={hideComp}
              onChange={(e) => setHideComp(e.target.checked)}
            />
            Hide compensation
          </label>
          {dataset && (
            <span>
              {dataset.engineers.length} engineers · {dataset.metrics.length} metrics
            </span>
          )}
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{VIEWS.find((v) => v.id === view)?.label}</h1>
          <SyncIndicator status={status} onSync={syncNow} />
        </header>
        <main className="content">
          {status?.lastError && (
            <div className="banner error">
              <span className="grow">{status.lastError}</span>
              <button className="btn small" onClick={() => setView('settings')}>
                Open settings
              </button>
            </div>
          )}
          {!!status?.warnings.length && !status.running && (
            <div className="banner warning">
              <div className="grow">
                {status.warnings.length} sync warning{status.warnings.length > 1 ? 's' : ''}
                {warningsOpen && (
                  <ul>
                    {status.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="btn small" onClick={() => setWarningsOpen(!warningsOpen)}>
                {warningsOpen ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
          {dataset?.isSample && (
            <div className="banner">
              <span className="grow">
                You&apos;re looking at <b>sample data</b>. Add your DX and BambooHR keys in
                Settings. Your first sync replaces it.
              </span>
              <button className="btn small" onClick={() => window.api.data.clear()}>
                Clear sample
              </button>
            </div>
          )}

          {view === 'settings' && dataset && <SettingsView dataset={dataset} onSaved={reload} />}

          {analysisView && dataset && !hasData && (
            <div className="card empty">
              <h2>No data yet</h2>
              <p>
                Add your DX API token and at least one Data Studio datafeed in Settings. You can
                also add BambooHR for levels, salaries and promotions. The app then pulls new data
                on a schedule.
              </p>
              <div className="row">
                <button className="btn primary" onClick={() => setView('settings')}>
                  Open settings
                </button>
                <button className="btn" onClick={() => window.api.data.loadSample()}>
                  Explore with sample data
                </button>
              </div>
            </div>
          )}

          {analysisView && dataset && engineerDataset && hasData && (
            <>
              <FilterBar
                engineers={dataset.engineers}
                filters={filters}
                onFiltersChange={setFilters}
                timeWindow={timeWindow}
                onWindowChange={setTimeWindow}
                summary={
                  view === 'dora'
                    ? 'DORA is measured per team'
                    : `${engineers.length} of ${dataset.engineers.length} engineers`
                }
                dimensions={view === 'dora' ? ['teamGroup', 'team'] : undefined}
              />
              {view === 'explore' && (
                <ExploreView
                  dataset={engineerDataset}
                  engineers={engineers}
                  timeWindow={timeWindow}
                  onSelectEngineer={setSelected}
                />
              )}
              {view === 'ai' && (
                <AiImpactView
                  dataset={engineerDataset}
                  engineers={engineers}
                  timeWindow={timeWindow}
                  onSelectEngineer={setSelected}
                />
              )}
              {view === 'dora' && (
                <DoraView dataset={dataset} filters={filters} timeWindow={timeWindow} />
              )}
              {view === 'scorecard' && (
                <ScorecardView
                  dataset={engineerDataset}
                  engineers={engineers}
                  timeWindow={timeWindow}
                  onSelectEngineer={setSelected}
                />
              )}
              {view === 'engineers' && (
                <EngineersView
                  dataset={engineerDataset}
                  engineers={engineers}
                  timeWindow={timeWindow}
                  onSelectEngineer={setSelected}
                />
              )}
            </>
          )}
        </main>
      </div>

      {selectedEngineer && engineerDataset && (
        <EngineerDetail
          engineer={selectedEngineer}
          dataset={engineerDataset}
          timeWindow={timeWindow}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

export default App
