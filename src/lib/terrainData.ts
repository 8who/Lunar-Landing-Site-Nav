import { TERRAIN_COLS, TERRAIN_ROWS } from './astro/terrain'

/**
 * One shared download of the LOLA elevation grid.
 *
 * The sky view and the horizon profile need the same 4 MB buffer; fetching it
 * twice would double the payload for no benefit. A rejected load resolves to
 * null and the app stays on the flat-horizon model with a visible note.
 */
let pending: Promise<Float32Array | null> | null = null

export function loadTerrainGrid(): Promise<Float32Array | null> {
  if (pending) return pending
  const expected = TERRAIN_COLS * TERRAIN_ROWS
  pending = fetch(`${import.meta.env.BASE_URL}moon-elevation.f32`)
    .then((response) => {
      if (!response.ok) throw new Error(`terrain HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    .then((buffer) => {
      if (buffer.byteLength !== expected * 4) {
        throw new Error(`terrain size ${buffer.byteLength}, expected ${expected * 4}`)
      }
      return new Float32Array(buffer)
    })
    .catch(() => {
      // Leave `pending` resolved to null: a retry loop would only spam the network.
      return null
    })
  return pending
}
