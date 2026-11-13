import { useState } from 'react'
import { findMissionWindow } from '../lib/astro/mission'
import type { LunarSite, TimeWindow } from '../lib/astro/types'
import { formatDuration, formatUtc, formatCoord } from '../lib/format'

interface Props {
  site: LunarSite
  windows: TimeWindow[]
  now: number
  end: number
  onJump: (t: number) => void
}

export default function MissionPlanner({ site, windows, now, end, onJump }: Props) {
  const [hours, setHours] = useState(24)
  const next = findMissionWindow(windows, now, hours)

  function downloadBrief() {
    const text = [
      'LUNAR LANDING SITE NAVIGATOR — MISSION BRIEF',
      `Site: ${site.name} (${formatCoord(site.lat, site.lon)})`,
      `Coordinates: ${site.approx ? 'Approximate' : 'Curated / custom'}`,
      `Search: ${formatUtc(now)} to ${formatUtc(end)}`,
      `Required continuous operation: ${hours} hours`,
      next ? `Operation starts: ${formatUtc(next.start)}` : 'No matching window in the search range.',
      next ? `Operation ends: ${formatUtc(next.start + hours * 3_600_000)}` : '',
      next ? `Overlap available in range: ${formatDuration(next.end - next.start)}` : '',
      '', 'Model: Sun and Earth centres above a flat local horizon. Terrain, slopes, relay links, thermal limits and link budgets are not modelled.',
      'Geometric screening only; this is not a landing safety assessment.',
      site.source ? `Coordinate source: ${site.source}` : '',
    ].filter(Boolean).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `lunar-mission-${site.id}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="chart-card mission-planner" aria-labelledby="mission-title">
      <div className="chart-head">
        <div><p className="mission-eyebrow">Plan your surface operation</p><h2 id="mission-title">Find a working window</h2></div>
        <label className="field">Continuous operation
          <select value={hours} onChange={e => setHours(Number(e.target.value))}>
            {[1, 6, 12, 24, 48, 72].map(h => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </label>
      </div>
      <p>Find simultaneous sunlight and direct Earth visibility from the selected time to the end of this 30-day cycle.</p>
      <div className="mission-result" aria-live="polite">
        <span className="mission-eyebrow">{next ? 'Earliest matching operation' : 'No matching operation'}</span>
        <strong>{next ? formatUtc(next.start) : 'Try a shorter duration or another site'}</strong>
        {next && <p>{formatDuration(next.end - next.start)} of overlap available{!next.closed ? ' or more; search ends here' : ''}. Your {hours}-hour operation ends {formatUtc(next.start + hours * 3_600_000)}.</p>}
      </div>
      <div className="mission-actions">
        <button disabled={!next} onClick={() => next && onJump(next.start)}>Jump to window →</button>
        <button onClick={downloadBrief}>Download mission brief ↓</button>
      </div>
      <p className="mission-assumption">Flat-horizon estimate · Terrain and relay links not modelled · Visibility does not guarantee power or a working radio link.</p>
    </section>
  )
}
