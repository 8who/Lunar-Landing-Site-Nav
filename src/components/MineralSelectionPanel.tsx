import { useMemo, useState } from 'react'
import type { RankedSite } from '../lib/astro/ranking'
import type { LunarSite } from '../lib/astro/types'
import type { ResourceSearchCriteria } from '../lib/siteAlternatives'
import { formatCoord, formatDecimal, formatPercent } from '../lib/format'
import { MINERAL_KEYS, MINERAL_PRODUCTS, sampleMineral, scoreResources, trekMetadataUrl, type MineralDataset, type MineralKey, type ResourcePreferences } from '../lib/resources/minerals'

interface Props { rows: RankedSite[]; loading: boolean; onSelect: (site: LunarSite, criteria: ResourceSearchCriteria) => void; mineral: MineralKey; onMineralChange: (mineral: MineralKey) => void; radius: number; onRadiusChange: (radius: number) => void; prefs: ResourcePreferences; onPrefsChange: (prefs: ResourcePreferences) => void; dataset: MineralDataset | null; error: boolean; onRetry: () => void }

export default function MineralSelectionPanel({ rows, loading, onSelect, mineral, onMineralChange, radius, onRadiusChange, prefs, onPrefsChange, dataset, error, onRetry }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const product = MINERAL_PRODUCTS[mineral]
  const sampled = useMemo(() => rows.map((row) => ({ ...row, sample: dataset ? sampleMineral(dataset[mineral].cells, row.site.lat, row.site.lon, radius) : null })), [rows, dataset, mineral, radius])
  const scored = useMemo(() => scoreResources(sampled, prefs), [sampled, prefs])
  const best = scored.find((row) => row.eligible)
  const selected = scored.find((row) => row.site.id === selectedId) ?? best ?? scored[0]
  // Plot original bin bounds in angular coordinates, including the full polar cap.
  // Normalize the site longitude using the same convention as source sampling.
  const footprint = selected?.sample ? (() => {
    const bin = selected.sample.selected
    const lon = ((selected.site.lon + 180) % 360 + 360) % 360 - 180
    const lat = selected.site.lat
    const lonPadding = Math.max(.25, (Math.max(bin.east, lon) - Math.min(bin.west, lon)) * .1)
    const latPadding = Math.max(.25, (Math.max(bin.north, lat) - Math.min(bin.south, lat)) * .1)
    const west = Math.max(-180, Math.min(bin.west, lon) - lonPadding)
    const east = Math.min(180, Math.max(bin.east, lon) + lonPadding)
    const south = Math.max(-90, Math.min(bin.south, lat) - latPadding)
    const north = Math.min(90, Math.max(bin.north, lat) + latPadding)
    const x = (value: number) => 80 + (value - west) / (east - west) * 480
    const y = (value: number) => 200 - (value - south) / (north - south) * 160
    return { bin, lon, lat, west, east, south, north, x, y }
  })() : null
  const changeNumber = (key: keyof ResourcePreferences, value: string) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return
    onPrefsChange({ ...prefs, [key]: key === 'target' ? Math.max(.01, Math.min(1000, number)) : Math.max(0, Math.min(100, number)) })
  }

  return (
    <section className="chart-card mineral-panel" aria-labelledby="mineral-title">
      <div className="chart-head">
        <div><h2 id="mineral-title">Resources &amp; landing feasibility</h2><p>Compare the seven south-pole candidates using Lunar Prospector abundances cataloged by NASA Moon Trek.</p></div>
      </div>
      <p className="mineral-caveat">These are regional surface abundances, not ore density or recoverable reserves. Fine mineral-species maps in Trek stop at 50° S; they do not cover these sites.</p>
      <div className="mineral-controls">
        <label className="field"><span>Resource objective</span><select value={mineral} onChange={(e) => {
          const next = e.target.value as MineralKey
          onMineralChange(next)
          onPrefsChange({ ...prefs, target: MINERAL_PRODUCTS[next].target })
        }}>{MINERAL_KEYS.map((key) => <option key={key} value={key}>{MINERAL_PRODUCTS[key].label}</option>)}</select></label>
        <label className="field"><span>Sampling area</span><select value={radius} onChange={(e) => onRadiusChange(Number(e.target.value))}><option value={0}>Bin containing the landing site</option><option value={25}>Strongest regional bin within 25 km</option><option value={50}>Strongest regional bin within 50 km</option></select></label>
        <label className="field"><span>Target abundance ({product.unit})</span><input type="number" min="0.01" max="1000" step="0.1" value={prefs.target} onChange={(e) => changeNumber('target', e.target.value)} /></label>
        <label className="field mineral-weight"><span>Resource influence: {prefs.mineralWeight}%</span><input type="range" min={0} max={100} step={5} value={prefs.mineralWeight} onChange={(e) => changeNumber('mineralWeight', e.target.value)} /></label>
      </div>
      <fieldset className="mineral-thresholds"><legend>Operational minimums over the selected date range</legend>
        {([['minSun', 'Sunlight'], ['minEarth', 'Earth visibility'], ['minJoint', 'Simultaneous Sun + Earth']] as const).map(([key, label]) => <label className="field" key={key}><span>{label} (%)</span><input type="number" min={0} max={100} step={5} value={prefs[key]} onChange={(e) => changeNumber(key, e.target.value)} /></label>)}
      </fieldset>
      <p className="mineral-method">Planning score = {100 - prefs.mineralWeight}% × simultaneous visibility + {prefs.mineralWeight}% × resource score. Resource score = abundance ÷ target, capped at 100. Targets and weights are your planning assumptions, not NASA recommendations. Sites must meet every minimum, have a terrain skyline, and have some simultaneous visibility.</p>
      <p className="mineral-caveat">Tradeoff: a higher score can exchange simultaneous Sun + Earth geometry for higher regional abundance. Compare the underlying percentages and abundance; the score does not establish a better landing site. Operations describe the landing site at 1 h cadence, while abundance describes a whole source bin. The planning score includes no station scheduling, link budget or electrical power model.</p>
      {radius > 0 && <p className="terrain-warning">Regional search includes the site’s own bin plus bin centres within {radius} km. A nearby maximum is off-site context: no rover route, accessible deposit, local illumination, or communications at that bin is inferred.</p>}
      <div aria-live="polite" role="status" className="mineral-status">
        {error ? <p>Mineral data could not load. Operational ranking remains available. <button onClick={onRetry}>Retry mineral data</button></p>
          : !dataset || loading ? <p>Loading source abundances and operational conditions…</p>
            : <p>{scored.filter((row) => row.eligible).length} of {rows.length} sites meet your criteria. {best ? <>Highest planning score: <strong>{best.site.name}</strong> ({formatDecimal(best.score!, 1)}/100).</> : 'No candidate qualifies. Review the minimums or choose another date range; no site is recommended.'}</p>}
      </div>
      {dataset && !error && !loading && <>
        <div className="ranking-wrap mineral-table-wrap"><table className="ranking-table mineral-table"><caption>Resource-adjusted comparison, sorted by planning score. Select a site to inspect its source bin.</caption><thead><tr><th scope="col">Site</th><th scope="col" aria-sort="descending">Score ↓</th><th scope="col">{product.label}<br />{product.unit}</th><th scope="col">Sunlight</th><th scope="col">Earth</th><th scope="col">Both</th><th scope="col">Assessment</th></tr></thead><tbody>
          {scored.map((row) => <tr key={row.site.id} className={selected?.site.id === row.site.id ? 'mineral-selected' : ''}>
            <td><button className="mineral-site-button" aria-pressed={selected?.site.id === row.site.id} onClick={() => setSelectedId(row.site.id)}>{row.site.name}</button></td>
            <td>{row.score === null ? '—' : formatDecimal(row.score, 1)}</td>
            <td>{row.sample ? <>{formatDecimal(row.sample.selected.value, 3)}<small>{row.sample.selected.id === row.sample.atSite.id ? 'Containing source bin' : `${formatDecimal(row.sample.distanceKm, 1)} km to bin centre`}</small></> : 'No coverage'}</td>
            <td className="sun-text">{formatPercent(row.metrics.sunlitPct)}</td><td className="earth-text">{formatPercent(row.metrics.commPct)}</td><td>{formatPercent(row.metrics.jointPct)}</td>
            <td>{row.eligible ? 'Meets minimums' : row.reasons.join('; ')}</td>
          </tr>)}
        </tbody></table></div>
        {selected && <section className="mineral-detail" aria-labelledby="mineral-detail-title"><div><h3 id="mineral-detail-title">{selected.site.name}</h3><p>{formatCoord(selected.site.lat, selected.site.lon)}{selected.site.approx ? ' · approximate site coordinates' : ''}</p></div><button onClick={() => onSelect(selected.site, { mineral, radiusKm: radius, preferences: { ...prefs } })}>Explore this site</button>
          <dl className="mineral-measurements">{MINERAL_KEYS.map((key) => {
            const cell = sampleMineral(dataset[key].cells, selected.site.lat, selected.site.lon)?.atSite
            return <div key={key}><dt>{MINERAL_PRODUCTS[key].label} at site</dt><dd>{cell ? `${formatDecimal(cell.value, 3)} ${MINERAL_PRODUCTS[key].unit}` : 'No coverage'}</dd></div>
          })}</dl>
          {selected.sample && <p className="mineral-bin">Selected {product.label} source bin: {formatCoord(selected.sample.selected.south, selected.sample.selected.west)} to {formatCoord(selected.sample.selected.north, selected.sample.selected.east)}. {product.resolution}. Grid spacing is not the instrument’s resolving power; adjacent sites may share one regional measurement.</p>}
          {footprint && <figure style={{ gridColumn: '1 / -1', margin: '12px 0', minWidth: 0 }}>
            <svg viewBox="0 0 640 280" role="img" aria-labelledby="mineral-footprint-title mineral-footprint-description" style={{ display: 'block', width: '100%', maxWidth: 640, color: 'var(--text)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <title id="mineral-footprint-title">Selected source-bin footprint and landing site</title>
              <desc id="mineral-footprint-description">Rectangle: original {product.label} source bin, longitude {formatDecimal(footprint.bin.west, 6)} to {formatDecimal(footprint.bin.east, 6)} degrees east, latitude {formatDecimal(footprint.bin.south, 6)} to {formatDecimal(footprint.bin.north, 6)} degrees north. Cross: {selected.site.name} at longitude {formatDecimal(footprint.lon, 6)}, latitude {formatDecimal(footprint.lat, 6)}. Longitude increases rightward; latitude increases upward. Angular coordinates, not a distance map.</desc>
              <path d="M80 30V200H570" fill="none" stroke="currentColor" />
              <rect x={footprint.x(footprint.bin.west)} y={footprint.y(footprint.bin.north)} width={footprint.x(footprint.bin.east) - footprint.x(footprint.bin.west)} height={footprint.y(footprint.bin.south) - footprint.y(footprint.bin.north)} fill="var(--earth)" fillOpacity={.15} stroke="var(--earth)" strokeWidth={2} />
              <path d={`M${footprint.x(footprint.lon) - 6} ${footprint.y(footprint.lat)}h12M${footprint.x(footprint.lon)} ${footprint.y(footprint.lat) - 6}v12`} stroke="currentColor" strokeWidth={2} />
              <g fill="currentColor">
                <text x={80} y={222} textAnchor="middle">{formatDecimal(footprint.west, 6)}°</text>
                <text x={560} y={222} textAnchor="middle">{formatDecimal(footprint.east, 6)}°</text>
                <text x={70} y={204} textAnchor="end">{formatDecimal(footprint.south, 6)}°</text>
                <text x={70} y={44} textAnchor="end">{formatDecimal(footprint.north, 6)}°</text>
                <text x={320} y={250} textAnchor="middle">Longitude (° east-positive)</text>
                <text transform="translate(18 120) rotate(-90)" textAnchor="middle">Latitude (° north-positive)</text>
              </g>
            </svg>
            <figcaption className="mineral-bin">Rectangle: selected source bin · Cross: landing site{selected.site.approx ? ' (approximate coordinates)' : ''}. Original boundaries and one abundance per bin; no interpolation or lander-scale precision. Angular plot; distances and areas are distorted near the pole. A polar cap spans all longitudes.</figcaption>
          </figure>}
          <p>{product.note} No per-bin uncertainty is supplied in these source tables; small concentration differences are not established statistically significant.</p>
        </section>}
      </>}
      <details className="mineral-sources"><summary>Sources, coverage &amp; interpretation</summary><p>NASA Moon Trek identifies the layers; numeric values come directly from their original Lunar Prospector spectrometer-team ASCII products at NASA PDS Geosciences. No colors are converted into concentrations. The bundled subset covers 90° S to 75° S and preserves original bin boundaries and values without interpolation. These special products are not a PDS peer-reviewed dataset.</p>
        <ul>{MINERAL_KEYS.map((key) => <li key={key}><a href={trekMetadataUrl(key)} target="_blank" rel="noreferrer">Moon Trek: {MINERAL_PRODUCTS[key].label}</a>{dataset && <> · <a href={dataset[key].sourceUrl} target="_blank" rel="noreferrer">Original numeric table</a></>}</li>)}</ul>
        <p>FeO and Th use the December 2001 half-degree products (released January 2002). Ti uses the June 2002 approximately 60 km bins, including a single polar cap bin south of 89° S. FeO is retained as labeled by the original data header, resolving Trek’s ambiguous “Fe” label. Neither hydrogen nor thorium is substituted for water-ice or rare-earth reserves.</p>
        <p>Operational conditions are sampled at 1 h and describe the landing site only. Percentage thresholds do not guarantee a continuous mission window; use the mission planner before choosing a date. Orbital abundance cannot establish subsurface concentration, extraction yield, terrain accessibility, or lander-scale hotspots.</p>
      </details>
    </section>
  )
}
