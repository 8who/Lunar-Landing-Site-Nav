/**
 * Polar stereographic projection used by the high-resolution polar caps
 * (true scale at the pole, sphere R = 1737.4 km). Shared by the build scripts
 * and the globe so data, textures and geometry line up exactly.
 *
 *   south: rho = 2R tan((90 + lat) / 2), x = rho sin(lon), y =  rho cos(lon)
 *   north: rho = 2R tan((90 - lat) / 2), x = rho sin(lon), y = -rho cos(lon)
 *
 * Rasters store row 0 at +y (top), column 0 at -x (left), pixel centres at
 * (j + 0.5) * px - half, half - (i + 0.5) * px.
 */

export type Pole = 'south' | 'north'
export const POLAR_R = 1737.4
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export function polarXY(pole: Pole, lat: number, lon: number): { x: number; y: number } {
  const colat = pole === 'south' ? 90 + lat : 90 - lat
  const rho = 2 * POLAR_R * Math.tan((colat * RAD) / 2)
  const l = lon * RAD
  return { x: rho * Math.sin(l), y: (pole === 'south' ? 1 : -1) * rho * Math.cos(l) }
}

export function polarLatLon(pole: Pole, x: number, y: number): { lat: number; lon: number } {
  const c = 2 * Math.atan(Math.hypot(x, y) / (2 * POLAR_R)) * DEG
  return pole === 'south'
    ? { lat: -90 + c, lon: Math.atan2(x, y) * DEG }
    : { lat: 90 - c, lon: Math.atan2(x, -y) * DEG }
}

/** A square polar raster: n x n pixels of `px` km, centred on the pole. */
export interface PolarRaster<T extends ArrayLike<number>> {
  pole: Pole
  n: number
  px: number
  data: T
}

/** Bilinear value at a coordinate; NaN outside the raster or on `noData`. */
export function polarSample(r: PolarRaster<ArrayLike<number>>, lat: number, lon: number, noData?: number) {
  const { x, y } = polarXY(r.pole, lat, lon)
  const half = (r.n * r.px) / 2
  const fj = (x + half) / r.px - 0.5
  const fi = (half - y) / r.px - 0.5
  if (fj < 0 || fi < 0 || fj > r.n - 1 || fi > r.n - 1) return NaN
  const j0 = Math.min(r.n - 2, Math.floor(fj))
  const i0 = Math.min(r.n - 2, Math.floor(fi))
  const tx = fj - j0
  const ty = fi - i0
  const v = (i: number, j: number) => r.data[i * r.n + j]
  const vals = [v(i0, j0), v(i0, j0 + 1), v(i0 + 1, j0), v(i0 + 1, j0 + 1)]
  if (noData !== undefined && vals.some((q) => q === noData)) {
    // Nearest valid corner, so the cap edge does not blend in no-data.
    const near = v(Math.round(fi), Math.round(fj))
    return near === noData ? NaN : near
  }
  return (vals[0] * (1 - tx) + vals[1] * tx) * (1 - ty) + (vals[2] * (1 - tx) + vals[3] * tx) * ty
}
