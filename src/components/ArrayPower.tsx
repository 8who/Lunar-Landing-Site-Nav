import { useMemo } from 'react'
import { createObserver } from '../lib/astro/observer'
import { compassPoint16, trackingPointing } from '../lib/astro/panel'
import type { LunarSite } from '../lib/astro/types'

const w = (x: number) => `${Math.round(x)} W/m²`

export interface ArrayPowerRow {
  label: string
  value: number
}

/** Average power per m² for each array layout, as bars scaled to the best one. */
export function ArrayPowerBars({ rows, caption }: { rows: ArrayPowerRow[]; caption: string }) {
  const best = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="array-compare">
      <span className="array-caption">{caption}</span>
      {rows.map((r) => (
        <div className="array-bar" key={r.label}>
          <span>{r.label}</span>
          <div className="array-bar-track">
            <div className="array-bar-fill" style={{ width: `${Math.max(0.5, (r.value / best) * 100)}%` }} />
          </div>
          <span className="mono">{w(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Pointing of a Sun-tracking array right now, at the mast top. */
export function useTrackingPointing(site: LunarSite, t: number) {
  const observer = useMemo(() => createObserver(site), [site])
  return useMemo(() => {
    const sample = observer.skyAt(t)
    return { sample, pointing: trackingPointing(observer, sample) }
  }, [observer, t])
}

/** "Mast 2 m · horizon 0.09° lower" */
export function mastLine(site: LunarSite, dipDeg: number | undefined): string {
  const mast = site.mastHeightM ?? 0
  return dipDeg && dipDeg > 0
    ? `Mast ${mast} m · horizon ${dipDeg.toFixed(2)}° lower`
    : `Mast ${mast} m · horizon at ground level`
}

/** Explorer-mode card: where to point the array now, and what each layout yields. */
export default function ArrayCard({
  site,
  t,
  rows,
  rangeLabel,
}: {
  site: LunarSite
  t: number
  rows: ArrayPowerRow[]
  rangeLabel: string
}) {
  const { sample, pointing: p } = useTrackingPointing(site, t)
  return (
    <section className="chart-card array-card">
      <div className="chart-head">
        <div>
          <h2>Solar array</h2>
          <p>{mastLine(site, sample.horizonDipDeg)}</p>
        </div>
      </div>

      {p.sunUp ? (
        <div className="array-now">
          <div>
            <span className="array-caption">Tilt</span>
            <strong className="mono">{p.tiltDeg.toFixed(1)}°</strong>
            <small>{p.tiltDeg > 80 ? 'almost vertical' : 'from horizontal'}</small>
          </div>
          <div>
            <span className="array-caption">Face</span>
            <strong className="mono">
              {p.azimuthDeg.toFixed(0)}° {compassPoint16(p.azimuthDeg)}
            </strong>
            <small>compass heading</small>
          </div>
          <div>
            <span className="array-caption">Turn</span>
            <strong className="mono">{Math.abs(p.turnRateDegPerHour).toFixed(2)}°/h</strong>
            <small>{p.turnRateDegPerHour >= 0 ? 'clockwise' : 'counter-clockwise'} to keep facing it</small>
          </div>
        </div>
      ) : (
        <p className="muted-line">Sun below the horizon: nothing to point at, the lander runs on batteries.</p>
      )}

      <ArrayPowerBars rows={rows} caption={`Average power per m² · ${rangeLabel}`} />
    </section>
  )
}
