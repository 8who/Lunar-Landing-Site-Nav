import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { apparentBodyRadius, createSkylineMask, skylineValues } from './skyVisibility'
import { buildHorizon } from '../lib/astro/horizon'
import { createObserver } from '../lib/astro/observer'
import { SITES } from '../lib/astro/sites'
import { sliderMinutesToTime, utcDay, minutesOfDayUtc } from '../lib/astro/scrub'
import { focusFieldOfView, focusZoomFieldOfView, skyMagnification, SKY_FOV_MIN } from '../lib/skyCamera'

const file = readFileSync(new URL('../../public/moon-elevation.f32', import.meta.url))
const grid = new Float32Array(file.buffer, file.byteOffset, file.byteLength / 4)
const site = SITES.find((s) => s.id === 'shackleton')!

// Emulate nearest texture lookup + explicit wrap/interpolation in the fragment
// shader. This is a contract with the physical horizon, independent of mesh relief.
function textureHorizon(values: Float32Array, az: number) {
  const index = (((az % 360) + 360) % 360) / 360 * values.length
  const i = Math.floor(index)
  return values[i % values.length] * (1 - (index - i)) + values[(i + 1) % values.length] * (index - i)
}

describe('first-person view / physical horizon contract', () => {
  it('centres hidden targets without requesting zoom, and frames visible targets', () => {
    for (const diameter of [.53, 1.9]) for (const current of [.5, 10, 70]) {
      expect(focusZoomFieldOfView(current, diameter, 1, false, false)).toBeNull()
      expect(focusZoomFieldOfView(current, diameter, 1, false, true)).toBeNull()
    }
    expect(focusZoomFieldOfView(70, .53, 1, true, false)).toBe(focusFieldOfView(.53, 1))
    expect(focusZoomFieldOfView(.5, .53, 1, true, true)).toBe(.5)
    expect(focusZoomFieldOfView(.5, 1.9, 1, true, false)).toBe(focusFieldOfView(1.9, 1))
  })
  it('automatically frames real Sun/Earth discs on desktop and portrait viewports', () => {
    for (const diameter of [.53, 1.9, 2.05]) for (const aspect of [2, 1, .6]) {
      const fov = focusFieldOfView(diameter, aspect)
      const fill = Math.tan(diameter * Math.PI / 360) / Math.tan(fov * Math.PI / 360) / Math.min(1, aspect)
      expect(fill).toBeCloseTo(.3, 10)
      expect(fov).toBeGreaterThanOrEqual(SKY_FOV_MIN)
    }
  })
  it('supports telescope close-ups with perspective-correct zoom readouts', () => {
    expect(skyMagnification(70)).toBeCloseTo(1)
    expect(skyMagnification(SKY_FOV_MIN)).toBeGreaterThan(160)
    expect(focusFieldOfView(.53, 2)).toBeLessThan(focusFieldOfView(1.9, 2))
  })
  it.each([0, 2, 20])('uses the identical terrain skyline at mast %s m while scrubbing across UTC dates', (mastHeightM) => {
    const observed = { ...site, mastHeightM, horizon: buildHorizon(grid, site.lat, site.lon, { mastHeightM }) }
    const observer = createObserver(observed)
    const values = skylineValues(observed)
    const start = Date.parse('2028-12-20T00:00:00Z')
    for (const minutes of [0, 1439, 1440, 17_280, 43_200]) {
      const t = sliderMinutesToTime(start, minutes)
      const dateControlTime = Date.parse(`${utcDay(t)}T00:00:00Z`) + minutesOfDayUtc(t, 1) * 60_000
      expect(dateControlTime).toBe(t)
      const sample = observer.skyAt(t)
      for (const body of [sample.sun, sample.earth]) {
        for (const offset of [-body.angularDiameterDeg / 2, 0, body.angularDiameterDeg / 2]) {
          const az = body.azimuth + offset
          expect(textureHorizon(values, az)).toBeCloseTo(observer.horizonElevation(az), 10)
        }
      }
    }
    // Cross the circular texture seam in both directions.
    for (const az of [-.001, 0, 359.999, 360, 720.001]) expect(textureHorizon(values, az)).toBeCloseTo(observer.horizonElevation(az), 10)
  })

  it('keeps negative mast-dip skyline visible instead of occluding at the tangent plane', () => {
    const flat = { ...site, horizon: undefined, mastHeightM: 20 }
    const values = skylineValues(flat)
    const observer = createObserver(flat)
    expect(values[0]).toBeLessThan(0)
    expect(textureHorizon(values, 180)).toBeCloseTo(observer.horizonElevation(180), 7)
    expect(-.05 > textureHorizon(values, 180)).toBe(true)
  })

  it('renders true solar and Earth angular diameters at every sky-shell distance', () => {
    for (const diameter of [.53, 1.9, 2.05]) for (const shell of [55, 100, 1000]) {
      const radius = apparentBodyRadius(diameter, shell)
      const displayedDiameter = 2 * Math.asin(radius / shell) * 180 / Math.PI
      expect(displayedDiameter).toBeCloseTo(diameter, 12)
    }
  })

  it('reallocates the GPU texture when terrain arrives and updates mast profiles without stale bins', () => {
    const mask = createSkylineMask({ ...site, mastHeightM: 2 })
    const fallback = mask.uniforms.uSkyline.value
    expect(fallback.image.width).toBe(1)
    const profile = buildHorizon(grid, site.lat, site.lon, { mastHeightM: 2 })
    mask.update({ ...site, mastHeightM: 2, horizon: profile })
    expect(mask.uniforms.uSkyline.value).not.toBe(fallback)
    expect(mask.uniforms.uSkylineBins.value).toBe(profile.elevations.length)
    expect(Array.from(mask.uniforms.uSkyline.value.image.data!)).toEqual(Array.from(profile.elevations))
    mask.update({ ...site, mastHeightM: 20 })
    expect(mask.uniforms.uSkyline.value.image.width).toBe(1)
    expect(mask.uniforms.uSkyline.value.image.data![0]).toBeLessThan(fallback.image.data![0])
    mask.dispose()
  })
})
