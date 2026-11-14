import type { Pole, PolarRaster } from './astro/polar'

/**
 * High-resolution polar data (80-90 deg), from NASA LOLA ldem_16 (1.9 km,
 * 4x the global grid) in polar stereographic, built by scripts/build_polar.py
 * and scripts/build-polar-illumination.ts:
 *  - moon-polar-dem-<pole>.i16: 811 x 811 at 0.75 km, int16 metres above 1737.4 km
 *  - moon-polar-light-<pole>.u8: 405 x 405 at 1.5 km, % of the year in sunlight (255 = outside)
 */
export interface PolarCap {
  dem: PolarRaster<Float32Array>
  light: PolarRaster<Uint8Array>
}

const pending = new Map<Pole, Promise<PolarCap | null>>()

async function fetchBytes(name: string): Promise<ArrayBuffer> {
  const r = await fetch(`${import.meta.env.BASE_URL}${name}`)
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
  return r.arrayBuffer()
}

export function loadPolarCap(pole: Pole): Promise<PolarCap | null> {
  let p = pending.get(pole)
  if (!p) {
    p = Promise.all([fetchBytes(`moon-polar-dem-${pole}.i16`), fetchBytes(`moon-polar-light-${pole}.u8`)])
      .then(([demBuf, lightBuf]) => {
        const i16 = new Int16Array(demBuf)
        if (i16.length !== 811 * 811 || lightBuf.byteLength !== 405 * 405) throw new Error('polar size')
        const km = new Float32Array(i16.length)
        for (let i = 0; i < i16.length; i++) km[i] = i16[i] / 1000
        return {
          dem: { pole, n: 811, px: 0.75, data: km },
          light: { pole, n: 405, px: 1.5, data: new Uint8Array(lightBuf) },
        }
      })
      .catch(() => null)
    pending.set(pole, p)
  }
  return p
}
