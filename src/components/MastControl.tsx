import { useEffect, useRef, useState, type CSSProperties } from 'react'

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
  appliedValue,
  onChange,
}: {
  value: number
  appliedValue: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(value)
  const [dragging, setDragging] = useState(false)
  const draftRef = useRef(value)
  const draggingRef = useRef(false)
  const updating = draft !== appliedValue
  useEffect(() => {
    if (draggingRef.current) return
    draftRef.current = value
    setDraft(value)
  }, [value])
  const commitDraft = () => {
    draggingRef.current = false
    setDragging(false)
    if (draftRef.current !== value) onChange(draftRef.current)
  }
  // Taller mast, higher array. The animation rises from 26 px to this height.
  const liftPx = 40 + (draft / MAX_MAST_M) * 32
  const style = { '--mast-lift': `${liftPx.toFixed(1)}px` } as CSSProperties
  const dip = horizonDipDeg(draft).toFixed(2)

  return (
    <div className="mast-control-wrap">
      <label className="mast-control">
        <span>Mast</span>
        <svg className="mast-mobile-icon" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 28h24M16 28V5M9 8h14M11 5v6M21 5v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="16" cy="5" r="2" fill="currentColor" />
        </svg>
        <input
          type="range"
          min={0}
          max={MAX_MAST_M}
          step={0.5}
          value={draft}
          onPointerDown={() => { draggingRef.current = true; setDragging(true) }}
          onChange={(e) => {
            const next = Number(e.target.value)
            draftRef.current = next
            setDraft(next)
          }}
          onPointerUp={commitDraft}
          onPointerCancel={commitDraft}
          onKeyDown={() => { draggingRef.current = true; setDragging(true) }}
          onKeyUp={commitDraft}
          onBlur={commitDraft}
          aria-label="Mast height in metres"
          aria-describedby="mast-preview-help"
        />
        <span className="mono">{draft} m</span>
        <span className="mast-update-status" aria-live="polite">{dragging ? 'Release to apply' : updating ? 'Updating model…' : ''}</span>
      </label>
      <div className="mast-mobile-steps" aria-label="Adjust mast height">
        <button type="button" aria-label="Lower mast by half a metre" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - .5))}>−</button>
        <button type="button" aria-label="Raise mast by half a metre" disabled={value >= MAX_MAST_M} onClick={() => onChange(Math.min(MAX_MAST_M, value + .5))}>+</button>
      </div>

      <div className="mast-preview" id="mast-preview-help" role="tooltip">
        <div className="mast-preview-head">
          <span>Mast &amp; horizon</span>
          <span className="mono">{draft} m</span>
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
          nearby terrain: at {draft} m the geometric horizon is <strong>{dip}° lower</strong>.
        </p>
      </div>
    </div>
  )
}
