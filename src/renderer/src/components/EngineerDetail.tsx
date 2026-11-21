import { useEffect } from 'react'
import { Sparkline } from './Charts'
import { aggregate, engineerValues, type TimeWindow } from '../utils/analytics'
import { formatDate, formatMoney, formatNumber } from '../utils/format'
import type { Dataset, Engineer } from '../../../shared/types'

interface Props {
  engineer: Engineer
  dataset: Dataset
  timeWindow: TimeWindow
  onClose: () => void
}

export function EngineerDetail({
  engineer,
  dataset,
  timeWindow,
  onClose
}: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Peers = same level, so a metric can be read against a fair comparison.
  const peers = dataset.engineers.filter((e) => e.level === engineer.level)
  const promotionDates = new Set(engineer.promotions.map((p) => p.date))
  const metrics = dataset.metrics.filter((m) => m.grain !== 'team')

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" aria-label={`${engineer.name} details`}>
        <div className="card-header">
          <h1>{engineer.name}</h1>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="secondary">
          {engineer.jobTitle || 'No BambooHR title'} · {engineer.email}
        </div>

        <div className="card">
          <dl className="kv">
            <dt>Team</dt>
            <dd>{engineer.teamPath.length ? engineer.teamPath.join(' › ') : engineer.teamName}</dd>
            <dt>Level</dt>
            <dd>{engineer.level}</dd>
            <dt>Role type</dt>
            <dd>{engineer.roleType}</dd>
            <dt>Employment</dt>
            <dd>{engineer.employmentType}</dd>
            <dt>Hire date</dt>
            <dd>{formatDate(engineer.hireDate)}</dd>
            <dt>Current salary</dt>
            <dd className="comp">
              {engineer.salary
                ? `${formatMoney(engineer.salary.annual, engineer.salary.currency)} / year` +
                  (engineer.salary.paidPer.toLowerCase().startsWith('year')
                    ? ''
                    : ` (${formatMoney(engineer.salary.rawAmount, engineer.salary.currency)} per ${engineer.salary.paidPer.toLowerCase()})`)
                : '—'}
            </dd>
            <dt>Promotions</dt>
            <dd>
              {engineer.promotions.length
                ? `${engineer.promotions.length}, most recently ${formatDate(engineer.promotions[engineer.promotions.length - 1].date)}`
                : 'None recorded'}
            </dd>
          </dl>
        </div>

        <div className="card">
          <h2>Metrics</h2>
          <span className="muted">
            Each tile shows the engineer&apos;s average over the selected time window, the median
            for their level ({engineer.level}, {peers.length}{' '}
            {peers.length === 1 ? 'engineer' : 'engineers'}), and their full history.
          </span>
          <div className="metric-tiles">
            {metrics.map((m) => {
              const peerValues = engineerValues(dataset.points, m.key, timeWindow)
              const mine = peerValues.get(engineer.email)
              const peerMedian = aggregate(
                peers.map((p) => peerValues.get(p.email)).filter((v) => v !== undefined),
                'median'
              )
              const history = dataset.points
                .filter((p) => p.metric === m.key && p.email === engineer.email)
                .sort((a, b) => a.period.localeCompare(b.period))
                .map((p) => p.value)
              return (
                <div className="metric-tile" key={m.key}>
                  <span className="name">
                    {m.name} <span className="badge">{m.category}</span>
                  </span>
                  <span className="value">{formatNumber(mine)}</span>
                  <span className="cohort">Level median: {formatNumber(peerMedian)}</span>
                  <Sparkline values={history} />
                </div>
              )
            })}
            {metrics.length === 0 && <span className="muted">No metrics yet.</span>}
          </div>
        </div>

        <div className="card">
          <h2>Job history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Effective</th>
                  <th>Title</th>
                  <th>Department</th>
                  <th>Division</th>
                </tr>
              </thead>
              <tbody>
                {[...engineer.jobHistory].reverse().map((j, i) => (
                  <tr key={`${j.date}-${i}`}>
                    <td>{formatDate(j.date)}</td>
                    <td>
                      {j.jobTitle}{' '}
                      {promotionDates.has(j.date) && <span className="promo">▲ Promotion</span>}
                    </td>
                    <td>{j.department || '—'}</td>
                    <td>{j.division || '—'}</td>
                  </tr>
                ))}
                {engineer.jobHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No BambooHR job history
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Compensation history</h2>
          <div className="table-wrap comp">
            <table>
              <thead>
                <tr>
                  <th>Effective</th>
                  <th className="num">Pay rate</th>
                  <th className="num">Annualized</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {[...engineer.compensationHistory].reverse().map((c, i) => (
                  <tr key={`${c.startDate}-${i}`}>
                    <td>{formatDate(c.startDate)}</td>
                    <td className="num">
                      {formatMoney(c.amount, c.currency)} / {c.paidPer.toLowerCase()}
                    </td>
                    <td className="num">{formatMoney(c.annual, c.currency)}</td>
                    <td>{c.reason || '—'}</td>
                  </tr>
                ))}
                {engineer.compensationHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No BambooHR compensation records
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </>
  )
}
