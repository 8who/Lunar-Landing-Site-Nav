import { describe, expect, it } from 'vitest'
import { horizonDipDeg } from './observer'
import { buildTimeline } from './timeline'
import { siteById } from './sites'
import { azimuthDelta, bestFixedPanel, compassPoint16 } from './panel'

const t0 = Date.parse('2026-01-01T00:00:00Z')

describe('mast horizon dip', () => {
  it('matches acos(R/(R+h)): ~0.19 deg at 10 m, 0 at ground level', () => {
    expect(horizonDipDeg(0)).toBe(0)
    expect(horizonDipDeg(10)).toBeCloseTo(0.1944, 3)
    expect(horizonDipDeg(1)).toBeCloseTo(0.0615, 3)
  })
  it('a taller mast never reduces sunlight and lengthens Earth visibility at a polar site', () => {
    const base = siteById('shackleton')!
    const t1 = t0 + 120 * 86_400_000
    const low = buildTimeline({ ...base, mastHeightM: 0 }, t0, t1, 3_600_000).metrics
    const high = buildTimeline({ ...base, mastHeightM: 20 }, t0, t1, 3_600_000).metrics
    expect(high.sunlitPct).toBeGreaterThanOrEqual(low.sunlitPct)
    expect(high.commPct).toBeGreaterThan(low.commPct)
    expect(high.meanTrackingFluxWm2).toBeGreaterThanOrEqual(low.meanTrackingFluxWm2)
  })
  it('samples carry the dip so the fixed-panel search sees the same horizon', () => {
    const tl = buildTimeline({ ...siteById('shackleton')!, mastHeightM: 10 }, t0, t0 + 86_400_000, 3_600_000)
    expect(tl.samples[0].horizonDipDeg).toBeCloseTo(horizonDipDeg(10), 6)
  })
})

describe('array pointing helpers', () => {
  it('names 16 compass points and wraps azimuth differences', () => {
    expect(compassPoint16(0)).toBe('N')
    expect(compassPoint16(359)).toBe('N')
    expect(compassPoint16(135)).toBe('SE')
    expect(compassPoint16(202.5)).toBe('SSW')
    expect(azimuthDelta(350, 10)).toBe(20)
    expect(azimuthDelta(10, 350)).toBe(-20)
  })
  it('a fixed panel at the pole captures far less than tracking but beats a flat deck', () => {
    const tl = buildTimeline(siteById('shackleton')!, t0, t0 + 30 * 86_400_000, 3_600_000)
    const fixed = bestFixedPanel(tl.samples)
    const fixedW = (tl.metrics.meanTrackingFluxWm2 * fixed.capturedPct) / 100
    expect(fixed.capturedPct).toBeLessThan(60)
    expect(fixedW).toBeGreaterThan(tl.metrics.meanFlatFluxWm2)
  })
})
