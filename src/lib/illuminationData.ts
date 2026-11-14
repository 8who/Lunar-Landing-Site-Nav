import { TERRAIN_COLS, TERRAIN_ROWS } from './astro/terrain'

/**
 * Year-averaged sunlight map, precomputed by scripts/build-illumination-map.ts:
 * 1440 x 720 bytes on the ldem_4 grid, % of the year (0..100) that some part of
 * the Sun is above the LOLA terrain skyline at ground level. One shared
 * download; null if it cannot be fetched (the layer then says so).
 */
let pending: Promise<Uint8Array | null> | null = null

export function loadIlluminationMap(): Promise<Uint8Array | null> {
  if (pending) return pending
  pending = fetch(`${import.meta.env.BASE_URL}illumination-map.u8`)
    .then((response) => {
      if (!response.ok) throw new Error(`illumination HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    .then((buffer) => {
      if (buffer.byteLength !== TERRAIN_COLS * TERRAIN_ROWS) throw new Error('illumination size')
      return new Uint8Array(buffer)
    })
    .catch(() => null)
  return pending
}

/** Value of the illumination map at a coordinate (nearest cell). */
export function illuminationAt(map: Uint8Array, lat: number, lon: number): number {
  const row = Math.min(TERRAIN_ROWS - 1, Math.max(0, Math.floor(((90 - lat) / 180) * TERRAIN_ROWS)))
  const col = ((Math.floor(((lon + 180) / 360) * TERRAIN_COLS) % TERRAIN_COLS) + TERRAIN_COLS) % TERRAIN_COLS
  return map[row * TERRAIN_COLS + col]
}
