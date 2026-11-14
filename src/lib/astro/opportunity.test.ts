import { describe, expect, it } from 'vitest'
import {
  OPPORTUNITY_STEP_MS,
  buildStarts,
  closestWindows,
  earliestPerSite,
  scanOpportunities,
  scanSite,
  type OpportunityCell,
  type OpportunityMetrics,
} from './opportunity'
import { SITES } from './sites'

const DAY = 86_400_000
const START = Date.parse('2028-01-01T00:00:00Z')
const CONSTRAINTS = { minJointPct: 50, minSunlitPct: 50, minCommPct: 50 }

const metrics = (joint: number, sun = joint, comm = joint): OpportunityMetrics => ({
  jointPct: joint,
  sunlitPct: sun,
  commPct: comm,
})

const candidates = SITES.filter((s) => s.category === 'candidate')

function cell(
  site = candidates[0],
  start = START,
  joint = 60,
  sun = joint,
  comm = joint,
): OpportunityCell {
  const margin = Math.min(joint - 50, sun - 50, comm - 50)
  return {
    site,
    start,
    metrics: metrics(joint, sun, comm),
    margin,
    meets: margin >= 0,
  }
}

describe('buildStarts', () => {
  it('spans the horizon without running past it', () => {
    const starts = buildStarts(START, START + 10 * DAY, 2 * DAY, 2 * DAY)
    expect(starts).toEqual([
      START,
      START + 2 * DAY,
      START + 4 * DAY,
      START + 6 * DAY,
      START + 8 * DAY,
    ])
  })

  it('returns nothing when the mission is longer than the horizon', () => {
    expect(buildStarts(START, START + 2 * DAY, 3 * DAY, DAY)).toEqual([])
  })

  it('rejects a non-positive step', () => {
    expect(buildStarts(START, START + 10 * DAY, DAY, 0)).toEqual([])
  })

  it('keeps a single start when the step exceeds the horizon', () => {
    expect(buildStarts(START, START + 2 * DAY, DAY, 30 * DAY)).toEqual([START])
  })
})

describe('scanSite', () => {
  it('flags a cell only when every threshold is met', () => {
    const scores = [metrics(60), metrics(60, 40, 80), metrics(60, 80, 30)]
    let index = 0
    const cells = scanSite(
      candidates[0],
      [START, START + DAY, START + 2 * DAY],
      {
        durationMs: DAY,
        constraints: CONSTRAINTS,
        score: () => scores[index++],
      },
    )
    expect(cells.map((c) => c.meets)).toEqual([true, false, false])
    expect(cells.map((c) => c.margin)).toEqual([10, -10, -20])
  })

  it('scores exactly the requested mission window', () => {
    const calls: number[][] = []
    scanSite(candidates[0], [START], {
      durationMs: 2 * DAY,
      constraints: CONSTRAINTS,
      stepMs: 7_200_000,
      score: (_site, t0, t1, stepMs) => {
        calls.push([t0, t1, stepMs])
        return metrics(0)
      },
    })
    expect(calls).toEqual([[START, START + 2 * DAY, 7_200_000]])
  })

  it('defaults to a 3 h sampling step', () => {
    let used: number | undefined
    scanSite(candidates[0], [START], {
      durationMs: DAY,
      constraints: CONSTRAINTS,
      score: (_site, _t0, _t1, stepMs) => {
        used = stepMs
        return metrics(0)
      },
    })
    expect(used).toBe(OPPORTUNITY_STEP_MS)
  })
})

describe('scanOpportunities', () => {
  const sites = candidates.slice(0, 2)

  it('covers every site and start date, site by site', () => {
    const grid = scanOpportunities(sites, START, START + 3 * DAY, {
      durationMs: DAY,
      startStepMs: DAY,
      constraints: { minJointPct: 0, minSunlitPct: 0, minCommPct: 0 },
      score: () => metrics(10),
    })
    expect(grid.starts).toHaveLength(3)
    expect(grid.cells).toHaveLength(6)
    expect(grid.cells.slice(0, 3).every((c) => c.site.id === sites[0].id)).toBe(true)
    expect(grid.cells.slice(3).every((c) => c.site.id === sites[1].id)).toBe(true)
  })

  it('keeps the earliest passing start per site, sorted by date', () => {
    const grid = {
      sites,
      starts: [START, START + DAY],
      cells: [
        cell(sites[0], START, 55),
        cell(sites[0], START + DAY, 70),
        cell(sites[1], START, 80),
        cell(sites[1], START + DAY, 90, 40), // fails on sunlight
      ],
    }
    const earliest = earliestPerSite(grid)
    expect(earliest).toHaveLength(2)
    expect(earliest.map((c) => c.site.id)).toEqual([sites[1].id, sites[0].id])
    expect(earliest[1].start).toBe(START)
    expect(earliest[0].metrics.jointPct).toBe(80)
  })

  it('drops every failing cell from the shortlist', () => {
    const grid = {
      sites,
      starts: [START],
      cells: [cell(sites[0], START, 40), cell(sites[1], START, 20)],
    }
    expect(earliestPerSite(grid)).toEqual([])
  })

  it('offers the closest attempts when nothing passes', () => {
    const grid = {
      sites,
      starts: [START, START + DAY],
      cells: [
        cell(sites[0], START, 45),
        cell(sites[0], START + DAY, 48),
        cell(sites[1], START, 10),
      ],
    }
    const closest = closestWindows(grid, 2)
    expect(closest).toHaveLength(2)
    expect(closest[0].start).toBe(START + DAY)
    expect(closest[0].margin).toBe(-2)
  })
})

describe('real ephemeris', () => {
  it('finds a feasible Shackleton window in January 2028', () => {
    const shackleton = SITES.find((s) => s.id === 'shackleton')!
    const grid = scanOpportunities([shackleton], START, START + 30 * DAY, {
      durationMs: 5 * DAY,
      startStepMs: DAY,
      constraints: { minJointPct: 30, minSunlitPct: 30, minCommPct: 30 },
    })
    const best = earliestPerSite(grid, 3)
    expect(best).toHaveLength(1)
    expect(best[0].metrics.jointPct).toBeGreaterThan(30)
    // Polar summer: the rim is lit almost continuously.
    expect(best[0].metrics.sunlitPct).toBeGreaterThan(50)
    // The window must stay inside the requested horizon.
    expect(best[0].start).toBeGreaterThanOrEqual(START)
    expect(best[0].start + 5 * DAY).toBeLessThanOrEqual(START + 30 * DAY)
  })
})
