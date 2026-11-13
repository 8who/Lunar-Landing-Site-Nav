import { useMemo } from 'react'
import MoonGlobe from '../components/MoonGlobe'
import SkyView from '../components/SkyView'
import { buildTimeline } from '../lib/astro/timeline'
import { createObserver } from '../lib/astro/observer'
import { SITES, customSite } from '../lib/astro/sites'
import type { LunarSite } from '../lib/astro/types'
import { formatClockMinutes, formatCoord, formatHours, formatUtc } from '../lib/format'

export interface ExplorerModeProps {
  site: LunarSite
  onSiteChange: (site: LunarSite) => void
  /** 'YYYY-MM-DD' UTC */
  day: string
  onDayChange: (day: string) => void
  /** Minutes after midnight UTC, 0..1435 */
  minutesOfDay: number
  onMinutesChange: (minutes: number) => void
  /** Shared instant, UTC epoch ms */
  t: number
}

const DAY = 86_400_000
const RAD = Math.PI / 180
const NEAR_SITE_DEG = 3

/** Great-circle separation, degrees. */
function angularDistanceDeg(a: LunarSite, b: LunarSite): number {
  const la1 = a.lat * RAD
  const la2 = b.lat * RAD
  const dLon = (b.lon - a.lon) * RAD
  const cosine = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dLon)
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / RAD
}

export default function ExplorerMode({
  site,
  onSiteChange,
  day,
  onDayChange,
  minutesOfDay,
  onMinutesChange,
  t,
}: ExplorerModeProps) {
  const observer = useMemo(() => createObserver(site), [site])
  const sky = useMemo(() => observer.skyAt(t), [observer, t])

  const dayStart = useMemo(() => Date.parse(`${day}T00:00:00Z`), [day])
  // One day at 10 min resolution: only recomputed when the site or day changes,
  // so the time slider stays smooth.
  const daily = useMemo(
    () => buildTimeline(site, dayStart, dayStart + DAY, 600_000).metrics,
    [site, dayStart],
  )

  const nearest = useMemo(() => {
    let best: { site: LunarSite; distance: number } | null = null
    for (const candidate of SITES) {
      const distance = angularDistanceDeg(site, candidate)
      if (!best || distance < best.distance) best = { site: candidate, distance }
    }
    return best && best.distance <= NEAR_SITE_DEG ? best.site : null
  }, [site])

  const shiftDay = (deltaDays: number) => {
    const base = Number.isFinite(dayStart) ? dayStart : Date.now()
    onDayChange(new Date(base + deltaDays * DAY).toISOString().slice(0, 10))
  }

  const earthUp = sky.earth.elevation > 0
  const sunUp = sky.sun.elevation > 0
  const earthDegrees = Math.round(Math.abs(sky.earth.elevation))
  const sunDegrees = Math.round(Math.abs(sky.sun.elevation))

  return (
    <div className="explorer">
      <section className="chart-card explorer-hero">
        <MoonGlobe
          sites={SITES}
          selected={site}
          onPick={(lat, lon) => onSiteChange(customSite(lat, lon))}
        />
        <div className="explorer-picked">
          <strong>{formatCoord(site.lat, site.lon)}</strong>
          <span>{nearest ? nearest.name : 'Custom point'}</span>
        </div>
      </section>

      <aside className="explorer-side">
        <div className={`verdict verdict--earth ${earthUp ? 'is-up' : 'is-down'}`}>
          <h3>Earth: {earthUp ? 'visible' : 'not visible'}</h3>
          <p>
            {earthUp
              ? `Earth is ${earthDegrees} degrees above the horizon, so there is a clear line of sight (flat-terrain assumption).`
              : 'Earth is below the horizon, no direct line of sight.'}
          </p>
        </div>

        <div className={`verdict verdict--sun ${sunUp ? 'is-up' : 'is-down'}`}>
          <h3>Sun: {sunUp ? 'visible' : 'not visible'}</h3>
          <p>
            {sunUp
              ? `The Sun is ${sunDegrees} degrees above the horizon, so solar panels get light.`
              : 'The Sun is below the horizon, so it is night here.'}
          </p>
        </div>

        <p className="daily-summary">
          Earth is visible {formatHours(daily.commMs)} of this day, the Sun{' '}
          {formatHours(daily.sunlitMs)}
        </p>

        <section className="chart-card explorer-sky">
          <div className="chart-head">
            <div>
              <h2>What you would see</h2>
              <p>
                {formatUtc(t, { seconds: true })} · {formatCoord(site.lat, site.lon)}
              </p>
            </div>
          </div>
          <SkyView site={site} t={t} />
        </section>
      </aside>

      <section className="controls explorer-controls">
        <div className="field">
          <span>Day (UTC)</span>
          <div className="day-row">
            <button onClick={() => shiftDay(-1)} aria-label="Previous day">
              −
            </button>
            <input
              type="date"
              value={day}
              onChange={(e) => {
                if (Number.isFinite(Date.parse(`${e.target.value}T00:00:00Z`))) {
                  onDayChange(e.target.value)
                }
              }}
            />
            <button onClick={() => shiftDay(1)} aria-label="Next day">
              +
            </button>
          </div>
        </div>

        <div className="field explorer-time">
          <span>Time of day (UTC)</span>
          <div className="time-row">
            <strong className="time-big">{formatClockMinutes(minutesOfDay)}</strong>
            <input
              type="range"
              min={0}
              max={1_435}
              step={5}
              value={minutesOfDay}
              onChange={(e) => onMinutesChange(Number(e.target.value))}
              aria-label="Time of day"
            />
            <span className="time-range">00:00 → 24:00</span>
          </div>
        </div>
      </section>
    </div>
  )
}
