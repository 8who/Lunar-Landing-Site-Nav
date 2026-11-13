import type { TimeWindow } from './types'

/** Earliest minute-aligned operation that fits entirely in a visibility window. */
export function findMissionWindow(windows: TimeWindow[], now: number, hours: number): TimeWindow | undefined {
  if (!Number.isFinite(now) || !Number.isFinite(hours) || hours <= 0) return undefined
  for (const window of windows) {
    const start = Math.ceil(Math.max(now, window.start) / 60_000) * 60_000
    if (window.end - start >= hours * 3_600_000) {
      return { ...window, start, durationMs: window.end - start }
    }
  }
  return undefined
}
