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
