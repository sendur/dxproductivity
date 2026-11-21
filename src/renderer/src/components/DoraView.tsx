import { useMemo, useState } from 'react'
import { Sparkline, TrendChart } from './Charts'
import { aiAdoption, loadAiConfig } from '../utils/aiSegments'
import { engineerValues, toCsv, type Filters, type TimeWindow } from '../utils/analytics'
import {
  DORA_INFO,
  DORA_KEYS,
  TIERS,
  doraTeams,
  formatDora,
  loadDoraConfig,
  orgSeries,
  overallTier,
  saveDoraConfig,
  teamGroups,
  teamSeries,
  tierOf,
  windowValue,
  type DoraConfig,
  type DoraKey,
  type Tier
} from '../utils/dora'
import { formatNumber } from '../utils/format'
import type { Dataset } from '../../../shared/types'

interface Props {
  dataset: Dataset
  filters: Filters
  timeWindow: TimeWindow
}

function TierChip({ tier }: { tier: Tier | null }): React.JSX.Element | null {
  return tier ? <span className={`tier tier-${tier}`}>{tier}</span> : null
}

export function DoraView({ dataset, filters, timeWindow }: Props): React.JSX.Element {
  const [config, setConfig] = useState<DoraConfig>(() => loadDoraConfig(dataset))
  const [showConfig, setShowConfig] = useState(false)
  const mappedKeys = DORA_KEYS.filter((k) => config[k].metric)

  const update = (key: DoraKey, patch: Partial<DoraConfig[DoraKey]>): void => {
    const next = { ...config, [key]: { ...config[key], ...patch } }
    setConfig(next)
    saveDoraConfig(next)
  }

  const teams = useMemo(() => doraTeams(dataset, config, filters), [dataset, config, filters])
  const perKey = useMemo(() => {
    const result = {} as Record<DoraKey, ReturnType<typeof teamSeries>>
    for (const key of DORA_KEYS) result[key] = teamSeries(dataset, config, key, teams)
    return result
  }, [dataset, config, teams])

  const groups = teamGroups(dataset)
  const aiConfig = useMemo(() => loadAiConfig(dataset.metrics), [dataset.metrics])
  const aiValues = useMemo(
    () =>
      aiConfig.aiMetric
        ? engineerValues(dataset.points, aiConfig.aiMetric, timeWindow)
        : new Map<string, number>(),
    [dataset.points, aiConfig.aiMetric, timeWindow]
  )

  const rows = teams
    .map((team) => {
      const members = dataset.engineers.filter((e) => e.teamName === team)
      const values = Object.fromEntries(
        DORA_KEYS.map((k) => [k, windowValue(perKey[k].get(team) ?? new Map(), timeWindow)])
      ) as Record<DoraKey, number | null>
      const tiers = Object.fromEntries(
        DORA_KEYS.map((k) => [k, values[k] === null ? null : tierOf(k, values[k]!)])
      ) as Record<DoraKey, Tier | null>
      return {
        team,
        group: groups.get(team) ?? team,
        engineers: members.length,
        aiAdoption: aiAdoption(members, aiValues, aiConfig),
        values,
        tiers,
        overall: overallTier(Object.values(tiers).filter((t): t is Tier => t !== null))
      }
    })
    .sort(
      (a, b) =>
        (a.overall ? TIERS.indexOf(a.overall) : 9) - (b.overall ? TIERS.indexOf(b.overall) : 9) ||
        a.team.localeCompare(b.team)
    )

  const metricName = (key: string): string =>
    dataset.metrics.find((m) => m.key === key)?.name ?? key

  const exportCsv = (): void => {
    window.api.exportCsv(
      'DORA by team.csv',
      toCsv(
        [
          'Team',
          'Team group',
          'Engineers',
          'AI adoption %',
          ...DORA_KEYS.flatMap((k) => [DORA_INFO[k].label, `${DORA_INFO[k].label} level`]),
          'Overall level'
        ],
        rows.map((r) => [
          r.team,
          r.group,
          r.engineers,
          r.aiAdoption === null ? null : Math.round(r.aiAdoption),
          ...DORA_KEYS.flatMap((k) => [formatDora(k, r.values[k]), r.tiers[k]]),
          r.overall
        ])
      )
    )
  }

  const mappingCard = (
    <div className="card">
      <h2>DORA metric mapping</h2>
      <span className="muted">
        Choose which DX metric feeds each DORA key and the unit it&apos;s in. Team-level feeds (one
        row per team, e.g. from DX&apos;s deployments and incidents data) are used as-is.
        Per-engineer metrics are rolled up by team: deployments are added up, and the rest use the
        team&apos;s typical value.
      </span>
      <div className="dora-config">
        {DORA_KEYS.map((key) => (
          <div key={key} className="control">
            {DORA_INFO[key].label}
            <div className="row">
              <select
                value={config[key].metric}
                onChange={(e) => update(key, { metric: e.target.value })}
              >
                <option value="">Not mapped</option>
                {dataset.metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.grain === 'team' ? 'Team' : 'Engineer'} · {m.name}
                  </option>
                ))}
              </select>
              <select
                value={config[key].unit}
                onChange={(e) => update(key, { unit: e.target.value })}
                aria-label={`${DORA_INFO[key].label} unit`}
              >
                {DORA_INFO[key].units.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  if (mappedKeys.length === 0) {
    return (
      <>
        <div className="card empty">
          <h2>No DORA metrics yet</h2>
          <p>
            Add a DX datafeed in Settings with <b>Rows are: One per team</b>. It needs a team column
            and any of: deployments per week, lead time for changes, change failure rate, and time
            to restore. Columns with those names are mapped automatically. You can also map existing
            metrics below.
          </p>
        </div>
        {mappingCard}
      </>
    )
  }

  return (
    <>
      <div className="toolbar">
        <div className="secondary" style={{ maxWidth: 760 }}>
          DORA&apos;s four keys across {teams.length} team{teams.length === 1 ? '' : 's'}, rated
          against the DORA performance levels (Elite, High, Medium, Low). Team and team-group
          filters apply. Level, role and employment filters don&apos;t, because DORA is measured per
          team.
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowConfig(!showConfig)}>
          {showConfig ? 'Hide mapping' : 'Adjust mapping'}
        </button>
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {showConfig && mappingCard}

      <div className="dora-tiles">
        {DORA_KEYS.map((key) => {
          const series = orgSeries(key, perKey[key])
          const value = windowValue(series, timeWindow)
          return (
            <div key={key} className="stat dora-tile">
              <div className="label">{DORA_INFO[key].label}</div>
              {config[key].metric ? (
                <>
                  <div className="value">
                    {formatDora(key, value)}
                    <TierChip tier={value === null ? null : tierOf(key, value)} />
                  </div>
                  <div className="sub">
                    {key === 'deploymentFrequency' ? 'All teams combined' : 'Typical team'} ·{' '}
                    {DORA_INFO[key].higherIsBetter ? 'higher is better' : 'lower is better'}
                  </div>
                  <Sparkline values={[...series.values()]} width={200} />
                  <div className="sub muted">{DORA_INFO[key].help}</div>
                </>
              ) : (
                <>
                  <div className="value muted">—</div>
                  <button className="btn small" onClick={() => setShowConfig(true)}>
                    Map a metric
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>By team</h2>
          <span className="muted">
            Average over the selected time window · overall level is the middle of the four
          </span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 460 }}>
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Group</th>
                <th className="num">Engineers</th>
                <th
                  className="num"
                  title="Share of the team's engineers using AI (AI Impact method)"
                >
                  AI adoption
                </th>
                {DORA_KEYS.map((k) => (
                  <th
                    key={k}
                    className="num"
                    title={`${DORA_INFO[k].label}${config[k].metric ? ` · ${metricName(config[k].metric)}` : ''}`}
                  >
                    {DORA_INFO[k].short}
                  </th>
                ))}
                <th>Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team}>
                  <td>{r.team}</td>
                  <td className="secondary">{r.group}</td>
                  <td className="num">{r.engineers}</td>
                  <td className="num">
                    {r.aiAdoption === null ? '—' : `${formatNumber(r.aiAdoption, 0)}%`}
                  </td>
                  {DORA_KEYS.map((k) => (
                    <td key={k} className="num">
                      {formatDora(k, r.values[k])}
                      <TierChip tier={r.tiers[k]} />
                    </td>
                  ))}
                  <td>
                    <TierChip tier={r.overall} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dora-grid">
        {mappedKeys.map((key) => {
          const series = orgSeries(key, perKey[key])
          const counts = new Map<string, number>()
          for (const s of perKey[key].values()) {
            for (const p of s.keys()) counts.set(p, (counts.get(p) ?? 0) + 1)
          }
          return (
            <div key={key} className="card">
              <div className="card-header">
                <h2>{DORA_INFO[key].label}</h2>
                <span className="muted">
                  {key === 'deploymentFrequency' ? 'All teams combined' : 'Typical team'} · all
                  history
                </span>
              </div>
              <TrendChart
                data={[...series].map(([period, value]) => ({
                  period,
                  value,
                  n: counts.get(period) ?? 0
                }))}
                height={200}
                formatValue={(v) => formatDora(key, v)}
                countLabel="Teams"
              />
            </div>
          )
        })}
      </div>
      <span className="muted">
        Performance levels follow the DORA State of DevOps benchmarks. Deployment frequency: Elite
        daily or more, High weekly, Medium monthly. Lead time: Elite under a day, High under a week,
        Medium under a month. Change failure rate: Elite 5% or less, High 10%, Medium 15%. Recovery
        time: Elite under an hour, High under a day, Medium under a week.
      </span>
    </>
  )
}
