/**
 * Small vector helpers (plain objects, no allocations hidden behind classes).
 * Frames used across the app:
 *  - ICRF/EQJ: geocentric J2000 equatorial (what astronomy-engine returns)
 *  - Lunar body-fixed (selenographic): x = (0°N, 0°E), y = (0°N, 90°E), z = north pole
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

export const scale = (a: Vec3, k: number): Vec3 => ({
  x: a.x * k,
  y: a.y * k,
  z: a.z * k,
})

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const norm = (a: Vec3): number => Math.sqrt(dot(a, a))

export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a)
  return n === 0 ? vec() : scale(a, 1 / n)
}

export const RAD = Math.PI / 180
export const DEG = 180 / Math.PI
