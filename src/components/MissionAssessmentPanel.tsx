import { useEffect, useRef, useState } from 'react'
import { assessMission, assessMissionChunks, DEFAULT_MISSION_REQUIREMENTS, type MissionRequirements } from '../lib/astro/missionAssessment'
import type { LunarSite } from '../lib/astro/types'
import { SITES } from '../lib/astro/sites'
import { loadTerrainGrid } from '../lib/terrainData'
import { buildHorizon } from '../lib/astro/horizon'
import { formatDuration, formatUtc } from '../lib/format'
import { loadMineralDataset, MINERAL_KEYS, MINERAL_PRODUCTS, sampleMineral, type MineralDataset } from '../lib/resources/minerals'

type Assessment = ReturnType<typeof assessMission>
interface Props { site: LunarSite; t0: number; t1: number; horizonFor: (site: LunarSite) => LunarSite }
const fields: [keyof MissionRequirements, string, number, number, number][] = [
  ['demandW', 'Continuous demand (W)', 0, 100000, 10],
  ['arrayAreaM2', 'Array area (m²)', 0, 10000, .1],
  ['efficiency', 'Conversion efficiency (0–1)', .001, 1, .01],
  ['capacityWh', 'Usable battery capacity (Wh)', 0, 10000000, 100],
  ['initialChargePct', 'Initial charge (%)', 0, 100, 5],
  ['chargeEfficiency', 'Charging efficiency (0–1)', .001, 1, .01],
  ['dischargeEfficiency', 'Discharge efficiency (0–1)', .001, 1, .01],
  ['maxBlackoutHours', 'Maximum DSN geometric blackout (h)', 0, 10000, 1],
  ['stationMaskDeg', 'Station geometric elevation mask (°)', 0, 90, 1],
  ['tiltDeg', 'Fixed array tilt from horizontal (°)', 0, 90, 1],
  ['azimuthDeg', 'Fixed array heading clockwise from north (°)', 0, 360, 1],
]
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function MissionAssessmentPanel({ site, t0, t1, horizonFor }: Props) {
  const [requirements, setRequirements] = useState({ ...DEFAULT_MISSION_REQUIREMENTS })
  const [comparison, setComparison] = useState<string[]>([])
  const [results, setResults] = useState<Assessment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sensitivity, setSensitivity] = useState('')
  const [offsetKm, setOffsetKm] = useState(5)
  const [progress, setProgress] = useState('')
  const [minerals, setMinerals] = useState<MineralDataset | null>(null)
  useEffect(() => {
    let active = true
    loadMineralDataset().then((data) => { if (active) setMinerals(data) }).catch(() => {})
    return () => { active = false }
  }, [])
  const mineralEvidence = (candidate: LunarSite) => MINERAL_KEYS.map((key) => ({
    product: key, unit: MINERAL_PRODUCTS[key].unit,
    bin: minerals ? sampleMineral(minerals[key].cells, candidate.lat, candidate.lon)?.atSite ?? null : null,
    sourceUrl: minerals?.[key].sourceUrl ?? null, sha256: minerals?.[key].sha256 ?? null,
  }))
  const generation = useRef(0)
  useEffect(() => { generation.current++; setResults([]); setSensitivity(''); setBusy(false) }, [site, t0, t1, requirements, comparison])
  useEffect(() => () => { generation.current++ }, [])
  const run = async (nearby = false) => {
    const token = ++generation.current
    setBusy(true); setError(''); setSensitivity('')
    try {
      const calculate = async (candidate: LunarSite) => {
        const iterator = assessMissionChunks(candidate, t0, t1, 300_000, requirements)
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (token !== generation.current) throw new Error('Assessment cancelled')
          const next = iterator.next()
          if (next.done) return next.value
          setProgress(`Assessing ${candidate.name}…`)
        }
      }
      const candidates = [site, ...comparison.map((id) => ({ ...horizonFor(SITES.find((s) => s.id === id)!), mastHeightM: site.mastHeightM }))]
      const computed: Assessment[] = []
      for (const candidate of candidates) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (token !== generation.current) return
        computed.push(await calculate(candidate))
      }
      if (token !== generation.current) return
      setResults(computed)
      if (nearby) {
        const grid = await loadTerrainGrid()
        if (!grid) throw new Error('Terrain grid unavailable for nearby-position assessment')
        const shifts: Assessment[] = []
        // Great-circle destinations remain well defined at the pole.
        const lat = site.lat * Math.PI / 180, lon = site.lon * Math.PI / 180, arc = offsetKm / 1737.4
        for (const bearing of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (token !== generation.current) return
          const phi = Math.asin(Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(bearing))
          const lambda = lon + Math.atan2(Math.sin(bearing) * Math.sin(arc) * Math.cos(lat), Math.cos(arc) - Math.sin(lat) * Math.sin(phi))
          const shifted = { ...site, lat: phi * 180 / Math.PI, lon: ((lambda * 180 / Math.PI + 540) % 360) - 180 }
          shifted.horizon = buildHorizon(grid, shifted.lat, shifted.lon, { mastHeightM: site.mastHeightM })
          shifts.push(await calculate(shifted))
        }
        if (token !== generation.current) return
        const all = [computed[0], ...shifts]
        setSensitivity(`${all.some((r) => r.passes !== all[0].passes) ? 'Sensitive to location: requirement verdict changes.' : 'No verdict change at these sampled offsets.'} Four positions ${offsetKm} km away plus the centre. DSN access range ${Math.min(...all.map((r) => r.dsnPct)).toFixed(1)}–${Math.max(...all.map((r) => r.dsnPct)).toFixed(1)}%. Offsets are a user scenario, not a statistical coordinate uncertainty or proof of local stability.`)
      }
    } catch (e) { if (token === generation.current) setError(e instanceof Error ? e.message : 'Assessment unavailable') }
    finally { if (token === generation.current) { setBusy(false); setProgress('') } }
  }
  return <section className="chart-card mission-assessment" aria-labelledby="assessment-title">
    <h2 id="assessment-title">Mission requirements assessment</h2>
    <p>Screen electrical energy and DSN geometric access over {formatUtc(t0)} → {formatUtc(t1)}. Results use 5 min midpoint intervals; brief events between samples can be missed. Default inputs are an illustrative scenario, not a mission specification.</p>
    <form onSubmit={(e) => { e.preventDefault(); void run() }}>
      <div className="mineral-controls">
        {fields.map(([key, label, min, max, step]) => <label className="field" key={key}><span>{label}</span><input type="number" required min={min} max={max} step={step} value={requirements[key] as number} onChange={(e) => setRequirements((old) => ({ ...old, [key]: e.target.valueAsNumber }))} /></label>)}
        <label className="field"><span>Array orientation</span><select value={requirements.orientation} onChange={(e) => setRequirements((old) => ({ ...old, orientation: e.target.value as MissionRequirements['orientation'] }))}><option value="tracking">Ideal Sun tracking</option><option value="horizontal">Horizontal</option><option value="fixed">Fixed tilt and heading</option></select></label>
      </div>
      <fieldset><legend>Compare up to two additional sites with identical requirements and dates</legend>{SITES.filter((s) => s.category === 'candidate' && s.id !== site.id).map((s) => <label key={s.id} className="ranking-resource-toggle"><input type="checkbox" checked={comparison.includes(s.id)} disabled={!comparison.includes(s.id) && comparison.length >= 2} onChange={(e) => setComparison((old) => e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id))} />{s.name}</label>)}</fieldset>
      <button disabled={busy} type="submit">{busy ? 'Assessing…' : 'Assess mission & compare'}</button>
      {busy && <button type="button" onClick={() => { generation.current++; setBusy(false); setProgress('Cancelled. Run assessment again to obtain complete results.') }}>Cancel assessment</button>}
      <label className="ranking-resource-toggle">Nearby-position offset (km)<input type="number" min={.1} max={50} step={.1} value={offsetKm} onChange={(e) => { generation.current++; setBusy(false); setSensitivity(''); setOffsetKm(e.target.valueAsNumber) }} /></label>
      <button disabled={busy || !Number.isFinite(offsetKm) || offsetKm < .1 || offsetKm > 50} type="button" onClick={() => void run(true)}>Assess nearby positions</button>
    </form>
    <p role="status" aria-live="polite">{error || progress || sensitivity}</p>
    {results.length > 0 && <>
      <div className="ranking-wrap"><table className="ranking-table"><caption>Same inputs and date range; pass means only the explicitly modeled requirements are met.</caption><thead><tr><th>Metric</th>{results.map((r) => <th key={r.site.id}>{r.site.name}</th>)}</tr></thead><tbody>
        {([
          ['Assessment', (r: Assessment) => r.passes ? 'Meets modeled requirements' : r.reasons.join('; ')],
          ['Earth geometric visibility', (r: Assessment) => `${r.earthPct.toFixed(1)}%`],
          ['DSN geometric access ≥ station mask', (r: Assessment) => `${r.dsnPct.toFixed(1)}%`],
          ['Longest DSN geometric blackout', (r: Assessment) => formatDuration(r.longestDsnBlackoutMs)],
          ['DSN blackout requirement margin', (r: Assessment) => `${(r.requirements.maxBlackoutHours - r.longestDsnBlackoutMs / 3_600_000).toFixed(2)} h`],
          ['Longest Earth geometric blackout', (r: Assessment) => formatDuration(r.longestEarthBlackoutMs)],
          ['Time generation below demand', (r: Assessment) => formatDuration(r.generationBelowDemandMs)],
          ['Time with unmet electrical load', (r: Assessment) => formatDuration(r.unmetDurationMs)],
          ['Unmet electrical energy', (r: Assessment) => `${r.shortfallWh.toFixed(1)} Wh`],
          ['Minimum stored battery energy', (r: Assessment) => `${r.minBatteryWh.toFixed(1)} Wh`],
          ['Coordinate / terrain basis', (r: Assessment) => `${r.site.approx ? 'Approximate coordinates' : 'Catalogue coordinates'} · ${r.site.horizon ? `${r.site.horizon.cellKm} km grid / ${r.site.horizon.stepDeg}° skyline` : 'Smooth-sphere fallback'}`],
        ] as const).map(([label, render]) => <tr key={label}><th scope="row">{label}</th>{results.map((r) => <td key={r.site.id}>{render(r)}</td>)}</tr>)}
        {MINERAL_KEYS.map((key) => <tr key={key}><th scope="row">Regional {MINERAL_PRODUCTS[key].label} ({MINERAL_PRODUCTS[key].unit})</th>{results.map((r) => <td key={r.site.id}>{minerals ? sampleMineral(minerals[key].cells, r.site.lat, r.site.lon)?.atSite.value.toFixed(3) ?? 'No coverage' : 'Unavailable'}</td>)}</tr>)}
      </tbody></table></div>
      <p>Abundances describe regional bins, not local reserves. Compare resource evidence only after reviewing electrical and blackout failures; abundance never overrides the assessment requirements.</p>
      {results.map((r) => <figure key={r.site.id}><figcaption>{r.site.name} · stored energy (0–{requirements.capacityWh} Wh), common UTC interval. Detailed energy and station access samples are available in CSV.</figcaption><svg viewBox="0 0 800 100" width="100%" height="100" role="img" aria-label={`${r.site.name} battery energy over the selected mission range`}><polyline fill="none" stroke="var(--sun)" strokeWidth="2" points={r.samples.filter((_, i) => i % Math.max(1, Math.floor(r.samples.length / 800)) === 0).map((s) => `${(s.t - t0) / (t1 - t0) * 800},${95 - s.batteryWh / Math.max(1, requirements.capacityWh) * 90}`).join(' ')} /></svg></figure>)}
      <p>Aligned access tracks below: upper line = Earth disc geometry; lower line = DSN geometric access. High = available, low = unavailable. No scheduled communications are inferred.</p>
      {results.map((r) => <figure key={r.site.id}><figcaption>{r.site.name}</figcaption><svg viewBox="0 0 800 80" width="100%" height="80" role="img" aria-label={`${r.site.name} Earth and DSN geometric access`}>
        {(['earthVisible', 'dsnAccess'] as const).map((key, lane) => <polyline key={key} fill="none" stroke={lane === 0 ? 'var(--earth)' : 'var(--sun)'} strokeWidth="2" points={r.samples.map((s) => `${(s.t - t0) / (t1 - t0) * 800},${lane * 40 + (s[key] ? 8 : 30)}`).join(' ')} />)}
      </svg><small>{formatUtc(t0)} → {formatUtc(t1)}</small></figure>)}
      <button onClick={() => download('lumbra-assessment.json', JSON.stringify({ schemaVersion: 1, sensitivity, offsetKm, results: results.map((r) => ({ ...r, minerals: mineralEvidence(r.site) })) }, (_key, value) => value instanceof Float32Array ? Array.from(value) : value, 2), 'application/json')}>Export assessment JSON</button>{' '}
      <button onClick={() => {
        const quote = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`
        const rows = results.flatMap((r) => r.samples.map((s) => [r.site.id, new Date(s.t).toISOString(), s.solarFluxWm2, s.generatedW, s.batteryWh, s.unmetW, s.earthVisible, s.dsnAccess, s.stations.join('|'), JSON.stringify(r.requirements), r.stepMs, r.site.lat, r.site.lon, r.site.horizon?.source ?? 'smooth sphere', r.assumptions.join('; ')]))
        download('lumbra-assessment.csv', ['site,utc,incident_W_m2,generated_W,battery_Wh,unmet_W,earth_geometry,dsn_geometry,stations,requirements,sampling_ms,latitude,longitude,terrain_source,assumptions', ...rows.map((row) => row.map(quote).join(','))].join('\n'), 'text/csv')
      }}>Export timeline CSV</button>
    </>}
    <p>DSN geometry is potential line of sight, excluding antenna scheduling, radio frequency compatibility, link budgets and relay service. Electrical estimates use constant load and ideal orientation, excluding degradation and thermal constraints. Regional terrain cannot certify a safe landing point.</p>
  </section>
}
