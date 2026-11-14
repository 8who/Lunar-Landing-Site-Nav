import { describe, expect, it } from 'vitest'
import { buildHorizon, horizonAt } from './horizon'
import { createObserver, horizonDipDeg, MOON_RADIUS_KM } from './observer'
import { elevationAt, TERRAIN_COLS, TERRAIN_ROWS } from './terrain'
import { buildTimeline } from './timeline'
import type { HorizonProfile, LunarSite } from './types'

const DAY = 86_400_000
const R = MOON_RADIUS_KM
const RAD = Math.PI / 180

/** Cell-centre latitude of a grid row. */
const cellLat = (row: number) => 90 - ((row + 0.5) * 180) / TERRAIN_ROWS
/** Cell-centre longitude of a grid column. */
const cellLon = (col: number) => -180 + ((col + 0.5) * 360) / TERRAIN_COLS

const rowFor = (lat: number) =>
  Math.max(0, Math.min(TERRAIN_ROWS - 1, Math.floor(((90 - lat) / 180) * TERRAIN_ROWS)))
const colFor = (lon: number) =>
  ((Math.floor(((lon + 180) / 360) * TERRAIN_COLS) % TERRAIN_COLS) + TERRAIN_COLS) % TERRAIN_COLS

/** Flat reference sphere. */
function flatGrid(): Float32Array {
  return new Float32Array(TERRAIN_COLS * TERRAIN_ROWS)
}

/** A crater: level floor inside `radiusDeg` of the pole, high ground outside. */
function craterGrid(rimKm: number, radiusDeg: number): Float32Array {
  const grid = flatGrid()
  for (let row = 0; row < TERRAIN_ROWS; row++) {
    const lat = cellLat(row)
    const inside = 90 - Math.abs(lat) < radiusDeg
    if (!inside) grid.fill(rimKm, row * TERRAIN_COLS, (row + 1) * TERRAIN_COLS)
  }
  return grid
}

const site = (lat: number, lon: number, horizon?: HorizonProfile): LunarSite => ({
  id: 'test',
  name: 'test',
  lat,
  lon,
  category: 'custom',
  horizon,
})

describe('buildHorizon', () => {
  it('returns the geometric dip on a smooth sphere, in every direction', () => {
    for (const mast of [2, 10, 20]) {
      const profile = buildHorizon(flatGrid(), 0.674, 23.473, { mastHeightM: mast })
      const expected = -horizonDipDeg(mast, R)
      expect(profile.elevations).toHaveLength(120)
      expect(profile.stepDeg).toBeCloseTo(3, 10)
      for (const elevation of profile.elevations) {
        // A smooth sphere has no azimuth dependence: the skyline is the limb.
        expect(Math.abs(elevation - expected)).toBeLessThan(0.01)
      }
      expect(Math.abs(profile.maxElevationDeg - expected)).toBeLessThan(0.01)
      expect(profile.groundElevationM).toBe(0)
    }
  })

  it('reads the ground radius from the grid, not from the catalogue', () => {
    const grid = flatGrid().fill(1.5)
    const profile = buildHorizon(grid, 0, 0, { mastHeightM: 2 })
    expect(profile.groundElevationM).toBeCloseTo(1500, 3)
    expect(profile.eyeHeightM).toBe(2)
  })

  it('sees the rim of a polar crater from its floor, all the way round', () => {
    // Floor at datum, rim +1 km. The grid's first row outside the cap sits at
    // 0.625 deg of colatitude, because cells are 0.25 deg apart.
    const profile = buildHorizon(craterGrid(1, 0.5), -90, 0, { mastHeightM: 2 })
    const rimArcKm = 0.625 * RAD * R
    const phi = rimArcKm / R
    const eye = R + 0.002
    const expected = Math.atan2((R + 1) * Math.cos(phi) - eye, (R + 1) * Math.sin(phi)) / RAD
    expect(expected).toBeCloseTo(2.72, 1)
    expect(Math.abs(profile.maxElevationDeg - expected)).toBeLessThan(0.1)
    // A crater rim is a full circle: the minimum is the same as the maximum.
    expect(Math.min(...profile.elevations)).toBeCloseTo(profile.maxElevationDeg, 2)
    expect(profile.maxDistanceKm).toBeGreaterThan(18)
    expect(profile.maxDistanceKm).toBeLessThan(20)
  })

  it('lowers the skyline when the mast raises the eye', () => {
    const grid = craterGrid(1, 0.5)
    const ground = buildHorizon(grid, -90, 0, { mastHeightM: 0 })
    const mast = buildHorizon(grid, -90, 0, { mastHeightM: 20 })
    expect(mast.maxElevationDeg).toBeLessThan(ground.maxElevationDeg)
    expect(ground.maxElevationDeg - mast.maxElevationDeg).toBeGreaterThan(0.05)
  })

  it('reports the direction and distance of the highest skyline', () => {
    const grid = flatGrid()
    // A 2 km wall east of the site, two cells wide.
    const row0 = rowFor(4)
    const row1 = rowFor(-4)
    const col0 = colFor(0.5)
    const col1 = colFor(1.6)
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) grid[row * TERRAIN_COLS + col] = 2
    }
    const profile = buildHorizon(grid, 0, 0, { mastHeightM: 2 })
    expect(profile.maxElevationDeg).toBeGreaterThan(5)
    expect(profile.maxElevationDeg).toBeLessThan(20)
    expect(profile.maxAzimuthDeg).toBeGreaterThan(75)
    expect(profile.maxAzimuthDeg).toBeLessThan(105)
    expect(profile.maxDistanceKm).toBeGreaterThan(10)
    expect(profile.maxDistanceKm).toBeLessThan(60)
    // Looking west there is nothing to block the limb.
    expect(Math.abs(horizonAt(profile, 270) + horizonDipDeg(2, R))).toBeLessThan(0.01)
  })

  it('puts a mountain beyond the curvature horizon below the skyline', () => {
    const grid = flatGrid()
    // A single-cell +5 km peak 150 km east. Curvature has already dropped that
    // distance by 6.4 km, so the summit sits below the limb and cannot block.
    const col = colFor(5.0)
    for (let row = rowFor(3); row <= rowFor(-3); row++) grid[row * TERRAIN_COLS + col] = 5
    const profile = buildHorizon(grid, 0, 0, { mastHeightM: 2 })
    expect(horizonAt(profile, 90)).toBeLessThan(0)
    // The skyline is the smooth limb, not the peak.
    expect(Math.abs(profile.maxElevationDeg + horizonDipDeg(2, R))).toBeLessThan(0.02)
  })
})

describe('horizonAt', () => {
  const profile: HorizonProfile = {
    stepDeg: 90,
    elevations: new Float32Array([0, 10, 20, 30]),
    groundElevationM: 0,
    eyeHeightM: 2,
    maxElevationDeg: 30,
    maxAzimuthDeg: 270,
    maxDistanceKm: 10,
    source: 'synthetic',
    cellKm: 7.6,
  }

  it('interpolates between bins', () => {
    expect(horizonAt(profile, 0)).toBeCloseTo(0, 10)
    expect(horizonAt(profile, 45)).toBeCloseTo(5, 10)
    expect(horizonAt(profile, 90)).toBeCloseTo(10, 10)
    expect(horizonAt(profile, 180)).toBeCloseTo(20, 10)
  })

  it('wraps through north and handles negative azimuths', () => {
    expect(horizonAt(profile, 359.999)).toBeCloseTo(0, 2)
    expect(horizonAt(profile, 350)).toBeCloseTo(30 / 9, 6)
    expect(horizonAt(profile, -10)).toBeCloseTo(horizonAt(profile, 350), 10)
    expect(horizonAt(profile, 720)).toBeCloseTo(0, 10)
  })
})

describe('sky flags use the terrain skyline', () => {
  const START = Date.parse('2028-01-01T00:00:00Z')

  it('reports the horizon that applies to the Sun and Earth azimuths', () => {
    const profile = buildHorizon(craterGrid(1, 0.5), -90, 0, { mastHeightM: 2 })
    const observer = createObserver(site(-90, 0, profile))
    const sky = observer.skyAt(START)
    expect(sky.sun.horizonDeg).toBeCloseTo(horizonAt(profile, sky.sun.azimuth), 10)
    expect(sky.earth.horizonDeg).toBeCloseTo(horizonAt(profile, sky.earth.azimuth), 10)
    // Visibility is decided by the whole disc, not the centre line: some part
    // of the disc must clear the skyline at its own azimuth.
    expect(sky.sunlit).toBe((sky.sun.marginDeg ?? -1) > 0)
    expect(sky.earthVisible).toBe((sky.earth.marginDeg ?? -1) > 0)
    // The disc's best point clears the skyline at least as well as the centre.
    expect(sky.earth.marginDeg!).toBeGreaterThanOrEqual(
      sky.earth.elevation - (sky.earth.horizonDeg ?? 0) - 1e-9,
    )
  })

  it('turns a lit polar site dark when a 3.5 deg rim surrounds it', () => {
    const flatSite = site(-90, 0)
    const rimSite = site(-90, 0, buildHorizon(craterGrid(1, 0.5), -90, 0, { mastHeightM: 2 }))
    const flat = buildTimeline(flatSite, START, START + 30 * DAY, 3_600_000).metrics
    const rim = buildTimeline(rimSite, START, START + 30 * DAY, 3_600_000).metrics
    // The Sun's polar elevation stays inside +-1.5 deg, so a 2.7 deg rim is
    // never cleared: no direct light at all.
    expect(flat.sunlitPct).toBeGreaterThan(20)
    expect(rim.sunlitPct).toBe(0)
    expect(rim.jointPct).toBe(0)
    // Earth's libration in latitude reaches ~6.7 deg, so it still rises above
    // the rim part of the time — but less often than over flat ground.
    expect(rim.commPct).toBeGreaterThan(0)
    expect(rim.commPct).toBeLessThan(flat.commPct)
  })

  it('leaves the flat model unchanged when no grid is attached', () => {
    const flatSite = site(0.674, 23.473)
    const observer = createObserver({ ...flatSite, mastHeightM: 10 })
    const sky = observer.skyAt(START)
    expect(sky.horizonDipDeg).toBeCloseTo(horizonDipDeg(10), 6)
    expect(sky.sun.horizonDeg).toBeCloseTo(-horizonDipDeg(10), 6)
    expect(observer.horizonElevation(123)).toBeCloseTo(-horizonDipDeg(10), 10)
  })
})

describe('grid lookup', () => {
  it('samples cell centres exactly', () => {
    const grid = flatGrid()
    grid[rowFor(0) * TERRAIN_COLS + colFor(0)] = 3
    // Cell-centre coordinates land on the stored value; half a cell away is half.
    expect(elevationAt(grid, cellLat(rowFor(0)), cellLon(colFor(0)))).toBeCloseTo(3, 6)
    expect(elevationAt(grid, cellLat(rowFor(0) + 1), cellLon(colFor(0)))).toBeCloseTo(0, 6)
  })
})
