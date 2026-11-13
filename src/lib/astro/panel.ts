/**
 * Solar-panel geometry and the best fixed orientation for a sample range.
 *
 * Directions live in the local east/north/up frame of the site, the same frame
 * used by SkyDirection (azimuth 0 = north, 90 = east).
 */

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
    if (midElevation <= 0) continue

    // Shortest signed azimuth step, so a pair straddling north interpolates
    // through 0/360 rather than through the far side of the compass.
    const rawDelta = b.sun.azimuth - a.sun.azimuth
    const delta = ((rawDelta + 540) % 360) - 180
    const midAzimuth = a.sun.azimuth + delta / 2
    const sun = sunVector(midAzimuth, midElevation)

    east[intervals] = sun.e
    north[intervals] = sun.n
    up[intervals] = sun.u
    weight[intervals] = dt
    sunUpMs += dt
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
