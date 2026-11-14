import { describe, expect, it } from 'vitest'
import { discVisibility, flatSkyline, segmentFraction, type Skyline } from './disc'

/** A skyline that is `low` everywhere except a wall of height `high` over [from, to] deg. */
const wall = (from: number, to: number, low: number, high: number): Skyline => ({
  at: (az) => {
    const a = ((az % 360) + 360) % 360
    return a >= from && a <= to ? high : low
  },
  min: low,
  max: high,
})

describe('whole-disc visibility', () => {
  it('a level skyline matches the exact circular segment', () => {
    for (const h of [-0.3, -0.1, 0, 0.1, 0.25]) {
      const v = discVisibility(100, h, 0.27, flatSkyline(0))
      expect(v.fraction).toBeCloseTo(segmentFraction(h, 0.27), 12)
      expect(v.marginDeg).toBeCloseTo(h + 0.27, 12)
    }
  })

  it('sees the limb past a ridge that hides the centre', () => {
    // Earth (r = 0.95 deg) centred on azimuth 180, elevation 1 deg. A 3 deg
    // ridge covers azimuths 179.5..180.5: the centre ray is blocked, but both
    // sides of the disc are in the clear.
    const sky = wall(179.5, 180.5, 0, 3)
    const v = discVisibility(180, 1, 0.95, sky)
    expect(1 > sky.at(180)).toBe(false) // a centre-only test would say "hidden"
    expect(v.marginDeg).toBeGreaterThan(0)
    expect(v.fraction).toBeGreaterThan(0.3)
    expect(v.fraction).toBeLessThan(0.9)
  })

  it('hides most of a disc whose centre peeks through a narrow notch', () => {
    // Skyline 3 deg everywhere except a 0.4 deg-wide notch down to 0 at az 90.
    const notch: Skyline = {
      at: (az) => (Math.abs((((az - 90) % 360) + 540) % 360 - 180) <= 0.2 ? 0 : 3),
      min: 0,
      max: 3,
    }
    const v = discVisibility(90, 1, 0.95, notch)
    expect(notch.at(90) < 1).toBe(true) // a centre-only test would say "visible"
    expect(v.marginDeg).toBeGreaterThan(0) // the sliver in the notch is visible
    expect(v.fraction).toBeLessThan(0.3) // but most of the disc is behind rock
  })

  it('is fully visible or fully hidden when clear of the whole skyline', () => {
    const sky = wall(0, 90, 0, 2)
    expect(discVisibility(45, 5, 0.27, sky).fraction).toBe(1)
    expect(discVisibility(45, -1, 0.27, sky)).toEqual({ fraction: 0, marginDeg: -0.73 })
  })
})
