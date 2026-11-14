import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_OPPORTUNITY_CONSTRAINTS,
  OPPORTUNITY_STEP_MS,
  buildStarts,
  closestWindows,
  earliestPerSite,
  scanSite,
  type OpportunityCell,
  type OpportunityConstraints,
  type OpportunityGrid,
} from '../lib/astro/opportunity'
import { refineOpportunity, type RefinedOpportunity } from './opportunityRefinement'
import type { LunarSite } from '../lib/astro/types'
import { formatDecimal, formatDuration, formatMonthDay, formatMonthYear, formatPercent, formatUtc } from '../lib/format'

const DAY = 86_400_000
const DURATIONS = [3, 5, 7, 10] as const

const LEVELS = [
  { level: 0, label: '<20' },
  { level: 1, label: '20–40' },
  { level: 2, label: '40–60' },
  { level: 3, label: '60–80' },
  { level: 4, label: '80+' },
] as const

interface Props {
  /** Candidate shortlist, already filtered by the caller. */
  sites: LunarSite[]
  /** UTC midnight at the start of the search horizon. */
  t0: number
  /** Search horizon, days. */
  days: number
  onOpen: (site: LunarSite, start: number, criteria: { durationMs: number; constraints: OpportunityConstraints }) => void
}

interface Query {
  durationDays: number
  constraints: OpportunityConstraints
}

const clampPct = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
const levelFor = (jointPct: number) => Math.max(0, Math.min(4, Math.floor(jointPct / 20)))
const shortName = (name: string) => name.replace(' (candidate)', '')

function cellTitle(cell: OpportunityCell): string {
  const verdict = cell.meets ? 'coarse estimate meets the thresholds; not refined' : 'coarse estimate fails at least one threshold; not refined'
  return `${shortName(cell.site.name)}, start ${formatMonthDay(cell.start)}: ${formatPercent(
    cell.metrics.jointPct,
  )} joint, ${formatPercent(cell.metrics.sunlitPct)} sunlight, ${formatPercent(
    cell.metrics.commPct,
  )} Earth — ${verdict}`
}

export default function OpportunityPanel({ sites, t0, days, onOpen }: Props) {
  const [durationDays, setDurationDays] = useState(5)
  const [minJoint, setMinJoint] = useState(DEFAULT_OPPORTUNITY_CONSTRAINTS.minJointPct)
  const [minSun, setMinSun] = useState(DEFAULT_OPPORTUNITY_CONSTRAINTS.minSunlitPct)
  const [minComm, setMinComm] = useState(DEFAULT_OPPORTUNITY_CONSTRAINTS.minCommPct)
  const [query, setQuery] = useState<Query>({
    durationDays: 5,
    constraints: DEFAULT_OPPORTUNITY_CONSTRAINTS,
  })

  const horizonMs = days * DAY
  const durationMs = query.durationDays * DAY
  const tooLong = durationMs > horizonMs
  // Aim for at most ~30 columns of heatmap, whatever the horizon.
  const startStepMs = Math.max(1, Math.round(days / 30)) * DAY
  const request = useMemo(
    () => ({ sites, t0, horizonMs, durationMs, startStepMs, query }),
    [sites, t0, horizonMs, durationMs, startStepMs, query],
  )
  type Phase = 'coarse' | 'refining' | 'complete' | 'cancelled' | 'error'
  interface Run {
    request: typeof request
    grid: OpportunityGrid
    phase: Phase
    scored: number
    total: number
    refined: RefinedOpportunity[]
  }
  const [run, setRun] = useState<Run | null>(null)
  const cancelRef = useRef<() => void>(() => {})
  // Hide old results during the render that changes inputs, before effect cleanup.
  const current = run?.request === request ? run : null
  const grid = current?.grid ?? null
  const scanning = !tooLong && (!current || current.phase === 'coarse')
  const busy = scanning || current?.phase === 'refining'

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
    cancelRef.current = stop
    const starts = tooLong ? [] : buildStarts(t0, t0 + horizonMs, durationMs, startStepMs)
    const coarse: OpportunityGrid = { sites, starts, cells: [] }
    const publish = (update: Partial<Run>) => {
      if (cancelled) return
      setRun((previous) => previous?.request === request ? { ...previous, ...update } : previous)
    }
    setRun({ request, grid: coarse, phase: 'coarse', scored: 0, total: 0, refined: [] })
    let siteIndex = 0
    let startIndex = 0
    let shortlist: OpportunityCell[] = []
    let refined: RefinedOpportunity[] = []
    let refinement: ReturnType<typeof refineOpportunity> | undefined

    // Each task scores one coarse window or one six-hour refinement chunk.
    // Keep timers cancellable and yield between chunks, including the final one.
    const tick = () => {
      if (cancelled) return
      try {
        if (siteIndex < sites.length && starts.length > 0) {
          const [cell] = scanSite(sites[siteIndex], [starts[startIndex]], {
            durationMs, constraints: query.constraints, stepMs: OPPORTUNITY_STEP_MS,
          })
          coarse.cells.push(cell)
          startIndex += 1
          if (startIndex === starts.length) {
            startIndex = 0
            siteIndex += 1
          }
          publish({ grid: { ...coarse, cells: [...coarse.cells] }, scored: coarse.cells.length })
        } else {
          if (!refinement) {
            shortlist = earliestPerSite(coarse, 8)
            if (shortlist.length === 0) shortlist = closestWindows(coarse, 3)
            publish({ phase: 'refining', total: shortlist.length })
            refinement = shortlist.length > 0
              ? refineOpportunity(shortlist[0], durationMs, query.constraints)
              : undefined
            if (!refinement) {
              publish({ phase: 'complete' })
              return
            }
          }
          const next = refinement.next()
          if (next.done) {
            refined = [...refined, next.value]
            publish({ refined })
            if (refined.length === shortlist.length) {
              publish({ phase: 'complete' })
              return
            }
            refinement = refineOpportunity(shortlist[refined.length], durationMs, query.constraints)
          }
        }
        timer = setTimeout(tick, 0)
      } catch {
        publish({ phase: 'error' })
        stop()
      }
    }
    timer = setTimeout(tick, 0)
    return stop
  }, [request, sites, t0, horizonMs, durationMs, startStepMs, tooLong, query])

  const cellMap = useMemo(() => {
    const map = new Map<string, OpportunityCell>()
    for (const cell of grid?.cells ?? []) map.set(`${cell.site.id}:${cell.start}`, cell)
    return map
  }, [grid])

  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; span: number }[] = []
    for (const start of grid?.starts ?? []) {
      const key = new Date(start).toISOString().slice(0, 7)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.span += 1
      else groups.push({ key, label: formatMonthYear(start), span: 1 })
    }
    return groups
  }, [grid?.starts])

  const rows = grid?.sites ?? sites
  const starts = grid?.starts ?? []
  const stepLabel = startStepMs === DAY ? 'every day' : `every ${startStepMs / DAY} days`

  const search = () => {
    cancelRef.current()
    setRun(null)
    setQuery({
      durationDays,
      constraints: {
        minJointPct: clampPct(minJoint),
        minSunlitPct: clampPct(minSun),
        minCommPct: clampPct(minComm),
      },
    })
  }

  const open = (site: LunarSite, start: number) => {
    if (!current) return
    onOpen(site, start, { durationMs, constraints: { ...query.constraints } })
  }
  const cancel = () => {
    cancelRef.current()
    setRun((previous) => previous?.request === request ? { ...previous, phase: 'cancelled' } : previous)
  }

  return (
    <section className="chart-card opportunity-card">
      <div className="chart-head">
        <div>
          <h2>Mission calendar — find a landing date</h2>
          <p>
            {sites.length} south-pole candidates · start dates {stepLabel} · 3 h coarse / 5 min refinement ·{' '}
            {formatUtc(t0)} → {formatUtc(t0 + horizonMs)}
          </p>
        </div>
        <p className="rank-hint">Set minimums, press Search, then select a cell. Earth means geometric disc visibility; no DSN schedule or link budget is modeled.</p>
      </div>

      <p className="opp-copy">
        This inverts the usual question. Give the mission what it needs — length, minimum
        simultaneous sunlight and Earth visibility — and the search scores every candidate against
        every start date.
      </p>

      <form
        className="opp-query"
        onSubmit={(event) => {
          event.preventDefault()
          search()
        }}
      >
        <label className="field opp-field">
          <span>Mission length</span>
          <select
            value={durationDays}
            onChange={(event) => setDurationDays(Number(event.target.value))}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="field opp-field">
          <span>Min joint</span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minJoint}
            onChange={(event) => setMinJoint(Number(event.target.value))}
          />
        </label>
        <label className="field opp-field">
          <span>Min sunlight</span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minSun}
            onChange={(event) => setMinSun(Number(event.target.value))}
          />
        </label>
        <label className="field opp-field">
          <span>Min Earth</span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minComm}
            onChange={(event) => setMinComm(Number(event.target.value))}
          />
        </label>
        <button type="submit" className="opp-search">
          Search
        </button>
        {busy && <button type="button" className="opp-open" onClick={cancel}>Cancel search</button>}
      </form>

      {tooLong ? (
        <p className="rank-loading">
          A {query.durationDays}-day mission does not fit in a {days}-day horizon. Extend the search
          horizon or shorten the mission.
        </p>
      ) : (
        <>
          <p className="opp-scan" aria-live="polite">
            {!current
              ? 'Preparing coarse search…'
              : current.phase === 'cancelled'
                ? 'Search cancelled. Completed refinements are shown; other cells remain coarse estimates. Press Search to restart.'
                : current.phase === 'error'
                  ? 'Search stopped after a calculation error. Partial results are shown; press Search to retry.'
                  : starts.length === 0 || sites.length === 0
                    ? 'No candidates or start dates fit inside this horizon.'
                    : scanning
                      ? `Coarse scoring at 3 h… (${current.scored}/${sites.length * starts.length} windows). No refined results yet.`
                      : current.phase === 'refining'
                        ? `Refining shortlist at 5 min… (${current.refined.length}/${current.total} windows complete)`
                        : `${current.refined.filter((cell) => cell.meets).length}/${current.total} shortlisted windows meet all minimums at 5 min. Grid cells remain coarse estimates.`}
          </p>

          <div className="opp-scroll">
            <table className="opp-table">
              <thead>
                <tr>
                  <th className="opp-corner" rowSpan={2} scope="col">
                    Site
                  </th>
                  {monthGroups.map((group) => (
                    <th key={group.key} className="opp-month" colSpan={group.span} scope="colgroup">
                      {group.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {starts.map((start) => (
                    <th key={start} className="opp-day" scope="col" title={formatUtc(start)}>
                      {new Date(start).getUTCDate()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((site) => (
                  <tr key={site.id}>
                    <th className="opp-site" scope="row" title={site.name}>
                      {shortName(site.name)}
                    </th>
                    {starts.map((start) => {
                      const cell = cellMap.get(`${site.id}:${start}`)
                      return (
                        <td key={start}>
                          {cell ? (
                            <button
                              type="button"
                              className={`opp-cell level-${levelFor(cell.metrics.jointPct)}`}
                              onClick={() => open(cell.site, cell.start)}
                              title={cellTitle(cell)}
                              aria-label={cellTitle(cell)}
                            >
                              {Math.round(cell.metrics.jointPct)}
                            </button>
                          ) : (
                            <span className="opp-placeholder" aria-hidden="true" />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="opp-legend">
            <span className="opp-legend-title">Joint Sun + Earth</span>
            {LEVELS.map((entry) => (
              <span key={entry.level} className="opp-legend-step">
                <span
                  className={`opp-swatch level-${entry.level}`}
                  aria-hidden="true"
                />
                {entry.label}
              </span>
            ))}
            <span className="opp-legend-note">all cells = coarse estimates, not refined</span>
          </div>

          {current && current.phase !== 'coarse' && starts.length > 0 && (
            <div className="opp-results">
              <h3 className="opp-subhead">Shortlisted windows — 5 min refinement</h3>
              <p className="opp-note">
                Up to eight earliest coarse passing starts (one per site), or three closest coarse
                attempts if none pass. Only completed refinements appear below. Dates stay on the
                coarse start grid; a failed refinement does not trigger a search of later dates.
                These are model estimates, not mission validation.
              </p>
              {current.phase === 'complete' && current.total > 0 && !current.refined.some((cell) => cell.meets) && (
                <p className="opp-note">No refined shortlisted window meets every minimum. Other start dates have not been ruled out.</p>
              )}
              <ol className="opp-list">
                {current.refined.map((cell, index) => (
                  <li key={`${cell.site.id}:${cell.start}`} className="opp-result">
                    <span className="opp-rank">{index + 1}</span>
                    <span className="opp-result-site">
                      <strong>{shortName(cell.site.name)}</strong>
                      <small>start {formatMonthDay(cell.start)} · {query.durationDays} days</small>
                      <br />
                      <small>{cell.meets ? 'Meets minimums at 5 min' : 'Fails minimums at 5 min'}</small>
                    </span>
                    <span className="opp-figures">
                      <span className="opp-figure opp-figure-joint">{formatPercent(cell.metrics.jointPct, 1)} joint</span>
                      <span className="opp-figure sun-text">{formatPercent(cell.metrics.sunlitPct, 1)} sun</span>
                      <span className="opp-figure earth-text">{formatPercent(cell.metrics.commPct, 1)} Earth</span>
                      <span>Binding: {cell.binding.join(' / ')} · margin {cell.margin >= 0 ? '+' : ''}{formatDecimal(cell.margin, 2)} pp</span>
                      <span>Longest Earth geometric blackout: {formatDuration(cell.longestBlackoutMs)}</span>
                      <span>Longest darkness: {formatDuration(cell.longestDarknessMs)}</span>
                    </span>
                    <button type="button" className="opp-open" onClick={() => open(cell.site, cell.start)}>Open</button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="opp-footnote">
            Coarse search at 3 h; shortlisted windows refined at 5 min. Each site uses its LOLA
            terrain skyline when available, otherwise a flat horizon. Blackout and darkness are
            clipped to the mission window and mean no part of the respective disc is visible.
            Detected edges are refined to about 1 s; events between samples may be missed.
            Open shows a separate 15 min timeline and may differ. Polar estimates remain
            preliminary: the terrain grid cannot resolve a lander-scale ridge.
          </p>
        </>
      )}
    </section>
  )
}
