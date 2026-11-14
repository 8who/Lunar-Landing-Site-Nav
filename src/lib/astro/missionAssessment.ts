import { KM_PER_AU, MOON_RADIUS_KM, SOLAR_CONSTANT_WM2, createObserver } from './observer'
import { siteSeesStation, stationSkyPoints } from './earthView'
import { panelNormal, sunVector } from './panel'
import type { LunarSite } from './types'

const HOUR_MS = 3_600_000

export interface MissionRequirements {
  demandW: number
  arrayAreaM2: number
  efficiency: number
  capacityWh: number
  initialChargePct: number
  chargeEfficiency: number
  dischargeEfficiency: number
  maxBlackoutHours: number
  stationMaskDeg: number
  orientation: 'tracking' | 'horizontal' | 'fixed'
  tiltDeg: number
  azimuthDeg: number
}

export const DEFAULT_MISSION_REQUIREMENTS: Readonly<MissionRequirements> = Object.freeze({
  demandW: 100,
  arrayAreaM2: 2,
  efficiency: 0.3,
  capacityWh: 2_000,
  initialChargePct: 100,
  chargeEfficiency: 0.95,
  dischargeEfficiency: 0.95,
  maxBlackoutHours: 24,
  stationMaskDeg: 10,
  orientation: 'tracking',
  tiltDeg: 90,
  azimuthDeg: 0,
})

export interface MissionAssessmentSample {
  /** UTC epoch ms at the interval midpoint. */
  t: number
  /** Irradiance on the chosen panel plane, including visible solar disc share. */
  solarFluxWm2: number
  generatedW: number
  /** Stored energy at the END of this interval. Initial charge is in requirements. */
  batteryWh: number
  /** Mean unserved load over this interval; may be fractional if charge runs out. */
  unmetW: number
  earthVisible: boolean
  dsnAccess: boolean
  /** IDs of geometrically accessible DSN complexes. */
  stations: string[]
}

export interface MissionAssessment {
  site: LunarSite
  t0: number
  t1: number
  stepMs: number
  requirements: MissionRequirements
  assumptions: string[]
  samples: MissionAssessmentSample[]
  shortfallWh: number
  unmetDurationMs: number
  generationBelowDemandMs: number
  minBatteryWh: number
  dsnPct: number
  earthPct: number
  longestDsnBlackoutMs: number
  longestEarthBlackoutMs: number
  passes: boolean
  reasons: string[]
}

function bounded(name: string, value: number, min: number, max = Infinity): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and in [${min}, ${max}]`)
  }
}

function validateStorage(requirements: Pick<MissionRequirements, 'capacityWh' | 'chargeEfficiency' | 'dischargeEfficiency'>): void {
  bounded('capacityWh', requirements.capacityWh, 0)
  for (const key of ['chargeEfficiency', 'dischargeEfficiency'] as const) {
    bounded(key, requirements[key], Number.MIN_VALUE, 1)
  }
}

export interface BatteryInterval {
  batteryWh: number
  shortfallWh: number
  unmetMs: number
  /** Mean unserved power across the interval, not peak unserved power. */
  unmetW: number
}

/** Constant-power interval: generation serves load first, then charges storage. */
export function integrateBatteryInterval(
  batteryWh: number,
  generatedW: number,
  demandW: number,
  durationMs: number,
  requirements: Pick<MissionRequirements, 'capacityWh' | 'chargeEfficiency' | 'dischargeEfficiency'>,
): BatteryInterval {
  validateStorage(requirements)
  bounded('batteryWh', batteryWh, 0, requirements.capacityWh)
  bounded('generatedW', generatedW, 0)
  bounded('demandW', demandW, 0)
  bounded('durationMs', durationMs, Number.MIN_VALUE)
  const hours = durationMs / HOUR_MS
  const surplusW = generatedW - demandW
  if (surplusW >= 0) {
    return {
      batteryWh: Math.min(requirements.capacityWh, batteryWh + surplusW * hours * requirements.chargeEfficiency),
      shortfallWh: 0,
      unmetMs: 0,
      unmetW: 0,
    }
  }
  const deficitW = -surplusW
  const requiredWh = deficitW * hours
  const deliveredWh = Math.min(requiredWh, batteryWh * requirements.dischargeEfficiency)
  const shortfallWh = Math.max(0, requiredWh - deliveredWh)
  return {
    batteryWh: Math.max(0, batteryWh - deliveredWh / requirements.dischargeEfficiency),
    shortfallWh,
    unmetMs: Math.min(durationMs, shortfallWh / deficitW * HOUR_MS),
    unmetW: shortfallWh / hours,
  }
}

function validate(site: LunarSite, t0: number, t1: number, stepMs: number, requirements: MissionRequirements): void {
  bounded('t0', t0, -8.64e15, 8.64e15)
  bounded('t1', t1, -8.64e15, 8.64e15)
  bounded('stepMs', stepMs, Number.MIN_VALUE)
  if (t1 <= t0 || t0 + stepMs <= t0 || t1 - Math.min(stepMs, t1 - t0) >= t1) {
    throw new RangeError('Require t1 > t0 and a stepMs that advances epoch time')
  }
  bounded('site.lat', site.lat, -90, 90)
  bounded('site.lon', site.lon, -180, 180)
  bounded('site.elevationM', site.elevationM ?? 0, -MOON_RADIUS_KM * 1000 + 1)
  bounded('site.mastHeightM', site.mastHeightM ?? 0, 0)
  if (site.horizon) {
    const h = site.horizon
    bounded('horizon.groundElevationM', h.groundElevationM, -MOON_RADIUS_KM * 1000 + 1)
    bounded('horizon.stepDeg', h.stepDeg, Number.MIN_VALUE, 360)
    if (!h.elevations.length || Math.abs(h.elevations.length * h.stepDeg - 360) > 1e-6) {
      throw new RangeError('Horizon bins must cover 360 degrees')
    }
    for (const elevation of h.elevations) bounded('horizon elevation', elevation, -90, 90)
  }
  validateStorage(requirements)
  for (const key of ['demandW', 'arrayAreaM2', 'maxBlackoutHours'] as const) bounded(key, requirements[key], 0)
  bounded('efficiency', requirements.efficiency, 0, 1)
  bounded('initialChargePct', requirements.initialChargePct, 0, 100)
  bounded('stationMaskDeg', requirements.stationMaskDeg, 0, 90)
  bounded('tiltDeg', requirements.tiltDeg, 0, 90)
  bounded('azimuthDeg', requirements.azimuthDeg, 0, 360)
  if (!['tracking', 'horizontal', 'fixed'].includes(requirements.orientation)) {
    throw new RangeError('Unknown panel orientation')
  }
}

/** Yields completed sample counts every 72 intervals; returns the final assessment. */
export function* assessMissionChunks(
  site: LunarSite,
  t0: number,
  t1: number,
  stepMs: number,
  requirements: MissionRequirements,
): Generator<number, MissionAssessment, void> {
  validate(site, t0, t1, stepMs, requirements)
  const observer = createObserver(site)
  const normal = panelNormal(requirements.orientation === 'horizontal' ? 0 : requirements.tiltDeg, requirements.azimuthDeg)
  let batteryWh = requirements.capacityWh * (requirements.initialChargePct / 100)
  const result: MissionAssessment = {
    site, t0, t1, stepMs, requirements: { ...requirements },
    assumptions: [
      'UTC epoch milliseconds; constant demand and array/battery efficiencies.',
      'Geometry and power are held constant at each interval midpoint; the final interval is clipped to t1.',
      'Sample batteryWh is end-of-interval charge; unmetW is mean unserved load over that interval.',
      'Solar flux includes inverse-square distance, visible solar disc fraction and panel incidence; no reflected light, degradation or thermal effects.',
      site.horizon ? 'Sun, Earth and stations use the supplied terrain skyline.' : 'No terrain skyline supplied: smooth lunar horizon with mast-height dip.',
      'Earth visibility means any part of its disc clears the skyline. DSN requires a visible, Earth-facing antenna and geometric station elevation at least stationMaskDeg; no refraction, scheduling or link budget.',
      'Surplus generation charges storage with charge losses; deficits draw stored energy with discharge losses. Capacity clips surplus; no battery power limit or self-discharge.',
      'Visibility and blackout durations use midpoint intervals without edge refinement; power depletion time within each interval is integrated.',
      'Pass requires zero unserved energy and longest DSN blackout no greater than maxBlackoutHours; Earth blackout is diagnostic.',
    ],
    samples: [], shortfallWh: 0, unmetDurationMs: 0, generationBelowDemandMs: 0,
    minBatteryWh: batteryWh, dsnPct: 0, earthPct: 0,
    longestDsnBlackoutMs: 0, longestEarthBlackoutMs: 0, passes: true, reasons: [],
  }
  let dsnMs = 0
  let earthMs = 0
  let dsnBlackoutMs = 0
  let earthBlackoutMs = 0
  for (let start = t0; start < t1;) {
    const end = Math.min(t1, start + stepMs)
    if (end <= start) throw new RangeError('stepMs no longer advances epoch time')
    const durationMs = end - start
    const t = start + durationMs / 2
    const sky = observer.skyAt(t)
    const sun = sunVector(sky.sun.azimuth, sky.sun.elevation)
    const incidence = requirements.orientation === 'tracking' ? 1 : Math.max(0, normal.e * sun.e + normal.n * sun.n + normal.u * sun.u)
    const distanceRatio = KM_PER_AU / sky.sun.distanceKm
    const solarFluxWm2 = SOLAR_CONSTANT_WM2 * distanceRatio ** 2 * sky.sun.visibleFraction! * incidence
    const generatedW = solarFluxWm2 * requirements.arrayAreaM2 * requirements.efficiency
    const power = integrateBatteryInterval(batteryWh, generatedW, requirements.demandW, durationMs, requirements)
    batteryWh = power.batteryWh
    const points = stationSkyPoints(site, t, sky.earth)
    const stations = [...points].filter(([, point]) =>
      siteSeesStation(point, observer.skyline.at) && point.siteElevationAtStation >= requirements.stationMaskDeg,
    ).map(([id]) => id)
    const dsnAccess = stations.length > 0
    result.samples.push({ t, solarFluxWm2, generatedW, batteryWh, unmetW: power.unmetW, earthVisible: sky.earthVisible, dsnAccess, stations })
    result.shortfallWh += power.shortfallWh
    result.unmetDurationMs += power.unmetMs
    if (generatedW < requirements.demandW) result.generationBelowDemandMs += durationMs
    result.minBatteryWh = Math.min(result.minBatteryWh, batteryWh)
    if (dsnAccess) dsnMs += durationMs
    if (sky.earthVisible) earthMs += durationMs
    dsnBlackoutMs = dsnAccess ? 0 : dsnBlackoutMs + durationMs
    earthBlackoutMs = sky.earthVisible ? 0 : earthBlackoutMs + durationMs
    result.longestDsnBlackoutMs = Math.max(result.longestDsnBlackoutMs, dsnBlackoutMs)
    result.longestEarthBlackoutMs = Math.max(result.longestEarthBlackoutMs, earthBlackoutMs)
    start = end
    if (result.samples.length % 72 === 0 && start < t1) yield result.samples.length
  }
  result.dsnPct = 100 * (dsnMs / (t1 - t0))
  result.earthPct = 100 * (earthMs / (t1 - t0))
  if (result.shortfallWh > 0) result.reasons.push('Stored energy and solar generation cannot meet demand throughout the mission.')
  if (result.longestDsnBlackoutMs / HOUR_MS > requirements.maxBlackoutHours) result.reasons.push('The longest DSN blackout exceeds maxBlackoutHours.')
  result.passes = result.reasons.length === 0
  return result
}

/** Pure synchronous convenience wrapper; use assessMissionChunks to yield UI work. */
export function assessMission(
  site: LunarSite,
  t0: number,
  t1: number,
  stepMs: number,
  requirements: MissionRequirements,
): MissionAssessment {
  const chunks = assessMissionChunks(site, t0, t1, stepMs, requirements)
  let next = chunks.next()
  while (!next.done) next = chunks.next()
  return next.value
}
