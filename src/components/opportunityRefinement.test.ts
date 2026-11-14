import { describe, expect, it, vi } from 'vitest'
import { longestGap, refineOpportunity, REFINEMENT_STEP_MS } from './opportunityRefinement'
import * as timeline from '../lib/astro/timeline'
import { scanSite } from '../lib/astro/opportunity'
import { SITES } from '../lib/astro/sites'
import type { TimeWindow } from '../lib/astro/types'

const DAY = 86_400_000
const START = Date.parse('2028-01-01T00:00:00Z')
const constraints = { minJointPct: 30, minSunlitPct: 30, minCommPct: 30 }
const site = SITES.find((candidate) => candidate.id === 'shackleton')!
const window = (start: number, end: number): TimeWindow => ({
  start, end, durationMs: end - start, closed: true,
})

describe('longestGap', () => {
  it('counts complete blackout and complete visibility', () => {
    expect(longestGap([], 0, 100)).toBe(100)
    expect(longestGap([window(0, 100)], 0, 100)).toBe(0)
  })

  it('includes both mission edges and carries gaps over chunk boundaries', () => {
    expect(longestGap([window(10, 20), window(60, 70)], 0, 100)).toBe(40)
    expect(longestGap([window(0, 20), window(20, 40)], 0, 100)).toBe(60)
    expect(longestGap([window(40, 80)], 0, 100)).toBe(40)
  })
})

describe('refineOpportunity', () => {
  it('matches an uncapped five-minute timeline, including binding constraints and outages', () => {
    const durationMs = 5 * DAY
    const [coarse] = scanSite(site, [START], { durationMs, constraints })
    const reference = timeline.buildTimeline(site, START, START + durationMs, REFINEMENT_STEP_MS)
    const iterator = refineOpportunity(coarse, durationMs, constraints)
    let next = iterator.next()
    let yields = 0
    while (!next.done) {
      yields += 1
      next = iterator.next()
    }
    const refined = next.value
    expect(yields).toBe(20)
    for (const key of ['jointPct', 'sunlitPct', 'commPct'] as const) {
      expect(refined.metrics[key]).toBeCloseTo(reference.metrics[key], 8)
    }
    expect(refined.longestBlackoutMs).toBeCloseTo(longestGap(reference.commWindows, START, START + durationMs), 0)
    expect(refined.longestDarknessMs).toBeCloseTo(longestGap(reference.sunWindows, START, START + durationMs), 0)
    const margins = [refined.metrics.jointPct - 30, refined.metrics.sunlitPct - 30, refined.metrics.commPct - 30]
    expect(refined.margin).toBe(Math.min(...margins))
    expect(refined.meets).toBe(refined.margin >= 0)
    expect(refined.binding.length).toBeGreaterThan(0)
    // Physical anchor: the Shackleton rim is illuminated through much of polar summer.
    expect(refined.metrics.sunlitPct).toBeGreaterThan(50)
  })

  it('preserves five-minute sampling beyond the 2400-sample cap and supports early termination', () => {
    const durationMs = 10 * DAY
    const [coarse] = scanSite(site, [START], { durationMs, constraints })
    const spy = vi.spyOn(timeline, 'buildTimeline')
    try {
      const iterator = refineOpportunity(coarse, durationMs, constraints)
      let next = iterator.next()
      while (!next.done) next = iterator.next()
      expect(spy).toHaveBeenCalledTimes(40)
      for (const [, from, to, step] of spy.mock.calls) {
        expect(step).toBe(REFINEMENT_STEP_MS)
        expect((to - from) / step).toBe(72)
      }
      expect(spy.mock.calls[0][1]).toBe(START)
      expect(spy.mock.calls[39][2]).toBe(START + durationMs)
      spy.mockClear()
      const cancelled = refineOpportunity(coarse, durationMs, constraints)
      cancelled.next()
      expect(spy).toHaveBeenCalledTimes(1)
      // Discarding the generator schedules no work of its own.
      cancelled.return(next.value)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('rechecks a coarse pass against stricter criteria rather than retaining its verdict', () => {
    const durationMs = DAY / 4
    const [coarse] = scanSite(site, [START], {
      durationMs, constraints: { minJointPct: 0, minSunlitPct: 0, minCommPct: 0 },
    })
    const iterator = refineOpportunity(coarse, durationMs, { minJointPct: 101, minSunlitPct: 0, minCommPct: 0 })
    iterator.next()
    const next = iterator.next()
    expect(next.done).toBe(true)
    if (!next.done) throw new Error('Expected completed refinement')
    expect(coarse.meets).toBe(true)
    expect(next.value.meets).toBe(false)
    expect(next.value.binding).toEqual(['joint'])
    expect(next.value.margin).toBeLessThan(0)
  })
})
