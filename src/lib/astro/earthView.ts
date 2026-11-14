/**
 * Earth as seen from a lunar site, and the Deep Space Network link.
 *
 * Two things the sky view needs beyond az/el:
 *  1. Earth's orientation in the site's sky, so a textured globe shows the
 *     right continents, the right way up, for that instant.
 *  2. Which DSN complexes can talk to the site: the site must see Earth, and
 *     the ground station must see the Moon above its antenna elevation mask.
 *
 * Frames: Earth-fixed (x = 0 deg longitude, z = north pole) -> equator of date
 * (sidereal rotation) -> J2000/ICRF (precession + nutation) -> lunar body-fixed
 * (IAU rotation model, libration included) -> site east/north/up.
 */

import {
  Body,
  Equator,
  Horizon,
  MakeTime,
  Observer,
  RotateVector,
  Rotation_EQD_EQJ,
  SiderealTime,
  Vector,
} from 'astronomy-engine'
import { bodyBasis, moonOrientation, toBody } from './lunarFrame'
import { localFrame } from './observer'
import { dot, type Vec3 } from './vec'
import type { LunarSite } from './types'

/** A direction expressed in the site's local east / north / up frame. */
export interface Enu {
  e: number
  n: number
  u: number
}

/** Earth-fixed axes (x: 0 deg lon, y: 90 deg E, z: north pole) seen from the site. */
export interface EarthAxes {
  x: Enu
  y: Enu
  z: Enu
}

/**
 * Earth-fixed axes expressed in the site's local frame at an instant.
 * Uses Greenwich apparent sidereal time; polar motion (< 1") is ignored.
 */
export function earthAxesInSky(site: LunarSite, date: Date | number): EarthAxes {
  const time = MakeTime(date instanceof Date ? date : new Date(date))
  const gast = SiderealTime(time) * 15 * (Math.PI / 180)
  const toJ2000 = Rotation_EQD_EQJ(time)
  const basis = bodyBasis(moonOrientation(time.tt))
  const frame = localFrame(site)

  const toEnu = (x: number, y: number, z: number): Enu => {
    const v = RotateVector(toJ2000, new Vector(x, y, z, time))
    const body: Vec3 = toBody({ x: v.x, y: v.y, z: v.z }, basis)
    return { e: dot(body, frame.east), n: dot(body, frame.north), u: dot(body, frame.up) }
  }

  const c = Math.cos(gast)
  const s = Math.sin(gast)
  return {
    x: toEnu(c, s, 0),
    y: toEnu(-s, c, 0),
    z: toEnu(0, 0, 1),
  }
}

export interface DsnStation {
  id: string
  name: string
  antenna: string
  lat: number
  lon: number
  heightM: number
}

/**
 * The three Deep Space Network complexes, ~120 deg apart in longitude so one
 * of them always has the Moon in view. Coordinates of the 70 m antennas.
 */
export const DSN_STATIONS: DsnStation[] = [
  {
    id: 'goldstone',
    name: 'Goldstone',
    antenna: 'DSS-14',
    lat: 35.4259,
    lon: -116.8895,
    heightM: 1002,
  },
  { id: 'madrid', name: 'Madrid', antenna: 'DSS-63', lat: 40.4313, lon: -4.248, heightM: 865 },
  {
    id: 'canberra',
    name: 'Canberra',
    antenna: 'DSS-43',
    lat: -35.4021,
    lon: 148.9813,
    heightM: 689,
  },
]

/** Antenna elevation mask: DSN schedules lunar passes above ~10 deg. */
export const DSN_MIN_ELEVATION_DEG = 10

export type DsnLinkState = 'link' | 'low' | 'moon-down' | 'site-blind'

export interface DsnStatus {
  station: DsnStation
  /** Moon elevation above the station's horizon, deg (with refraction) */
  moonElevation: number
  moonAzimuth: number
  state: DsnLinkState
}

/**
 * Link state of every DSN complex at an instant.
 *  - link: site sees Earth and the station sees the Moon above the mask
 *  - low: Moon up at the station but below the mask
 *  - moon-down: Moon below the station's horizon
 *  - site-blind: the station sees the Moon, but Earth is below the site's horizon
 */
export function dsnStatus(date: Date | number, siteSeesEarth: boolean): DsnStatus[] {
  const time = MakeTime(date instanceof Date ? date : new Date(date))
  return DSN_STATIONS.map((station) => {
    const observer = new Observer(station.lat, station.lon, station.heightM)
    const eq = Equator(Body.Moon, time, observer, true, true)
    const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal')
    const up = hor.altitude >= DSN_MIN_ELEVATION_DEG
    let state: DsnLinkState
    if (hor.altitude <= 0) state = 'moon-down'
    else if (!up) state = 'low'
    else if (!siteSeesEarth) state = 'site-blind'
    else state = 'link'
    return { station, moonElevation: hor.altitude, moonAzimuth: hor.azimuth, state }
  })
}

/** Earth-fixed unit vector of a geodetic lat/lon (spherical; fine for drawing). */
export function earthFixedUnit(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * (Math.PI / 180)
  const lon = lonDeg * (Math.PI / 180)
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) }
}
