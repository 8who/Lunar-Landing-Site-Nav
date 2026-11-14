import { useEffect, useMemo, useState } from 'react'
import TimelineChart from '../components/TimelineChart'
import RankingTable from '../components/RankingTable'
import MineralSelectionPanel from '../components/MineralSelectionPanel'
import OpportunityPanel from '../components/OpportunityPanel'
import SkyView from '../components/SkyView'
import MoonGlobe from '../components/MoonGlobe'
import { buildTimeline } from '../lib/astro/timeline'
import { rankSites, type RankSortKey, type RankedSite } from '../lib/astro/ranking'
import { bestFixedPanel, compassPoint16 } from '../lib/astro/panel'
import { ArrayPowerBars, mastLine, useTrackingPointing } from '../components/ArrayPower'
import { createObserver } from '../lib/astro/observer'
import { SITES, customSite, isTerrainCritical } from '../lib/astro/sites'
import type { LunarSite, SkySample } from '../lib/astro/types'
import { formatDuration, formatUtc, deg } from '../lib/format'
import { utcDay } from '../lib/astro/scrub'

export interface ExpertModeProps {
  site: LunarSite
  onSiteChange: (site: LunarSite) => void
  /** Shared day, 'YYYY-MM-DD' UTC */
  day: string
  onDayChange: (day: string) => void
  /** Shared instant from the Explorer; used when the timeline is not hovered */
  t: number
  /** Attach the terrain skyline to a site (no-op while the grid is loading) */
  horizonFor: (site: LunarSite) => LunarSite
}

const DAY = 86_400_000

const CATEGORY_ORDER = ['candidate', 'clps', 'international', 'apollo'] as const
const CATEGORY_LABEL: Record<string, string> = {
  candidate: 'Artemis / south pole',
  clps: 'CLPS',
  international: 'International',
  apollo: 'Apollo',
}

// Scoring every site is expensive; keep results per date range so toggling
// views, or coming back to the same range, is instant.
const RANK_CACHE = new Map<string, RankedSite[]>()

// The ranking is a landing-site shortlist, not a history tour: only the
// south-pole candidate regions compete there.
const RANK_SITES = SITES.filter((s) => s.category === 'candidate')

export default function ExpertMode({
  site,
  onSiteChange,
  day,
  onDayChange,
  t,
  horizonFor,
}: ExpertModeProps) {
  const [days, setDays] = useState(30)
  const [stepMin, setStepMin] = useState(15)
  const [hover, setHover] = useState<SkySample | null>(null)
  // Moment pinned by clicking the chart; survives the pointer leaving.
  const [pinned, setPinned] = useState<SkySample | null>(null)
  const [customLat, setCustomLat] = useState('-89.50')
  const [customLon, setCustomLon] = useState('0.00')
  const [view, setView] = useState<'single' | 'rank' | 'find' | 'resources'>('single')
  const [sortBy, setSortBy] = useState<RankSortKey>('jointPct')

  // Only decorate the shortlist when the ranking or the calendar is open: each
  // profile marches a few hundred thousand grid samples, and the single-site
  // view already carries its own.
  const shortlist = useMemo(
    () => (view === 'single' ? RANK_SITES : RANK_SITES.map(horizonFor)),
    [view, horizonFor],
  )

  const parsedStart = Date.parse(`${day}T00:00:00Z`)
  const t0 = Number.isFinite(parsedStart) ? parsedStart : Date.parse('2028-01-01T00:00:00Z')
  const t1 = t0 + days * DAY

  const timeline = useMemo(
    () => buildTimeline(site, t0, t1, stepMin * 60_000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site.id, site.lat, site.lon, site.horizon, site.mastHeightM, t0, t1, stepMin],
  )
  const { metrics, samples, sunWindows, commWindows } = timeline

  // Ranking evaluates the candidate shortlist, so only run it when that view is open.
  const [rankedBase, setRankedBase] = useState<RankedSite[]>([])
  const [rankLoading, setRankLoading] = useState(false)

  useEffect(() => {
    if (view !== 'rank' && view !== 'resources') return
    const mastM = site.mastHeightM ?? 0
    // The skyline is rebuilt when the mast settles, so the cache has to follow
    // the profile's eye height and not only the live slider value.
    const skylineMast = shortlist[0]?.horizon?.eyeHeightM
    const key = `${t0}:${t1}:${mastM}:${skylineMast ?? 'flat'}`
    const cached = RANK_CACHE.get(key)
    if (cached) {
      setRankedBase(cached)
      setRankLoading(false)
      return
    }
    // Scoring 22 sites blocks the main thread for a couple of seconds, so clear
    // the table, let the "scoring" state paint, and only then start the work.
    setRankedBase([])
    setRankLoading(true)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (cancelled) return
        const rows = rankSites(
          shortlist.map((s) => ({ ...s, mastHeightM: mastM })),
          t0,
          t1,
          { sortBy: 'jointPct' },
        )
        RANK_CACHE.set(key, rows)
        setRankedBase(rows)
        setRankLoading(false)
      }, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
    }
  }, [view, t0, t1, site.mastHeightM, shortlist])

  // Re-sorting the already computed metrics is instant; no need to re-score.
  const ranked = useMemo(
    () => [...rankedBase].sort((a, b) => b.metrics[sortBy] - a.metrics[sortBy]),
    [rankedBase, sortBy],
  )

  // A pinned moment belongs to one site and one range: drop it when either moves.
  useEffect(() => {
    setPinned(null)
  }, [site.id, site.lat, site.lon, t0, t1, stepMin])

  const focus = hover ?? pinned ?? samples[Math.floor(samples.length / 2)]
  // Sky view follows the hovered sample, then the pinned one, then the shared instant.
  const skyTime = hover?.t ?? pinned?.t ?? t
  const sky = useMemo(() => createObserver(site).skyAt(skyTime), [site, skyTime])
  // Flat-model dip at the mast top: the fallback skyline when no terrain is attached.
  const flatDip = sky.horizonDipDeg ?? 0

  // Ranking view has no single-site range analysis, so only score when needed.
  const bestPanel = useMemo(
    () => (view === 'single' ? bestFixedPanel(samples) : null),
    [view, samples],
  )

  const { pointing } = useTrackingPointing(site, skyTime)
  const panelNow = sky.sunlit
    ? `Tilt ${(90 - Math.max(0, sky.sun.elevation)).toFixed(1)}° from horizontal · heading ${
        Math.round(sky.sun.azimuth) % 360
      }° ${compassPoint(sky.sun.azimuth)} · turn ${Math.abs(pointing.turnRateDegPerHour).toFixed(2)}°/h`
    : 'Sun below the skyline'

  const applyCustom = () => {
    const lat = Number(customLat)
    const lon = Number(customLon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    if (Math.abs(lat) > 90) return
    onSiteChange(customSite(lat, lon))
  }

  return (
    <>
      <section className="atlas-intro expert-intro" aria-labelledby="analysis-title">
        <div>
          <p className="atlas-kicker">LUNAR SURFACE OPERATIONS <span>·</span> ANALYSIS</p>
          <h2 id="analysis-title">Compare the conditions.<br /><em>Choose the window.</em></h2>
          <p className="atlas-deck">A shared site and UTC time drive every timeline, score and visibility result below.</p>
        </div>
        <p className="atlas-index"><span>01</span> SITE CONDITIONS<br /><span>02</span> MISSION WINDOW</p>
      </section>
      <section className="controls">
        <div className="field">
          <span>View</span>
          <div className="segmented">
            <button className={view === 'single' ? 'active' : ''} onClick={() => setView('single')}>
              Single site
            </button>
            <button className={view === 'rank' ? 'active' : ''} onClick={() => setView('rank')}>
              Rank sites
            </button>
            <button className={view === 'find' ? 'active' : ''} onClick={() => setView('find')}>
              Find windows
            </button>
            <button className={view === 'resources' ? 'active' : ''} aria-pressed={view === 'resources'} onClick={() => setView('resources')}>
              Resources
            </button>
          </div>
        </div>

        {view === 'single' && (
          <label className="field">
            <span>Landing site</span>
            <select
              value={site.id}
              onChange={(e) => {
                const next = SITES.find((s) => s.id === e.target.value)
                if (next) onSiteChange(next)
              }}
            >
              {CATEGORY_ORDER.map((cat) => (
                <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                  {SITES.filter((s) => s.category === cat).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              {site.category === 'custom' && (
                <optgroup label="Custom">
                  <option value={site.id}>{site.name}</option>
                </optgroup>
              )}
            </select>
          </label>
        )}

        <label className="field">
          <span>Start (UTC)</span>
          <input type="date" value={day} onChange={(e) => onDayChange(e.target.value)} />
        </label>

        <div className="field">
          <span>{view === 'find' ? 'Search horizon' : 'Window'}</span>
          <div className="segmented">
            {[7, 30, 90, 365].map((d) => (
              <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
                {d === 30 ? '1 lunar day' : `${d}d`}
              </button>
            ))}
          </div>
        </div>

        {view === 'single' && (
          <label className="field">
            <span>Resolution</span>
            <select value={stepMin} onChange={(e) => setStepMin(Number(e.target.value))}>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
            </select>
          </label>
        )}

        {view === 'single' && (
          <div className="field custom-site">
            <span>Custom coordinates</span>
            <div className="custom-row">
              <input
                value={customLat}
                onChange={(e) => setCustomLat(e.target.value)}
                aria-label="Latitude"
                placeholder="lat"
              />
              <input
                value={customLon}
                onChange={(e) => setCustomLon(e.target.value)}
                aria-label="Longitude"
                placeholder="lon"
              />
              <button onClick={applyCustom}>Use</button>
            </div>
          </div>
        )}

        {(view === 'rank' || view === 'resources') && (
          <div className="field rank-note">
            <span>Ranking</span>
            <p>{RANK_SITES.length} south-pole candidates · 1 h resolution</p>
          </div>
        )}
      </section>

      {view === 'single' ? (
        <>
          <section className="kpis">
            <Kpi
              label="Sunlight"
              value={`${metrics.sunlitPct.toFixed(0)}%`}
              sub={`longest ${formatDuration(metrics.longestSunlitMs)}`}
              tone="sun"
            />
            <Kpi
              label="Direct-to-Earth"
              value={`${metrics.commPct.toFixed(0)}%`}
              sub={`longest ${formatDuration(metrics.longestCommMs)}`}
              tone="earth"
            />
            <Kpi
              label="Sun + link"
              value={`${metrics.jointPct.toFixed(0)}%`}
              sub="both conditions at once"
              tone="joint"
            />
            <Kpi
              label="Solar power"
              value={`${Math.round(metrics.meanTrackingFluxWm2)} W/m²`}
              sub={`avg, vertical Sun-tracking array · flat panel ${Math.round(
                metrics.meanSolarIncidence * 1361,
              )} W/m² · Sun max ${metrics.maxSunElevation.toFixed(1)}°`}
              tone="sun"
            />
            <Kpi
              label="Next sunset"
              value={countdown(metrics.nextSunset, t0)}
              sub={metrics.nextSunset ? formatUtc(metrics.nextSunset) : 'none in range'}
              tone="muted"
            />
            <Kpi
              label="Next Earthset"
              value={countdown(metrics.nextEarthset, t0)}
              sub={metrics.nextEarthset ? formatUtc(metrics.nextEarthset) : 'none in range'}
              tone="muted"
            />
          </section>

          <section className="chart-card panel-card">
            <div className="chart-head">
              <div>
                <h2>Solar panel</h2>
                <p>Fixed array · orientation for this site and range · {mastLine(site, sky.horizonDipDeg)}</p>
              </div>
            </div>

            <div className="panel-grid">
              <div className="panel-item">
                <span className="panel-label">Face the Sun now</span>
                <p className="panel-now">{panelNow}</p>
              </div>

              {bestPanel && (
                <div className="panel-item panel-best">
                  <span className="panel-label">Best fixed panel for this range</span>
                  <strong className="panel-value">
                    {bestPanel.tiltDeg}° tilt · {bestPanel.azimuthDeg}°{' '}
                    {compassPoint(bestPanel.azimuthDeg)}
                  </strong>
                  <span className="panel-sub">
                    captures {bestPanel.capturedPct.toFixed(1)}% of a perfect two-axis Sun-tracking panel
                  </span>
                  {isTerrainCritical(site) && (
                    <p className="panel-note">
                      At polar sites the Sun circles through every heading, so the heading shown is not
                      meaningful; a vertical array that rotates, or panels on several faces, collects far
                      more.
                    </p>
                  )}
                </div>
              )}
            </div>

            {bestPanel && (
              <ArrayPowerBars
                caption="Average power per m² · selected range"
                rows={[
                  { label: 'Two-axis Sun-tracking array', value: metrics.meanTrackingFluxWm2 },
                  {
                    label: `Best fixed panel (${bestPanel.tiltDeg}°, ${bestPanel.azimuthDeg}°)`,
                    value: (metrics.meanTrackingFluxWm2 * bestPanel.capturedPct) / 100,
                  },
                  { label: 'Flat on the deck', value: metrics.meanFlatFluxWm2 },
                ]}
              />
            )}

            <p className="panel-note">
              {site.horizon
                ? `The Sun counts while its upper limb is above the terrain skyline (up to ${site.horizon.maxElevationDeg.toFixed(
                    1,
                  )}° here), not the tangent plane. The mast lifts the eye, which lowers that skyline.`
                : 'Flat-horizon model while the elevation grid loads: the Sun counts from its upper limb, and the mast lowers the horizon by acos(R/(R+h)).'}
            </p>
          </section>

          <section className="chart-card">
            <div className="chart-head">
              <div>
                <h2>{site.name}</h2>
                <p>
                  {site.lat.toFixed(2)}° lat · {site.lon.toFixed(2)}° lon
                  {site.approx ? ' (approx.)' : ''} — {formatUtc(t0)} → {formatUtc(t1)}
                </p>
                {site.note && <p className="site-note">{site.note}</p>}
                {isTerrainCritical(site) && (
                  <p className="terrain-warning">
                    {site.horizon
                      ? `|lat| ≥ 80°: terrain decides illumination here. The LOLA skyline rises to ${site.horizon.maxElevationDeg.toFixed(
                          1,
                        )}° towards ${compassPoint16(site.horizon.maxAzimuthDeg)} (${site.horizon.maxDistanceKm.toFixed(
                          0,
                        )} km away); the 0.25° grid (~7.6 km) cannot resolve a lander-scale ridge.`
                      : '|lat| ≥ 80°: flat-horizon estimate while the elevation grid loads. Local relief dominates here (crests can exceed 80% illumination, crater floors are permanently dark).'}
                  </p>
                )}
              </div>
              <div className="readout">
                <div>
                  <span className="readout-label">Sun</span>
                  <strong className="sun-text">{deg(focus.sun.elevation)}</strong>
                  <span className="readout-sub">
                    az {focus.sun.azimuth.toFixed(0)}° · sky {deg(focus.sun.horizonDeg ?? -flatDip)}
                  </span>
                </div>
                <div>
                  <span className="readout-label">Earth</span>
                  <strong className="earth-text">{deg(focus.earth.elevation)}</strong>
                  <span className="readout-sub">
                    az {focus.earth.azimuth.toFixed(0)}° · sky {deg(focus.earth.horizonDeg ?? -flatDip)}
                  </span>
                </div>
                <div>
                  <span className="readout-label">Link</span>
                  <strong className={focus.earthVisible ? 'ok-text' : 'bad-text'}>
                    {focus.earthVisible ? 'OPEN' : 'BLOCKED'}
                  </strong>
                  <span className="readout-sub">
                    Earth {(focus.earth.distanceKm / 1000).toFixed(0)}k km ·{' '}
                    {focus.earth.angularDiameterDeg.toFixed(2)}°
                  </span>
                </div>
                <div className="readout-time">{formatUtc(focus.t, { seconds: true })}</div>
              </div>
            </div>

            <TimelineChart
              samples={samples}
              sunWindows={sunWindows}
              commWindows={commWindows}
              onHover={setHover}
              pinned={pinned}
              onPick={setPinned}
            />
          </section>

          <section className="chart-card globe-card">
            <div className="chart-head">
              <div>
                <h2>Pick a point on the Moon</h2>
                <p>
                  Drag to spin · click anywhere to make it the landing site · highlighted dot is
                  the current site
                </p>
              </div>
            </div>
            <MoonGlobe
              sites={SITES}
              selected={site}
              onPick={(lat, lon) => onSiteChange(customSite(lat, lon))}
            />
          </section>

          <section className="chart-card sky-card">
            <div className="chart-head">
              <div>
                <h2>Sky view</h2>
                <p>
                  First person from {site.name} · {formatUtc(skyTime, { seconds: true })}
                  {pinned && !hover ? ' · pinned from the chart' : ''}
                </p>
              </div>
              <p className="sky-hint">Drag to look around</p>
            </div>
            <SkyView
              site={site}
              t={skyTime}
              panel={
                bestPanel && bestPanel.capturedPct > 0
                  ? { tiltDeg: bestPanel.tiltDeg, azimuthDeg: bestPanel.azimuthDeg }
                  : null
              }
            />
          </section>
        </>
      ) : view === 'resources' ? (
        <MineralSelectionPanel rows={rankedBase} loading={rankLoading} onSelect={(next) => {
          onSiteChange(next)
          setView('single')
        }} />
      ) : view === 'rank' ? (
        <section className="chart-card ranking-card">
          <div className="chart-head">
            <div>
              <h2>Site ranking — {days === 30 ? '1 lunar day' : `${days} days`}</h2>
              <p>
                {RANK_SITES.length} south-pole candidates · {formatUtc(t0)} → {formatUtc(t1)} · 1 h
                resolution
              </p>
            </div>
            <p className="rank-hint">Click a header to re-sort · click a row to open that site</p>
          </div>
          {rankLoading ? (
            <p className="rank-loading">
              Scoring {RANK_SITES.length} candidates over {days} days…
            </p>
          ) : (
            <RankingTable
              rows={ranked}
              sortBy={sortBy}
              onSort={setSortBy}
              onSelect={(next) => {
                onSiteChange(next)
                setView('single')
              }}
            />
          )}
        </section>
      ) : (
        <OpportunityPanel
          sites={shortlist}
          t0={t0}
          days={days}
          onOpen={(next, start) => {
            onSiteChange(next)
            onDayChange(utcDay(start))
            setView('single')
          }}
        />
      )}

      <footer className="foot">
        <div>
          <strong>Model.</strong> Sun &amp; Moon ephemerides via astronomy-engine (VSOP87/ELP-2000
          series), lunar body-fixed frame from IAU WGCCRE 2015 including physical libration.
          Validated against JPL Horizons to &lt;0.02° in elevation. Sunlight counts from the upper
          limb of the solar disc; power is the visible-disc fraction × incidence × (1 AU/r)², for a
          vertical Sun-tracking array (polar-lander practice) and a flat panel. Horizon: LOLA
          ldem_4 elevation grid (0.25° cells), marched out to 400 km with exact lunar curvature;
          the skyline is sampled in 3° azimuth bins and the mast raises the eye. Falls back to the
          flat tangent plane if the grid cannot load.
        </div>
      </footer>
    </>
  )
}

function countdown(target: number | undefined, from: number) {
  if (target === undefined) return '—'
  return formatDuration(Math.max(0, target - from))
}

/** Four-point compass letter for a heading in degrees. */
function compassPoint(azimuthDeg: number): string {
  const azimuth = ((azimuthDeg % 360) + 360) % 360
  if (azimuth < 45 || azimuth >= 315) return 'N'
  if (azimuth < 135) return 'E'
  if (azimuth < 225) return 'S'
  return 'W'
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone: 'sun' | 'earth' | 'joint' | 'muted'
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-sub">{sub}</span>
    </div>
  )
}
