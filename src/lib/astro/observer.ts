/**
 * Sky geometry as seen from a point on the lunar surface.
 *
 * Everything is computed in the lunar body-fixed (selenographic) frame, so the
 * local horizon is simply the plane perpendicular to the site's radius vector.
 *
 * Two geometric subtleties that matter at the Moon:
 *  1. No atmosphere -> the horizon is exactly the local tangent plane (plus
 *     terrain, handled separately). No refraction.
 *  2. The observer is up to 1738 km off the Moon's centre. For Earth that is
 *     ~0.26 deg of parallax, i.e. half of Earth's own apparent diameter. We
 *     therefore use the site position, not the Moon's centre.
 */

import { Body, GeoVector, MakeTime } from 'astronomy-engine'
import { bodyBasis, moonOrientation, toBody, toSelenographic } from './lunarFrame'
import { DEG, RAD, cross, dot, normalize, scale, sub, vec, type Vec3 } from './vec'
import type { LunarSite, SkyDirection, SkySample } from './types'

export const KM_PER_AU = 149_597_870.7
export const MOON_RADIUS_KM = 1737.4
const SUN_RADIUS_KM = 695_700
const EARTH_RADIUS_KM = 6371.0

/** Site radius vector in the body-fixed frame (km). */
export function siteVector(site: LunarSite): Vec3 {
  const r = MOON_RADIUS_KM + (site.elevationM ?? 0) / 1000
  const lat = site.lat * RAD
  const lon = site.lon * RAD
  return vec(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.cos(lat) * Math.sin(lon),
    r * Math.sin(lat),
  )
}

/** Local east/north/up unit vectors of the site, in the body-fixed frame. */
export function localFrame(site: LunarSite) {
  const up = normalize(siteVector(site))
  const lon = site.lon * RAD
  // East = d(up)/d(lon) normalised. Degenerate exactly at the pole, where the
  // prime meridian still gives a well defined direction.
  const east = normalize(vec(-Math.sin(lon), Math.cos(lon), 0))
  const north = cross(up, east)
  return { up, east, north }
}

function direction(vRel: Vec3, frame: ReturnType<typeof localFrame>, radiusKm: number): SkyDirection {
  const u = normalize(vRel)
  const elevation = Math.asin(Math.max(-1, Math.min(1, dot(u, frame.up)))) * DEG
  let azimuth = Math.atan2(dot(u, frame.east), dot(u, frame.north)) * DEG
  if (azimuth < 0) azimuth += 360
  const distanceKm = Math.sqrt(dot(vRel, vRel))
  return {
    elevation,
    azimuth,
    distanceKm,
    angularDiameterDeg: (2 * Math.atan(radiusKm / distanceKm)) * DEG,
  }
}

/**
 * Sub-Earth point: the selenographic coordinates where Earth stands at the
 * zenith. This is exactly the Moon's libration, and it validates the body-fixed
 * frame on its own (Horizons "ObsSub-LON/LAT", quantity 14).
 */
export function subEarthPoint(date: Date | number): { lat: number; lon: number } {
  const t = MakeTime(date instanceof Date ? date : new Date(date))
  const basis = bodyBasis(moonOrientation(t.tt))
  const m = GeoVector(Body.Moon, t, false)
  return toSelenographic(toBody({ x: -m.x, y: -m.y, z: -m.z }, basis))
}

/**
 * Fraction of a disc of angular radius `radiusDeg` that sits above a flat
 * horizon when its centre is at `elevationDeg` (circular-segment area).
 *
 * The Sun is 0.53 deg across. At the poles it skims the horizon for days, so
 * "centre above 0 deg" is the wrong test: half a Sun already powers a panel.
 */
export function discFractionAbove(elevationDeg: number, radiusDeg: number): number {
  if (radiusDeg <= 0) return elevationDeg > 0 ? 1 : 0
  const h = elevationDeg / radiusDeg
  if (h >= 1) return 1
  if (h <= -1) return 0
  return (Math.acos(-h) + h * Math.sqrt(1 - h * h)) / Math.PI
}

/**
 * Geometric horizon dip for an eye `heightM` above a sphere of radius
 * `groundRadiusKm`: acos(R / (R + h)), in degrees. No atmosphere on the Moon,
 * so no refraction correction.
 */
export function horizonDipDeg(heightM: number, groundRadiusKm = MOON_RADIUS_KM): number {
  if (!(heightM > 0)) return 0
  const R = groundRadiusKm
  return Math.acos(R / (R + heightM / 1000)) * DEG
}

/** Mean solar constant at 1 AU, W/m^2 (TSI). */
export const SOLAR_CONSTANT_WM2 = 1361

export interface SiteObserver {
  site: LunarSite
  /** Full Sun + Earth geometry at an instant */
  skyAt(date: Date | number): SkySample
  /** Sun centre elevation only (cheap path for window searches) */
  sunElevation(date: Date | number): number
  /** Any part of the solar disc above the horizon seen from the mast top */
  sunVisible(date: Date | number): boolean
  /** Earth's centre above the horizon seen from the mast top (antenna line of sight) */
  earthVisible(date: Date | number): boolean
  /** Horizon dip at the mast top, deg */
  horizonDipDeg: number
  /** Earth elevation only (cheap path for window searches) */
  earthElevation(date: Date | number): number
}

export function createObserver(site: LunarSite): SiteObserver {
  const frame = localFrame(site)
  const groundRadiusKm = MOON_RADIUS_KM + (site.elevationM ?? 0) / 1000
  const mastM = Math.max(0, site.mastHeightM ?? 0)
  const dip = horizonDipDeg(mastM, groundRadiusKm)
  // Observer sits at the top of the mast.
  const rSite = scale(frame.up, groundRadiusKm + mastM / 1000)

  const relativeVectors = (date: Date | number) => {
    const t = MakeTime(date instanceof Date ? date : new Date(date))
    const basis = bodyBasis(moonOrientation(t.tt))

    const moon = GeoVector(Body.Moon, t, false)
    const sun = GeoVector(Body.Sun, t, false)

    const moonKm = vec(moon.x * KM_PER_AU, moon.y * KM_PER_AU, moon.z * KM_PER_AU)
    const sunKm = vec(sun.x * KM_PER_AU, sun.y * KM_PER_AU, sun.z * KM_PER_AU)

    // Moon -> Earth is simply minus the Moon's geocentric position.
    const earth = sub(toBody({ x: -moonKm.x, y: -moonKm.y, z: -moonKm.z }, basis), rSite)
    const sunRel = sub(
      toBody({ x: sunKm.x - moonKm.x, y: sunKm.y - moonKm.y, z: sunKm.z - moonKm.z }, basis),
      rSite,
    )
    return { sunRel, earthRel: earth }
  }

  const sunElevation = (date: Date | number) => {
    const { sunRel } = relativeVectors(date)
    return Math.asin(Math.max(-1, Math.min(1, dot(normalize(sunRel), frame.up)))) * DEG
  }

  const sunVisible = (date: Date | number) => {
    const { sunRel } = relativeVectors(date)
    const d = Math.sqrt(dot(sunRel, sunRel))
    const elev = Math.asin(Math.max(-1, Math.min(1, dot(normalize(sunRel), frame.up)))) * DEG
    return elev > -dip - Math.atan(SUN_RADIUS_KM / d) * DEG
  }

  const earthVisible = (date: Date | number) => earthElevation(date) > -dip

  const earthElevation = (date: Date | number) => {
    const { earthRel } = relativeVectors(date)
    return Math.asin(Math.max(-1, Math.min(1, dot(normalize(earthRel), frame.up)))) * DEG
  }

  return {
    site,
    sunElevation,
    sunVisible,
    earthVisible,
    horizonDipDeg: dip,
    earthElevation,
    skyAt(date) {
      const { sunRel, earthRel } = relativeVectors(date)
      const sun = direction(sunRel, frame, SUN_RADIUS_KM)
      const earth = direction(earthRel, frame, EARTH_RADIUS_KM)
      return {
        t: (date instanceof Date ? date : new Date(date)).getTime(),
        sun,
        earth,
        horizonDipDeg: dip,
        // Upper limb above the horizon: a partly risen Sun still lights the site.
        sunlit: sun.elevation > -dip - sun.angularDiameterDeg / 2,
        earthVisible: earth.elevation > -dip,
      }
    },
  }
}
