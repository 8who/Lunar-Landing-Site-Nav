/**
 * Precompute the year-averaged sunlight map of the whole Moon.
 *
 *   npx tsx scripts/build-illumination-map.ts [year]
 *
 * Output: public/illumination-map.u8, 1440 x 720 (0.25 deg, same layout as
 * moon-elevation.f32), one byte per cell = % of the year (0..100) that some part
 * of the Sun is above the terrain skyline at ground level; 255 = no data.
 *
 * Method, per cell:
 *  - terrain skyline from the LOLA grid (buildHorizon, the same code the app
 *    uses for a site), at ground level;
 *  - the Sun's direction in the lunar body-fixed frame every 4 h over the year
 *    (same ephemeris and rotation model as observer.ts);
 *  - lit while the Sun's upper limb clears the skyline at the Sun's azimuth.
 *
 * Resolution follows the data: near the poles cells are computed every ~7.6 km
 * along each row (one per grid cell) and copied to the narrower columns;
 * below 60 deg latitude every 4th row/column (1 deg) is computed and the rest
 * bilinearly filled, because a 1 deg cell there is still ~30 km and relief
 * only shaves a few percent off the 50% day/night split.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { Body, GeoVector, MakeTime } from 'astronomy-engine'
import { buildHorizon, horizonAt } from '../src/lib/astro/horizon'
import { bodyBasis, moonOrientation, toBody } from '../src/lib/astro/lunarFrame'
import { KM_PER_AU } from '../src/lib/astro/observer'
import { TERRAIN_CELL_KM, TERRAIN_COLS, TERRAIN_ROWS } from '../src/lib/astro/terrain'

const year = Number(process.argv[2] ?? 2026)
const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const SUN_RADIUS_KM = 695_700

const raw = readFileSync(new URL('../public/moon-elevation.f32', import.meta.url))
const grid = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)

// --- Sun directions in the body-fixed frame, once for every cell ------------
const t0 = Date.UTC(year, 0, 1)
const t1 = Date.UTC(year + 1, 0, 1)
const STEP = 4 * 3_600_000
const sx: number[] = []
const sy: number[] = []
const sz: number[] = []
const sr: number[] = []
for (let t = t0; t < t1; t += STEP) {
  const time = MakeTime(new Date(t))
  const basis = bodyBasis(moonOrientation(time.tt))
  const m = GeoVector(Body.Moon, time, false)
  const s = GeoVector(Body.Sun, time, false)
  const v = toBody({ x: s.x - m.x, y: s.y - m.y, z: s.z - m.z }, basis)
  const d = Math.hypot(v.x, v.y, v.z)
  sx.push(v.x / d)
  sy.push(v.y / d)
  sz.push(v.z / d)
  sr.push(Math.atan(SUN_RADIUS_KM / (d * KM_PER_AU)) * DEG)
}
const N = sx.length

function sunlitPercent(lat: number, lon: number, bins: number, maxDistanceKm: number): number {
  const profile = buildHorizon(grid, lat, lon, { bins, maxDistanceKm })
  let hMin = Infinity
  let hMax = -Infinity
  for (const h of profile.elevations) {
    if (h < hMin) hMin = h
    if (h > hMax) hMax = h
  }
  const p = lat * RAD
  const l = lon * RAD
  const ux = Math.cos(p) * Math.cos(l)
  const uy = Math.cos(p) * Math.sin(l)
  const uz = Math.sin(p)
  const ex = -Math.sin(l)
  const ey = Math.cos(l)
  const nx = -uz * ey
  const ny = uz * ex
  const nz = ux * ey - uy * ex
  let lit = 0
  for (let i = 0; i < N; i++) {
    const up = sx[i] * ux + sy[i] * uy + sz[i] * uz
    const el = Math.asin(up) * DEG + sr[i] // upper limb
    if (el <= hMin) continue
    if (el > hMax) {
      lit++
      continue
    }
    const az = Math.atan2(sx[i] * ex + sy[i] * ey, sx[i] * nx + sy[i] * ny + sz[i] * nz) * DEG
    if (el > horizonAt(profile, az < 0 ? az + 360 : az)) lit++
  }
  return (100 * lit) / N
}

const out = new Uint8Array(TERRAIN_COLS * TERRAIN_ROWS).fill(255)
const started = Date.now()
const latOf = (row: number) => 90 - (row + 0.5) * (180 / TERRAIN_ROWS)
const lonOf = (col: number) => -180 + (col + 0.5) * (360 / TERRAIN_COLS)

// Polar caps (|lat| >= 60): every row, one sample per ~7.6 km along the row.
let cells = 0
for (let row = 0; row < TERRAIN_ROWS; row++) {
  const lat = latOf(row)
  if (Math.abs(lat) < 60) continue
  const colKm = TERRAIN_CELL_KM * Math.cos(lat * RAD)
  const stride = Math.max(1, Math.floor(TERRAIN_CELL_KM / colKm))
  for (let col = 0; col < TERRAIN_COLS; col += stride) {
    const v = Math.round(sunlitPercent(lat, lonOf(col + (stride - 1) / 2), 72, 300))
    for (let k = 0; k < stride && col + k < TERRAIN_COLS; k++) out[row * TERRAIN_COLS + col + k] = v
    cells++
  }
  if (row % 20 === 0) console.log(`row ${row} lat ${lat.toFixed(2)}  cells ${cells}  ${((Date.now() - started) / 1000).toFixed(0)} s`)
}

// Low latitudes: a 1 deg lattice, then bilinear fill.
const coarse = new Map<string, number>()
for (let row = 0; row < TERRAIN_ROWS; row += 4) {
  const lat = latOf(row)
  if (Math.abs(lat) >= 61) continue
  for (let col = 0; col < TERRAIN_COLS; col += 4) {
    coarse.set(`${row},${col}`, sunlitPercent(lat, lonOf(col), 36, 150))
    cells++
  }
}
for (let row = 0; row < TERRAIN_ROWS; row++) {
  if (Math.abs(latOf(row)) >= 60) continue
  const r0 = Math.floor(row / 4) * 4
  const r1 = r0 + 4
  const fy = (row - r0) / 4
  for (let col = 0; col < TERRAIN_COLS; col++) {
    const c0 = Math.floor(col / 4) * 4
    const c1 = (c0 + 4) % TERRAIN_COLS
    const fx = (col - c0) / 4
    const at = (r: number, c: number) => coarse.get(`${r},${c}`) ?? coarse.get(`${r0},${c}`)!
    const v =
      (at(r0, c0) * (1 - fx) + at(r0, c1) * fx) * (1 - fy) +
      (at(r1, c0) * (1 - fx) + at(r1, c1) * fx) * fy
    out[row * TERRAIN_COLS + col] = Math.round(v)
  }
}

writeFileSync(new URL('../public/illumination-map.u8', import.meta.url), out)
console.log(`done: ${cells} skyline cells, ${N} Sun positions, ${((Date.now() - started) / 1000).toFixed(0)} s`)
