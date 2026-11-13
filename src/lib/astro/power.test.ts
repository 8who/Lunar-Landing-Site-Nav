import { describe, expect, it } from 'vitest'
import { discFractionAbove } from './observer'
import { buildTimeline } from './timeline'
import { siteById } from './sites'

describe('solar disc above a flat horizon', () => {
  it('is 0, 1/2 and 1 for the disc below, centred on and above the horizon', () => {
    expect(discFractionAbove(-0.3, 0.27)).toBe(0)
    expect(discFractionAbove(0, 0.27)).toBeCloseTo(0.5, 6)
    expect(discFractionAbove(0.3, 0.27)).toBe(1)
  })
  it('grows monotonically as the Sun rises', () => {
    let prev = -1
    for (let e = -0.27; e <= 0.27; e += 0.03) {
      const f = discFractionAbove(e, 0.27)
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
  })
})

describe('polar power', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z')
  const t1 = t0 + 365 * 86_400_000
  it('a vertical tracking array beats a flat panel by >10x at Shackleton', () => {
    const m = buildTimeline(siteById('shackleton')!, t0, t1, 3_600_000).metrics
    expect(m.meanTrackingIncidence).toBeGreaterThan(10 * m.meanSolarIncidence)
    // ~half the year lit with a near-horizontal Sun: ~50% of 1361 W/m^2
    expect(m.meanTrackingFluxWm2).toBeGreaterThan(600)
    expect(m.meanTrackingFluxWm2).toBeLessThan(900)
  })
  it('mean Sun elevation excludes the night', () => {
    const m = buildTimeline(siteById('apollo11')!, t0, t1, 3_600_000).metrics
    // Equatorial site: averaged over daylight only it is ~40 deg, not ~0.
    expect(m.meanSunElevation).toBeGreaterThan(30)
  })
})
