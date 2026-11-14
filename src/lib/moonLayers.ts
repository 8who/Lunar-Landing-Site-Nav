/**
 * Colour layers draped over the Moon globe: year-round sunlight, surface
 * temperature at the selected instant, and altitude. Each layer renders to an
 * equirectangular canvas with the same layout as moon.jpg (longitude -180 at
 * the left edge, north at the top), so it maps onto the sphere unchanged.
 */

import { elevationAt, isotropicGrid, TERRAIN_COLS, TERRAIN_ROWS } from './astro/terrain'
import { cellTemperature, sunInBodyFrame } from './astro/thermal'
import { illuminationAt } from './illuminationData'
import { polarLatLon, polarSample, POLAR_R, type Pole } from './astro/polar'
import type { PolarCap } from './polarData'

export type MoonLayer = 'none' | 'light' | 'temperature' | 'altitude'

type Rgb = readonly [number, number, number]
type Stop = readonly [number, Rgb]

export function ramp(stops: Stop[]) {
  return (v: number): Rgb => {
    if (v <= stops[0][0]) return stops[0][1]
    for (let i = 1; i < stops.length; i++) {
      const [x1, c1] = stops[i]
      if (v <= x1) {
        const [x0, c0] = stops[i - 1]
        const f = (v - x0) / (x1 - x0)
        return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
      }
    }
    return stops[stops.length - 1][1]
  }
}

/** % of the year lit: permanent shadow in blue, day/night split in amber, near-permanent light in white-gold. */
export const LIGHT_STOPS: Stop[] = [
  [0, [30, 64, 175]],
  [0.5, [30, 27, 75]],
  [20, [76, 29, 92]],
  [45, [180, 60, 40]],
  [55, [234, 120, 30]],
  [70, [250, 190, 60]],
  [85, [255, 245, 200]],
]
/** Kelvin: cold traps deep blue, night blue, terminator teal, noon orange-white. */
export const TEMP_STOPS: Stop[] = [
  [40, [49, 46, 129]],
  [90, [37, 99, 235]],
  [130, [14, 165, 233]],
  [200, [20, 184, 166]],
  [270, [234, 179, 8]],
  [340, [234, 88, 12]],
  [395, [254, 242, 242]],
]
/** km relative to 1737.4 km: basins blue, mean surface sand, highlands white. */
export const ALT_STOPS: Stop[] = [
  [-8, [30, 58, 138]],
  [-4, [56, 120, 190]],
  [-1.5, [134, 186, 160]],
  [0, [205, 190, 140]],
  [2.5, [160, 110, 70]],
  [5.5, [120, 85, 70]],
  [9, [250, 250, 250]],
]

export const LAYER_INFO: Record<Exclude<MoonLayer, 'none'>, {
  label: string
  stops: Stop[]
  ticks: { at: number; label: string }[]
  unit: string
  source: string
}> = {
  light: {
    label: 'Sunlight over a year',
    stops: LIGHT_STOPS,
    ticks: [
      { at: 0, label: '0% · permanent shadow' },
      { at: 50, label: '50%' },
      { at: 85, label: '≥ 85%' },
    ],
    unit: '% of the year',
    source: 'Terrain skyline from LOLA, Sun every 4 h over 2026, at ground level',
  },
  temperature: {
    label: 'Modeled surface temperature',
    stops: TEMP_STOPS,
    ticks: [
      { at: 40, label: '40 K' },
      { at: 120, label: '120 K' },
      { at: 250, label: '250 K' },
      { at: 395, label: '395 K' },
    ],
    unit: 'K',
    source: 'Radiative model with LOLA slopes; 2 h map samples; cold traps from the sunlight map (not Diviner data)',
  },
  altitude: {
    label: 'Altitude',
    stops: ALT_STOPS,
    ticks: [
      { at: -8, label: '−8 km' },
      { at: 0, label: '0' },
      { at: 9, label: '+9 km' },
    ],
    unit: 'km above 1737.4 km',
    source: 'NASA LOLA ldem_4 (0.25°)',
  },
}

/** CSS gradient for a legend bar. */
export function legendGradient(stops: Stop[]): string {
  const lo = stops[0][0]
  const hi = stops[stops.length - 1][0]
  return `linear-gradient(90deg, ${stops
    .map(([x, c]) => `rgb(${c.map(Math.round).join(',')}) ${(((x - lo) / (hi - lo)) * 100).toFixed(1)}%`)
    .join(', ')})`
}

function paint(
  canvas: HTMLCanvasElement,
  value: (lat: number, lon: number) => number,
  color: (v: number) => Rgb,
  // Static layers use the data's own 0.25 deg grid; the time-varying
  // temperature layer is drawn at 0.5 deg so it repaints quickly.
  W = TERRAIN_COLS,
  H = TERRAIN_ROWS,
) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180
    for (let x = 0; x < W; x++) {
      const lon = -180 + ((x + 0.5) / W) * 360
      const [r, g, b] = color(value(lat, lon))
      const i = (y * W + x) * 4
      image.data[i] = r
      image.data[i + 1] = g
      image.data[i + 2] = b
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

export function paintLight(canvas: HTMLCanvasElement, light: Uint8Array) {
  const color = ramp(LIGHT_STOPS)
  paint(canvas, (lat, lon) => illuminationAt(light, lat, lon), color)
}

export function paintAltitude(canvas: HTMLCanvasElement, grid: Float32Array) {
  const color = ramp(ALT_STOPS)
  paint(canvas, (lat, lon) => elevationAt(grid, lat, lon), color)
}

/** Surface normal at a cell from the isotropic grid's local gradient. */
function normalAt(dem: Float32Array, lat: number, lon: number) {
  const R = 1737.4
  const r = Math.PI / 180
  const p = lat * r
  const l = lon * r
  const up = { x: Math.cos(p) * Math.cos(l), y: Math.cos(p) * Math.sin(l), z: Math.sin(p) }
  const east = { x: -Math.sin(l), y: Math.cos(l), z: 0 }
  const north = {
    x: -Math.sin(p) * Math.cos(l),
    y: -Math.sin(p) * Math.sin(l),
    z: Math.cos(p),
  }
  // Central differences over ~one grid cell (7.6 km) in each direction.
  const dKm = 7.6
  const dLat = (dKm / R) / r
  const dLon = Math.min(180, dLat / Math.max(0.02, Math.cos(p)))
  const hE = elevationAt(dem, lat, lon + dLon) - elevationAt(dem, lat, lon - dLon)
  const hN =
    elevationAt(dem, Math.min(90, lat + dLat), lon) - elevationAt(dem, Math.max(-90, lat - dLat), lon)
  const gE = hE / (2 * dKm)
  const gN = hN / (2 * dKm)
  const nx = up.x - gE * east.x - gN * north.x
  const ny = up.y - gE * east.y - gN * north.y
  const nz = up.z - gE * east.z - gN * north.z
  const len = Math.hypot(nx, ny, nz)
  return { up, normal: { x: nx / len, y: ny / len, z: nz / len } }
}

/** Temperature of one point at an instant, K (also used for the site readout). */
export function temperatureAt(
  grid: Float32Array,
  light: Uint8Array,
  t: number,
  lat: number,
  lon: number,
  sun = sunInBodyFrame(t),
): number {
  const { up, normal } = normalAt(isotropicGrid(grid), lat, lon)
  return cellTemperature(sun, lat, lon, up, normal, illuminationAt(light, lat, lon))
}

export function paintTemperature(canvas: HTMLCanvasElement, grid: Float32Array, light: Uint8Array, t: number) {
  const color = ramp(TEMP_STOPS)
  const sun = sunInBodyFrame(t)
  paint(canvas, (lat, lon) => temperatureAt(grid, light, t, lat, lon, sun), color, 720, 360)
}

export { TERRAIN_COLS, TERRAIN_ROWS }

/** Latitude where the high-resolution polar caps begin. */
export const CAP_EDGE_LAT = 80

/** Height (km) and surface normal from the polar DEM, for the cap textures. */
function capHeight(cap: PolarCap, lat: number, lon: number): number {
  return polarSample(cap.dem, lat, lon)
}

function capNormal(cap: PolarCap, lat: number, lon: number) {
  const r = Math.PI / 180
  const p = lat * r
  const l = lon * r
  const up = { x: Math.cos(p) * Math.cos(l), y: Math.cos(p) * Math.sin(l), z: Math.sin(p) }
  const east = { x: -Math.sin(l), y: Math.cos(l), z: 0 }
  const north = { x: -Math.sin(p) * Math.cos(l), y: -Math.sin(p) * Math.sin(l), z: Math.cos(p) }
  const dKm = 1.5
  const dLat = dKm / POLAR_R / r
  const dLon = Math.min(170, dLat / Math.max(1e-4, Math.cos(p)))
  const gE = (capHeight(cap, lat, lon + dLon) - capHeight(cap, lat, lon - dLon)) / (2 * dKm)
  const latN = Math.min(89.9999, lat + dLat)
  const latS = Math.max(-89.9999, lat - dLat)
  const gN = (capHeight(cap, latN, lon) - capHeight(cap, latS, lon)) / ((latN - latS) * r * POLAR_R)
  const nx = up.x - (gE || 0) * east.x - (gN || 0) * north.x
  const ny = up.y - (gE || 0) * east.y - (gN || 0) * north.y
  const nz = up.z - (gE || 0) * east.z - (gN || 0) * north.z
  const len = Math.hypot(nx, ny, nz)
  return { up, normal: { x: nx / len, y: ny / len, z: nz / len } }
}

/** Polar values at a coordinate, or undefined outside the cap. */
export function capValue(cap: PolarCap, layer: Exclude<MoonLayer, 'none'>, lat: number, lon: number, t?: number) {
  if (Math.abs(lat) < CAP_EDGE_LAT) return undefined
  if (layer === 'altitude') {
    const h = capHeight(cap, lat, lon)
    return Number.isNaN(h) ? undefined : h
  }
  const lit = polarSample(cap.light, lat, lon, 255)
  if (Number.isNaN(lit)) return undefined
  if (layer === 'light') return lit
  const { up, normal } = capNormal(cap, lat, lon)
  return cellTemperature(sunInBodyFrame(t ?? Date.now()), lat, lon, up, normal, Math.round(lit))
}

/**
 * Paint one polar cap texture (polar stereographic, row 0 at +y) for a layer.
 * `size` px across the cap's bounding square.
 */
export function paintCap(
  canvas: HTMLCanvasElement,
  pole: Pole,
  cap: PolarCap,
  layer: Exclude<MoonLayer, 'none'>,
  t: number,
  size = 1024,
) {
  const half = (cap.dem.n * cap.dem.px) / 2
  const stops = layer === 'light' ? LIGHT_STOPS : layer === 'temperature' ? TEMP_STOPS : ALT_STOPS
  const color = ramp(stops)
  const sun = sunInBodyFrame(t)
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const pxKm = (2 * half) / size
  for (let i = 0; i < size; i++) {
    const y = half - (i + 0.5) * pxKm
    for (let j = 0; j < size; j++) {
      const x = (j + 0.5) * pxKm - half
      const k = (i * size + j) * 4
      const { lat, lon } = polarLatLon(pole, x, y)
      if (Math.abs(lat) < CAP_EDGE_LAT - 0.05) {
        image.data[k + 3] = 0
        continue
      }
      let v: number
      if (layer === 'altitude') v = capHeight(cap, lat, lon)
      else {
        const lit = polarSample(cap.light, lat, lon, 255)
        if (layer === 'light') v = lit
        else {
          const { up, normal } = capNormal(cap, lat, lon)
          v = Number.isNaN(lit) ? NaN : cellTemperature(sun, lat, lon, up, normal, Math.round(lit))
        }
      }
      if (Number.isNaN(v)) {
        image.data[k + 3] = 0
        continue
      }
      const [r, g, b] = color(v)
      image.data[k] = r
      image.data[k + 1] = g
      image.data[k + 2] = b
      image.data[k + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
}
