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
  const [site, setSite] = useState<LunarSite>(SITES.find((s) => s.id === 'apollo11')!)
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
            <p>Lunar Landing Site Navigator</p>
          </div>
        </div>
        <div className="topbar-meta">
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
