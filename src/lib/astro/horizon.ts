import { elevationAt, isotropicGrid } from './terrain'
import type { HorizonProfile } from './types'

/**
 * Terrain horizon from the global LOLA elevation grid.
 *
 * The flat model treats the horizon as the local tangent plane: a site is lit
 * while the Sun's upper limb is above -dip, where dip only depends on the mast.
 * That is wrong wherever relief matters. At the poles the Sun and Earth skim
 * the horizon for days, so a crater rim two degrees high decides whether the
 * site is lit at all.
 *
 * The march here is exact for a spherical Moon. For a point at arc distance d,
 * radius Rp, seen from an eye at radius Re, the elevation angle above the eye's
 * horizontal is
 *
 *   theta = atan2(Rp cos(d/R) - Re, Rp sin(d/R))
 *
 * which contains the curvature drop (a ridge at the same height as the eye is
 * below the horizontal once it is far enough away) without any small-angle
 * approximation. Angles are therefore in the same frame as the Sun and Earth
 * elevations from observer.ts: degrees above the local horizontal at the eye.
 */

/** Reference sphere shared with terrain.ts and observer.ts. */
export const MOON_RADIUS_KM = 1737.4

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** 3 deg bins: finer than the 0.25 deg grid can justify at a useful range. */
export const HORIZON_BINS = 120

/** Highest terrain above the reference sphere, km: a safe early-exit bound. */
const MAX_TERRAIN_KM = 12

export interface HorizonOptions {
  /** Eye height above the ground, m. Same convention as `mastHeightM`. */
  mastHeightM?: number
  /** Azimuth bins; 120 = 3 deg. Rounded to at least 8. */
  bins?: number
  /** Give up looking beyond this arc distance, km. */
  maxDistanceKm?: number
}

/**
 * Radial step, km. Below the 7.6 km DEM cell so a ridge is never skipped whole,
 * and coarser with distance where the grid itself is the limit.
 */
function marchStepKm(distanceKm: number): number {
  if (distanceKm < 8) return 0.25
  if (distanceKm < 40) return 1
  if (distanceKm < 120) return 2
  return 4
}

/**
 * Horizon elevation in every direction from a surface point.
 *
 * Uses the observer's local frame, so it is stable at the poles (a lat/lon
 * "destination point" formula degenerates to atan2(0, 0) exactly at 90 deg).
 */
export function buildHorizon(
  grid: Float32Array,
  lat: number,
  lon: number,
  opts: HorizonOptions = {},
): HorizonProfile {
  const bins = Math.max(8, Math.round(opts.bins ?? HORIZON_BINS))
  const stepDeg = 360 / bins
  const mastM = Math.max(0, opts.mastHeightM ?? 0)
  const limitKm = Math.max(10, opts.maxDistanceKm ?? 400)
  // Isotropic copy: near the poles the raw columns are tens of metres wide and
  // their noise would read as cliffs (see isotropicGrid).
  const dem = isotropicGrid(grid)

  // Ground and eye in the same datum as the sky elevations: radius above the
  // 1737.4 km sphere. The grid, not a catalogue figure, sets the ground here,
  // so the profile and the sky can never disagree about the datum.
  const groundElevationM = elevationAt(dem, lat, lon) * 1000
  const eyeRadiusKm = MOON_RADIUS_KM + groundElevationM / 1000 + mastM / 1000
  // The highest point on the Moon bounds any sample: if even that cannot beat
  // the running maximum, the rest of this azimuth is settled.
  const farRadiusKm = MOON_RADIUS_KM + MAX_TERRAIN_KM

  // Local east/north/up at the site, matching localFrame() in observer.ts.
  const phi = lat * RAD
  const lam = lon * RAD
  const upX = Math.cos(phi) * Math.cos(lam)
  const upY = Math.cos(phi) * Math.sin(lam)
  const upZ = Math.sin(phi)
  const eastX = -Math.sin(lam)
  const eastY = Math.cos(lam)
  const eastZ = 0
  // north = up x east
  const northX = upY * 0 - upZ * eastY
  const northY = upZ * eastX - upX * 0
  const northZ = upX * eastY - upY * eastX

  const elevations = new Float32Array(bins)
  let maxElevationDeg = -90
  let maxAzimuthDeg = 0
  let maxDistanceKmAtMax = 0

  for (let bin = 0; bin < bins; bin++) {
    const az = bin * stepDeg
    const theta = az * RAD
    const sinT = Math.sin(theta)
    const cosT = Math.cos(theta)
    let top = -90
    let topDistanceKm = 0

    for (let d = marchStepKm(0); d <= limitKm; d += marchStepKm(d)) {
      const arc = d / MOON_RADIUS_KM
      const cosArc = Math.cos(arc)
      const sinArc = Math.sin(arc)

      // Best elevation any terrain could reach at or beyond this distance.
      // Once that falls below the running maximum, no further sample can win.
      const bound = Math.atan2(farRadiusKm * cosArc - eyeRadiusKm, farRadiusKm * sinArc) * DEG
      if (bound <= top) break

      // Point on the ground at this azimuth and arc distance, in body-fixed
      // coordinates, then back to selenographic lat/lon for the grid lookup.
      const dirX = upX * cosArc + (northX * cosT + eastX * sinT) * sinArc
      const dirY = upY * cosArc + (northY * cosT + eastY * sinT) * sinArc
      const dirZ = upZ * cosArc + (northZ * cosT + eastZ * sinT) * sinArc
      const pointLat = Math.asin(Math.max(-1, Math.min(1, dirZ))) * DEG
      const pointLon = Math.atan2(dirY, dirX) * DEG
      const pointRadiusKm = MOON_RADIUS_KM + elevationAt(dem, pointLat, pointLon)

      const elevationDeg =
        Math.atan2(pointRadiusKm * cosArc - eyeRadiusKm, pointRadiusKm * sinArc) * DEG
      if (elevationDeg > top) {
        top = elevationDeg
        topDistanceKm = d
      }
    }

    elevations[bin] = top
    if (top > maxElevationDeg) {
      maxElevationDeg = top
      maxAzimuthDeg = az
      maxDistanceKmAtMax = topDistanceKm
    }
  }

  return {
    stepDeg,
    elevations,
    groundElevationM,
    eyeHeightM: mastM,
    maxElevationDeg,
    maxAzimuthDeg,
    maxDistanceKm: maxDistanceKmAtMax,
    source: 'NASA SVS LOLA ldem_4 · 0.25° grid (7.6 km north–south)',
    cellKm: 7.6,
  }
}

/**
 * Horizon elevation at an arbitrary azimuth, linearly interpolated between
 * bins and wrapping through north. Missing bins degrade to the flat horizon.
 */
export function horizonAt(profile: HorizonProfile, azimuthDeg: number): number {
  const bins = profile.elevations.length
  if (bins === 0 || !(profile.stepDeg > 0)) return 0
  const wrapped = ((azimuthDeg % 360) + 360) % 360
  const x = wrapped / profile.stepDeg
  const i0 = Math.floor(x) % bins
  const i1 = (i0 + 1) % bins
  const fraction = x - Math.floor(x)
  return profile.elevations[i0] * (1 - fraction) + profile.elevations[i1] * fraction
}
