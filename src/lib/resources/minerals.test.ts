import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SITES } from '../astro/sites'
import { buildTimeline } from '../astro/timeline'
import { lunarDistanceKm, parseMineralDataset, sampleMineral, scoreResources, type MineralCell, type ResourcePreferences } from './minerals'

const raw = JSON.parse(new TextDecoder().decode(readFileSync(new URL('../../../public/resources/lp-south-pole.json', import.meta.url))))
const data = parseMineralDataset(raw)
const candidates = SITES.filter((site) => site.category === 'candidate')
const prefs: ResourcePreferences = { target: 10, mineralWeight: 35, minSun: 50, minEarth: 50, minJoint: 25 }
const c = (value: number): MineralCell => ({ id: 'test', south: -90, north: -89, west: -180, east: 180, value })
const sample = (value: number) => ({ atSite: c(value), selected: c(value), distanceKm: 0 })
const base = buildTimeline(candidates[0], Date.parse('2028-01-01T00:00:00Z'), Date.parse('2028-01-02T00:00:00Z'), 3_600_000).metrics
const row = (id: string, joint: number, abundance: number | null) => ({ site: { ...candidates[0], id, horizon: { stepDeg: 3, elevations: new Float32Array(120), groundElevationM: 0, eyeHeightM: 2, maxElevationDeg: 0, maxAzimuthDeg: 0, maxDistanceKm: 0, source: 'test', cellKm: 7.6 } }, metrics: { ...base, sunlitPct: joint, commPct: joint, jointPct: joint }, sample: abundance === null ? null : sample(abundance) })

describe('source data and coordinate sampling', () => {
  it.each([
    ['monsmouton', 6.4893, 1.7363, .10642],
    ['malapert', 6.204, 1.735, .013302],
    ['shackleton', 6.4751, 1.7687, .18367],
    ['cabeus', 6.4678, 1.7257, .090941],
  ] as const)('preserves original ASCII bin values at %s', (id, feo, th, ti) => {
    const site = candidates.find((s) => s.id === id)!
    expect(sampleMineral(data.feo.cells, site.lat, site.lon)?.atSite.value).toBe(feo)
    expect(sampleMineral(data.thorium.cells, site.lat, site.lon)?.atSite.value).toBe(th)
    expect(sampleMineral(data.titanium.cells, site.lat, site.lon)?.atSite.value).toBe(ti)
  })
  it('has source coverage at all seven candidates without inventing separate polar Ti bins', () => {
    for (const site of candidates) for (const product of Object.values(data)) expect(sampleMineral(product.cells, site.lat, site.lon)).not.toBeNull()
    const polar = candidates.filter((site) => site.lat < -89)
    expect(new Set(polar.map((site) => sampleMineral(data.titanium.cells, site.lat, site.lon)?.atSite.id)).size).toBe(1)
  })
  it('wraps east-positive longitudes and handles the pole and coverage edge', () => {
    expect(sampleMineral(data.feo.cells, -85, 180)).toEqual(sampleMineral(data.feo.cells, -85, -180))
    expect(sampleMineral(data.feo.cells, -85, 203)).toEqual(sampleMineral(data.feo.cells, -85, -157))
    expect(sampleMineral(data.feo.cells, -90, 0)).not.toBeNull()
    for (const lat of [-91, -75, 0, NaN]) expect(sampleMineral(data.feo.cells, lat, 0)).toBeNull()
  })
  it('rejects incomplete and corrupt datasets instead of substituting zero', () => {
    expect(() => parseMineralDataset(null)).toThrow()
    expect(() => parseMineralDataset({ ...raw, schemaVersion: 2 })).toThrow()
    expect(() => parseMineralDataset({ ...raw, products: { ...raw.products, feo: { ...raw.products.feo, values: [1] } } })).toThrow()
  })
  it('finds nearby maximums only inside the specified bin-centre radius', () => {
    const cells = [{ ...c(3), south: -85, north: -84, west: 0, east: 1 }, { ...c(8), id: 'near', south: -85, north: -84, west: 1, east: 2 }, { ...c(50), id: 'far', south: -82, north: -81, west: 1, east: 2 }]
    expect(sampleMineral(cells, -84.5, .5, 0)?.selected.value).toBe(3)
    expect(sampleMineral(cells, -84.5, .5, 25)?.selected.value).toBe(8)
    expect(sampleMineral(cells, -84.5, .5, 25)?.distanceKm).toBeLessThan(25)
    expect(lunarDistanceKm(-90, -180, -90, 180)).toBeCloseTo(0)
  })
})

describe('resource-aware planning score', () => {
  it('can change selection with resource influence while preserving operational metrics', () => {
    const rows = [row('light-rich', 90, 2), row('resource-rich', 70, 10)]
    expect(scoreResources(rows, { ...prefs, mineralWeight: 0 })[0].site.id).toBe('light-rich')
    const scored = scoreResources(rows, prefs)
    expect(scored[0].site.id).toBe('resource-rich')
    expect(scored[0].score).toBeCloseTo(.65 * 70 + .35 * 100)
    expect(scored[0].metrics).toBe(rows[1].metrics)
  })
  it('never lets a high concentration override operational minimums or missing coverage', () => {
    const rows = [row('dark', 0, 100), row('weak', 40, 100), row('unknown', 100, null), row('viable', 70, 5)]
    const scored = scoreResources(rows, { ...prefs, mineralWeight: 100 })
    expect(scored[0].site.id).toBe('viable')
    expect(scored.slice(1).every((r) => !r.eligible && r.score === null)).toBe(true)
  })
  it('requires terrain, caps abundance at the target, and rejects invalid weights', () => {
    const r = row('test', 100, 100)
    expect(scoreResources([r], prefs)[0].score).toBe(100)
    expect(scoreResources([{ ...r, site: { ...r.site, horizon: undefined } }], prefs)[0].reasons).toContain('Terrain skyline unavailable')
    for (const invalid of [{ target: 0 }, { mineralWeight: 101 }, { minEarth: NaN }]) expect(() => scoreResources([r], { ...prefs, ...invalid })).toThrow()
  })
})
