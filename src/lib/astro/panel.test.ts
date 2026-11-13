import { describe, expect, it } from 'vitest'
import {
  bestFixedPanel,
  panelNormal,
  panelNormalSky,
  sunVector,
  tiltArcPoints,
} from './panel'
import { buildTimeline } from './timeline'
import { SITES, customSite } from './sites'
import type { SkySample } from './types'

const HOUR = 3_600_000
const DAY = 86_400_000
const START = Date.parse('2028-01-01T00:00:00Z')

/** Synthetic sky with the Sun fixed at azimuth 90, elevation 30. */
function fixedSunSamples(hours: number): SkySample[] {
  return Array.from({ length: hours + 1 }, (_, i) => ({
    t: START + i * HOUR,
    sun: { elevation: 30, azimuth: 90, distanceKm: 384_400, angularDiameterDeg: 0.52 },
    earth: { elevation: 10, azimuth: 0, distanceKm: 384_400, angularDiameterDeg: 1.9 },
    sunlit: true,
    earthVisible: true,
  }))
}

describe('panelNormal / sunVector', () => {
  it('returns unit vectors', () => {
    for (const [tilt, azimuth] of [
      [0, 0],
      [30, 90],
      [60, 180],
      [90, 270],
    ]) {
      const n = panelNormal(tilt, azimuth)
      expect(Math.hypot(n.e, n.n, n.u)).toBeCloseTo(1, 12)
    }
    for (const [azimuth, elevation] of [
      [0, 0],
      [90, 30],
      [270, -20],
    ]) {
      const s = sunVector(azimuth, elevation)
      expect(Math.hypot(s.e, s.n, s.u)).toBeCloseTo(1, 12)
    }
  })

  it('points east at azimuth 90 and up at tilt 0', () => {
    expect(panelNormal(90, 90).e).toBeCloseTo(1, 12)
    expect(panelNormal(0, 123).u).toBeCloseTo(1, 12)
  })
})

describe('panelNormalSky / tiltArcPoints', () => {
  const dot = (a: { e: number; n: number; u: number }, b: { e: number; n: number; u: number }) =>
    a.e * b.e + a.n * b.n + a.u * b.u

  it('puts a flat panel at the zenith regardless of heading', () => {
    expect(panelNormalSky(0, 123).elevation).toBe(90)
  })

  it('maps a tilt and heading onto sky angles', () => {
    expect(panelNormalSky(60, 90)).toEqual({ azimuth: 90, elevation: 30 })
  })

  it('spans the tilt arc evenly from the zenith to the normal', () => {
    const points = tiltArcPoints(40, 200, 10)
    expect(points).toHaveLength(11)
    expect(points[0].elevation).toBe(90)
    expect(points[10].elevation).toBe(50)
    for (const point of points) expect(point.azimuth).toBe(200)
  })

  it('agrees with the panel normal vector', () => {
    const n = panelNormalSky(35, 140)
    expect(dot(sunVector(n.azimuth, n.elevation), panelNormal(35, 140))).toBeCloseTo(1, 10)
  })
})

describe('bestFixedPanel', () => {
  it('keeps an equatorial panel nearly flat', () => {
    const samples = buildTimeline(customSite(0, 0), START, START + 30 * DAY, HOUR).samples
    const best = bestFixedPanel(samples)
    expect(best.tiltDeg).toBeLessThanOrEqual(8)
    expect(best.capturedPct).toBeGreaterThan(0)
    expect(best.capturedPct).toBeLessThanOrEqual(100)
  })

  it('points a polar panel almost straight up', () => {
    const shackleton = SITES.find((site) => site.id === 'shackleton')
    expect(shackleton).toBeDefined()
    const samples = buildTimeline(shackleton!, START, START + 30 * DAY, HOUR).samples
    const best = bestFixedPanel(samples)
    expect(best.tiltDeg).toBeGreaterThanOrEqual(70)
  })

  it('finds the optimal tilt and heading for a fixed Sun', () => {
    const best = bestFixedPanel(fixedSunSamples(10))
    expect(Math.abs(best.tiltDeg - 60)).toBeLessThanOrEqual(1)
    expect(best.azimuthDeg).toBe(90)
    expect(best.capturedPct).toBeCloseTo(100, 1)
  })

  it('returns zero capture when the Sun never rises', () => {
    const samples: SkySample[] = Array.from({ length: 5 }, (_, i) => ({
      t: START + i * HOUR,
      sun: { elevation: -10, azimuth: 180, distanceKm: 384_400, angularDiameterDeg: 0.52 },
      earth: { elevation: 30, azimuth: 0, distanceKm: 384_400, angularDiameterDeg: 1.9 },
      sunlit: false,
      earthVisible: true,
    }))
    expect(bestFixedPanel(samples)).toEqual({ tiltDeg: 0, azimuthDeg: 0, capturedPct: 0 })
  })
})
