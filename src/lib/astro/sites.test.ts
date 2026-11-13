import { describe, expect, it } from 'vitest'
import { SITES, siteById } from './sites'

describe('curated sites', () => {
  it('puts Chandrayaan-3 in the southern hemisphere', () => {
    const site = siteById('chandrayaan3')
    expect(site).toBeDefined()
    expect(site!.lat).toBeLessThan(0)
  })

  it('keeps every coordinate inside the selenographic range', () => {
    // The catalogue is east-positive in -180..180; no site uses a 0..360 convention.
    for (const site of SITES) {
      expect(site.lat, `${site.id} lat`).toBeGreaterThanOrEqual(-90)
      expect(site.lat, `${site.id} lat`).toBeLessThanOrEqual(90)
      expect(site.lon, `${site.id} lon`).toBeGreaterThanOrEqual(-180)
      expect(site.lon, `${site.id} lon`).toBeLessThanOrEqual(180)
    }
  })

  it('has unique ids', () => {
    const ids = SITES.map((site) => site.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
