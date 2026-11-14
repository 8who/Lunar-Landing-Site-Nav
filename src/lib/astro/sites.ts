import type { LunarSite } from './types'

/**
 * Curated landing sites.
 *
 * Selenographic coordinates, east longitude positive. `approx: true` marks
 * coordinates rounded from public maps (QuickMap / mission fact sheets) rather
 * than published landing-site solutions; they are good to a few km, which is
 * fine for lighting/communication studies but should not be quoted as precise.
 */
export const SITES: LunarSite[] = [
  // ---- Apollo -------------------------------------------------------------
  { id: 'apollo11', name: 'Apollo 11 · Tranquility Base', lat: 0.674, lon: 23.473, category: 'apollo', note: 'First crewed landing, 1969' },
  { id: 'apollo12', name: 'Apollo 12 · Oceanus Procellarum', lat: -3.012, lon: -23.422, category: 'apollo', note: 'Surveyor 3 site, 1969' },
  { id: 'apollo14', name: 'Apollo 14 · Fra Mauro', lat: -3.645, lon: -17.471, category: 'apollo', note: '1971' },
  { id: 'apollo15', name: 'Apollo 15 · Hadley–Apennine', lat: 26.132, lon: 3.634, category: 'apollo', note: 'First lunar rover, 1971' },
  { id: 'apollo16', name: 'Apollo 16 · Descartes Highlands', lat: -8.973, lon: 15.501, category: 'apollo', note: '1972' },
  { id: 'apollo17', name: 'Apollo 17 · Taurus–Littrow', lat: 20.191, lon: 30.772, category: 'apollo', note: 'Last crewed landing, 1972' },

  // ---- Robotic / international -------------------------------------------
  { id: 'luna9', name: 'Luna 9', lat: 7.08, lon: -64.37, category: 'international', note: 'First soft landing, 1966' },
  { id: 'surveyor7', name: 'Surveyor 7', lat: -40.98, lon: -11.45, category: 'international', note: '1968' },
  { id: 'change4', name: "Chang'e 4 · Von Kármán", lat: -45.457, lon: 177.588, category: 'international', note: 'First far-side landing, 2019' },
  { id: 'change5', name: "Chang'e 5 · Mons Rümker", lat: 43.06, lon: -51.92, category: 'international', note: 'Sample return, 2020' },
  { id: 'change6', name: "Chang'e 6 · Apollo Basin", lat: -41.64, lon: -153.99, category: 'international', note: 'Far-side sample return, 2024' },
  { id: 'chandrayaan3', name: 'Chandrayaan-3 · Vikram', lat: -69.373, lon: 32.319, category: 'international', note: 'South polar region, 2023' },
  { id: 'slim', name: 'SLIM · Shioli', lat: -13.316, lon: 25.251, category: 'international', note: 'JAXA pinpoint landing, 2024' },

  // ---- CLPS / commercial -------------------------------------------------
  { id: 'im1', name: 'IM-1 Odysseus · Malapert A', lat: -80.13, lon: 1.44, category: 'clps', note: 'Intuitive Machines, 2024' },
  { id: 'blueghost1', name: 'Blue Ghost 1 · Mare Crisium', lat: 18.56, lon: 61.81, category: 'clps', note: 'Firefly, 2025' },

  // ---- Artemis candidates (south polar region) ---------------------------
  { id: 'monsmouton', name: 'Mons Mouton (candidate)', lat: -84.6, lon: 31.0, category: 'candidate', note: 'Artemis candidate region', approx: true },
  { id: 'malapert', name: 'Malapert Massif (candidate)', lat: -86.0, lon: 2.9, category: 'candidate', note: 'Artemis candidate region', approx: true },
  { id: 'connectingridge', name: 'Connecting Ridge (candidate)', lat: -89.474, lon: -138.814, category: 'candidate', note: 'Crest of the Shackleton–de Gerlache ridge in the LOLA ldem_16 1.9 km map (published ~92% sunlit at 2 m, Gläser et al. 2014)', source: 'LOLA ldem_16 1.9 km crest: highest-sunlight pixel above +1 km within 8 km of the old ldem_4 point', approx: true },
  { id: 'shackleton', name: 'Shackleton rim', lat: -89.779, lon: -153.435, category: 'candidate', note: 'Highest rim crest of Shackleton in the LOLA ldem_16 1.9 km map (the crater centre is 89.67° S, 129.78° E)', source: 'LOLA ldem_16 1.9 km crest on the 9–12 km rim ring around the crater centre', approx: true },
  { id: 'degerlache', name: 'de Gerlache rim', lat: -88.668, lon: -68.199, category: 'candidate', note: 'Highest rim crest of de Gerlache in the LOLA ldem_16 1.9 km map (the crater centre is 88.5° S, 87.1° W)', source: 'LOLA ldem_16 1.9 km crest on the 14–18 km rim ring around the crater centre', approx: true },
  { id: 'cabeus', name: 'Cabeus · LCROSS impact', lat: -84.675, lon: -48.725, category: 'candidate', note: 'Permanently shadowed crater floor: the terrain grid shows an 11° rim closing the horizon', source: 'LCROSS impact point, Schultz et al. 2010' },
  { id: 'southpole', name: 'Lunar South Pole', lat: -89.9, lon: 0, category: 'candidate', note: 'Reference point', approx: true },
]

export const SITE_GROUPS: { id: string; label: string }[] = [
  { id: 'candidate', label: 'Artemis / south pole' },
  { id: 'clps', label: 'CLPS' },
  { id: 'international', label: 'International' },
  { id: 'apollo', label: 'Apollo' },
  { id: 'custom', label: 'Custom' },
]

/**
 * Beyond ~80 deg latitude the Sun and Earth skim the horizon, so local relief
 * (kilometre-high crater rims, massifs) decides lighting and line of sight more
 * than the ephemeris does. The app uses the LOLA grid to build a skyline per
 * site; without it (grid still loading or unavailable) the numbers fall back to
 * a flat horizon and are only a first guess: crests can be lit >80% of the time,
 * crater floors never.
 */
export const TERRAIN_CRITICAL_LAT = 80

export function isTerrainCritical(site: { lat: number }): boolean {
  return Math.abs(site.lat) >= TERRAIN_CRITICAL_LAT
}

export function siteById(id: string): LunarSite | undefined {
  return SITES.find((s) => s.id === id)
}

export function customSite(lat: number, lon: number, name = 'Custom site'): LunarSite {
  return {
    id: `custom:${lat.toFixed(3)}:${lon.toFixed(3)}`,
    name,
    lat,
    lon,
    category: 'custom',
    note: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
  }
}
