import type { RankedSite } from '../astro/ranking'

export const MINERAL_PRODUCTS = {
  feo: { label: 'Iron oxide (FeO)', unit: 'wt.% FeO', target: 10, layer: 'LP_GRS_Fe_Clr_Global_2ppd', resolution: '0.5° grid; regional resolving power', note: 'Oxide abundance, not elemental iron. The original ASCII header specifies FeO, although Trek labels the layer Fe.' },
  titanium: { label: 'Titanium (Ti)', unit: 'wt.% Ti', target: 1, layer: 'LP_GRS_TitaniumAbundance_2ppd', resolution: 'Approximately 60 × 60 km source bins', note: 'Elemental titanium, not TiO₂ or ilmenite. The 0.5° Trek display grid does not increase the source resolution.' },
  thorium: { label: 'Thorium (Th)', unit: 'ppm Th', target: 2, layer: 'LP_GRS_Th_Clr_Global_2ppd', resolution: '0.5° grid; regional resolving power', note: 'A geochemical indicator, not a measurement of rare-earth elements or recoverable reserves.' },
} as const
export type MineralKey = keyof typeof MINERAL_PRODUCTS
export const MINERAL_KEYS = Object.keys(MINERAL_PRODUCTS) as MineralKey[]
export type MineralCell = { id: string; south: number; north: number; west: number; east: number; value: number }
export type MineralDataset = Record<MineralKey, { cells: MineralCell[]; sourceUrl: string; sha256: string }>
export const trekMetadataUrl = (key: MineralKey) =>
  `https://trek.nasa.gov/moon/TrekWS/rest/cat/metadata/fgdc/html?label=${MINERAL_PRODUCTS[key].layer}`

/** Strict version/dimension checks; corrupt or missing data never becomes zero. */
export function parseMineralDataset(input: unknown): MineralDataset {
  const data = input as { schemaVersion?: number; coverage?: { south: number; north: number }; products?: Record<string, { values?: number[]; cells?: number[][]; sourceUrl?: string; sha256?: string }> }
  if (!data || data.schemaVersion !== 1 || data.coverage?.south !== -90 || data.coverage?.north !== -75) throw new Error('Unsupported mineral dataset')
  return Object.fromEntries(MINERAL_KEYS.map((key) => {
    const p = data.products?.[key]
    if (!p || typeof p.sourceUrl !== 'string' || !/^[a-f0-9]{64}$/.test(p.sha256 ?? '')) throw new Error(`Missing ${key} provenance`)
    let raw: number[][]
    if (key === 'titanium') {
      if (!Array.isArray(p.cells) || p.cells.length !== 195) throw new Error('Incomplete titanium bins')
      raw = p.cells
    } else {
      if (!Array.isArray(p.values) || p.values.length !== 21_600) throw new Error(`Incomplete ${key} grid`)
      raw = p.values.map((v, i) => {
        const south = -90 + Math.floor(i / 720) * .5
        const west = -180 + (i % 720) * .5
        return [south, south + .5, west, west + .5, v]
      })
    }
    const cells = raw.map((r, i) => {
      if (!Array.isArray(r) || r.length !== 5 || !r.every(Number.isFinite)) throw new Error(`Invalid ${key} cell`)
      const [south, north, west, east, value] = r
      if (south < -90 || north > -75 || south >= north || west < -180 || east > 180 || west >= east || value < 0) throw new Error(`Invalid ${key} bounds or abundance`)
      return { id: `${key}:${i}`, south, north, west, east, value }
    })
    return [key, { cells, sourceUrl: p.sourceUrl, sha256: p.sha256 }]
  })) as MineralDataset
}

let cached: Promise<MineralDataset> | undefined
export function loadMineralDataset(): Promise<MineralDataset> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}resources/lp-south-pole.json`)
      .then((res) => { if (!res.ok) throw new Error('Mineral data unavailable'); return res.json() })
      .then(parseMineralDataset)
      .catch((error) => { cached = undefined; throw error })
  }
  return cached
}

const RAD = Math.PI / 180
export function lunarDistanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const h = Math.sin((bLat - aLat) * RAD / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin((bLon - aLon) * RAD / 2) ** 2
  return 2 * 1737.4 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}
const longitude = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180
export type MineralSample = { atSite: MineralCell; selected: MineralCell; distanceKm: number }

/** Containing bin without interpolation; optional regional maximum by bin-centre distance.
 * The containing bin is always included. A bin centre is not a surveyed deposit.
 */
export function sampleMineral(cells: MineralCell[], lat: number, lon: number, radiusKm = 0): MineralSample | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat >= -75 || !Number.isFinite(radiusKm) || radiusKm < 0) return null
  const lng = longitude(lon)
  const atSite = cells.find((c) => lat >= c.south && lat < c.north && lng >= c.west && lng < c.east)
  if (!atSite) return null
  let selected = atSite
  let distanceKm = 0
  if (radiusKm > 0) {
    for (const cell of cells) {
      if (cell.value <= selected.value) continue
      const distance = lunarDistanceKm(lat, lng, (cell.south + cell.north) / 2, (cell.west + cell.east) / 2)
      if (distance <= radiusKm) { selected = cell; distanceKm = distance }
    }
  }
  return { atSite, selected, distanceKm }
}

export interface ResourcePreferences {
  mineralWeight: number
  target: number
  minSun: number
  minEarth: number
  minJoint: number
}
export type ResourceRow = RankedSite & { sample: MineralSample | null; eligible: boolean; reasons: string[]; resourceScore: number | null; score: number | null }

/** An explicit user planning score, not a NASA score or an ore-yield prediction. */
export function scoreResources(rows: (RankedSite & { sample: MineralSample | null })[], prefs: ResourcePreferences): ResourceRow[] {
  if (![prefs.target, prefs.mineralWeight, prefs.minSun, prefs.minEarth, prefs.minJoint].every(Number.isFinite) || prefs.target <= 0 || prefs.mineralWeight < 0 || prefs.mineralWeight > 100 || [prefs.minSun, prefs.minEarth, prefs.minJoint].some((v) => v < 0 || v > 100)) throw new Error('Invalid resource preferences')
  const w = prefs.mineralWeight / 100
  return rows.map((row) => {
    const reasons: string[] = []
    if (!row.sample) reasons.push('No mineral coverage')
    if (!row.site.horizon) reasons.push('Terrain skyline unavailable')
    if (row.metrics.sunlitPct < prefs.minSun) reasons.push('Below sunlight minimum')
    if (row.metrics.commPct < prefs.minEarth) reasons.push('Below Earth minimum')
    if (row.metrics.jointPct < prefs.minJoint || row.metrics.jointPct <= 0) reasons.push('Insufficient simultaneous visibility')
    const resourceScore = row.sample ? Math.min(100, row.sample.selected.value / prefs.target * 100) : null
    const eligible = reasons.length === 0
    const score = eligible && resourceScore !== null ? (1 - w) * row.metrics.jointPct + w * resourceScore : null
    return { ...row, sample: row.sample, eligible, reasons, resourceScore, score }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.metrics.jointPct - a.metrics.jointPct)
}
