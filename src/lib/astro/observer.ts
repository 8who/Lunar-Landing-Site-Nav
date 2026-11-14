/**
 * Sky geometry as seen from a point on the lunar surface.
 *
 * Everything is computed in the lunar body-fixed (selenographic) frame, so the
 * local horizon is the plane perpendicular to the site's radius vector, raised
 * or lowered by the terrain skyline when `site.horizon` is present.
 *
 * Three geometric subtleties that matter at the Moon:
 *  1. No atmosphere -> no refraction. The horizon is purely geometric: the
 *     terrain profile from LOLA when available, else the smooth-sphere dip.
 *  2. The observer is up to 1738 km off the Moon's centre. For Earth that is
 *     ~0.26 deg of parallax, i.e. half of Earth's own apparent diameter. We
 *     therefore use the site position, not the Moon's centre.
 *  3. The Sun is 0.53 deg across and skims the horizon at the poles, so
 *     "some of the disc above the skyline" is the meaningful test. Earth uses
 *     its centre, the app's documented convention.
 */

import { Body, GeoVector, MakeTime } from 'astronomy-engine'
import { horizonAt, MOON_RADIUS_KM } from './horizon'
import { discVisibility, flatSkyline, type Skyline } from './disc'
import { bodyBasis, moonOrientation, toBody, toSelenographic } from './lunarFrame'
import { DEG, RAD, cross, dot, normalize, scale, sub, vec, type Vec3 } from './vec'
import type { LunarSite, SkyDirection, SkySample } from './types'

export { MOON_RADIUS_KM }

export const KM_PER_AU = 149_597_870.7
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
 * so no refraction correction. This is the flat-ground fallback: with a
 * terrain profile the skyline replaces it.
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
  /** Any part of the solar disc above the skyline seen from the mast top */
  sunVisible(date: Date | number): boolean
  /** Any part of Earth's disc above the skyline seen from the mast top */
  earthVisible(date: Date | number): boolean
  /** The skyline every disc test uses (terrain, or the flat dip) */
  skyline: Skyline
  /** Flat-model horizon dip at the mast top, deg (for the mast readout) */
  horizonDipDeg: number
  /** Horizon elevation towards a compass azimuth, deg (terrain or flat) */
  horizonElevation(azimuthDeg: number): number
  /** Earth elevation only (cheap path for window searches) */
  earthElevation(date: Date | number): number
}

export function createObserver(site: LunarSite): SiteObserver {
  // The LOLA grid sets the ground when a terrain profile is attached: the
  // profile and the sky then share one datum. Without it, use the catalogue
  // elevation and the flat-horizon dip.
  const terrain = site.horizon
  const elevationM = terrain ? terrain.groundElevationM : (site.elevationM ?? 0)
  const frame = localFrame({ ...site, elevationM })
  const groundRadiusKm = MOON_RADIUS_KM + elevationM / 1000
  const mastM = Math.max(0, site.mastHeightM ?? 0)
  const dip = horizonDipDeg(mastM, groundRadiusKm)
  // Observer sits at the top of the mast.
  const rSite = scale(frame.up, groundRadiusKm + mastM / 1000)

  const horizonElevation = (azimuthDeg: number) =>
    terrain ? horizonAt(terrain, azimuthDeg) : -dip
  const skyline: Skyline = terrain
    ? {
        at: horizonElevation,
        min: Math.min(...Array.from(terrain.elevations)),
        max: Math.max(...Array.from(terrain.elevations)),
      }
    : flatSkyline(-dip)

  /** Whole-disc visibility of a body at `rel` (km, site -> body), radius `radiusKm`. */
  const discOf = (rel: Vec3, radiusKm: number) => {
    const u = normalize(rel)
    const d = Math.sqrt(dot(rel, rel))
    const elev = Math.asin(Math.max(-1, Math.min(1, dot(u, frame.up)))) * DEG
    return discVisibility(azimuthOf(u, frame), elev, Math.atan(radiusKm / d) * DEG, skyline)
  }

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

  // Visible means some part of the disc clears the skyline at its own azimuth,
  // not just the centre (see disc.ts).
  const sunVisible = (date: Date | number) =>
    discOf(relativeVectors(date).sunRel, SUN_RADIUS_KM).marginDeg > 0

  const earthVisible = (date: Date | number) =>
    discOf(relativeVectors(date).earthRel, EARTH_RADIUS_KM).marginDeg > 0

  const earthElevation = (date: Date | number) => {
    const { earthRel } = relativeVectors(date)
    return Math.asin(Math.max(-1, Math.min(1, dot(normalize(earthRel), frame.up)))) * DEG
  }

  return {
    site,
    sunElevation,
    sunVisible,
    earthVisible,
    skyline,
    horizonDipDeg: dip,
    horizonElevation,
    earthElevation,
    skyAt(date) {
      const { sunRel, earthRel } = relativeVectors(date)
      const sun = direction(sunRel, frame, SUN_RADIUS_KM)
      const earth = direction(earthRel, frame, EARTH_RADIUS_KM)
      const sunHorizon = horizonElevation(sun.azimuth)
      const earthHorizon = horizonElevation(earth.azimuth)
      const sunDisc = discOf(sunRel, SUN_RADIUS_KM)
      const earthDisc = discOf(earthRel, EARTH_RADIUS_KM)
      return {
        t: (date instanceof Date ? date : new Date(date)).getTime(),
        sun: {
          ...sun,
          horizonDeg: sunHorizon,
          visibleFraction: sunDisc.fraction,
          marginDeg: sunDisc.marginDeg,
        },
        earth: {
          ...earth,
          horizonDeg: earthHorizon,
          visibleFraction: earthDisc.fraction,
          marginDeg: earthDisc.marginDeg,
        },
        horizonDipDeg: terrain ? undefined : dip,
        // Any part of the disc above the skyline: a partly risen Sun still
        // lights the site, and a sliver of Earth still gives line of sight.
        sunlit: sunDisc.marginDeg > 0,
        earthVisible: earthDisc.marginDeg > 0,
      }
    },
  }
}

/** Compass azimuth of a unit vector in the local frame, deg from north. */
function azimuthOf(u: Vec3, frame: ReturnType<typeof localFrame>): number {
  const azimuth = Math.atan2(dot(u, frame.east), dot(u, frame.north)) * DEG
  return azimuth < 0 ? azimuth + 360 : azimuth
}
