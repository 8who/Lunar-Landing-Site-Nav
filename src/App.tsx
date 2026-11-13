import { useMemo, useState } from 'react'
import TimelineChart from './components/TimelineChart'
import { buildTimeline } from './lib/astro/timeline'
import { SITES, customSite } from './lib/astro/sites'
import type { LunarSite, SkySample } from './lib/astro/types'
import { formatDuration, formatUtc, deg } from './lib/format'

const DAY = 86_400_000

const CATEGORY_ORDER = ['candidate', 'clps', 'international', 'apollo'] as const
const CATEGORY_LABEL: Record<string, string> = {
  candidate: 'Artemis / south pole',
  clps: 'CLPS',
  international: 'International',
  apollo: 'Apollo',
}

export default function App() {
  const [site, setSite] = useState<LunarSite>(SITES.find((s) => s.id === 'shackleton')!)
  const [startDate, setStartDate] = useState('2028-01-01')
  const [days, setDays] = useState(30)
  const [stepMin, setStepMin] = useState(15)
  const [hover, setHover] = useState<SkySample | null>(null)
  const [customLat, setCustomLat] = useState('-89.50')
  const [customLon, setCustomLon] = useState('0.00')

  const parsedStart = Date.parse(`${startDate}T00:00:00Z`)
  const t0 = Number.isFinite(parsedStart) ? parsedStart : Date.parse('2028-01-01T00:00:00Z')
  const t1 = t0 + days * DAY

  const timeline = useMemo(
    () => buildTimeline(site, t0, t1, stepMin * 60_000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site.id, site.lat, site.lon, t0, t1, stepMin],
  )
  const { metrics, samples, sunWindows, commWindows } = timeline

  const focus = hover ?? samples[Math.floor(samples.length / 2)]

  const applyCustom = () => {
    const lat = Number(customLat)
    const lon = Number(customLon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    if (Math.abs(lat) > 90) return
    setSite(customSite(lat, lon))
  }

  const setPreset = (n: number) => setDays(n)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">◎</div>
          <div>
            <h1>Lunar Landing Site Navigator</h1>
            <p>Sun &amp; Earth geometry, power and direct-to-Earth windows · Viability42</p>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="pill">NASA Space Apps Challenge 2026</span>
        </div>
      </header>

      <section className="controls">
        <label className="field">
          <span>Landing site</span>
          <select value={site.id} onChange={(e) => {
            if (e.target.value === '__custom') return
            const next = SITES.find((s) => s.id === e.target.value)
            if (next) setSite(next)
          }}>
            {CATEGORY_ORDER.map((cat) => (
              <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                {SITES.filter((s) => s.category === cat).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
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

        <label className="field">
          <span>Start (UTC)</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <div className="field">
          <span>Window</span>
          <div className="segmented">
            {[7, 30, 90, 365].map((d) => (
              <button key={d} className={days === d ? 'active' : ''} onClick={() => setPreset(d)}>
                {d === 30 ? '1 lunar day' : `${d}d`}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Resolution</span>
          <select value={stepMin} onChange={(e) => setStepMin(Number(e.target.value))}>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
          </select>
        </label>

        <div className="field custom-site">
          <span>Custom coordinates</span>
          <div className="custom-row">
            <input value={customLat} onChange={(e) => setCustomLat(e.target.value)} aria-label="Latitude" placeholder="lat" />
            <input value={customLon} onChange={(e) => setCustomLon(e.target.value)} aria-label="Longitude" placeholder="lon" />
            <button onClick={applyCustom}>Use</button>
          </div>
        </div>
      </section>

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
          label="Max Sun height"
          value={`${metrics.maxSunElevation.toFixed(1)}°`}
          sub={`power proxy ${(metrics.meanSolarIncidence * 100).toFixed(1)}% of flat array`}
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

      <section className="chart-card">
        <div className="chart-head">
          <div>
            <h2>{site.name}</h2>
            <p>
              {site.lat.toFixed(2)}° lat · {site.lon.toFixed(2)}° lon
              {site.approx ? ' (approx.)' : ''} — {formatUtc(t0)} → {formatUtc(t1)}
            </p>
            {site.note && <p className="site-note">{site.note}</p>}
          </div>
          <div className="readout">
            <div>
              <span className="readout-label">Sun</span>
              <strong className="sun-text">{deg(focus.sun.elevation)}</strong>
              <span className="readout-sub">az {focus.sun.azimuth.toFixed(0)}°</span>
            </div>
            <div>
              <span className="readout-label">Earth</span>
              <strong className="earth-text">{deg(focus.earth.elevation)}</strong>
              <span className="readout-sub">az {focus.earth.azimuth.toFixed(0)}°</span>
            </div>
            <div>
              <span className="readout-label">Link</span>
              <strong className={focus.earthVisible ? 'ok-text' : 'bad-text'}>
                {focus.earthVisible ? 'OPEN' : 'BLOCKED'}
              </strong>
              <span className="readout-sub">
                Earth {(focus.earth.distanceKm / 1000).toFixed(0)}k km · {focus.earth.angularDiameterDeg.toFixed(2)}°
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
        />
      </section>

      <footer className="foot">
        <div>
          <strong>Model.</strong> Sun &amp; Moon ephemerides via astronomy-engine (VSOP87/ELP-2000
          series), lunar body-fixed frame from IAU WGCCRE 2015 including physical libration.
          Validated against JPL Horizons to &lt;0.02° in elevation. Flat local horizon: terrain
          masking and LOLA topography are the next step.
        </div>
      </footer>
    </div>
  )
}

function countdown(target: number | undefined, from: number) {
  if (target === undefined) return '—'
  return formatDuration(Math.max(0, target - from))
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
