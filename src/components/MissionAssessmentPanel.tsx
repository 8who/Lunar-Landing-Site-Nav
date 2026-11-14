import { useEffect, useRef, useState } from 'react'
import { assessMissionChunks, DEFAULT_MISSION_REQUIREMENTS, type MissionAssessment } from '../lib/astro/missionAssessment'
import type { LunarSite } from '../lib/astro/types'
import { formatDuration, formatPercent, formatUtc } from '../lib/format'

interface Props { site: LunarSite; t0: number; t1: number }

/** A concise, automatically generated DSN geometry check for a demo mission. */
export default function MissionAssessmentPanel({ site, t0, t1 }: Props) {
  const [maxBlackoutHours, setMaxBlackoutHours] = useState(24)
  const [result, setResult] = useState<MissionAssessment | null>(null)
  const [progress, setProgress] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)

  useEffect(() => {
    const runId = ++generation.current
    let cancelled = false
    const timer = setTimeout(() => {
      const requirements = { ...DEFAULT_MISSION_REQUIREMENTS, maxBlackoutHours }
      const chunks = assessMissionChunks(site, t0, t1, 300_000, requirements)
      setProgress(true)
      setError('')
      setResult(null)
      const step = () => {
        if (cancelled || runId !== generation.current) return
        try {
          const next = chunks.next()
          if (next.done) {
            setResult(next.value)
            setProgress(false)
          } else setTimeout(step, 0)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'DSN assessment unavailable')
          setProgress(false)
        }
      }
      step()
    }, 0)
    return () => { cancelled = true; clearTimeout(timer); generation.current++ }
  }, [site, t0, t1, maxBlackoutHours])

  return <section className="chart-card mission-assessment" aria-labelledby="assessment-title">
    <div className="chart-head">
      <div>
        <h2 id="assessment-title">Mission communications check</h2>
        <p>{site.name} · {formatUtc(t0)} → {formatUtc(t1)} · automatic 5 min sampling</p>
      </div>
      <label className="field"><span>Maximum DSN outage</span><select value={maxBlackoutHours} onChange={(event) => setMaxBlackoutHours(Number(event.target.value))}>
        <option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={48}>48 hours</option>
      </select></label>
    </div>
    {progress ? <p role="status">Checking station geometry along the selected mission interval…</p>
      : error ? <p role="alert">Could not complete the DSN check: {error}</p>
        : result && <>
          <div className="kpis mission-assessment-kpis">
            <article className="kpi kpi-earth"><span className="kpi-label">DSN geometric access</span><strong className="kpi-value">{formatPercent(result.dsnPct)}</strong><small className="kpi-sub">At least one modeled station clears the terrain and 10° station mask</small></article>
            <article className="kpi"><span className="kpi-label">Longest modeled outage</span><strong className="kpi-value">{formatDuration(result.longestDsnBlackoutMs)}</strong><small className="kpi-sub">Limit: {maxBlackoutHours} h</small></article>
            <article className="kpi"><span className="kpi-label">Assessment</span><strong className="kpi-value">{result.longestDsnBlackoutMs <= maxBlackoutHours * 3_600_000 ? 'Within limit' : 'Exceeds limit'}</strong><small className="kpi-sub">Based on selected time range</small></article>
          </div>
          <p className="panel-note">This is an automatically generated geometric screening using the selected site, mission dates, LOLA skyline when available, and DSN station locations. It does not include antenna schedules, maintenance, RF link budgets, relay coverage, or guarantee a communications link. Five-minute samples can miss brief outages. {site.approx ? 'The selected site coordinates are approximate.' : ''}</p>
        </>}
  </section>
}
