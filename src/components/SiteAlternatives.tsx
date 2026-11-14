import { useEffect, useState } from 'react'
import { SITES } from '../lib/astro/sites'
import { buildTimeline } from '../lib/astro/timeline'
import type { LunarSite } from '../lib/astro/types'
import type { RankedSite } from '../lib/astro/ranking'
import { chooseAlternatives, type AlternativeSearch, type SiteAlternative } from '../lib/siteAlternatives'
import { loadMineralDataset, MINERAL_PRODUCTS } from '../lib/resources/minerals'
import { formatDecimal, formatPercent, formatUtc } from '../lib/format'

interface Props {
  site: LunarSite
  horizonFor: (site: LunarSite) => LunarSite
  t0: number
  t1: number
  search: AlternativeSearch | null
  onClearSearch: () => void
  onSelect: (site: LunarSite) => void
}
const CACHE = new Map<string, RankedSite>()

export default function SiteAlternatives({ site, horizonFor, t0, t1, search, onClearSearch, onSelect }: Props) {
  const [result, setResult] = useState<{ key: string; rows: SiteAlternative[]; loading: boolean; error: boolean }>({ key: '', rows: [], loading: true, error: false })
  const start = search?.t0 ?? t0
  const end = search?.t1 ?? t1
  const key = `${site.id}:${site.lat}:${site.lon}:${site.mastHeightM}:${site.horizon?.eyeHeightM ?? 'flat'}:${start}:${end}:${JSON.stringify(search)}`
  const pending = result.loading || result.key !== key
  const comparisonNote = search?.kind === 'continuous' ? 'same operation interval; terrain-resolution limits still apply.' : 'percentage matches do not guarantee a continuous operation window.'
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    setResult({ key, rows: [], loading: true, error: false })
    const pool = SITES.filter((candidate) => search ? candidate.category === 'candidate' : candidate.category === (site.category === 'custom' ? 'candidate' : site.category))
    const rows: RankedSite[] = []
    const inputs = [site, ...pool.filter((candidate) => candidate.id !== site.id)]
    const scoreNext = (index: number) => {
      if (cancelled) return
      const observed = { ...horizonFor(inputs[index]), mastHeightM: site.mastHeightM }
      if (!observed.horizon) { setResult({ key, rows: [], loading: false, error: true }); return }
      const cacheKey = `${observed.id}:${observed.lat}:${observed.lon}:${observed.horizon.eyeHeightM}:${site.mastHeightM}:${start}:${end}`
      let row = CACHE.get(cacheKey)
      if (!row) {
        row = { site: observed, metrics: buildTimeline(observed, start, end, 3_600_000).metrics }
        if (CACHE.size > 200) CACHE.clear()
        CACHE.set(cacheKey, row)
      }
      rows.push(row)
      if (index + 1 < inputs.length) { timer = setTimeout(() => scoreNext(index + 1), 0); return }
      const finish = async () => {
        try {
          const dataset = search?.kind === 'resources' ? await loadMineralDataset() : undefined
          const alternatives = chooseAlternatives(rows, rows[0], search, dataset)
          if (!cancelled) setResult({ key, rows: alternatives, loading: false, error: false })
        } catch { if (!cancelled) setResult({ key, rows: [], loading: false, error: true }) }
      }
      void finish()
    }
    timer = setTimeout(() => scoreNext(0), 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [site.id, site.lat, site.lon, site.horizon, site.mastHeightM, horizonFor, start, end, search, key])

  return <section className="site-alternatives" aria-label="Alternative landing sites">
    <div className="alternatives-heading"><h3>Alternatives</h3>{search && <button onClick={onClearSearch}>Clear saved search criteria</button>}</div>
    <p className="alternatives-context">{search?.kind === 'resources' ? `Last resource search: ${MINERAL_PRODUCTS[search.mineral].label}, ${search.preferences.mineralWeight}% resource influence and all operational minimums.` : search?.kind === 'continuous' ? `Last operation: ${search.hours} h of simultaneous Sun and Earth visibility, at the same start time. Matches require 100% overlap in the model.` : search?.kind === 'calendar' ? 'Last mission-window search: same percentage thresholds, at the selected start date.' : `${search ? 'Last ranking range. ' : ''}Similar sunlight, Earth visibility and simultaneous availability: within 20 percentage points on each metric.`} {formatUtc(start)} → {formatUtc(end)}. Current mast: {formatDecimal(site.mastHeightM ?? 0, 1)} m.</p>
    <div role="status" aria-live="polite">{pending ? <p>Comparing landing sites…</p> : result.error ? <p>Comparison unavailable until terrain and required source data are loaded.</p> : result.rows.length === 0 ? <p>No other sites meet these criteria. Browse all sites or adjust your search.</p> : <p className="alternatives-count">{result.rows.length} matching {result.rows.length === 1 ? 'site' : 'sites'} · 1 h sampling · {comparisonNote}</p>}</div>
    {!pending && <ul>{result.rows.map((row) => <li key={row.site.id}><button onClick={() => onSelect(row.site)} title={`Select ${row.site.name}`}><strong>{row.site.name}</strong><span>Sun {formatPercent(row.metrics.sunlitPct)} · Earth {formatPercent(row.metrics.commPct)} · Both {formatPercent(row.metrics.jointPct)}</span>{search?.kind === 'resources' && row.resourceValue !== undefined && <span>{formatDecimal(row.resourceValue, 3)} {MINERAL_PRODUCTS[search.mineral].unit} · score {formatDecimal(row.score!, 1)}</span>}</button></li>)}</ul>}
  </section>
}
