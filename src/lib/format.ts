export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const totalMin = Math.round(ms / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

const pad = (n: number) => String(n).padStart(2, '0')

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export function formatUtc(t: number, opts: { seconds?: boolean } = {}): string {
  const d = new Date(t)
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`
  return opts.seconds ? `${base}:${pad(d.getUTCSeconds())} UTC` : `${base} UTC`
}

export function formatDay(t: number): string {
  const d = new Date(t)
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}

export function formatDeg(v: number, digits = 1): string {
  return `${v.toFixed(digits)}°`
}

/** Signed degree, one decimal, never "-0.0". */
export const deg = (v: number) => `${Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1)}°`

export function formatCountdown(target: number | undefined, now: number): string {
  if (target === undefined) return 'outside range'
  const dt = target - now
  if (dt <= 0) return 'passed'
  return `in ${formatDuration(dt)}`
}

/** value in [0,1] -> 0..100 with one decimal */
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** value already in percent (0..100) */
export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`
}

/** Duration in hours with one decimal, for "X h of this day" copy. */
export function formatHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)} h`
}

/** Minutes after midnight -> HH:MM (UTC). */
export function formatClockMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`
}

/** "Nov 13" in UTC, for compact date ticks. */
export function formatMonthDay(t: number): string {
  const d = new Date(t)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Nov 13 2026 · 12:00 UTC". */
export function formatInstant(t: number): string {
  const d = new Date(t)
  return `${formatMonthDay(t)} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )} UTC`
}

/** Selenographic coordinates in plain text: "0.67 N, 23.47 E". */
export function formatCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)} ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)} ${
    lon >= 0 ? 'E' : 'W'
  }`
}
