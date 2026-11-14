import { useEffect, useMemo, useState } from 'react'
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
import type { LunarSite } from '../lib/astro/types'
import { formatMonthDay, formatMonthYear, formatPercent, formatUtc } from '../lib/format'

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
  const verdict = cell.meets ? 'meets the thresholds' : 'fails at least one threshold'
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

  const [grid, setGrid] = useState<OpportunityGrid | null>(null)
  const [done, setDone] = useState(0)

  const horizonMs = days * DAY
  const durationMs = query.durationDays * DAY
  const tooLong = durationMs > horizonMs
  // Aim for at most ~30 columns of heatmap, whatever the horizon.
  const startStepMs = Math.max(1, Math.round(days / 30)) * DAY
  const scanning = !tooLong && done < sites.length

  useEffect(() => {
    if (tooLong) {
      setGrid(null)
      setDone(sites.length)
      return
    }

    const starts = buildStarts(t0, t0 + horizonMs, durationMs, startStepMs)
    const shortlist = sites
    setGrid({ sites: shortlist, starts, cells: [] })
    setDone(starts.length === 0 ? shortlist.length : 0)

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let index = 0

    // One site per task: each row is ~0.2 s, so the UI keeps painting.
    const tick = () => {
      if (cancelled) return
      const site = shortlist[index]
      const cells = scanSite(site, starts, {
        durationMs,
        constraints: query.constraints,
        stepMs: OPPORTUNITY_STEP_MS,
      })
      index += 1
      setGrid((previous) =>
        previous ? { ...previous, cells: [...previous.cells, ...cells] } : previous,
      )
      setDone(index)
      if (index < shortlist.length) timer = setTimeout(tick, 0)
    }

    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [t0, horizonMs, durationMs, startStepMs, tooLong, query, sites])

  const cellMap = useMemo(() => {
    const map = new Map<string, OpportunityCell>()
    for (const cell of grid?.cells ?? []) map.set(`${cell.site.id}:${cell.start}`, cell)
    return map
  }, [grid])

  const earliest = useMemo(
    () => (grid && !scanning ? earliestPerSite(grid) : []),
    [grid, scanning],
  )
  const closest = useMemo(
    () => (grid && !scanning ? closestWindows(grid, 3) : []),
    [grid, scanning],
  )

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
    setQuery({
      durationDays,
      constraints: {
        minJointPct: clampPct(minJoint),
        minSunlitPct: clampPct(minSun),
        minCommPct: clampPct(minComm),
      },
    })
  }

  const open = (site: LunarSite, start: number) => onOpen(site, start, { durationMs, constraints: { ...query.constraints } })

  return (
    <section className="chart-card opportunity-card">
      <div className="chart-head">
        <div>
          <h2>Mission calendar — find a landing date</h2>
          <p>
            {sites.length} south-pole candidates · start dates {stepLabel} · 3 h sampling ·{' '}
            {formatUtc(t0)} → {formatUtc(t0 + horizonMs)}
          </p>
        </div>
        <p className="rank-hint">Set the minimums, press Search, click a cell to open it</p>
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
      </form>

      {tooLong ? (
        <p className="rank-loading">
          A {query.durationDays}-day mission does not fit in a {days}-day horizon. Extend the search
          horizon or shorten the mission.
        </p>
      ) : (
        <>
          <p className="opp-scan" aria-live="polite">
            {starts.length === 0
              ? 'No start date fits inside this horizon.'
              : scanning
                ? `Scoring ${sites.length} candidates × ${starts.length} start dates at 3 h… (${done}/${sites.length} sites)`
                : `${sites.length} candidates × ${starts.length} start dates scored · ${earliest.length} site${
                    earliest.length === 1 ? '' : 's'
                  } clear the bar`}
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
                              className={`opp-cell level-${levelFor(cell.metrics.jointPct)}${
                                cell.meets ? ' is-meets' : ''
                              }`}
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
            <span className="opp-legend-note">ring = meets all three thresholds</span>
          </div>

          {grid && !scanning && starts.length > 0 && (
            <div className="opp-results">
              {earliest.length > 0 ? (
                <>
                  <h3 className="opp-subhead">Earliest start per site</h3>
                  <p className="opp-note">
                    First date that clears every minimum. Later cells in the grid can capture more
                    joint Sun and Earth, up to 100%.
                  </p>
                  <ol className="opp-list">
                    {earliest.map((cell, index) => (
                      <li key={`${cell.site.id}:${cell.start}`} className="opp-result">
                        <span className="opp-rank">{index + 1}</span>
                        <span className="opp-result-site">
                          <strong>{shortName(cell.site.name)}</strong>
                          <small>
                            start {formatMonthDay(cell.start)} · {query.durationDays} days
                          </small>
                        </span>
                        <span className="opp-figures">
                          <span className="opp-figure opp-figure-joint">
                            {formatPercent(cell.metrics.jointPct)} joint
                          </span>
                          <span className="opp-figure sun-text">
                            {formatPercent(cell.metrics.sunlitPct)} sun
                          </span>
                          <span className="opp-figure earth-text">
                            {formatPercent(cell.metrics.commPct)} Earth
                          </span>
                        </span>
                        <button
                          type="button"
                          className="opp-open"
                          onClick={() => open(cell.site, cell.start)}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <h3 className="opp-subhead">No start date clears all three thresholds</h3>
                  <p className="opp-note">
                    Closest attempts — lower a minimum or extend the search horizon.
                  </p>
                  <ol className="opp-list">
                    {closest.map((cell) => (
                      <li key={`${cell.site.id}:${cell.start}`} className="opp-result">
                        <span className="opp-rank">—</span>
                        <span className="opp-result-site">
                          <strong>{shortName(cell.site.name)}</strong>
                          <small>start {formatMonthDay(cell.start)}</small>
                        </span>
                        <span className="opp-figures">
                          <span className="opp-figure opp-figure-joint">
                            {formatPercent(cell.metrics.jointPct)} joint
                          </span>
                          <span className="opp-figure sun-text">
                            {formatPercent(cell.metrics.sunlitPct)} sun
                          </span>
                          <span className="opp-figure earth-text">
                            {formatPercent(cell.metrics.commPct)} Earth
                          </span>
                        </span>
                        <button
                          type="button"
                          className="opp-open"
                          onClick={() => open(cell.site, cell.start)}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}

          <p className="opp-footnote">
            Coarse search at 3 h sampling with the{' '}
            {sites.some((s) => s.horizon) ? 'LOLA terrain skyline' : 'flat-horizon model'}. Open a
            result for the exact 15 min timeline; polar percentages remain preliminary because the
            0.25° grid cannot resolve a lander-scale ridge.
          </p>
        </>
      )}
    </section>
  )
}
