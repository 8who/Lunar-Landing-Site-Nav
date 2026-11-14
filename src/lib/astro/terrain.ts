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
