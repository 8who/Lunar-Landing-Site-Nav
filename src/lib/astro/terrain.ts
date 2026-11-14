/**
 * Global LOLA elevation grid, loaded once from public/moon-elevation.f32.
 *
 * NASA SVS CGI Moon Kit ldem_4: 1440 x 720 (0.25 deg), float32 little-endian,
 * kilometres above the 1737.4 km reference sphere. The same grid drives the
 * visual terrain patch and the horizon profile, so what you see in the sky
 * view and what the sunlight / link flags use cannot drift apart.
 */
export const TERRAIN_COLS = 1440
export const TERRAIN_ROWS = 720

export function elevationAt(grid: Float32Array, lat: number, lon: number): number {
  const x = ((lon + 180) / 360 * TERRAIN_COLS - 0.5 + TERRAIN_COLS) % TERRAIN_COLS
  const y = Math.max(0, Math.min(TERRAIN_ROWS - 1, (90 - lat) / 180 * TERRAIN_ROWS - 0.5))
  const x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0
  const at = (xx: number, yy: number) =>
    grid[Math.min(TERRAIN_ROWS - 1, yy) * TERRAIN_COLS + (xx % TERRAIN_COLS)]
  return (at(x0, y0) * (1 - dx) + at(x0 + 1, y0) * dx) * (1 - dy) +
    (at(x0, y0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1) * dx) * dy
}

/** North–south size of one grid cell, km (0.25 deg of latitude). */
export const TERRAIN_CELL_KM = (2 * Math.PI * 1737.4) / (TERRAIN_ROWS * 2)

const isotropicCache = new WeakMap<Float32Array, Float32Array>()

/**
 * The same grid, low-passed in longitude so every row has the ~7.6 km
 * resolution it really has north–south.
 *
 * ldem_4 is equirectangular: a 0.25 deg column is 7.6 km wide at the equator
 * but only 17 m wide next to the pole, while a row is always 7.6 km tall. Near
 * the poles that turns resampling noise between neighbouring columns into fake
 * cliffs (300 m jumps over 17-80 m, i.e. 70-87 deg "slopes"), and a horizon
 * march that crosses dozens of columns per step picks them up as skyline spikes.
 * A cyclic box filter over one cell's worth of columns removes them; at the
 * equator the window is one column and the data are untouched.
 */
export function isotropicGrid(grid: Float32Array): Float32Array {
  const cached = isotropicCache.get(grid)
  if (cached) return cached
  const out = new Float32Array(grid.length)
  for (let row = 0; row < TERRAIN_ROWS; row++) {
    const lat = 90 - (row + 0.5) * (180 / TERRAIN_ROWS)
    const colKm = TERRAIN_CELL_KM * Math.cos((lat * Math.PI) / 180)
    const half = Math.min(
      Math.floor(TERRAIN_COLS / 2) - 1,
      Math.max(0, Math.floor(TERRAIN_CELL_KM / colKm / 2)),
    )
    const base = row * TERRAIN_COLS
    const width = 2 * half + 1
    let sum = 0
    for (let k = -half; k <= half; k++) sum += grid[base + ((k + TERRAIN_COLS) % TERRAIN_COLS)]
    for (let col = 0; col < TERRAIN_COLS; col++) {
      out[base + col] = sum / width
      const leaving = (col - half + TERRAIN_COLS) % TERRAIN_COLS
      const entering = (col + half + 1) % TERRAIN_COLS
      sum += grid[base + entering] - grid[base + leaving]
    }
  }
  isotropicCache.set(grid, out)
  return out
}
