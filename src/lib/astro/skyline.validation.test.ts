/**
 * Skyline checks against the real LOLA grid and published south-pole results.
 *
 * - The march must agree with an independent brute-force march (0.1 km steps).
 * - Near the pole the raw equirectangular grid has 17-80 m columns whose noise
 *   reads as cliffs; the horizon must not inherit those spikes.
 * - Crater floors that are permanently shadowed must stay dark; rim and ridge
 *   crests, published at 80-92% sunlit, must come out clearly lit.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildHorizon, horizonAt } from './horizon'
import { elevationAt, isotropicGrid } from './terrain'
import { buildTimeline } from './timeline'
import { siteById } from './sites'
import type { LunarSite } from './types'

const buf = readFileSync(new URL('../../../public/moon-elevation.f32', import.meta.url))
const raw = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
const dem = isotropicGrid(raw)
const R = 1737.4
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

function bruteSkyline(lat: number, lon: number, az: number): number {
  const h0 = elevationAt(dem, lat, lon)
  const p = lat * RAD
  const l = lon * RAD
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]
  const east = [-Math.sin(l), Math.cos(l), 0]
  const north = [-up[2] * east[1], up[2] * east[0], up[0] * east[1] - up[1] * east[0]]
  const t = az * RAD
  let best = -90
  for (let d = 0.1; d <= 400; d += 0.1) {
    const a = d / R
    const v = [0, 1, 2].map(
      (k) => up[k] * Math.cos(a) + (north[k] * Math.cos(t) + east[k] * Math.sin(t)) * Math.sin(a),
    )
    const h = elevationAt(dem, Math.asin(v[2]) * DEG, Math.atan2(v[1], v[0]) * DEG)
    best = Math.max(best, Math.atan2((R + h) * Math.cos(a) - (R + h0), (R + h) * Math.sin(a)) * DEG)
  }
  return best
}

const yearSunlit = (site: LunarSite, mastHeightM = 0) => {
  const t0 = Date.parse('2026-01-01T00:00:00Z')
  const horizon = buildHorizon(raw, site.lat, site.lon, { mastHeightM })
  return buildTimeline({ ...site, horizon }, t0, t0 + 365 * 86_400_000, 3_600_000).metrics.sunlitPct
}

describe('skyline against the LOLA grid', () => {
  it('matches an independent brute-force march within 0.6 deg', () => {
    for (const id of ['connectingridge', 'malapert', 'cabeus', 'apollo11']) {
      const s = siteById(id)!
      const profile = buildHorizon(raw, s.lat, s.lon)
      for (let az = 0; az < 360; az += 30) {
        expect(Math.abs(bruteSkyline(s.lat, s.lon, az) - horizonAt(profile, az))).toBeLessThan(0.6)
      }
    }
  })

  it('does not turn polar column noise into cliffs', () => {
    // The raw grid jumps up to ~300 m between 17 m columns at 89.9 deg S.
    const lastRow = 719 * 1440
    let maxJump = 0
    for (let c = 0; c < 1440; c++) {
      maxJump = Math.max(maxJump, Math.abs(dem[lastRow + ((c + 1) % 1440)] - dem[lastRow + c]))
    }
    expect(maxJump).toBeLessThan(0.02) // km, i.e. < 20 m per column
  })

  it('leaves low-latitude data untouched', () => {
    for (let c = 0; c < 1440; c += 37) expect(dem[360 * 1440 + c]).toBe(raw[360 * 1440 + c])
  })
})

describe('south-pole illumination with terrain', () => {
  it('keeps permanently shadowed floors dark', () => {
    expect(yearSunlit(siteById('cabeus')!)).toBe(0)
    expect(yearSunlit({ id: 'shk', name: 'Shackleton floor', lat: -89.67, lon: 129.78, category: 'custom' })).toBe(0)
  })

  it('lights the rim and ridge crests most of the year (published 80-92% at 2-10 m)', () => {
    for (const id of ['connectingridge', 'shackleton', 'degerlache']) {
      const pct = yearSunlit(siteById(id)!, 10)
      expect(pct).toBeGreaterThan(70)
      expect(pct).toBeLessThan(97)
    }
  })

  it('places the polar candidates on high ground, not on crater floors', () => {
    for (const id of ['connectingridge', 'shackleton', 'degerlache']) {
      const s = siteById(id)!
      expect(elevationAt(dem, s.lat, s.lon)).toBeGreaterThan(1) // km above 1737.4
    }
  })
})
