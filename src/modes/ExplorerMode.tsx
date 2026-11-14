import { useEffect, useMemo, useRef, useState } from 'react'
import MissionPlanner from '../components/MissionPlanner'
import MoonGlobe from '../components/MoonGlobe'
import SiteAlternatives from '../components/SiteAlternatives'
import type { AlternativeSearch } from '../lib/siteAlternatives'
import SkyView from '../components/SkyView'
import ArrayCard from '../components/ArrayPower'
import { bestFixedPanel, compassPoint16 } from '../lib/astro/panel'
import { buildTimeline } from '../lib/astro/timeline'
import { createObserver } from '../lib/astro/observer'
import { SITES, customSite, isTerrainCritical } from '../lib/astro/sites'
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
import type { HorizonProfile, LunarSite, TimeWindow } from '../lib/astro/types'
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
  horizonFor: (site: LunarSite) => LunarSite
  alternativeSearch: AlternativeSearch | null
  onAlternativeSearchChange: (search: AlternativeSearch | null) => void
}

const RAD = Math.PI / 180
const NEAR_SITE_DEG = 3
/** Playback speed: three simulated hours every 80 ms. */
const PLAY_STEP_MS = 3 * 3_600_000
const PLAY_INTERVAL_MS = 80
/** Date tick every five days, including both window ends. */
const TICK_OFFSET_DAYS = Array.from({ length: SCRUB_DAYS / 5 + 1 }, (_, i) => i * 5)

/** Sun icon: disc with rays. */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.2v2.1M12 19.7v2.1M2.2 12h2.1M19.7 12h2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5" />
    </svg>
  )
}

/** Earth icon: disc with simplified continents. */
function EarthIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.8 10.2h4.1l1.7 2.1 2.4-.8 1.3 1.9 2.9.4 1.9-2h2.1" />
      <path d="M7.2 5.7l1.9 2.3 2.3.3 1.4-1.7" />
      <path d="M8.1 18.4l1-2.3 2.5-1 1.8 1.4 2.1-.5" />
    </svg>
  )
}

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
  onMinutesChange(minutesOfDayUtc(next, 1))
}

export default function ExplorerMode({
  site,
  onSiteChange,
  day,
  onDayChange,
  onMinutesChange,
  t,
  horizonFor,
  alternativeSearch,
  onAlternativeSearchChange,
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

  // Best fixed panel over the 30-day window (shared model with Expert mode).
  const fixedPanel = useMemo(() => bestFixedPanel(cycle.samples), [cycle])

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

  const earthUp = sky.earthVisible
  // A Sun whose centre sits just below the horizon can still be half visible
  // at the poles, so "up" means the upper limb is above the horizon.
  const sunUp = sky.sunlit
  // The skyline is the terrain profile when it is loaded, otherwise the flat
  // tangent-plane dip. Clearance is what the eye actually has to work with.
  const profile = site.horizon
  const flatDip = sky.horizonDipDeg ?? 0
  const sunHorizon = sky.sun.horizonDeg ?? -flatDip
  const earthHorizon = sky.earth.horizonDeg ?? -flatDip
  const sunClearance = sky.sun.elevation - sunHorizon
  const earthClearance = sky.earth.elevation - earthHorizon
  const sunPartial = sunUp && (sky.sun.visibleFraction ?? 1) < 1
  const earthPartial = earthUp && (sky.earth.visibleFraction ?? 1) < 1
  const terrainCritical = isTerrainCritical(site)
  const earthDegrees = Math.max(0, earthClearance).toFixed(1)
  const sunDegrees = Math.max(0, sunClearance).toFixed(1)

  return (
    <div className="explorer">
      <section className="atlas-intro" aria-labelledby="atlas-title">
        <div>
          <p className="atlas-kicker">LUNAR SURFACE OPERATIONS <span>·</span> EXPLORER</p>
          <h2 id="atlas-title">Find the light.<br /><em>Keep Earth in view.</em></h2>
          <p className="atlas-deck">Compare landing sites against the lunar horizon, sunlight and direct-to-Earth visibility.</p>
        </div>
        <p className="atlas-index"><span>01</span> SITE CONDITIONS<br /><span>02</span> MISSION WINDOW</p>
      </section>
      <section className="controls explorer-site-picker">
        <label className="field">Landing site
          <select value={SITES.some(s => s.id === site.id) ? site.id : 'custom'} onChange={e => {
            const selected = SITES.find(s => s.id === e.target.value)
            if (selected) onSiteChange(selected)
          }}>
            {!SITES.some(s => s.id === site.id) && <option value="custom">Custom point</option>}
            {SITES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <p>Browse named markers to see their names and select an exact site, or click unmarked terrain for a custom location.</p>
      </section>
      <section className="chart-card explorer-hero">
        <MoonGlobe
          sites={SITES}
          selected={site}
          onPick={(lat, lon) => onSiteChange(customSite(lat, lon))}
          onSelectSite={onSiteChange}
        />
        <div className="explorer-picked">
          <strong>{formatCoord(site.lat, site.lon)}</strong>
          <span>{site.category === 'custom' ? nearest ? `Custom point near ${nearest.name}` : 'Custom point' : site.name}</span>
        </div>
        <p className="globe-caption">Moon map: NASA&apos;s Scientific Visualization Studio / LRO</p>
      </section>

      <SiteAlternatives site={site} horizonFor={horizonFor} t0={windowStart} t1={windowEnd} search={alternativeSearch} onClearSearch={() => onAlternativeSearchChange(null)} onSelect={onSiteChange} />

      <aside className="explorer-side">
        <article className={`verdict verdict--earth ${earthUp ? 'is-up' : 'is-down'}`}>
          <div className="verdict-icon" aria-hidden="true">
            <EarthIcon />
          </div>
          <div className="verdict-body">
            <div className="verdict-top">
              <h3>Earth</h3>
              <span className="verdict-state">{earthUp ? earthPartial ? 'Partly visible' : 'Visible' : 'Not visible'}</span>
            </div>
            <p>
              {earthUp
                ? earthPartial
                  ? 'Only part of Earth clears the terrain skyline. Check the DSN station list for an actual antenna link.'
                  : `Earth is ${earthDegrees}° above the local skyline. This is geometric visibility; check DSN stations for an antenna link.`
                : sky.earth.elevation > 0
                  ? 'Earth is up, but the terrain skyline hides it, so there is no direct line of sight.'
                  : `Earth is ${Math.abs(sky.earth.elevation).toFixed(
                      1,
                    )}° below the horizon, no direct line of sight.`}
            </p>
          </div>
        </article>

        <article className={`verdict verdict--sun ${sunUp ? 'is-up' : 'is-down'}`}>
          <div className="verdict-icon" aria-hidden="true">
            <SunIcon />
          </div>
          <div className="verdict-body">
            <div className="verdict-top">
              <h3>Sun</h3>
              <span className="verdict-state">{sunUp ? 'Visible' : 'Not visible'}</span>
            </div>
            <p>
              {sunUp
                ? sunPartial
                  ? 'The Sun is only partly above the local skyline: panels get some light, and a vertical panel facing it gets the most.'
                  : `The Sun is ${sunDegrees}° above the local skyline, so solar panels get light.`
                : sky.sun.elevation > 0
                  ? 'The Sun is up, but the terrain skyline hides it, so the site is in shadow.'
                  : 'The Sun is below the horizon, so it is night here.'}
            </p>
          </div>
        </article>

        {terrainCritical && (
          <p className="terrain-warning">
            {profile
              ? `Polar site: the Sun and Earth skim the horizon, so relief decides what you see. The skyline here comes from the LOLA elevation grid: it rises ${profile.maxElevationDeg.toFixed(
                  1,
                )}° towards ${compassPoint16(profile.maxAzimuthDeg)}, ${profile.maxDistanceKm.toFixed(
                  0,
                )} km away, and averages ${averageHorizon(profile).toFixed(1)}° around the horizon.`
              : 'Polar site: the Sun and Earth skim the horizon, so nearby hills and crater walls decide what you really see. The elevation grid has not loaded, so these numbers assume flat ground; ridges can be lit most of the time and crater floors never.'}
          </p>
        )}

        <p className="daily-summary">
          Earth is visible {formatHours(daily.commMs)} of this day, the Sun{' '}
          {formatHours(daily.sunlitMs)}
        </p>

        <ArrayCard
          site={site}
          t={t}
          rangeLabel="this 30-day window"
          rows={arrayRows(cycle.metrics, fixedPanel)}
        />

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

      <MissionPlanner site={site} windows={cycle.jointWindows} now={t} end={windowEnd}
        onJump={(next, hours) => {
          onAlternativeSearchChange({ kind: 'continuous', t0: next, t1: next + hours * 3_600_000, hours })
          setPlaying(false)
          commitInstant(next, onDayChange, onMinutesChange)
        }} />

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
                {playing ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="3.6" y="3" width="3.2" height="10" rx="1.1" />
                    <rect x="9.2" y="3" width="3.2" height="10" rx="1.1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4.9 2.9 12.8 8l-7.9 5.1Z" />
                  </svg>
                )}
                <span>{playing ? 'Pause' : 'Play'}</span>
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
              step={1}
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

/** Tracking / best fixed / flat average power for the array card. */
function arrayRows(
  metrics: { meanTrackingFluxWm2: number; meanFlatFluxWm2: number },
  fixed: { tiltDeg: number; azimuthDeg: number; capturedPct: number },
) {
  return [
    { label: 'Tilts and turns to face the Sun', value: metrics.meanTrackingFluxWm2 },
    {
      label: `Best fixed panel (${fixed.tiltDeg}° tilt, ${fixed.azimuthDeg}°)`,
      value: (metrics.meanTrackingFluxWm2 * fixed.capturedPct) / 100,
    },
    { label: 'Flat on the deck', value: metrics.meanFlatFluxWm2 },
  ]
}

/** Mean skyline elevation over all azimuths, deg: how enclosed the site is. */
function averageHorizon(profile: HorizonProfile): number {
  let sum = 0
  for (const elevation of profile.elevations) sum += elevation
  return sum / Math.max(1, profile.elevations.length)
}
