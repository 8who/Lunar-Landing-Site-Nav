import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chooseAlternatives, type AlternativeSearch } from './siteAlternatives'
import { SITES } from './astro/sites'
import { buildTimeline } from './astro/timeline'
import { parseMineralDataset } from './resources/minerals'
import type { RankedSite } from './astro/ranking'

const t0 = Date.parse('2028-01-01T00:00:00Z')
const t1 = t0 + 30 * 86_400_000
const candidates = SITES.filter((s) => s.category === 'candidate')
const metrics = buildTimeline(candidates[0], t0, t0 + 86_400_000, 3_600_000).metrics
function row(index: number, sun = 70, earth = 70, joint = 60): RankedSite {
  return { site: { ...candidates[index], horizon: { elevations: new Float32Array(120), stepDeg: 3, groundElevationM: 0, eyeHeightM: 2, maxElevationDeg: 0, maxAzimuthDeg: 0, maxDistanceKm: 0, source: 'test', cellKm: 7.6 } }, metrics: { ...metrics, sunlitPct: sun, commPct: earth, jointPct: joint } }
}

describe('criteria-preserving landing alternatives', () => {
  it('returns at most three closest matches and excludes the selected location', () => {
    const selected = row(0)
    const sameCoordinates = { ...row(1), site: { ...selected.site, id: 'coordinate-alias' } }
    const rows = [selected, sameCoordinates, row(1, 72), row(2, 75), row(3, 80), row(4, 85), row(5, 0, 0, 0)]
    const result = chooseAlternatives(rows, selected, null)
    expect(result.map((r) => r.site.id)).toEqual([candidates[1].id, candidates[2].id, candidates[3].id])
  })
  it('does not pad empty or short results with dissimilar or terrainless sites', () => {
    const selected = row(0)
    const noTerrain = { ...row(1), site: { ...row(1).site, horizon: undefined } }
    expect(chooseAlternatives([selected, row(2, 95), noTerrain], selected, null)).toEqual([])
    expect(chooseAlternatives([selected, row(1), row(2, 95)], selected, null)).toHaveLength(1)
  })
  it('requires every saved calendar percentage constraint', () => {
    const selected = row(0)
    const search: AlternativeSearch = { kind: 'calendar', t0, t1, constraints: { minSunlitPct: 80, minCommPct: 70, minJointPct: 60 } }
    const result = chooseAlternatives([selected, row(1, 85, 75, 65), row(2, 90, 60, 60), row(3, 79, 80, 70)], selected, search)
    expect(result.map((r) => r.site.id)).toEqual([candidates[1].id])
  })
  it('does not substitute similar percentages for a requested uninterrupted operation', () => {
    const selected = row(0, 100, 100, 100)
    const search: AlternativeSearch = { kind: 'continuous', t0, t1: t0 + 24 * 3_600_000, hours: 24 }
    const result = chooseAlternatives([selected, row(1, 100, 100, 100), row(2, 100, 100, 99.9)], selected, search)
    expect(result.map((r) => r.site.id)).toEqual([candidates[1].id])
  })
  it('preserves resource feasibility gates and returns no resource suggestions without source data', () => {
    const dataset = parseMineralDataset(JSON.parse(new TextDecoder().decode(readFileSync(new URL('../../public/resources/lp-south-pole.json', import.meta.url)))))
    const search: AlternativeSearch = { kind: 'resources', t0, t1, mineral: 'titanium', radiusKm: 0, preferences: { mineralWeight: 50, target: 1, minSun: 80, minEarth: 60, minJoint: 50 } }
    const selected = row(0, 90, 90, 80)
    const rows = [selected, row(1, 50), row(2, 90, 90, 80), row(3, 90, 40), row(4, 90, 90, 80)]
    const result = chooseAlternatives(rows, selected, search, dataset)
    expect(result.map((r) => r.site.id).sort()).toEqual([candidates[2].id, candidates[4].id].sort())
    expect(result.every((r) => r.resourceValue !== undefined && r.score !== undefined)).toBe(true)
    expect(chooseAlternatives(rows, selected, search)).toEqual([])
  })
})
