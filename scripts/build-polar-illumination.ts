/**
 * High-resolution year-round sunlight for the polar caps (80-90 deg).
 *
 *   npx tsx scripts/build-polar-illumination.ts <south|north> <work-dem.f32> [year]
 *
 * Input: a polar stereographic float32 DEM (km above 1737.4 km), 817 x 817 at
 * 1.5 km, reaching 20 deg from the pole, resampled from NASA LOLA ldem_16
 * (scripts/build_polar.py). Output: public/moon-polar-light-<pole>.u8, 405 x
 * 405 at 1.5 km covering the 10 deg cap, % of the year (0..100) that some part
 * of the Sun clears the terrain skyline at ground level; 255 outside the cap.
 *
 * Same physics as build-illumination-map.ts, on a 4x finer elevation model:
 * terrain skyline in 72 azimuths out to 300 km with lunar curvature, the Sun's
 * direction every 4 h over the year, lit while its upper limb clears the
 * skyline at its azimuth.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Body, GeoVector, MakeTime } from 'astronomy-engine'
import { bodyBasis, moonOrientation, toBody } from '../src/lib/astro/lunarFrame'
import { KM_PER_AU } from '../src/lib/astro/observer'
import { polarXY, polarLatLon, POLAR_R } from '../src/lib/astro/polar'

const pole = process.argv[2] === 'north' ? 'north' : 'south'
const demPath = process.argv[3]
const year = Number(process.argv[4] ?? 2026)
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

const WORK_N = 817
const WORK_PX = 1.5
const WORK_HALF = (WORK_N * WORK_PX) / 2
const raw = readFileSync(demPath)
const dem = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)

function heightAt(lat: number, lon: number): number {
  const { x, y } = polarXY(pole, lat, lon)
  const fj = (x + WORK_HALF) / WORK_PX - 0.5
  const fi = (WORK_HALF - y) / WORK_PX - 0.5
  const j0 = Math.max(0, Math.min(WORK_N - 2, Math.floor(fj)))
  const i0 = Math.max(0, Math.min(WORK_N - 2, Math.floor(fi)))
  const tx = Math.max(0, Math.min(1, fj - j0))
  const ty = Math.max(0, Math.min(1, fi - i0))
  const a = dem[i0 * WORK_N + j0] * (1 - tx) + dem[i0 * WORK_N + j0 + 1] * tx
  const b = dem[(i0 + 1) * WORK_N + j0] * (1 - tx) + dem[(i0 + 1) * WORK_N + j0 + 1] * tx
  return a * (1 - ty) + b * ty
}

const BINS = 72
const MAX_KM = 300
function stepKm(d: number) {
  return d < 10 ? 0.5 : d < 60 ? 1.5 : 3
}

/** Skyline elevations (deg) in BINS azimuths from (lat, lon) at ground level. */
function skyline(lat: number, lon: number): Float32Array {
  const p = lat * RAD
  const l = lon * RAD
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]
  const east = [-Math.sin(l), Math.cos(l), 0]
  const north = [-up[2] * east[1], up[2] * east[0], up[0] * east[1] - up[1] * east[0]]
  const eye = POLAR_R + heightAt(lat, lon)
  const out = new Float32Array(BINS)
  for (let b = 0; b < BINS; b++) {
    const t = (b * 360 * RAD) / BINS
    const dir = [0, 1, 2].map((k) => north[k] * Math.cos(t) + east[k] * Math.sin(t))
    let best = -90
    for (let d = stepKm(0); d <= MAX_KM; d += stepKm(d)) {
      const a = d / POLAR_R
      // Upper bound for anything further out (terrain < +11 km): stop early.
      const bound = Math.atan2((POLAR_R + 11) * Math.cos(a) - eye, (POLAR_R + 11) * Math.sin(a)) * DEG
      if (bound < best) break
      const v = [0, 1, 2].map((k) => up[k] * Math.cos(a) + dir[k] * Math.sin(a))
      const plat = Math.asin(v[2]) * DEG
      const plon = Math.atan2(v[1], v[0]) * DEG
      const r = POLAR_R + heightAt(plat, plon)
      const e = Math.atan2(r * Math.cos(a) - eye, r * Math.sin(a)) * DEG
      if (e > best) best = e
    }
    out[b] = best
  }
  return out
}

// Sun directions in the body-fixed frame (same as build-illumination-map.ts).
const sx: number[] = []
const sy: number[] = []
const sz: number[] = []
const sr: number[] = []
for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 4 * 3_600_000) {
  const time = MakeTime(new Date(t))
  const basis = bodyBasis(moonOrientation(time.tt))
  const m = GeoVector(Body.Moon, time, false)
  const s = GeoVector(Body.Sun, time, false)
  const v = toBody({ x: s.x - m.x, y: s.y - m.y, z: s.z - m.z }, basis)
  const d = Math.hypot(v.x, v.y, v.z)
  sx.push(v.x / d)
  sy.push(v.y / d)
  sz.push(v.z / d)
  sr.push(Math.atan(695_700 / (d * KM_PER_AU)) * DEG)
}

const N = 405
const PX = 1.5
const HALF = (N * PX) / 2
const capRho = polarXY(pole, pole === 'south' ? -80 : 80, 0)
const capR = Math.hypot(capRho.x, capRho.y)
const out = new Uint8Array(N * N).fill(255)
const started = Date.now()
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const x = (j + 0.5) * PX - HALF
    const y = HALF - (i + 0.5) * PX
    if (Math.hypot(x, y) > capR + PX) continue
    const { lat, lon } = polarLatLon(pole, x, y)
    const sky = skyline(lat, lon)
    let hMin = Infinity
    let hMax = -Infinity
    for (const h of sky) {
      hMin = Math.min(hMin, h)
      hMax = Math.max(hMax, h)
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
    for (let k = 0; k < sx.length; k++) {
      const el = Math.asin(sx[k] * ux + sy[k] * uy + sz[k] * uz) * DEG + sr[k]
      if (el <= hMin) continue
      if (el > hMax) {
        lit++
        continue
      }
      let az = Math.atan2(sx[k] * ex + sy[k] * ey, sx[k] * nx + sy[k] * ny + sz[k] * nz) * DEG
      if (az < 0) az += 360
      const f = (az / 360) * BINS
      const b0 = Math.floor(f) % BINS
      const b1 = (b0 + 1) % BINS
      const h = sky[b0] + (sky[b1] - sky[b0]) * (f - Math.floor(f))
      if (el > h) lit++
    }
    out[i * N + j] = Math.round((100 * lit) / sx.length)
  }
  if (i % 40 === 0) console.log(`${pole} row ${i}/${N} ${((Date.now() - started) / 1000).toFixed(0)} s`)
}
writeFileSync(new URL(`../public/moon-polar-light-${pole}.u8`, import.meta.url), out)
console.log(`${pole} done in ${((Date.now() - started) / 1000).toFixed(0)} s`)
