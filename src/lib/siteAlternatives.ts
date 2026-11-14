import type { RankedSite } from './astro/ranking'
import type { OpportunityConstraints } from './astro/opportunity'
import type { MineralDataset, MineralKey, ResourcePreferences } from './resources/minerals'
import { sampleMineral, scoreResources } from './resources/minerals'

interface SearchRange { t0: number; t1: number }
export type AlternativeSearch = SearchRange & (
  | { kind: 'operations' }
  | { kind: 'calendar'; constraints: OpportunityConstraints }
  | { kind: 'continuous'; hours: number }
  | { kind: 'resources'; mineral: MineralKey; radiusKm: number; preferences: ResourcePreferences }
)
export type ResourceSearchCriteria = Pick<Extract<AlternativeSearch, { kind: 'resources' }>, 'mineral' | 'radiusKm' | 'preferences'>
export interface SiteAlternative extends RankedSite { resourceValue?: number; score?: number }

/** Same-site coordinate aliases are not alternatives to the selected location. */
function sameLocation(a: RankedSite['site'], b: RankedSite['site']) {
  const deltaLon = ((a.lon - b.lon + 540) % 360 + 360) % 360 - 180
  return a.id === b.id || Math.abs(a.lat - b.lat) < 1e-5 && (Math.abs(deltaLon) < 1e-5 || Math.abs(a.lat) === 90)
}
const distance = (a: RankedSite, b: RankedSite) => Math.abs(a.metrics.sunlitPct - b.metrics.sunlitPct)
  + Math.abs(a.metrics.commPct - b.metrics.commPct) + Math.abs(a.metrics.jointPct - b.metrics.jointPct)

/** At most three genuine matches. Never pad with candidates that fail a search. */
export function chooseAlternatives(rows: RankedSite[], reference: RankedSite, search: AlternativeSearch | null, dataset?: MineralDataset): SiteAlternative[] {
  const others = rows.filter((row) => !sameLocation(row.site, reference.site))
  if (search?.kind === 'resources') {
    if (!dataset) return []
    const resourceRows = scoreResources([reference, ...others].map((row) => ({ ...row, sample: sampleMineral(dataset[search.mineral].cells, row.site.lat, row.site.lon, search.radiusKm) })), search.preferences)
    const selectedScore = resourceRows.find((row) => row.site.id === reference.site.id)?.score
    return resourceRows.filter((row) => row.eligible && !sameLocation(row.site, reference.site))
      .sort((a, b) => selectedScore == null ? (b.score! - a.score!) : Math.abs(a.score! - selectedScore) - Math.abs(b.score! - selectedScore) || distance(a, reference) - distance(b, reference))
      .slice(0, 3).map((row) => ({ ...row, resourceValue: row.sample!.selected.value, score: row.score! }))
  }
  const matches = others.filter((row) => {
    if (!row.site.horizon) return false
    if (search?.kind === 'continuous') {
      return row.metrics.sunlitPct >= 100 && row.metrics.commPct >= 100 && row.metrics.jointPct >= 100
    }
    if (search?.kind === 'calendar') {
      const c = search.constraints
      return row.metrics.sunlitPct >= c.minSunlitPct && row.metrics.commPct >= c.minCommPct && row.metrics.jointPct >= c.minJointPct
    }
    // Explicit no-search rule: similar availability, within 20 percentage points
    // on each metric. Permanently dark/blocked matches are not recommendations.
    return row.metrics.jointPct > 0 && (['sunlitPct', 'commPct', 'jointPct'] as const).every((key) => Math.abs(row.metrics[key] - reference.metrics[key]) <= 20)
  })
  return matches.sort((a, b) => distance(a, reference) - distance(b, reference) || b.metrics.jointPct - a.metrics.jointPct).slice(0, 3)
}
