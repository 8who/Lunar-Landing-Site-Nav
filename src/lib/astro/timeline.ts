import { KM_PER_AU, SOLAR_CONSTANT_WM2, createObserver, discFractionAbove, type SiteObserver } from './observer'
import type { LunarSite, SkySample, TimelineMetrics, TimeWindow } from './types'

const MIN = 60_000
const HOUR = 3_600_000

export const RANGE_PRESETS = [
  { id: '7d', label: '7 days', ms: 7 * 24 * HOUR },
  { id: '29d', label: '1 lunar day', ms: 29.53 * 24 * HOUR },
  { id: '90d', label: '90 days', ms: 90 * 24 * HOUR },
  { id: '365d', label: '1 year', ms: 365 * 24 * HOUR },
] as const

/**
 * Sample the sky along [t0, t1]. The step is clamped so we never generate an
 * absurd number of points for a one-year range (chart still gets ~2000 pts).
 */
export function sampleRange(
  observer: SiteObserver,
  t0: number,
  t1: number,
  stepMs: number,
  maxSamples = 2400,
): SkySample[] {
  const span = Math.max(1, t1 - t0)
  const step = Math.max(stepMs, span / maxSamples)
  const out: SkySample[] = []
  for (let t = t0; t <= t1 + 1; t += step) {
    out.push(observer.skyAt(t))
  }
  // Always include the exact end of the range.
  if (out.length === 0 || out[out.length - 1].t < t1) out.push(observer.skyAt(t1))
  return out
}

/**
 * Turn a boolean predicate into closed/open intervals over [t0, t1].
 * Boundaries are refined by bisection so the reported times are good to ~1 s.
 */
export function findWindows(
  isOn: (t: number) => boolean,
  t0: number,
  t1: number,
  stepMs: number,
): TimeWindow[] {
  // Never scan finer than the requested step, and never much finer than the
  // range needs (4000 probes max). Edges are bisection-refined below, so a
  // coarse scan does not cost precision.
  const step = Math.max(stepMs, (t1 - t0) / 4000, 1000)
  const refine = (a: number, b: number, aOn: boolean) => {
    let lo = a
    let hi = b
    for (let i = 0; i < 40 && hi - lo > 1000; i++) {
      const mid = (lo + hi) / 2
      if (isOn(mid) === aOn) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }

  const windows: TimeWindow[] = []
  let start = isOn(t0) ? t0 : null
  let prevT = t0
  let prevOn = isOn(t0)

  for (let probe = t0 + step; prevT < t1; probe += step) {
    const t = Math.min(probe, t1)
    const on = isOn(t)
    if (on !== prevOn) {
      const crossing = refine(prevT, t, prevOn)
      if (on) {
        start = crossing
      } else if (start !== null) {
        windows.push({ start, end: crossing, durationMs: crossing - start, closed: true })
        start = null
      }
    }
    prevOn = on
    prevT = t
  }

  if (start !== null) {
    windows.push({ start, end: t1, durationMs: t1 - start, closed: false })
  }
  return windows
}

const longest = (windows: TimeWindow[]) =>
  windows.reduce((m, w) => Math.max(m, w.durationMs), 0)

/** First transition of `isOn` between t0 and t1, or undefined. */
function firstCrossing(
  isOn: (t: number) => boolean,
  t0: number,
  t1: number,
  stepMs: number,
  want: boolean,
): number | undefined {
  const step = Math.max(stepMs, (t1 - t0) / 2000, 1000)
  let prev = isOn(t0)
  for (let t = t0 + step; t <= t1; t += step) {
    const on = isOn(t)
    if (on !== prev && on === want) {
      let lo = t - step
      let hi = t
      for (let i = 0; i < 40 && hi - lo > 1000; i++) {
        const mid = (lo + hi) / 2
        if (isOn(mid) === prev) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    prev = on
  }
  return undefined
}

export interface TimelineResult {
  samples: SkySample[]
  sunWindows: TimeWindow[]
  commWindows: TimeWindow[]
  jointWindows: TimeWindow[]
  metrics: TimelineMetrics
}

export function buildTimeline(
  site: LunarSite,
  t0: number,
  t1: number,
  stepMs: number,
): TimelineResult {
  const observer = createObserver(site)
  const samples = sampleRange(observer, t0, t1, stepMs)
  // Window searches use the same cadence as the chart, so a one-year range
  // costs the same number of ephemeris evaluations as drawing the curve.
  const step = samples.length > 1 ? samples[1].t - samples[0].t : stepMs

  const sunOn = (t: number) => observer.sunVisible(t)
  const earthOn = (t: number) => observer.earthElevation(t) > 0
  const bothOn = (t: number) => sunOn(t) && earthOn(t)

  const sunWindows = findWindows(sunOn, t0, t1, step)
  const commWindows = findWindows(earthOn, t0, t1, step)
  const jointWindows = findWindows(bothOn, t0, t1, step)

  const spanMs = Math.max(1, t1 - t0)
  let sunlitMs = 0
  let commMs = 0
  let jointMs = 0
  let elevationSum = 0
  let litTimeForMean = 0
  let incidenceSum = 0
  let trackingSum = 0
  let maxSunElevation = -90

  const rad = Math.PI / 180
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t
    const a = samples[i - 1]
    const b = samples[i]
    const rSun = (a.sun.angularDiameterDeg + b.sun.angularDiameterDeg) / 4
    // Linear interpolation of the horizon crossing inside each step. The Sun
    // counts as up while its upper limb is above the horizon.
    sunlitMs += dt * fractionAbove(a.sun.elevation + rSun, b.sun.elevation + rSun)
    commMs += dt * fractionAbove(a.earth.elevation, b.earth.elevation)
    if (a.sunlit && b.sunlit && a.earthVisible && b.earthVisible) jointMs += dt

    const midElev = (a.sun.elevation + b.sun.elevation) / 2
    const visible = discFractionAbove(midElev, rSun)
    const auRatio = KM_PER_AU / ((a.sun.distanceKm + b.sun.distanceKm) / 2)
    const flux = visible * auRatio * auRatio
    if (visible > 0) {
      elevationSum += Math.max(0, midElev) * dt
      litTimeForMean += dt
    }
    // Flat deck array: sees the Sun at elevation e with incidence sin(e).
    incidenceSum += flux * Math.max(0, Math.sin(midElev * rad)) * dt
    // Vertical array turned to the Sun's azimuth: incidence cos(e).
    trackingSum += flux * Math.cos(Math.max(0, midElev) * rad) * dt
    if (b.sun.elevation > maxSunElevation) maxSunElevation = b.sun.elevation
  }

  const metrics: TimelineMetrics = {
    spanMs,
    sunlitMs,
    commMs,
    jointMs,
    sunlitPct: (sunlitMs / spanMs) * 100,
    commPct: (commMs / spanMs) * 100,
    jointPct: (jointMs / spanMs) * 100,
    longestSunlitMs: longest(sunWindows),
    longestCommMs: longest(commWindows),
    meanSunElevation: litTimeForMean > 0 ? elevationSum / litTimeForMean : 0,
    maxSunElevation,
    meanSolarIncidence: incidenceSum / spanMs,
    meanTrackingIncidence: trackingSum / spanMs,
    meanTrackingFluxWm2: (trackingSum / spanMs) * SOLAR_CONSTANT_WM2,
    nextSunset: firstCrossing(sunOn, t0, t1, stepMs, false),
    nextSunrise: firstCrossing(sunOn, t0, t1, stepMs, true),
    nextEarthset: firstCrossing(earthOn, t0, t1, stepMs, false),
    nextEarthrise: firstCrossing(earthOn, t0, t1, stepMs, true),
  }

  return { samples, sunWindows, commWindows, jointWindows, metrics }
}

/** Fraction of [a,b] where a value is above 0, from its two end values (linear). */
function fractionAbove(elevA: number, elevB: number): number {
  if (elevA > 0 && elevB > 0) return 1
  if (elevA <= 0 && elevB <= 0) return 0
  const above = Math.max(elevA, elevB)
  const below = Math.min(elevA, elevB)
  return above / (above - below)
}

export const HOUR_MS = HOUR
export const MIN_MS = MIN
