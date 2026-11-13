import { useEffect, useMemo, useRef, useState } from 'react'
import MoonGlobe from '../components/MoonGlobe'
import SkyView from '../components/SkyView'
import { buildTimeline } from '../lib/astro/timeline'
import { createObserver } from '../lib/astro/observer'
import { SITES, customSite } from '../lib/astro/sites'
import {
  DAY_MS,
  SCRUB_DAYS,
  SCRUB_MAX_MIN,
  SCRUB_SPAN_MS,
  minutesOfDayUtc,
  sliderMinutesToTime,
  timeToSliderMinutes,
  utcDay,
  utcDayStart,
  windowPercent,
} from '../lib/astro/scrub'
import type { LunarSite, TimeWindow } from '../lib/astro/types'
import { formatCoord, formatHours, formatInstant, formatMonthDay, formatUtc } from '../lib/format'

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

const RAD = Math.PI / 180
const NEAR_SITE_DEG = 3
/** Playback speed: three simulated hours every 80 ms. */
const PLAY_STEP_MS = 3 * 3_600_000
const PLAY_INTERVAL_MS = 80
/** Date tick every five days, including both window ends. */
const TICK_OFFSET_DAYS = Array.from({ length: SCRUB_DAYS / 5 + 1 }, (_, i) => i * 5)

/** Great-circle separation, degrees. */
function angularDistanceDeg(a: LunarSite, b: LunarSite): number {
  const la1 = a.lat * RAD
  const la2 = b.lat * RAD
  const dLon = (b.lon - a.lon) * RAD
  const cosine = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dLon)
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / RAD
}

/** Move the shared instant through the same day/minutes pair the date input uses. */
function commitInstant(
  next: number,
  onDayChange: (day: string) => void,
  onMinutesChange: (minutes: number) => void,
) {
  onDayChange(utcDay(next))
  onMinutesChange(minutesOfDayUtc(next))
}

export default function ExplorerMode({
  site,
  onSiteChange,
  day,
  onDayChange,
  onMinutesChange,
  t,
}: ExplorerModeProps) {
  const observer = useMemo(() => createObserver(site), [site])
  const sky = useMemo(() => observer.skyAt(t), [observer, t])

  const dayStart = useMemo(() => Date.parse(`${day}T00:00:00Z`), [day])
  // One day at 10 min resolution: only recomputed when the site or day changes.
  const daily = useMemo(
    () => buildTimeline(site, dayStart, dayStart + DAY_MS, 600_000).metrics,
    [site, dayStart],
  )

  // The scrub window is local: a date picked elsewhere recentres it, but the
  // shared instant only ever moves it when it falls outside.
  const [windowStart, setWindowStart] = useState(() => {
    const start = Date.parse(`${day}T00:00:00Z`)
    return Number.isFinite(start) ? start : utcDayStart(Date.now())
  })
  const windowEnd = windowStart + SCRUB_SPAN_MS
  // 30 days at 1 h resolution: independent of the playhead, so dragging and
  // playing never rebuild it.
  const cycle = useMemo(
    () => buildTimeline(site, windowStart, windowEnd, 3_600_000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site, windowStart],
  )

  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  // The interval must read the latest instant without restarting every tick.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  // A new site is a new question: stop the playback.
  useEffect(() => {
    setPlaying(false)
  }, [site.id, site.lat, site.lon])

  // Date input or any other external jump out of the window: recentre on it.
  useEffect(() => {
    if (t < windowStart || t > windowEnd) setWindowStart(utcDayStart(t))
  }, [t, windowStart, windowEnd])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      let next = tRef.current + PLAY_STEP_MS
      if (next >= windowEnd) {
        if (loop) {
          next = windowStart
        } else {
          next = windowEnd
          setPlaying(false)
        }
      }
      commitInstant(next, onDayChange, onMinutesChange)
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [playing, loop, windowStart, windowEnd, onDayChange, onMinutesChange])

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
    onDayChange(new Date(base + deltaDays * DAY_MS).toISOString().slice(0, 10))
  }

  const pickDay = (next: string) => {
    const nextStart = Date.parse(`${next}T00:00:00Z`)
    if (!Number.isFinite(nextStart)) return
    setPlaying(false)
    setWindowStart(nextStart)
    onDayChange(next)
  }

  const scrubValue = timeToSliderMinutes(windowStart, t)
  const scrubTo = (value: number) => {
    commitInstant(sliderMinutesToTime(windowStart, value), onDayChange, onMinutesChange)
  }

  const segments = (windows: TimeWindow[], tone: 'sun' | 'earth') =>
    windows.map((w, i) => (
      <span
        key={`${tone}-${i}`}
        className={`scrub-seg scrub-seg-${tone}`}
        style={{
          left: `${windowPercent(windowStart, w.start)}%`,
          width: `${(w.durationMs / SCRUB_SPAN_MS) * 100}%`,
        }}
      />
    ))

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
            <input type="date" value={day} onChange={(e) => pickDay(e.target.value)} />
            <button onClick={() => shiftDay(1)} aria-label="Next day">
              +
            </button>
          </div>
        </div>

        <div className="field explorer-scrub">
          <div className="scrub-head">
            <strong className="scrub-instant">{formatInstant(t)}</strong>
            <div className="scrub-actions">
              <button
                className={`scrub-play${playing ? ' is-playing' : ''}`}
                onClick={() => setPlaying((value) => !value)}
                aria-pressed={playing}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <label className="scrub-loop">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>
            </div>
          </div>

          <div className="scrub-grid">
            <span className="scrub-label">Sun</span>
            <div className="scrub-track" role="img" aria-label="Sunlight over the next 30 days">
              {segments(cycle.sunWindows, 'sun')}
            </div>

            <span className="scrub-label">Earth</span>
            <div className="scrub-track" role="img" aria-label="Earth visibility over the next 30 days">
              {segments(cycle.commWindows, 'earth')}
            </div>

            <span />
            <div className="scrub-ticks" aria-hidden="true">
              {TICK_OFFSET_DAYS.map((offsetDays, index) => {
                const edge =
                  index === 0
                    ? ' is-first'
                    : index === TICK_OFFSET_DAYS.length - 1
                      ? ' is-last'
                      : ''
                return (
                  <span
                    key={offsetDays}
                    className={`scrub-tick${edge}`}
                    style={{ left: `${(offsetDays / SCRUB_DAYS) * 100}%` }}
                  >
                    {formatMonthDay(windowStart + offsetDays * DAY_MS)}
                  </span>
                )
              })}
            </div>

            <span />
            <input
              className="scrub-range"
              type="range"
              min={0}
              max={SCRUB_MAX_MIN}
              step={15}
              value={scrubValue}
              onChange={(e) => scrubTo(Number(e.target.value))}
              onPointerDown={() => setPlaying(false)}
              aria-label="Time across the 30-day lunar cycle"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
