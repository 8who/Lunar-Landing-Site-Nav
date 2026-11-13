import { useMemo, useState } from 'react'
import ExplorerMode from './modes/ExplorerMode'
import ExpertMode from './modes/ExpertMode'
import { SITES } from './lib/astro/sites'
import type { LunarSite } from './lib/astro/types'

type Mode = 'explorer' | 'expert'

const MINUTE = 60_000

/** Today in UTC, as 'YYYY-MM-DD'. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function App() {
  const [mode, setMode] = useState<Mode>('explorer')
  // Shared between both modes: switching views keeps the site and the instant.
  const [site, setSite] = useState<LunarSite>(SITES.find((s) => s.id === 'shackleton')!)
  const [day, setDay] = useState(todayUtc)
  const [minutesOfDay, setMinutesOfDay] = useState(12 * 60)

  const t = useMemo(() => {
    const dayStart = Date.parse(`${day}T00:00:00Z`)
    const base = Number.isFinite(dayStart) ? dayStart : Date.parse(`${todayUtc()}T00:00:00Z`)
    return base + minutesOfDay * MINUTE
  }, [day, minutesOfDay])

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
          <div className="segmented view-toggle">
            <button
              className={mode === 'explorer' ? 'active' : ''}
              onClick={() => setMode('explorer')}
            >
              Explorer
            </button>
            <button className={mode === 'expert' ? 'active' : ''} onClick={() => setMode('expert')}>
              Expert
            </button>
          </div>
          <span className="pill">NASA Space Apps Challenge 2026</span>
        </div>
      </header>

      {mode === 'explorer' ? (
        <ExplorerMode
          site={site}
          onSiteChange={setSite}
          day={day}
          onDayChange={setDay}
          minutesOfDay={minutesOfDay}
          onMinutesChange={setMinutesOfDay}
          t={t}
        />
      ) : (
        <ExpertMode site={site} onSiteChange={setSite} day={day} onDayChange={setDay} t={t} />
      )}
    </div>
  )
}
