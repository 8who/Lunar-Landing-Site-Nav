export type SiteCategory =
  | 'apollo'
  | 'clps'
  | 'international'
  | 'robotic'
  | 'candidate'
  | 'custom'

/**
 * Terrain skyline as seen from one site: the elevation angle the ground reaches
 * in every azimuth direction, from the LOLA grid. Angles are degrees above the
 * observer's local horizontal at the eye, the same frame as `SkyDirection`.
 *
 * This is data, not physics: it is derived once per site (and eye height) by
 * buildHorizon() and then carried on the site so every consumer — observer,
 * timeline, ranking, calendar — shares the same horizon.
 */
export interface HorizonProfile {
  /** Azimuth bin width, deg (360 / bins) */
  stepDeg: number
  /** Horizon elevation per bin, deg; index 0 is due north */
  elevations: Float32Array
  /** Ground radius at the site, m above the 1737.4 km reference sphere */
  groundElevationM: number
  /** Eye height above that ground, m (the mast) */
  eyeHeightM: number
  /** Highest horizon in the profile, deg (may be negative on a smooth sphere) */
  maxElevationDeg: number
  /** Azimuth of that highest horizon, deg from north */
  maxAzimuthDeg: number
  /** Arc distance to the terrain that sets it, km */
  maxDistanceKm: number
  /** Data provenance, shown in the UI */
  source: string
  /** Approximate grid resolution, km north–south */
  cellKm: number
}

export interface LunarSite {
  id: string
  name: string
  /** Selenographic latitude, deg north positive */
  lat: number
  /** Selenographic longitude, deg east positive */
  lon: number
  /** Radius offset above the 1737.4 km reference sphere, metres */
  elevationM?: number
  /**
   * Height of the solar array / antenna mast above the local ground, metres.
   * A taller mast sees past the curvature of the Moon: the horizon drops by
   * acos(R / (R + h)), about 0.19 deg at 10 m, which is a lot when the Sun
   * and Earth skim the horizon at the poles.
   */
  mastHeightM?: number
  category: SiteCategory
  /** Short human note shown in the UI */
  note?: string
  /** Where the coordinates come from */
  source?: string
  /** Coordinates are approximate (rounded / from public maps) */
  approx?: boolean
  /**
   * Terrain skyline at this site, when the LOLA grid has been loaded. Absent
   * means the flat-horizon model (and the UI says so).
   */
  horizon?: HorizonProfile
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
  /**
   * Terrain skyline in this direction, deg above the local horizontal.
   * Absent when no elevation grid is loaded: the horizon is then the flat
   * sphere, i.e. -horizonDipDeg.
   */
  horizonDeg?: number
}

export interface SkySample {
  /** Unix epoch ms (UTC) */
  t: number
  sun: SkyDirection
  earth: SkyDirection
  /** Geometric horizon dip seen from the top of the mast, deg; absent when a terrain skyline is in use */
  horizonDipDeg?: number
  /** Some of the solar disc above the skyline (upper limb clears it) */
  sunlit: boolean
  /** Earth's centre above the skyline: direct-to-Earth link possible */
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
   * Sun-tracking array (tilts and turns to face the Sun): visible-disc fraction
   * x (1 AU / r)^2 (0..1). At the poles the Sun is on the horizon, so this is a
   * vertical panel turning in azimuth, the polar-lander standard.
   */
  meanTrackingIncidence: number
  /** meanTrackingIncidence x solar constant: average W per m^2 of panel */
  meanTrackingFluxWm2: number
  /** meanSolarIncidence x solar constant: flat panel, average W per m^2 */
  meanFlatFluxWm2: number
  /** First Sun set (or rise) after the range start, epoch ms */
  nextSunset?: number
  nextSunrise?: number
  /** First Earth set (or rise) after the range start, epoch ms */
  nextEarthset?: number
  nextEarthrise?: number
}
