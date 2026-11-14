import { describe, expect, it } from 'vitest'
import {
  Body,
  EquatorFromVector,
  GeoVector,
  MakeTime,
  RotateVector,
  Rotation_EQJ_EQD,
  SiderealTime,
} from 'astronomy-engine'
import { DSN_STATIONS, dsnStatus, earthAxesInSky, earthFixedUnit } from './earthView'
import { createObserver } from './observer'
import { siteById } from './sites'

const RAD = Math.PI / 180

/** Earth-fixed lat/lon of the point on Earth directly under the site. */
function subSitePoint(siteId: string, t: number) {
  const site = siteById(siteId)!
  const sky = createObserver(site).skyAt(t)
  const el = sky.earth.elevation * RAD
  const az = sky.earth.azimuth * RAD
  // Site -> Earth in ENU; Earth -> site is the opposite.
  const d = { e: -Math.cos(el) * Math.sin(az), n: -Math.cos(el) * Math.cos(az), u: -Math.sin(el) }
  const ax = earthAxesInSky(site, t)
  const comp = (a: { e: number; n: number; u: number }) => a.e * d.e + a.n * d.n + a.u * d.u
  const x = comp(ax.x)
  const y = comp(ax.y)
  const z = comp(ax.z)
  return { lat: Math.asin(z) / RAD, lon: Math.atan2(y, x) / RAD, vec: { x, y, z } }
}

/** Sub-lunar point from astronomy-engine directly: declination and RA - GAST. */
function subLunarPoint(t: number) {
  const time = MakeTime(new Date(t))
  const eqd = RotateVector(Rotation_EQJ_EQD(time), GeoVector(Body.Moon, time, false))
  const eq = EquatorFromVector(eqd)
  let lon = (eq.ra - SiderealTime(time)) * 15
  lon = ((lon + 540) % 360) - 180
  return { lat: eq.dec, lon }
}

describe('Earth orientation seen from a lunar site', () => {
  const times = [
    Date.parse('2026-11-14T00:00:00Z'),
    Date.parse('2026-11-20T07:30:00Z'),
    Date.parse('2027-03-02T18:00:00Z'),
  ]
  for (const id of ['apollo11', 'malapert', 'chandrayaan3']) {
    it(`points the sub-site meridian at the sub-lunar point (${id})`, () => {
      for (const t of times) {
        const a = subSitePoint(id, t)
        const b = subLunarPoint(t)
        // The site sits up to 1737 km off the Moon's centre: <= ~0.3 deg apart.
        expect(Math.abs(a.lat - b.lat)).toBeLessThan(0.4)
        const dLon = ((a.lon - b.lon + 540) % 360) - 180
        expect(Math.abs(dLon)).toBeLessThan(0.4 / Math.cos(b.lat * RAD))
      }
    })
  }

  it('Earth-fixed axes stay orthonormal in the sky frame', () => {
    const ax = earthAxesInSky(siteById('shackleton')!, times[0])
    const d = (p: typeof ax.x, q: typeof ax.x) => p.e * q.e + p.n * q.n + p.u * q.u
    expect(d(ax.x, ax.x)).toBeCloseTo(1, 9)
    expect(d(ax.z, ax.z)).toBeCloseTo(1, 9)
    expect(d(ax.x, ax.y)).toBeCloseTo(0, 9)
    expect(d(ax.y, ax.z)).toBeCloseTo(0, 9)
  })
})

describe('Deep Space Network link', () => {
  it('a station sees the Moon high exactly when it faces the site', () => {
    for (let h = 0; h < 48; h += 3) {
      const t = Date.parse('2026-11-14T00:00:00Z') + h * 3_600_000
      const sub = subSitePoint('apollo11', t).vec
      for (const s of dsnStatus(t, true)) {
        const u = earthFixedUnit(s.station.lat, s.station.lon)
        const facing = u.x * sub.x + u.y * sub.y + u.z * sub.z
        // sin(elevation) ~ cos(angle to the sub-lunar point), within parallax.
        expect(Math.abs(Math.sin(s.moonElevation * RAD) - facing)).toBeLessThan(0.05)
      }
    }
  })

  it('covers ~98% of the time; gaps (Moon < 10 deg at every complex) stay under 2 h', () => {
    let linked = 0
    let gap = 0
    let maxGap = 0
    const steps = 24 * 6 * 30 // 30 days at 10 min
    for (let i = 0; i < steps; i++) {
      const t = Date.parse('2026-11-14T00:00:00Z') + i * 600_000
      if (dsnStatus(t, true).some((s) => s.state === 'link')) {
        linked++
        gap = 0
      } else {
        gap += 10
        maxGap = Math.max(maxGap, gap)
      }
    }
    expect(linked / steps).toBeGreaterThan(0.95)
    expect(maxGap).toBeLessThan(120)
  })

  it('no complex links when Earth is below the site horizon', () => {
    const t = Date.parse('2026-11-14T00:00:00Z')
    expect(dsnStatus(t, false).some((s) => s.state === 'link')).toBe(false)
    expect(DSN_STATIONS).toHaveLength(3)
  })
})

describe('DSN antennas on Earth\'s disc', () => {
  it('places every antenna inside the disc, near the centre when the Moon is overhead there', async () => {
    const { stationSkyPoints, dsnStatus } = await import('./earthView')
    const site = siteById('malapert')!
    const R = Math.PI / 180
    for (let h = 0; h < 48; h += 6) {
      const t = Date.parse('2026-11-14T00:00:00Z') + h * 3_600_000
      const earth = createObserver(site).skyAt(t).earth
      const points = stationSkyPoints(site, t, earth)
      const status = dsnStatus(t, true)
      for (const st of status) {
        const p = points.get(st.station.id)!
        // Angular distance from Earth's centre on the sky.
        const c =
          Math.sin(p.elevation * R) * Math.sin(earth.elevation * R) +
          Math.cos(p.elevation * R) * Math.cos(earth.elevation * R) * Math.cos((p.azimuth - earth.azimuth) * R)
        const sep = Math.acos(Math.min(1, c)) / R
        const radius = earth.angularDiameterDeg / 2
        expect(sep).toBeLessThanOrEqual(radius * 1.001)
        // sin(Moon elevation at the antenna) ~ how close it is to the disc centre.
        const expected = radius * Math.cos(Math.max(0, st.moonElevation) * R)
        if (st.moonElevation > 0) expect(Math.abs(sep - expected)).toBeLessThan(0.05)
      }
    }
  })
})
