/**
 * Pure geometry for the interactive Moon globe.
 *
 * Selenographic coordinates use east-positive longitude and a body-fixed frame
 * with +z through the north pole, matching the rest of src/lib/astro.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

/** Body-fixed vector for a selenographic coordinate. */
export function lunarVector(latDeg: number, lonDeg: number, radius: number): Vec3 {
  const lat = latDeg * DEG_TO_RAD
  const lon = lonDeg * DEG_TO_RAD
  const cosLat = Math.cos(lat)
  return {
    x: radius * cosLat * Math.cos(lon),
    y: radius * cosLat * Math.sin(lon),
    z: radius * Math.sin(lat),
  }
}

/** Inverse of lunarVector: latitude and longitude in degrees. */
export function vectorToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const radius = Math.sqrt(x * x + y * y + z * z)
  if (radius === 0) return { lat: 0, lon: 0 }
  const sinLat = Math.min(1, Math.max(-1, z / radius))
  return {
    lat: Math.asin(sinLat) * RAD_TO_DEG,
    lon: Math.atan2(y, x) * RAD_TO_DEG,
  }
}

/**
 * Texture coordinate for an equirectangular lunar map: longitude 0 at the
 * image centre, longitude increasing eastward to the right, north up.
 */
export function textureUV(latDeg: number, lonDeg: number): { u: number; v: number } {
  return { u: 0.5 + lonDeg / 360, v: 0.5 + latDeg / 180 }
}

/**
 * Vertex of three's SphereGeometry (radius 1) for a texture coordinate.
 *
 * Matches three's sphere UV layout: the pole axis is +Y, and with flipY the
 * image's up direction maps to +Y. Rotating the result +90 deg about X gives
 * the lunar body-fixed vector (x, -z, y).
 */
export function sphereGeometryPoint(u: number, v: number): Vec3 {
  const phi = 2 * Math.PI * u
  const theta = Math.PI * (1 - v)
  const sinTheta = Math.sin(theta)
  return {
    x: -Math.cos(phi) * sinTheta,
    y: Math.cos(theta),
    z: Math.sin(phi) * sinTheta,
  }
}

/**
 * Yaw about the world +Y axis (the orbit group) that brings the given
 * selenographic longitude to face the camera.
 *
 * The globe group is rotated -90 deg about X so lunar +z points up; at yaw 0
 * the longitude facing the camera is therefore -90 deg, hence
 * yaw = -PI/2 - lon.
 */
export function yawToFaceLon(lonDeg: number): number {
  return -Math.PI / 2 - lonDeg * DEG_TO_RAD
}
