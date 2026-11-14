import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  cellTemperature,
  dayTemperature,
  hoursSinceSunset,
  nightTemperature,
  PSR_TEMPERATURE_K,
  sunInBodyFrame,
} from './thermal'
import { createObserver, subEarthPoint } from './observer'
import { siteById } from './sites'

describe('thermal model', () => {
  it('puts the subsolar point near Diviner\'s ~390 K noon maximum', () => {
    expect(dayTemperature(1)).toBeGreaterThan(375)
    expect(dayTemperature(1)).toBeLessThan(400)
  })

  it('cools from ~120 K at sunset to ~95 K before dawn at the equator', () => {
    expect(nightTemperature(0, 0)).toBeCloseTo(120, 0)
    expect(nightTemperature(350, 0)).toBeGreaterThan(94)
    expect(nightTemperature(350, 0)).toBeLessThan(97)
    expect(nightTemperature(100, 85)).toBeLessThan(nightTemperature(100, 0))
  })

  it('places sunset 90 deg east of the subsolar meridian and noon on it', () => {
    expect(hoursSinceSunset(90, 0)).toBeCloseTo(0, 6)
    expect(hoursSinceSunset(180, 0)).toBeCloseTo(29.530589 * 6, 3)
  })

  it('agrees with the observer on whether the Sun is up at a site', () => {
    const site = siteById('apollo11')!
    const observer = createObserver(site)
    const r = Math.PI / 180
    const up = {
      x: Math.cos(site.lat * r) * Math.cos(site.lon * r),
      y: Math.cos(site.lat * r) * Math.sin(site.lon * r),
      z: Math.sin(site.lat * r),
    }
    for (let h = 0; h < 30 * 24; h += 7) {
      const t = Date.parse('2026-11-14T00:00:00Z') + h * 3_600_000
      const sun = sunInBodyFrame(t)
      const elev = Math.asin(sun.dir.x * up.x + sun.dir.y * up.y + sun.dir.z * up.z) / r
      expect(Math.abs(elev - observer.skyAt(t).sun.elevation)).toBeLessThan(0.1)
      const k = cellTemperature(sun, site.lat, site.lon, up, up, 50)
      if (elev > 30) expect(k).toBeGreaterThan(300)
      if (elev < -1) expect(k).toBeLessThan(125)
    }
    expect(subEarthPoint(Date.parse('2026-11-14T00:00:00Z')).lat).toBeDefined()
  })

  it('keeps permanently shadowed cells at the cold-trap temperature', () => {
    const sun = sunInBodyFrame(Date.parse('2026-11-14T00:00:00Z'))
    const up = { x: 0, y: 0, z: -1 }
    expect(cellTemperature(sun, -89.67, 129.78, up, up, 0)).toBe(PSR_TEMPERATURE_K)
  })
})

describe('precomputed sunlight map', () => {
  const buf = readFileSync(new URL('../../../public/illumination-map.u8', import.meta.url))
  const map = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const at = (lat: number, lon: number) =>
    map[Math.min(719, Math.floor((90 - lat) * 4)) * 1440 + (Math.floor((lon + 180) * 4) % 1440)]

  it('covers the whole grid', () => {
    expect(map.length).toBe(1440 * 720)
    expect(map.every((v) => v <= 100)).toBe(true)
  })

  it('shows known permanent shadows dark and polar crests bright', () => {
    expect(at(-84.675, -48.72)).toBe(0) // Cabeus, LCROSS impact
    expect(at(-89.67, 129.78)).toBe(0) // Shackleton floor
    expect(at(-89.4, -142.0)).toBeGreaterThan(65) // Connecting Ridge crest
    expect(Math.abs(at(0.674, 23.473) - 50)).toBeLessThan(5) // Apollo 11: day/night split
  })
})
