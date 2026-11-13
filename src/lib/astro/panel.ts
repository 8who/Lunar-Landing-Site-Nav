/**
 * Solar-panel geometry and the best fixed orientation for a sample range.
 *
 * Directions live in the local east/north/up frame of the site, the same frame
 * used by SkyDirection (azimuth 0 = north, 90 = east).
 */

import { discFractionAbove, type SiteObserver } from './observer'
import type { SkySample } from './types'

export interface PanelVector {
  e: number
  n: number
  u: number
}

const DEG = Math.PI / 180
const TILT_STEPS = 91 // 0..90 degrees
const AZIMUTH_STEPS = 36 // 0..350 degrees, 10 degree steps
const AZIMUTH_STEP_DEG = 360 / AZIMUTH_STEPS

/** Unit normal of a panel tilted from horizontal towards a compass azimuth. */
export function panelNormal(tiltDeg: number, azimuthDeg: number): PanelVector {
  const tilt = tiltDeg * DEG
  const az = azimuthDeg * DEG
  const sinTilt = Math.sin(tilt)
  return {
    e: sinTilt * Math.sin(az),
    n: sinTilt * Math.cos(az),
    u: Math.cos(tilt),
  }
}

export interface SkyAngles {
  azimuth: number
  elevation: number
}

/**
 * Sky position of the panel normal. A panel tilted `tiltDeg` from horizontal
 * has its normal at elevation 90 - tilt, towards the panel heading.
 */
export function panelNormalSky(tiltDeg: number, azimuthDeg: number): SkyAngles {
  return { azimuth: tiltDeg === 0 ? 0 : azimuthDeg, elevation: 90 - tiltDeg }
}

/**
 * Points along the vertical great circle at `azimuthDeg`, from the zenith down
 * to the panel normal, evenly spaced in elevation. A flat panel is the zenith.
 */
export function tiltArcPoints(tiltDeg: number, azimuthDeg: number, steps = 24): SkyAngles[] {
  if (tiltDeg === 0) return [{ azimuth: 0, elevation: 90 }]
  const count = Math.max(1, Math.floor(steps))
  const points: SkyAngles[] = []
  for (let i = 0; i <= count; i++) {
    points.push({ azimuth: azimuthDeg, elevation: 90 - (tiltDeg * i) / count })
  }
  return points
}

/** Unit vector towards the Sun for a compass azimuth and elevation. */
export function sunVector(azimuthDeg: number, elevationDeg: number): PanelVector {
  const elevation = elevationDeg * DEG
  const az = azimuthDeg * DEG
  const cosEl = Math.cos(elevation)
  return {
    e: cosEl * Math.sin(az),
    n: cosEl * Math.cos(az),
    u: Math.sin(elevation),
  }
}

/**
 * Best fixed panel for a range of sky samples.
 *
 * The score is the time integral of max(0, normal . Sun), i.e. the relative
 * energy a fixed panel would collect. Dividing by the Sun-up duration gives a
 * percentage of what a perfectly Sun-tracking panel would collect.
 */
export function bestFixedPanel(samples: SkySample[]): {
  tiltDeg: number
  azimuthDeg: number
  capturedPct: number
} {
  const count = samples.length
  if (count < 2) return { tiltDeg: 0, azimuthDeg: 0, capturedPct: 0 }

  // Precompute one Sun vector and duration per Sun-up interval, so the search
  // below only does arithmetic on flat arrays.
  const east = new Float64Array(count - 1)
  const north = new Float64Array(count - 1)
  const up = new Float64Array(count - 1)
  const weight = new Float64Array(count - 1)
  let intervals = 0
  let sunUpMs = 0

  for (let i = 0; i < count - 1; i++) {
    const a = samples[i]
    const b = samples[i + 1]
    const dt = b.t - a.t
    if (!(dt > 0)) continue
    const midElevation = (a.sun.elevation + b.sun.elevation) / 2
    // Same limb criterion as timeline: the Sun counts while any part of its
    // disc is above the flat horizon, and a partial disc contributes pro rata.
    const rSun = (a.sun.angularDiameterDeg + b.sun.angularDiameterDeg) / 4
    // A mast lowers the horizon: the Sun is visible down to -dip.
    const dip = a.horizonDipDeg ?? 0
    const visible = discFractionAbove(midElevation + dip, rSun)
    if (visible <= 0) continue

    // Shortest signed azimuth step, so a pair straddling north interpolates
    // through 0/360 rather than through the far side of the compass.
    const rawDelta = b.sun.azimuth - a.sun.azimuth
    const delta = ((rawDelta + 540) % 360) - 180
    const midAzimuth = a.sun.azimuth + delta / 2
    const sun = sunVector(midAzimuth, midElevation)

    east[intervals] = sun.e
    north[intervals] = sun.n
    up[intervals] = sun.u
    weight[intervals] = dt * visible
    sunUpMs += dt * visible
    intervals++
  }

  if (intervals === 0 || sunUpMs <= 0) {
    return { tiltDeg: 0, azimuthDeg: 0, capturedPct: 0 }
  }

  const sinAz = new Float64Array(AZIMUTH_STEPS)
  const cosAz = new Float64Array(AZIMUTH_STEPS)
  for (let a = 0; a < AZIMUTH_STEPS; a++) {
    const az = a * AZIMUTH_STEP_DEG * DEG
    sinAz[a] = Math.sin(az)
    cosAz[a] = Math.cos(az)
  }

  let bestSum = -1
  let bestTilt = 0
  let bestAzimuth = 0

  for (let tilt = 0; tilt < TILT_STEPS; tilt++) {
    const tiltRad = tilt * DEG
    const sinTilt = Math.sin(tiltRad)
    const cosTilt = Math.cos(tiltRad)

    for (let a = 0; a < AZIMUTH_STEPS; a++) {
      const se = sinTilt * sinAz[a]
      const sn = sinTilt * cosAz[a]
      let sum = 0
      for (let i = 0; i < intervals; i++) {
        const dot = se * east[i] + sn * north[i] + cosTilt * up[i]
        if (dot > 0) sum += weight[i] * dot
      }
      if (sum > bestSum) {
        bestSum = sum
        bestTilt = tilt
        bestAzimuth = a * AZIMUTH_STEP_DEG
      }
    }
  }

  return {
    tiltDeg: bestTilt,
    // A flat panel has no meaningful heading.
    azimuthDeg: bestTilt === 0 ? 0 : bestAzimuth,
    capturedPct: Math.round((bestSum / sunUpMs) * 1000) / 10,
  }
}

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** 16-point compass label for an azimuth measured clockwise from north. */
export function compassPoint16(azimuthDeg: number): string {
  const a = ((azimuthDeg % 360) + 360) % 360
  return COMPASS_16[Math.round(a / 22.5) % 16]
}

/** Signed smallest difference b - a between two azimuths, deg in (-180, 180]. */
export function azimuthDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360
  if (d > 180) d -= 360
  return d
}

export interface TrackingPointing {
  /** Whether any part of the Sun is up (as seen from the mast top) */
  sunUp: boolean
  /** Panel tilt from horizontal to face the Sun, deg (90 = vertical) */
  tiltDeg: number
  /** Heading the panel must face, deg from north clockwise */
  azimuthDeg: number
  /** Azimuth rate a Sun-tracking panel needs, deg/h (+ = clockwise) */
  turnRateDegPerHour: number
}

/**
 * Pointing of a Sun-tracking panel at the sample's instant. At the poles the
 * Sun stays within ~1.5 deg of the horizon, so the panel is nearly vertical and
 * only turns in azimuth, ~360 deg per lunar day (~0.5 deg/h).
 */
export function trackingPointing(observer: SiteObserver, sample: SkySample): TrackingPointing {
  const halfHour = 1_800_000
  const before = observer.skyAt(sample.t - halfHour).sun.azimuth
  const after = observer.skyAt(sample.t + halfHour).sun.azimuth
  return {
    sunUp: sample.sunlit,
    tiltDeg: 90 - Math.max(0, sample.sun.elevation),
    azimuthDeg: sample.sun.azimuth,
    turnRateDegPerHour: azimuthDelta(before, after),
  }
}
