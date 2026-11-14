import type { CSSProperties } from 'react'

const MOON_RADIUS_KM = 1737.4
const MAX_MAST_M = 20

/** Geometric drop of the local horizon for an eye at `mastHeightM`. */
function horizonDipDeg(mastHeightM: number): number {
  const r = MOON_RADIUS_KM
  return (Math.acos(r / (r + mastHeightM / 1000)) * 180) / Math.PI
}

/**
 * Mast height control with an explanatory 3D scene.
 *
 * The mast is only adjustable in Expert mode. Hovering or focusing the slider
 * reveals the scene, and the mast then grows from a stowed height to the
 * selected one so the effect on the local skyline is visible.
 */
export default function MastControl({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  // Taller mast, higher array. The animation rises from 26 px to this height.
  const liftPx = 40 + (value / MAX_MAST_M) * 32
  const style = { '--mast-lift': `${liftPx.toFixed(1)}px` } as CSSProperties
  const dip = horizonDipDeg(value).toFixed(2)

  return (
    <div className="mast-control-wrap">
      <label className="mast-control">
        <span>Mast</span>
        <input
          type="range"
          min={0}
          max={MAX_MAST_M}
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Mast height in metres"
          aria-describedby="mast-preview-help"
        />
        <span className="mono">{value} m</span>
      </label>

      <div className="mast-preview" id="mast-preview-help" role="tooltip">
        <div className="mast-preview-head">
          <span>Mast &amp; horizon</span>
          <span className="mono">{value} m</span>
        </div>

        <div className="mast-stage" style={style} aria-hidden="true">
          <span className="mast-skyline"><i>local skyline</i></span>
          <span className="mast-ground" />
          <span className="mast-rig">
            <span className="mast-body" />
            <span className="mast-column">
              <span className="mast-array">
                <span className="mast-wing mast-wing--left" />
                <span className="mast-wing mast-wing--right" />
                <span className="mast-dish" />
              </span>
            </span>
          </span>
        </div>

        <p>
          The solar array and antenna sit on top of the mast. Raising it lifts the eye above
          nearby terrain: at {value} m the geometric horizon is <strong>{dip}° lower</strong>.
        </p>
      </div>
    </div>
  )
}
