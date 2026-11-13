/**
 * Conversions for the Explorer lunar-cycle scrubber: a 30-day window mapped to
 * slider minutes, epoch milliseconds and UTC calendar fields.
 */

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** Days covered by one scrub window. */
export const SCRUB_DAYS = 30
export const SCRUB_SPAN_MS = SCRUB_DAYS * DAY_MS
/** Slider maximum, in minutes across the whole window. */
export const SCRUB_MAX_MIN = SCRUB_DAYS * 24 * 60

/** Slider minutes -> epoch ms, clamped to the window. */
export function sliderMinutesToTime(windowStart: number, minutes: number): number {
  const clamped = Math.min(SCRUB_MAX_MIN, Math.max(0, minutes))
  return windowStart + clamped * MINUTE_MS
}

/** Epoch ms -> slider minutes, clamped to the window. */
export function timeToSliderMinutes(windowStart: number, t: number): number {
  const minutes = (t - windowStart) / MINUTE_MS
  return Math.min(SCRUB_MAX_MIN, Math.max(0, minutes))
}

/** Minutes after UTC midnight, rounded down to `step` and capped at the last valid step of the day. */
export function minutesOfDayUtc(t: number, step = 5): number {
  const d = new Date(t)
  const afterMidnight = d.getUTCHours() * 60 + d.getUTCMinutes()
  const rounded = Math.floor(afterMidnight / step) * step
  return Math.min(Math.floor(1439 / step) * step, rounded)
}

/** 'YYYY-MM-DD' for an instant, UTC. */
export function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** UTC midnight of the day containing an instant. */
export function utcDayStart(t: number): number {
  return Date.parse(`${utcDay(t)}T00:00:00Z`)
}

/** Position of an instant across the scrub window, percent 0..100 (clamped). */
export function windowPercent(windowStart: number, t: number): number {
  return Math.min(100, Math.max(0, ((t - windowStart) / SCRUB_SPAN_MS) * 100))
}
