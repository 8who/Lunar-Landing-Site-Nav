import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExplorerMode from './modes/ExplorerMode'
import ExpertMode from './modes/ExpertMode'
import MastControl from './components/MastControl'
import { buildHorizon } from './lib/astro/horizon'
import { SITES } from './lib/astro/sites'
import type { LunarSite } from './lib/astro/types'
import { loadTerrainGrid } from './lib/terrainData'
import './styles.css'
import type { AlternativeSearch } from './lib/siteAlternatives'

type Mode = 'explorer' | 'expert'

const MINUTE = 60_000

/** Today in UTC, as 'YYYY-MM-DD'. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function App() {
  const [mode, setMode] = useState<Mode>('explorer')
  // Shared between both modes: switching views keeps the site and the instant.
  const [site, setSite] = useState<LunarSite>(SITES.find((s) => s.id === 'apollo11')!)
  const [day, setDay] = useState(todayUtc)
  const [minutesOfDay, setMinutesOfDay] = useState(12 * 60)
  // Height of the solar array / antenna mast. Raising it lowers the horizon.
  const [mastHeightM, setMastHeightM] = useState(2)
  const [alternativeSearch, setAlternativeSearch] = useState<AlternativeSearch | null>(null)

  // The LOLA grid powers the terrain horizon, not just the sky view. It loads
  // once; until it arrives (or if it fails) the app uses the flat model.
  const [terrainGrid, setTerrainGrid] = useState<Float32Array | null>(null)
  useEffect(() => {
    let alive = true
    loadTerrainGrid().then((grid) => {
      if (alive) setTerrainGrid(grid)
    })
    return () => {
      alive = false
    }
  }, [])

  // Profiles are pure functions of (grid, lat, lon, mast): cache them so a
  // render, a view switch or a slider tick never recomputes an unchanged site.
  // The mast is debounced: rebuilding 8 skyline profiles per slider tick would
  // outrun the drag for a change of a few hundredths of a degree.
  const [profileMast, setProfileMast] = useState(mastHeightM)
  useEffect(() => {
    const timer = setTimeout(() => setProfileMast(mastHeightM), 200)
    return () => clearTimeout(timer)
  }, [mastHeightM])

  const horizonCache = useRef(new Map<string, LunarSite>())
  const horizonFor = useCallback(
    (input: LunarSite): LunarSite => {
      // Reuse a profile only if it was built for this mast; a site that came
      // back from the calendar carries the profile it was scored with.
      if (!terrainGrid) return input
      if (input.horizon?.eyeHeightM === profileMast) return input
      const key = `${input.id}|${input.lat.toFixed(3)}|${input.lon.toFixed(3)}|${profileMast}`
      const cached = horizonCache.current.get(key)
      if (cached) return cached
      const decorated: LunarSite = {
        ...input,
        mastHeightM: profileMast,
        horizon: buildHorizon(terrainGrid, input.lat, input.lon, { mastHeightM: profileMast }),
      }
      horizonCache.current.set(key, decorated)
      return decorated
    },
    [terrainGrid, profileMast],
  )

  const siteWithHorizon = useMemo(() => horizonFor(site), [horizonFor, site])
  const siteWithMast = useMemo(
    () => ({ ...siteWithHorizon, mastHeightM }),
    [siteWithHorizon, mastHeightM],
  )

  const t = useMemo(() => {
    const dayStart = Date.parse(`${day}T00:00:00Z`)
    const base = Number.isFinite(dayStart) ? dayStart : Date.parse(`${todayUtc()}T00:00:00Z`)
    return base + minutesOfDay * MINUTE
  }, [day, minutesOfDay])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M15.9 2.9a9.3 9.3 0 1 0 0 18.2 7.2 7.2 0 0 1 0-18.2Z"
                fill="currentColor"
                opacity="0.92"
              />
              <circle cx="19.4" cy="6.1" r="1.15" fill="var(--sun)" />
              <circle cx="17.3" cy="19.1" r="0.8" fill="currentColor" opacity="0.55" />
            </svg>
          </div>
          <div>
            <h1>Vi@bility42</h1>
            <p>Lunar mission atlas · Surface light &amp; communications</p>
          </div>
        </div>
        <div className={`topbar-meta${mode === 'expert' ? '' : ' no-mast'}`}>
          <div className={`segmented view-toggle${mode === 'expert' ? ' is-expert' : ''}`}>
            <span className="segmented-glide" aria-hidden="true" />
            <button
              className={mode === 'explorer' ? 'active' : ''}
              aria-pressed={mode === 'explorer'}
              onClick={() => setMode('explorer')}
            >
              Explorer
            </button>
            <button
              className={mode === 'expert' ? 'active' : ''}
              aria-pressed={mode === 'expert'}
              onClick={() => setMode('expert')}
            >
              Expert
            </button>
          </div>
          {mode === 'expert' && <MastControl value={mastHeightM} onChange={setMastHeightM} />}
          <span className="pill" title="Independent NASA Space Apps Challenge project; not an official NASA product">NASA Space Apps · Independent project</span>
        </div>
      </header>

      {mode === 'explorer' ? (
        <ExplorerMode
          site={siteWithMast}
          onSiteChange={setSite}
          day={day}
          onDayChange={setDay}
          minutesOfDay={minutesOfDay}
          onMinutesChange={setMinutesOfDay}
          t={t}
          horizonFor={horizonFor}
          alternativeSearch={alternativeSearch}
          onAlternativeSearchChange={setAlternativeSearch}
        />
      ) : (
        <ExpertMode
          site={siteWithMast}
          onSiteChange={setSite}
          day={day}
          onDayChange={setDay}
          t={t}
          horizonFor={horizonFor}
          alternativeSearch={alternativeSearch}
          onAlternativeSearchChange={setAlternativeSearch}
        />
      )}
    </div>
  )
}
