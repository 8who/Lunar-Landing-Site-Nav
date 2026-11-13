import { describe, expect, it } from 'vitest'
import { createObserver, subEarthPoint } from './observer'
import type { LunarSite } from './types'

/**
 * Regression tests against the JPL Horizons system (DE441 ephemerides).
 *
 * Reference values were captured from the Horizons API on 2026-11-13 with:
 *   CENTER='coord@301'  COORD_TYPE='GEODETIC'  SITE_COORD='<east-lon>,<lat>,0'
 *   QUANTITIES='4'      (airless apparent azimuth / elevation, topocentric)
 *
 * Horizons applies light-time, aberration and gravitational deflection; we use
 * geometric J2000 vectors, so a few arcseconds of difference is expected.
 * The tolerance below (0.02 deg) is ~4% of the Sun's apparent diameter.
 */

const EL_TOL = 0.02
const AZ_TOL = 0.05
const DIST_TOL_KM = 100

const site = (lat: number, lon: number): LunarSite => ({
  id: 'test',
  name: 'test site',
  lat,
  lon,
  category: 'custom',
})

interface Case {
  label: string
  site: LunarSite
  time: string
  sun?: { az: number; el: number }
  earth?: { az: number; el: number; distKm?: number }
}

const cases: Case[] = [
  {
    label: 'Apollo 11 site, 2028-01-01T00:00Z',
    site: site(0.674, 23.473),
    time: '2028-01-01T00:00:00Z',
    sun: { az: 90.427201, el: -19.760592 },
    earth: { az: 262.167627, el: 65.042008, distKm: 404_013.86 },
  },
  {
    label: 'Apollo 11 site, 2028-01-01T12:00Z',
    site: site(0.674, 23.473),
    time: '2028-01-01T12:00:00Z',
    earth: { az: 260.933045, el: 64.249434, distKm: 403_975.05 },
  },
  {
    label: 'Shackleton rim, 2028-01-15T00:00Z',
    site: site(-89.66, 129.2),
    time: '2028-01-15T00:00:00Z',
    sun: { az: 194.016547, el: -0.115563 },
    earth: { az: 233.454233, el: -4.037596, distKm: 361_613.57 },
  },
  {
    label: 'Shackleton rim, 2028-01-16T00:00Z',
    site: site(-89.66, 129.2),
    time: '2028-01-16T00:00:00Z',
    sun: { az: 181.882772, el: -0.162739 },
    earth: { az: 234.998156, el: -5.392892, distKm: 365_077.62 },
  },
  {
    // Apollo 11 landing, interpolated between the 20:00 and 20:30 rows.
    label: 'Apollo 11 landing, 1969-07-20T20:17Z',
    site: site(0.674, 23.473),
    time: '1969-07-20T20:17:00Z',
    sun: { az: 88.805408, el: 10.69751 },
  },
]

const angleDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe('sky geometry vs JPL Horizons', () => {
  for (const c of cases) {
    it(c.label, () => {
      const observer = createObserver(c.site)
      const sky = observer.skyAt(Date.parse(c.time))

      if (c.sun) {
        expect(Math.abs(sky.sun.elevation - c.sun.el), 'sun elevation').toBeLessThan(EL_TOL)
        expect(angleDelta(sky.sun.azimuth, c.sun.az), 'sun azimuth').toBeLessThan(AZ_TOL)
      }
      if (c.earth) {
        expect(Math.abs(sky.earth.elevation - c.earth.el), 'earth elevation').toBeLessThan(EL_TOL)
        expect(angleDelta(sky.earth.azimuth, c.earth.az), 'earth azimuth').toBeLessThan(AZ_TOL)
        if (c.earth.distKm) {
          expect(Math.abs(sky.earth.distanceKm - c.earth.distKm), 'earth distance').toBeLessThan(
            DIST_TOL_KM,
          )
        }
      }
    })
  }
})

describe('physical sanity', () => {
  it('matches the Horizons sub-Earth point across a libration cycle', () => {
    // Horizons quantity 14, target 301, observer geocenter (MOON_ME frame).
    const ref: [string, number, number][] = [
      ['2027-12-01T00:00:00Z', 3.474219, 2.523024],
      ['2027-12-11T00:00:00Z', 354.03182, -6.588807],
      ['2027-12-21T00:00:00Z', 4.933296, 6.039597],
      ['2027-12-31T00:00:00Z', 0.245887, -1.330019],
      ['2028-01-10T00:00:00Z', 354.343579, -4.66528],
      ['2028-01-20T00:00:00Z', 7.058309, 6.68557],
      ['2028-01-30T00:00:00Z', 357.003054, -4.736699],
      ['2028-02-09T00:00:00Z', 356.113551, -0.659391],
      ['2028-02-19T00:00:00Z', 7.013833, 4.578342],
      ['2028-02-29T00:00:00Z', 354.714694, -6.571719],
    ]
    for (const [iso, lon, lat] of ref) {
      const got = subEarthPoint(Date.parse(iso))
      expect(Math.abs(got.lat - lat), `lat at ${iso}`).toBeLessThan(0.02)
      expect(angleDelta(((got.lon % 360) + 360) % 360, lon), `lon at ${iso}`).toBeLessThan(0.02)
    }
  })

  it('sub-Earth point stays inside the libration envelope', () => {
    let minLon = Infinity
    let maxLon = -Infinity
    let minLat = Infinity
    let maxLat = -Infinity

    // One sample every 3 days over two years.
    const start = Date.parse('2027-01-01T00:00:00Z')
    for (let t = start; t < start + 730 * 86_400_000; t += 3 * 86_400_000) {
      const { lat, lon } = subEarthPoint(t)
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }

    // Optical + physical libration: about +-8 deg in longitude, +-7 deg in latitude.
    expect(minLat).toBeGreaterThan(-8)
    expect(maxLat).toBeLessThan(8)
    expect(minLon).toBeGreaterThan(-9)
    expect(maxLon).toBeLessThan(9)
    // ...and the pole really is tilted, it is not a smooth sine of zero amplitude.
    expect(maxLat - minLat).toBeGreaterThan(8)
    expect(maxLon - minLon).toBeGreaterThan(10)
  })

  it('sun elevation and earth elevation are bounded', () => {
    const observer = createObserver(site(-84.6, 31.0))
    for (let t = Date.parse('2028-01-01'); t < Date.parse('2028-02-01'); t += 6 * 3_600_000) {
      const sky = observer.skyAt(t)
      expect(Math.abs(sky.sun.elevation)).toBeLessThanOrEqual(90)
      expect(Math.abs(sky.earth.elevation)).toBeLessThanOrEqual(90)
      expect(sky.sun.distanceKm).toBeGreaterThan(146_500_000)
      expect(sky.sun.distanceKm).toBeLessThan(152_500_000)
    }
  })
})
