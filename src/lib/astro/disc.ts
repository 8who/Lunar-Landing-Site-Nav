/**
 * Visibility of a whole disc (Sun or Earth) against an arbitrary skyline.
 *
 * Testing only the line from the site to the body's centre is wrong in both
 * directions: the Sun is 0.53 deg and Earth ~1.9 deg across, and at the poles
 * the skyline itself can change by more than that across the disc. A ridge can
 * hide the centre while the limb still shines past it, or a notch can show the
 * centre while most of the disc is behind rock.
 *
 * The disc is therefore sampled over its full area (equal-area sunflower
 * points) plus a dense ring on the limb, and every point is compared with the
 * skyline at its own azimuth:
 *   - `fraction`: share of the disc area above the skyline (power, brightness);
 *   - `marginDeg`: how far the highest visible point clears the skyline. It is
 *     > 0 exactly when some part of the disc is visible, and varies smoothly in
 *     time, so horizon crossings can be interpolated from it.
 */

const RAD = Math.PI / 180
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** Equal-area interior samples (unit disc). */
const AREA_SAMPLES = 96
/** Points on the limb: the first and last parts of a disc to clear a skyline. */
const LIMB_SAMPLES = 48

/** Offsets in units of the disc radius: x towards increasing azimuth, y up. */
const AREA: ReadonlyArray<readonly [number, number]> = Array.from({ length: AREA_SAMPLES }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / AREA_SAMPLES)
  const a = i * GOLDEN
  return [r * Math.cos(a), r * Math.sin(a)] as const
})
const LIMB: ReadonlyArray<readonly [number, number]> = Array.from({ length: LIMB_SAMPLES }, (_, i) => {
  const a = (2 * Math.PI * i) / LIMB_SAMPLES
  return [Math.cos(a), Math.sin(a)] as const
})

export interface DiscVisibility {
  /** Share of the disc area above the skyline, 0..1 */
  fraction: number
  /** Highest (point elevation - skyline at that point's azimuth), deg; > 0 iff any part is visible */
  marginDeg: number
}

export interface Skyline {
  /** Skyline elevation at a compass azimuth, deg */
  at(azimuthDeg: number): number
  /** Lowest and highest skyline anywhere, deg: lets clear-cut cases skip sampling */
  min: number
  max: number
}

/**
 * Visible share and clearance of a disc centred at (azimuth, elevation) with
 * angular radius `radiusDeg`, against `skyline`.
 */
export function discVisibility(
  azimuthDeg: number,
  elevationDeg: number,
  radiusDeg: number,
  skyline: Skyline,
): DiscVisibility {
  const top = elevationDeg + radiusDeg
  const bottom = elevationDeg - radiusDeg
  // A level skyline has an exact answer: a circular segment.
  if (skyline.min === skyline.max) {
    return { fraction: segmentFraction(elevationDeg - skyline.min, radiusDeg), marginDeg: top - skyline.min }
  }
  // Entirely above the highest or below the lowest skyline: no sampling needed.
  if (bottom >= skyline.max) return { fraction: 1, marginDeg: top - skyline.max }
  if (top <= skyline.min) return { fraction: 0, marginDeg: top - skyline.min }

  // A horizontal offset of r on the sky is r / cos(el) of azimuth. Clamp so a
  // disc near the zenith does not wrap all the way round the compass.
  const azScale = 1 / Math.max(0.05, Math.cos(elevationDeg * RAD))
  const pointMargin = (x: number, y: number) => {
    const el = elevationDeg + y * radiusDeg
    const az = azimuthDeg + x * radiusDeg * azScale
    return el - skyline.at(az)
  }

  let above = 0
  let margin = -Infinity
  for (const [x, y] of AREA) {
    const m = pointMargin(x, y)
    if (m > 0) above++
    if (m > margin) margin = m
  }
  for (const [x, y] of LIMB) {
    const m = pointMargin(x, y)
    if (m > margin) margin = m
  }
  return { fraction: above / AREA_SAMPLES, marginDeg: margin }
}

/** Share of a disc above a level line `heightDeg` below its centre's elevation. */
export function segmentFraction(heightDeg: number, radiusDeg: number): number {
  if (radiusDeg <= 0) return heightDeg > 0 ? 1 : 0
  const h = heightDeg / radiusDeg
  if (h >= 1) return 1
  if (h <= -1) return 0
  return (Math.acos(-h) + h * Math.sqrt(1 - h * h)) / Math.PI
}

/** A flat skyline at a fixed elevation (the smooth-sphere horizon). */
export function flatSkyline(elevationDeg: number): Skyline {
  return { at: () => elevationDeg, min: elevationDeg, max: elevationDeg }
}
