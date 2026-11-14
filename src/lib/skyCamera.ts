/** Camera framing only: never changes physical body size or visibility. */
export const SKY_FOV_WIDE = 70
export const SKY_FOV_MIN = 0.5
export const SKY_FOV_MAX = 90

/** Frame the disc at 30% of the shorter viewport dimension, including phones. */
export function focusFieldOfView(diameterDeg: number, aspect: number): number {
  if (!(diameterDeg > 0) || !Number.isFinite(diameterDeg) || !(aspect > 0) || !Number.isFinite(aspect)) return SKY_FOV_WIDE
  const halfAngle = diameterDeg * Math.PI / 360
  const fov = 2 * Math.atan(Math.tan(halfAngle) / (0.3 * Math.min(1, aspect))) * 180 / Math.PI
  return Math.max(SKY_FOV_MIN, Math.min(SKY_FOV_MAX, fov))
}

/** A hidden target is centered only, even when cutaway reveals its illustration. */
export function focusZoomFieldOfView(currentFov: number, diameterDeg: number, aspect: number, visible: boolean, sameTarget: boolean): number | null {
  if (!visible) return null
  const framing = focusFieldOfView(diameterDeg, aspect)
  return sameTarget ? Math.min(currentFov, framing) : framing
}

/** Perspective magnification relative to the initial 70° view. */
export function skyMagnification(fov: number): number {
  return Math.tan(SKY_FOV_WIDE * Math.PI / 360) / Math.tan(fov * Math.PI / 360)
}
