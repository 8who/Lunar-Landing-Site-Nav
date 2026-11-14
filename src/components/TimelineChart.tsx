import { useMemo, useRef, useState } from 'react'
import type { SkySample, TimeWindow } from '../lib/astro/types'
import { deg, formatDay, formatUtc } from '../lib/format'

interface Props {
  samples: SkySample[]
  sunWindows: TimeWindow[]
  commWindows: TimeWindow[]
  onHover?: (sample: SkySample | null) => void
  /** Clicking the plot pins that moment, so it survives the pointer leaving. */
  onPick?: (sample: SkySample) => void
  /** Moment pinned by a click; kept on screen while nothing is hovered. */
  pinned?: SkySample | null
}

const W = 1000
const H = 380
const M = { top: 34, right: 18, bottom: 30, left: 46 }
const INNER_W = W - M.left - M.right
const INNER_H = H - M.top - M.bottom

function yTicks(maxAbs: number): number[] {
  const step = maxAbs <= 10 ? 2.5 : maxAbs <= 20 ? 5 : maxAbs <= 45 ? 10 : 30
  const out: number[] = []
  for (let v = -maxAbs; v <= maxAbs + 1e-9; v += step) out.push(Math.round(v * 10) / 10)
  return out
}

export default function TimelineChart({
  samples,
  sunWindows,
  commWindows,
  onHover,
  onPick,
  pinned,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const t0 = samples[0]?.t ?? 0
  const t1 = samples[samples.length - 1]?.t ?? 1
  const span = Math.max(1, t1 - t0)

  const x = (t: number) => M.left + ((t - t0) / span) * INNER_W

  // Adaptive vertical scale: at the poles everything happens within a few
  // degrees of the horizon, while equatorial sites need the full +-90 range.
  // A terrain skyline can sit 30° up, and the chart has to show it.
  const maxAbs = useMemo(() => {
    let m = 0
    for (const s of samples) {
      m = Math.max(
        m,
        Math.abs(s.sun.elevation),
        Math.abs(s.earth.elevation),
        Math.abs(s.sun.horizonDeg ?? 0),
      )
    }
    if (m < 10) return 10
    if (m < 20) return 20
    return Math.min(90, Math.ceil((m + 3) / 10) * 10)
  }, [samples])

  const hasSkyline = useMemo(
    () => samples.some((s) => s.sun.horizonDeg !== undefined),
    [samples],
  )

  const y = (elev: number) =>
    M.top + ((maxAbs - Math.max(-maxAbs, Math.min(maxAbs, elev))) / (2 * maxAbs)) * INNER_H

  const paths = useMemo(() => {
    const build = (key: 'sun' | 'earth') => {
      let d = ''
      samples.forEach((s, i) => {
        d += `${i === 0 ? 'M' : 'L'}${x(s.t).toFixed(2)},${y(s[key].elevation).toFixed(2)}`
      })
      return d
    }
    const skyline = () => {
      if (!hasSkyline) return ''
      let d = ''
      samples.forEach((s, i) => {
        const sky = s.sun.horizonDeg ?? 0
        d += `${i === 0 ? 'M' : 'L'}${x(s.t).toFixed(2)},${y(sky).toFixed(2)}`
      })
      return d
    }
    // Lit area: between the Sun and the skyline it has to clear, only where it
    // is above it. Without a profile the skyline is the tangent plane.
    const sunArea = () => {
      let d = ''
      let band: { px: number; sun: number; sky: number }[] = []
      const flush = () => {
        if (band.length === 0) return
        d += `M${band[0].px.toFixed(2)},${y(band[0].sky).toFixed(2)}`
        for (const p of band) d += `L${p.px.toFixed(2)},${y(p.sun).toFixed(2)}`
        for (let i = band.length - 1; i >= 0; i--) {
          d += `L${band[i].px.toFixed(2)},${y(band[i].sky).toFixed(2)}`
        }
        d += 'Z'
        band = []
      }
      for (const s of samples) {
        const sky = s.sun.horizonDeg ?? 0
        if (s.sun.elevation > sky) band.push({ px: x(s.t), sun: s.sun.elevation, sky })
        else flush()
      }
      flush()
      return d
    }
    return {
      sun: build('sun'),
      earth: build('earth'),
      skyline: skyline(),
      sunArea: sunArea(),
    }
  }, [samples, t0, t1, maxAbs, hasSkyline])

  const xTicks = useMemo(() => {
    const days = span / 86_400_000
    const stepDays = days <= 10 ? 1 : days <= 40 ? 5 : days <= 120 ? 10 : 30
    const stepMs = stepDays * 86_400_000
    const first = Math.ceil(t0 / stepMs) * stepMs
    const out: number[] = []
    for (let t = first; t <= t1; t += stepMs) out.push(t)
    return out
  }, [t0, t1, span])

  const hovered = hoverIdx !== null ? samples[hoverIdx] : null
  // Once the pointer leaves, the clicked moment stays on screen.
  const marker = hovered ?? pinned ?? null

  const sampleAt = (clientX: number): { sample: SkySample; index: number } | null => {
    const svg = svgRef.current
    if (!svg || samples.length === 0) return null
    const rect = svg.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    const t = t0 + ratio * span
    // nearest sample (binary search)
    let lo = 0
    let hi = samples.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (samples[mid].t < t) lo = mid
      else hi = mid
    }
    const index = Math.abs(samples[lo].t - t) <= Math.abs(samples[hi].t - t) ? lo : hi
    return { sample: samples[index], index }
  }

  const pick = (clientX: number) => {
    const hit = sampleAt(clientX)
    if (!hit) return
    setHoverIdx(hit.index)
    onHover?.(hit.sample)
  }

  const commit = (clientX: number) => {
    const hit = sampleAt(clientX)
    if (!hit) return
    setHoverIdx(hit.index)
    onHover?.(hit.sample)
    onPick?.(hit.sample)
  }

  const clear = () => {
    setHoverIdx(null)
    onHover?.(null)
  }

  const tooltipX = marker ? x(marker.t) : 0
  const tooltipRight = tooltipX > W - 280

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={clear}
        onClick={(e) => commit(e.clientX)}
        onTouchMove={(e) => pick(e.touches[0].clientX)}
        onTouchEnd={(e) => commit(e.changedTouches[0].clientX)}
      >
        <defs>
          <linearGradient id="sunFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sun)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--sun)" stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="plot">
            <rect x={M.left} y={M.top} width={INNER_W} height={INNER_H} />
          </clipPath>
        </defs>

        {/* Earth-visibility (direct-to-Earth) bands */}
        {commWindows.map((w, i) => (
          <rect
            key={`c${i}`}
            x={x(w.start)}
            y={M.top}
            width={Math.max(1, x(w.end) - x(w.start))}
            height={INNER_H}
            fill="var(--earth)"
            opacity={0.07}
          />
        ))}

        {/* Horizontal grid */}
        {yTicks(maxAbs).map((e) => (
          <g key={e}>
            <line
              x1={M.left}
              x2={M.left + INNER_W}
              y1={y(e)}
              y2={y(e)}
              className={e === 0 ? 'grid-zero' : 'grid'}
            />
            <text x={M.left - 8} y={y(e) + 4} className="axis-label" textAnchor="end">
              {e}°
            </text>
          </g>
        ))}

        {/* Time grid */}
        {xTicks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.top} y2={M.top + INNER_H} className="grid" />
            <text x={x(t)} y={H - 10} className="axis-label" textAnchor="middle">
              {formatDay(t)}
            </text>
          </g>
        ))}

        {/* Sun arc + lit area */}
        <g clipPath="url(#plot)">
          <path d={paths.sunArea} fill="url(#sunFill)" />
          {hasSkyline && <path d={paths.skyline} className="line-skyline" />}
          <path d={paths.sun} className="line-sun" />
          <path d={paths.earth} className="line-earth" />
        </g>

        {/* Lanes: sunlight (bottom) and D2E link (top) */}
        <rect x={M.left} y={M.top + INNER_H - 4} width={INNER_W} height={4} className="lane-bg" />
        <rect x={M.left} y={M.top} width={INNER_W} height={4} className="lane-bg" />
        {sunWindows.map((w, i) => (
          <rect
            key={`s${i}`}
            x={x(w.start)}
            y={M.top + INNER_H - 4}
            width={Math.max(1, x(w.end) - x(w.start))}
            height={4}
            fill="var(--sun)"
            opacity={0.85}
          />
        ))}
        {commWindows.map((w, i) => (
          <rect
            key={`d${i}`}
            x={x(w.start)}
            y={M.top}
            width={Math.max(1, x(w.end) - x(w.start))}
            height={4}
            fill="var(--earth)"
            opacity={0.9}
          />
        ))}

        {/* Crosshair */}
        {marker && (
          <g pointerEvents="none">
            <line x1={x(marker.t)} x2={x(marker.t)} y1={M.top} y2={M.top + INNER_H} className="crosshair" />
            <circle cx={x(marker.t)} cy={y(marker.sun.elevation)} r={4} className="dot-sun" />
            <circle cx={x(marker.t)} cy={y(marker.earth.elevation)} r={4} className="dot-earth" />
            <g transform={`translate(${tooltipRight ? tooltipX - 238 : tooltipX + 12}, ${M.top + 6})`}>
              <rect width={226} height={104} rx={8} className="tooltip-box" />
              <text x={10} y={18} className="tooltip-time">
                {formatUtc(marker.t)}
                {hovered ? '' : ' · pinned'}
              </text>
              <circle cx={14} cy={36} r={3} className="dot-sun" />
              <text x={24} y={40} className="tooltip-line">
                Sun {deg(marker.sun.elevation)} · sky{' '}
                {deg(marker.sun.horizonDeg ?? -(marker.horizonDipDeg ?? 0))} · az{' '}
                {marker.sun.azimuth.toFixed(0)}°
              </text>
              <circle cx={14} cy={56} r={3} className="dot-earth" />
              <text x={24} y={60} className="tooltip-line">
                Earth {deg(marker.earth.elevation)} · sky{' '}
                {deg(marker.earth.horizonDeg ?? -(marker.horizonDipDeg ?? 0))} · az{' '}
                {marker.earth.azimuth.toFixed(0)}°
              </text>
              <text x={10} y={80} className="tooltip-sub">
                {marker.sunlit ? 'Sunlit' : 'In shadow'} ·{' '}
                {marker.earthVisible ? 'D2E link open' : 'Earth below skyline'}
              </text>
              <text x={10} y={96} className="tooltip-sub">
                Earth dist. {(marker.earth.distanceKm / 1000).toFixed(0)}k km
              </text>
            </g>
          </g>
        )}
      </svg>
      <div className="chart-legend">
        <span><i className="swatch sun" /> Solar elevation</span>
        <span><i className="swatch earth" /> Earth elevation</span>
        {hasSkyline && <span><i className="swatch skyline" /> Skyline towards the Sun</span>}
        <span><i className="swatch band" /> Direct-to-Earth windows</span>
        <span className="legend-hint">Hover to inspect · click to pin a moment</span>
      </div>
      {marker && (
        <div className="hover-strip">
          <span>{formatUtc(marker.t)}</span>
          <span>
            Sun {deg(marker.sun.elevation)} · sky{' '}
            {deg(marker.sun.horizonDeg ?? -(marker.horizonDipDeg ?? 0))}
          </span>
          <span>
            Earth {deg(marker.earth.elevation)} · sky{' '}
            {deg(marker.earth.horizonDeg ?? -(marker.horizonDipDeg ?? 0))}
          </span>
          <span>
            {marker.sunlit ? '☀ in sunlight' : '☾ in shadow'} ·{' '}
            {marker.earthVisible ? '📡 Earth link open' : '📡 Earth below skyline'}
          </span>
        </div>
      )}
    </div>
  )
}
