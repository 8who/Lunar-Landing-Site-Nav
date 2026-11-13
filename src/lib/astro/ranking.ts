import { buildTimeline } from './timeline'
import type { LunarSite, TimelineMetrics } from './types'

export type RankSortKey =
  | 'jointPct'
  | 'sunlitPct'
  | 'commPct'
  | 'longestCommMs'
  | 'meanTrackingIncidence'

export interface RankedSite {
  site: LunarSite
  metrics: TimelineMetrics
}

export interface RankOptions {
  /** Sampling step, default 1 h: ranking only needs coarse accuracy. */
  stepMs?: number
  sortBy: RankSortKey
}

export const DEFAULT_RANK_STEP_MS = 3_600_000

/**
 * Score every site over [t0, t1] and sort descending by one metric.
 *
 * This is the "time-first" view: give a date range, see which sites are
 * actually viable. Ties keep the input order (Array.prototype.sort is stable).
 */
export function rankSites(
  sites: LunarSite[],
  t0: number,
  t1: number,
  opts: RankOptions,
): RankedSite[] {
  const stepMs = opts.stepMs ?? DEFAULT_RANK_STEP_MS
  return sites
    .map((site) => ({ site, metrics: buildTimeline(site, t0, t1, stepMs).metrics }))
    .sort((a, b) => b.metrics[opts.sortBy] - a.metrics[opts.sortBy])
}
