import { describe, expect, it } from 'vitest'
import { lunarVector, vectorToLatLon, yawToFaceLon, type Vec3 } from './globeMath'

/** Group rotation used by MoonGlobe to put lunar +z (north) up. */
function rotateX(v: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x, y: v.y * cos - v.z * sin, z: v.y * sin + v.z * cos }
}

/** Orbit yaw about the world +Y axis. */
function rotateY(v: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x * cos + v.z * sin, y: v.y, z: -v.x * sin + v.z * cos }
}

describe('lunarVector / vectorToLatLon', () => {
  it('round-trips selenographic coordinates in degrees', () => {
    const cases = [
      { lat: 0, lon: 0 },
      { lat: 0.674, lon: 23.473 }, // Apollo 11, Tranquility Base
      { lat: -3.012, lon: -23.422 }, // Apollo 12
      { lat: -89.66, lon: 129.2 }, // Shackleton rim
      { lat: -45.457, lon: 177.588 }, // Chang'e 4
      { lat: 43.06, lon: -51.92 }, // Chang'e 5
      { lat: -84.6, lon: 31.0 }, // Mons Mouton
    ]
    for (const { lat, lon } of cases) {
      const v = lunarVector(lat, lon, 1)
      const back = vectorToLatLon(v.x, v.y, v.z)
      expect(back.lat).toBeCloseTo(lat, 9)
      expect(back.lon).toBeCloseTo(lon, 9)
    }
  })

  it('respects the radius', () => {
    const v = lunarVector(12.5, -77.25, 2.5)
    expect(Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)).toBeCloseTo(2.5, 12)
  })
})

describe('yawToFaceLon', () => {
  it('faces longitude 0 at -PI/2', () => {
    expect(yawToFaceLon(0)).toBe(-Math.PI / 2)
  })

  it('puts the point at (0, 0) in front of the camera (+z world)', () => {
    const v = lunarVector(0, 0, 1)
    const tilted = rotateX(v, -Math.PI / 2)
    const world = rotateY(tilted, yawToFaceLon(0))
    expect(world.z).toBeCloseTo(1, 12)
    expect(world.x).toBeCloseTo(0, 12)
    expect(world.y).toBeCloseTo(0, 12)
  })

  it('brings any longitude to +z world', () => {
    for (const lon of [-177.588, -51.92, 0, 23.473, 90, 129.2]) {
      const v = lunarVector(0, lon, 1)
      const world = rotateY(rotateX(v, -Math.PI / 2), yawToFaceLon(lon))
      expect(world.z).toBeCloseTo(1, 12)
    }
  })
})
