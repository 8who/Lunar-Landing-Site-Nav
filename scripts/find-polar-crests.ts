/**
 * Find the sunniest crests in the high-resolution south-polar maps.
 *
 *   npx tsx scripts/find-polar-crests.ts
 *
 * Reads the LOLA ldem_16-derived polar rasters described in
 * src/lib/polarData.ts and, for each south-pole site, searches the sunlight
 * map (1.5 km pixels, % of the year in sunlight) for the best pixel:
 *
 *  - Connecting Ridge: within 8 km of the current point, on ground above
 *    +1 km (the ridge, not the saddle below it).
 *  - Shackleton rim: on the 9-12 km ring around the crater centre
 *    (-89.67, 129.78).
 *  - de Gerlache rim: on the 14-18 km ring around the centre (-88.5, -87.1).
 *
 * Distances are great-circle distances on the 1737.4 km sphere. Ties in the
 * integer sunlight map go to the higher pixel, then to the nearer one.
 * Elevations come from the 0.75 km int16 DEM (metres above 1737.4 km).
 */
import { readFileSync } from 'node:fs'
import { polarLatLon, polarSample, polarXY, POLAR_R } from '../src/lib/astro/polar'
import type { PolarRaster } from '../src/lib/astro/polar'

const publicDir = new URL('../public/', import.meta.url)
const RAD = Math.PI / 180

const demBytes = readFileSync(new URL('moon-polar-dem-south.i16', publicDir))
const demI16 = new Int16Array(demBytes.buffer, demBytes.byteOffset, demBytes.byteLength / 2)
const dem: PolarRaster<Float32Array> = {
  pole: 'south',
  n: 811,
  px: 0.75,
  data: Float32Array.from(demI16, (m) => m / 1000),
}

const lightBytes = readFileSync(new URL('moon-polar-light-south.u8', publicDir))
const light: PolarRaster<Uint8Array> = {
  pole: 'south',
  n: 405,
  px: 1.5,
  data: new Uint8Array(lightBytes.buffer, lightBytes.byteOffset, lightBytes.byteLength),
}

if (dem.data.length !== 811 * 811 || light.data.length !== 405 * 405) throw new Error('polar raster size')

const lightHalf = (light.n * light.px) / 2

/** Centre of the sunlight pixel containing (lat, lon), and its value. */
function sunlightPixel(lat: number, lon: number): { lat: number; lon: number; sunPct: number } {
  const { x, y } = polarXY('south', lat, lon)
  const j = Math.max(0, Math.min(light.n - 1, Math.floor((x + lightHalf) / light.px)))
  const i = Math.max(0, Math.min(light.n - 1, Math.floor((lightHalf - y) / light.px)))
  const { lat: plat, lon: plon } = polarLatLon(
    'south',
    (j + 0.5) * light.px - lightHalf,
    lightHalf - (i + 0.5) * light.px,
  )
  return { lat: plat, lon: plon, sunPct: light.data[i * light.n + j] }
}

/** Great-circle distance, km. */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = aLat * RAD
  const p2 = bLat * RAD
  const dp = p2 - p1
  const dl = (bLon - aLon) * RAD
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * POLAR_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

interface Candidate {
  lat: number
  lon: number
  sunPct: number
  elevationKm: number
  distanceKm: number
}

/** Highest-sunlight pixel passing `accept`, ties broken by elevation, then distance. */
function search(
  centreLat: number,
  centreLon: number,
  accept: (lat: number, lon: number, elevationKm: number) => boolean,
): Candidate | null {
  let best: Candidate | null = null
  for (let i = 0; i < light.n; i++) {
    for (let j = 0; j < light.n; j++) {
      const sunPct = light.data[i * light.n + j]
      if (sunPct > 100) continue // outside the 80-90 deg cap
      const { lat, lon } = polarLatLon(
        'south',
        (j + 0.5) * light.px - lightHalf,
        lightHalf - (i + 0.5) * light.px,
      )
      const elevationKm = polarSample(dem, lat, lon, -32768)
      if (!Number.isFinite(elevationKm)) continue
      if (!accept(lat, lon, elevationKm)) continue
      const d = distanceKm(lat, lon, centreLat, centreLon)
      if (
        !best ||
        sunPct > best.sunPct ||
        (sunPct === best.sunPct && elevationKm > best.elevationKm) ||
        (sunPct === best.sunPct && elevationKm === best.elevationKm && d < best.distanceKm)
      ) {
        best = { lat, lon, sunPct, elevationKm, distanceKm: d }
      }
    }
  }
  return best
}

const regions = [
  {
    id: 'connectingridge',
    lat: -89.4,
    lon: -142.0,
    accept: (lat: number, lon: number, elevationKm: number) =>
      distanceKm(lat, lon, -89.4, -142.0) <= 8 && elevationKm > 1,
  },
  {
    id: 'shackleton',
    lat: -89.622,
    lon: -156.01,
    accept: (lat: number, lon: number) => {
      const d = distanceKm(lat, lon, -89.67, 129.78)
      return d >= 9 && d <= 12
    },
  },
  {
    id: 'degerlache',
    lat: -88.626,
    lon: -67.23,
    accept: (lat: number, lon: number) => {
      const d = distanceKm(lat, lon, -88.5, -87.1)
      return d >= 14 && d <= 18
    },
  },
]

let failures = 0
for (const region of regions) {
  const before = sunlightPixel(region.lat, region.lon)
  const best = search(region.lat, region.lon, region.accept)
  if (!best) {
    failures++
    console.log(`${region.id}: no candidate`)
    continue
  }
  // Coordinates are rounded to 3 decimals for sites.ts; keep the pixel's own
  // sunlight and elevation, which come from the same pixel.
  const lat = Number(best.lat.toFixed(3))
  const lon = Number(best.lon.toFixed(3))
  console.log(
    [
      `${region.id}:`,
      `lat ${lat.toFixed(3)}, lon ${lon.toFixed(3)},`,
      `elevation ${(best.elevationKm * 1000).toFixed(0)} m,`,
      `sunlight ${best.sunPct}%`,
      `(was ${before.sunPct}%,`,
      `${(polarSample(dem, before.lat, before.lon, -32768) * 1000).toFixed(0)} m;`,
      `${best.distanceKm.toFixed(1)} km from the old point)`,
    ].join(' '),
  )
}
if (failures) process.exitCode = 1
