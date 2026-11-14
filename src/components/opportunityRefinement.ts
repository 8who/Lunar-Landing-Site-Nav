import { marginFor, type OpportunityCell, type OpportunityConstraints } from '../lib/astro/opportunity'
import { buildTimeline } from '../lib/astro/timeline'
import type { TimeWindow } from '../lib/astro/types'

export const REFINEMENT_STEP_MS = 5 * 60_000
const CHUNK_MS = 6 * 3_600_000

export interface RefinedOpportunity extends OpportunityCell {
  binding: string[]
  longestBlackoutMs: number
  longestDarknessMs: number
}

/** Complement of sorted visibility windows, including both mission edges. */
export function longestGap(windows: TimeWindow[], start: number, end: number): number {
  let cursor = start
  let longest = 0
  for (const window of windows) {
    longest = Math.max(longest, Math.min(end, window.start) - cursor)
    cursor = Math.max(cursor, Math.min(end, window.end))
  }
  return Math.max(longest, end - cursor)
}

/**
 * Yield after each bounded timeline calculation so the caller can cancel.
 * Six-hour chunks stay below sampleRange's cap even for ten-day missions,
 * preserving a real five-minute cadence. Shared endpoints add no duration.
 */
export function* refineOpportunity(
  cell: OpportunityCell,
  durationMs: number,
  constraints: OpportunityConstraints,
): Generator<void, RefinedOpportunity> {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new Error('Invalid mission duration')
  const end = cell.start + durationMs
  const sunWindows: TimeWindow[] = []
  const commWindows: TimeWindow[] = []
  let sunlitMs = 0
  let commMs = 0
  let jointMs = 0
  for (let start = cell.start; start < end; start += CHUNK_MS) {
    const timeline = buildTimeline(cell.site, start, Math.min(end, start + CHUNK_MS), REFINEMENT_STEP_MS)
    sunlitMs += timeline.metrics.sunlitMs
    commMs += timeline.metrics.commMs
    jointMs += timeline.metrics.jointMs
    sunWindows.push(...timeline.sunWindows)
    commWindows.push(...timeline.commWindows)
    yield
  }
  const metrics = {
    jointPct: jointMs / durationMs * 100,
    sunlitPct: sunlitMs / durationMs * 100,
    commPct: commMs / durationMs * 100,
  }
  const margin = marginFor(metrics, constraints)
  const margins: [string, number][] = [
    ['joint', metrics.jointPct - constraints.minJointPct],
    ['sunlight', metrics.sunlitPct - constraints.minSunlitPct],
    ['Earth visibility', metrics.commPct - constraints.minCommPct],
  ]
  return {
    ...cell, metrics, margin, meets: margin >= 0,
    binding: margins.filter(([, value]) => Math.abs(value - margin) < 1e-9).map(([label]) => label),
    longestBlackoutMs: longestGap(commWindows, cell.start, end),
    longestDarknessMs: longestGap(sunWindows, cell.start, end),
  }
}
