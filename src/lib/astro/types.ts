export type SiteCategory =
  | 'apollo'
  | 'clps'
  | 'international'
  | 'robotic'
  | 'candidate'
  | 'custom'

export interface LunarSite {
  id: string
  name: string
  /** Selenographic latitude, deg north positive */
  lat: number
  /** Selenographic longitude, deg east positive */
  lon: number
  /** Radius offset above the 1737.4 km reference sphere, metres */
  elevationM?: number
  category: SiteCategory
  /** Short human note shown in the UI */
  note?: string
  /** Where the coordinates come from */
  source?: string
  /** Coordinates are approximate (rounded / from public maps) */
  approx?: boolean
}

export interface SkyDirection {
  /** deg above the local horizontal plane, negative = below horizon */
  elevation: number
  /** deg from local north, clockwise (0 = N, 90 = E) */
  azimuth: number
  /** centre-to-centre distance, km */
  distanceKm: number
  /** apparent angular diameter, deg */
  angularDiameterDeg: number
}

export interface SkySample {
  /** Unix epoch ms (UTC) */
  t: number
  sun: SkyDirection
  earth: SkyDirection
  /** Sun above the (flat) local horizon */
  sunlit: boolean
  /** Earth above the (flat) local horizon: direct-to-Earth link possible */
  earthVisible: boolean
}

export interface TimeWindow {
  start: number
  end: number
  durationMs: number
  /** false when the window is still open at the end of the requested range */
  closed: boolean
}

export interface TimelineMetrics {
  spanMs: number
  sunlitMs: number
  commMs: number
  jointMs: number
  sunlitPct: number
  commPct: number
  jointPct: number
  longestSunlitMs: number
  longestCommMs: number
  meanSunElevation: number
  /** Highest Sun elevation reached in the range, deg */
  maxSunElevation: number
  /** Mean of max(0, sin(elev)) over the range: horizontal-array power proxy (0..1) */
  meanSolarIncidence: number
  /** First Sun set (or rise) after the range start, epoch ms */
  nextSunset?: number
  nextSunrise?: number
  /** First Earth set (or rise) after the range start, epoch ms */
  nextEarthset?: number
  nextEarthrise?: number
}
