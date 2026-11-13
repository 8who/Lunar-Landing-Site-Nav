import { describe, expect, it } from 'vitest'
import { rankSites } from './ranking'
import { SITES, customSite } from './sites'

const DAY = 86_400_000
const t0 = Date.parse('2028-01-01T00:00:00Z')
const t1 = t0 + 30 * DAY

// Longitude 180 deg sits on the far side: Earth is permanently hidden there.
const farSide = customSite(0, 180, 'Far-side reference')
const apollo11 = SITES.find((s) => s.id === 'apollo11')!
const shackleton = SITES.find((s) => s.id === 'shackleton')!
const sites = [farSide, apollo11, shackleton]

const byComm = rankSites(sites, t0, t1, { sortBy: 'commPct' })
const rowOf = (rows: ReturnType<typeof rankSites>, id: string) =>
  rows.find((r) => r.site.id === id)!

describe('rankSites', () => {
  it('reports no direct-to-Earth link on the far side', () => {
    expect(rowOf(byComm, farSide.id).metrics.commPct).toBe(0)
  })

  it('ranks the far side below Apollo 11 when sorting by Earth link', () => {
    const apollo = rowOf(byComm, apollo11.id)
    const far = rowOf(byComm, farSide.id)
    expect(apollo.metrics.commPct).toBeGreaterThan(0)
    expect(byComm.indexOf(far)).toBeGreaterThan(byComm.indexOf(apollo))
  })

  it('is sorted descending by the requested metric', () => {
    for (let i = 1; i < byComm.length; i++) {
      expect(byComm[i - 1].metrics.commPct).toBeGreaterThanOrEqual(byComm[i].metrics.commPct)
    }
  })

  it('sorts by every supported key', () => {
    for (const key of ['jointPct', 'sunlitPct', 'commPct', 'longestCommMs'] as const) {
      const rows = rankSites(sites, t0, t1, { sortBy: key })
      expect(rows).toHaveLength(sites.length)
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1].metrics[key], `order by ${key}`).toBeGreaterThanOrEqual(
          rows[i].metrics[key],
        )
      }
    }
  })

  it('keeps one row per input site', () => {
    const rows = rankSites(SITES, t0, t0 + 2 * DAY, { sortBy: 'sunlitPct' })
    expect(rows).toHaveLength(SITES.length)
    expect(new Set(rows.map((r) => r.site.id)).size).toBe(SITES.length)
  })
})
