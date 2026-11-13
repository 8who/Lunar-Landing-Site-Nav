/**
 * Lunar body-fixed frame (selenographic coordinates).
 *
 * Rotation model: IAU WGCCRE 2015 Moon orientation
 *   alpha0 = 269.9949 + 0.0031 T - 0.0028 T^2   (+ periodic terms)
 *   delta0 =  66.5392 + 0.0130 T + 0.000013 T^2 (+ periodic terms)
 *   W      =  38.3213 + 13.17635815 d - 1.4e-12 d^2 (+ periodic terms)
 * with T in Julian centuries and d in days, both TDB relative to J2000.
 *
 * The periodic terms carry the physical libration (the Moon is not a perfect
 * uniform rotator), so the sub-Earth point moves within roughly +-8 deg in
 * longitude and +-7 deg in latitude. That drift is exactly what makes Earth
 * visibility from a polar site time dependent.
 *
 * Accuracy is better than ~0.02 deg for our purpose (horizon geometry), i.e.
 * well below the ~0.5 deg angular size of the Sun.
 */

import { DEG, RAD, cross, dot, normalize, scale, sub, vec, type Vec3 } from './vec'

export interface LunarOrientation {
  /** deg, right ascension of the north pole */
  alpha0: number
  /** deg, declination of the north pole */
  delta0: number
  /** deg, prime meridian angle */
  W: number
}

const sinD = (deg: number) => Math.sin(deg * RAD)
const cosD = (deg: number) => Math.cos(deg * RAD)

/** Orientation of the Moon's body-fixed frame in ICRF for `d` days (TDB) since J2000. */
export function moonOrientation(d: number): LunarOrientation {
  const T = d / 36525

  let alpha0 = 269.9949 + 0.0031 * T - 0.0028 * T * T
  let delta0 = 66.5392 + 0.013 * T + 0.000013 * T * T
  let W = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d

  const E = (a: number, b: number) => a + b * d
  const E1 = E(125.045, -0.0529921)
  const E2 = E(250.089, -0.1059842)
  const E3 = E(260.008, 13.0120009)
  const E4 = E(176.625, 13.3407154)
  const E5 = E(357.529, 0.9856003)
  const E6 = E(311.589, 26.4057084)
  const E7 = E(134.963, 13.064993)
  const E8 = E(276.617, 0.3287146)
  const E9 = E(34.226, 1.7484877)
  const E10 = E(15.134, -0.1589763)
  const E11 = E(119.743, 0.0036096)
  const E12 = E(239.961, 0.1643573)
  const E13 = E(25.053, 12.9590088)

  alpha0 +=
    -3.8787 * sinD(E1) -
    0.1204 * sinD(E2) +
    0.07 * sinD(E3) -
    0.0172 * sinD(E4) +
    0.0072 * sinD(E6) -
    0.0052 * sinD(E10) +
    0.0043 * sinD(E13)

  delta0 +=
    1.5419 * cosD(E1) +
    0.0239 * cosD(E2) -
    0.0278 * cosD(E3) +
    0.0068 * cosD(E4) -
    0.0029 * cosD(E6) +
    0.0009 * cosD(E7)

  W +=
    3.561 * sinD(E1) +
    0.1208 * sinD(E2) -
    0.0642 * sinD(E3) +
    0.0158 * sinD(E4) +
    0.0252 * sinD(E5) -
    0.0066 * sinD(E6) -
    0.0047 * sinD(E7) -
    0.0046 * sinD(E8) +
    0.0028 * sinD(E9) +
    0.0052 * sinD(E10) +
    0.004 * sinD(E11) +
    0.0019 * sinD(E12) -
    0.0044 * sinD(E13)

  return { alpha0, delta0, W }
}

export interface BodyBasis {
  /** body-fixed x axis expressed in ICRF */
  X: Vec3
  /** body-fixed y axis expressed in ICRF */
  Y: Vec3
  /** body-fixed z axis (north pole) expressed in ICRF */
  Z: Vec3
}

/**
 * Orthonormal basis of the body-fixed frame in ICRF.
 * Body x points at the prime meridian (0 deg E), z at the north pole.
 */
export function bodyBasis(orientation: LunarOrientation): BodyBasis {
  const { alpha0, delta0, W } = orientation
  const Z = vec(
    cosD(delta0) * cosD(alpha0),
    cosD(delta0) * sinD(alpha0),
    sinD(delta0),
  )
  // Prime meridian at W = 0 sits 90 deg east of the pole's right ascension.
  const meridian0 = vec(-sinD(alpha0), cosD(alpha0), 0)
  const Wr = W * RAD
  const X = normalize({
    x: meridian0.x * Math.cos(Wr) + cross(Z, meridian0).x * Math.sin(Wr),
    y: meridian0.y * Math.cos(Wr) + cross(Z, meridian0).y * Math.sin(Wr),
    z: meridian0.z * Math.cos(Wr) + cross(Z, meridian0).z * Math.sin(Wr),
  })
  const Y = cross(Z, X)
  return { X, Y, Z }
}

/** ICRF -> lunar body-fixed. */
export function toBody(v: Vec3, basis: BodyBasis): Vec3 {
  return vec(dot(v, basis.X), dot(v, basis.Y), dot(v, basis.Z))
}

/** Lunar body-fixed -> ICRF. */
export function toInertial(v: Vec3, basis: BodyBasis): Vec3 {
  return {
    x: basis.X.x * v.x + basis.Y.x * v.y + basis.Z.x * v.z,
    y: basis.X.y * v.x + basis.Y.y * v.y + basis.Z.y * v.z,
    z: basis.X.z * v.x + basis.Y.z * v.y + basis.Z.z * v.z,
  }
}

/** Selenographic (lat, lon in deg, east positive) of a body-fixed unit/direction vector. */
export function toSelenographic(v: Vec3): { lat: number; lon: number } {
  const u = normalize(v)
  const lat = Math.asin(Math.max(-1, Math.min(1, u.z))) * DEG
  const lon = Math.atan2(u.y, u.x) * DEG
  return { lat, lon }
}

export { sub, scale }
