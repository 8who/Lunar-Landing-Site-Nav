/**
 * Inverse search: given a mission length and minimum power / comms fractions,
 * find the candidate sites and start dates that clear the bar.
 *
 * The forward workflow answers "what happens at this site on this date?".
 * This one answers the planner's question: "when and where can the mission
 * actually work?". Everything here is pure; the UI scores one site at a time
 * so the main thread stays responsive.
 */

import { buildTimeline } from './timeline'
import type { LunarSite } from './types'

/** Minimum acceptable percentages, 0..100. */
export interface OpportunityConstraints {
  minJointPct: number
  minSunlitPct: number
  minCommPct: number
}

/** The three numbers a calendar cell needs. A full TimelineMetrics fits. */
export interface OpportunityMetrics {
  jointPct: number
  sunlitPct: number
  commPct: number
}

/** Injected in tests; defaults to the real ephemeris. */
export type OpportunityScorer = (
  site: LunarSite,
  t0: number,
  t1: number,
  stepMs: number,
) => OpportunityMetrics

export interface OpportunityScanOptions {
  /** Mission length, ms. */
  durationMs: number
  constraints: OpportunityConstraints
  /** Sampling inside each candidate window; default 3 h. */
  stepMs?: number
  /** Override the scorer (tests only). */
  score?: OpportunityScorer
}

export interface OpportunityGridOptions extends OpportunityScanOptions {
  /** Spacing between candidate start dates, ms. */
  startStepMs: number
}

export interface OpportunityCell {
  site: LunarSite
  /** First instant of the candidate mission window, epoch ms. */
  start: number
  metrics: OpportunityMetrics
  /** Smallest distance to a threshold, percentage points; negative fails. */
  margin: number
  meets: boolean
}

export interface OpportunityGrid {
  sites: LunarSite[]
  starts: number[]
  /** Site-major: every start date for the first site, then the next site. */
  cells: OpportunityCell[]
}

/** 3 h: enough to place a multi-day window, cheap enough to scan a year. */
export const OPPORTUNITY_STEP_MS = 10_800_000

export const DEFAULT_OPPORTUNITY_CONSTRAINTS: OpportunityConstraints = {
  minJointPct: 50,
  minSunlitPct: 50,
  minCommPct: 50,
}

const defaultScorer: OpportunityScorer = (site, t0, t1, stepMs) =>
  buildTimeline(site, t0, t1, stepMs).metrics

/**
 * Candidate start dates from t0 to t1, spaced by `startStepMs`, never letting
 * a mission window run past t1. Empty when the mission cannot fit.
 */
export function buildStarts(
  t0: number,
  t1: number,
  durationMs: number,
  startStepMs: number,
): number[] {
  if (!(durationMs > 0) || !(startStepMs > 0)) return []
  const lastStart = t1 - durationMs
  const starts: number[] = []
  for (let start = t0; start <= lastStart; start += startStepMs) starts.push(start)
  return starts
}

/** Distance to the binding constraint, in percentage points. */
export function marginFor(
  metrics: OpportunityMetrics,
  constraints: OpportunityConstraints,
): number {
  return Math.min(
    metrics.jointPct - constraints.minJointPct,
    metrics.sunlitPct - constraints.minSunlitPct,
    metrics.commPct - constraints.minCommPct,
  )
}

/** Score one site for every candidate start date. */
export function scanSite(
  site: LunarSite,
  starts: number[],
  opts: OpportunityScanOptions,
): OpportunityCell[] {
  const stepMs = opts.stepMs ?? OPPORTUNITY_STEP_MS
  const score = opts.score ?? defaultScorer
  return starts.map((start) => {
    const metrics = score(site, start, start + opts.durationMs, stepMs)
    const margin = marginFor(metrics, opts.constraints)
    return { site, start, metrics, margin, meets: margin >= 0 }
  })
}

/** Score every site against every candidate start date. */
export function scanOpportunities(
  sites: LunarSite[],
  t0: number,
  t1: number,
  opts: OpportunityGridOptions,
): OpportunityGrid {
  const starts = buildStarts(t0, t1, opts.durationMs, opts.startStepMs)
  const cells = sites.flatMap((site) => scanSite(site, starts, opts))
  return { sites, starts, cells }
}

/**
 * Earliest start date per site among the cells that meet the constraints.
 * A planner asks "when can I go?", not "what is the theoretical best", so the
 * first date that clears the bar wins; equal dates fall back to joint capture.
 */
export function earliestPerSite(grid: OpportunityGrid, limit = 8): OpportunityCell[] {
  const earliest = new Map<string, OpportunityCell>()
  for (const cell of grid.cells) {
    if (!cell.meets) continue
    const current = earliest.get(cell.site.id)
    if (!current || cell.start < current.start) earliest.set(cell.site.id, cell)
  }
  return [...earliest.values()]
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.metrics.jointPct - a.metrics.jointPct ||
        a.site.id.localeCompare(b.site.id),
    )
    .slice(0, Math.max(0, limit))
}

/** Cells closest to passing, for the "nothing clears the bar" message. */
export function closestWindows(grid: OpportunityGrid, limit = 3): OpportunityCell[] {
  return [...grid.cells]
    .sort((a, b) => b.margin - a.margin || b.metrics.jointPct - a.metrics.jointPct)
    .slice(0, Math.max(0, limit))
}
