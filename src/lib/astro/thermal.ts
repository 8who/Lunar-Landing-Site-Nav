/**
 * Surface temperature model for the Moon map layer.
 *
 * Not Diviner data: a simple, documented physical model so the map can follow
 * the selected instant everywhere on the Moon.
 *
 *  - Day: radiative equilibrium of the regolith with the Sun,
 *      T = [ S (1 - A) cos i / (eps sigma) ]^(1/4)
 *    with S the solar flux at the Moon's distance, albedo A = 0.12, emissivity
 *    eps = 0.95 and i the angle between the Sun and the local surface normal
 *    (the slope comes from the LOLA grid). Subsolar ~385 K, matching Diviner's
 *    ~390 K noon maximum.
 *  - Night: the regolith cools slowly. Diviner sees ~120 K soon after sunset
 *    falling to ~95 K before dawn at the equator, and less towards the poles:
 *      T = (95 + 25 exp(-tau / 60 h)) * max(0.55, cos(lat))^(1/4)
 *    with tau the hours since local sunset.
 *  - Permanently shadowed cells (0% sunlight over a year in the illumination
 *    map) are cold traps: 40 K, the order Diviner measures in polar PSRs.
 *
 * Instantaneous shadows cast by terrain are not modelled outside the PSRs; at
 * high latitudes the map is therefore warmer than reality in places.
 */

import { Body, GeoVector, MakeTime } from 'astronomy-engine'
import { bodyBasis, moonOrientation, toBody } from './lunarFrame'
import { KM_PER_AU } from './observer'
import type { Vec3 } from './vec'

export const SIGMA = 5.670374419e-8
export const ALBEDO = 0.12
export const EMISSIVITY = 0.95
export const SOLAR_CONSTANT = 1361
export const PSR_TEMPERATURE_K = 40
/** Synodic day in hours: one full turn of local solar time. */
const SYNODIC_HOURS = 29.530589 * 24
const SUN_RADIUS_KM = 695_700

export interface SunInBodyFrame {
  /** Unit vector from the Moon to the Sun in the lunar body-fixed frame */
  dir: Vec3
  /** Solar flux at the Moon, W/m^2 */
  flux: number
  /** Apparent solar radius, deg */
  radiusDeg: number
  /** Subsolar longitude, deg east */
  subsolarLon: number
}

export function sunInBodyFrame(date: Date | number): SunInBodyFrame {
  const time = MakeTime(date instanceof Date ? date : new Date(date))
  const basis = bodyBasis(moonOrientation(time.tt))
  const m = GeoVector(Body.Moon, time, false)
  const s = GeoVector(Body.Sun, time, false)
  const v = toBody({ x: s.x - m.x, y: s.y - m.y, z: s.z - m.z }, basis)
  const au = Math.hypot(v.x, v.y, v.z)
  const dir = { x: v.x / au, y: v.y / au, z: v.z / au }
  return {
    dir,
    flux: SOLAR_CONSTANT / (au * au),
    radiusDeg: (Math.atan(SUN_RADIUS_KM / (au * KM_PER_AU)) * 180) / Math.PI,
    subsolarLon: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
  }
}

/** Equilibrium day-side temperature for a given incidence cosine, K. */
export function dayTemperature(cosIncidence: number, flux = SOLAR_CONSTANT): number {
  if (!(cosIncidence > 0)) return 0
  return Math.pow((flux * (1 - ALBEDO) * cosIncidence) / (EMISSIVITY * SIGMA), 0.25)
}

/** Night-side temperature `hoursSinceSunset` after local sunset at `latDeg`, K. */
export function nightTemperature(hoursSinceSunset: number, latDeg: number): number {
  const latFactor = Math.pow(Math.max(0.55, Math.cos((latDeg * Math.PI) / 180)), 0.25)
  return (95 + 25 * Math.exp(-Math.max(0, hoursSinceSunset) / 60)) * latFactor
}

/** Hours since local sunset for a meridian `lonDeg`, given the subsolar longitude. */
export function hoursSinceSunset(lonDeg: number, subsolarLonDeg: number): number {
  // Local hour angle: 0 at noon, +90 at sunset (the Sun moves west, i.e. the
  // subsolar longitude decreases), then night until +270 (sunrise).
  const h = (((lonDeg - subsolarLonDeg) % 360) + 360) % 360
  const sinceSunset = (h - 90 + 360) % 360
  return (sinceSunset / 360) * SYNODIC_HOURS
}

/**
 * Temperature of one surface cell, K.
 * @param up      unit local vertical (body frame)
 * @param normal  unit surface normal including slope (body frame)
 * @param litByYear  % of the year the cell sees the Sun (0 = permanent shadow)
 */
export function cellTemperature(
  sun: SunInBodyFrame,
  latDeg: number,
  lonDeg: number,
  up: Vec3,
  normal: Vec3,
  litByYear: number,
): number {
  if (litByYear === 0) return PSR_TEMPERATURE_K
  const night = nightTemperature(hoursSinceSunset(lonDeg, sun.subsolarLon), latDeg)
  const elevation =
    (Math.asin(Math.max(-1, Math.min(1, sun.dir.x * up.x + sun.dir.y * up.y + sun.dir.z * up.z))) *
      180) /
    Math.PI
  if (elevation <= -sun.radiusDeg) return night
  const cosI = sun.dir.x * normal.x + sun.dir.y * normal.y + sun.dir.z * normal.z
  // At grazing light the equilibrium value falls below the stored heat of the
  // regolith, so the night curve is the floor.
  return Math.max(night, dayTemperature(cosI, sun.flux))
}
