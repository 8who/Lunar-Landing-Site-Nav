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
  /** Some of the solar disc above the (flat) local horizon (upper limb > 0) */
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
  /** Mean Sun elevation while the site is lit, deg (night excluded) */
  meanSunElevation: number
  /** Highest Sun elevation reached in the range, deg */
  maxSunElevation: number
  /**
   * Horizontal (flat, deck-mounted) array: time-mean of visible-disc fraction
   * x sin(elev) x (1 AU / r)^2, relative to the solar constant (0..1).
   * Near zero at the poles, which is why polar landers do not use it.
   */
  meanSolarIncidence: number
  /**
   * Vertical array that rotates in azimuth to face the Sun (the polar-lander
   * standard): visible-disc fraction x cos(elev) x (1 AU / r)^2 (0..1).
   */
  meanTrackingIncidence: number
  /** meanTrackingIncidence x solar constant: average W per m^2 of panel */
  meanTrackingFluxWm2: number
  /** First Sun set (or rise) after the range start, epoch ms */
  nextSunset?: number
  nextSunrise?: number
  /** First Earth set (or rise) after the range start, epoch ms */
  nextEarthset?: number
  nextEarthrise?: number
}
