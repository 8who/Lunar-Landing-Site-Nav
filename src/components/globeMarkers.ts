import * as THREE from 'three'
import { lunarVector } from '../lib/astro/globeMath'
import type { LunarSite } from '../lib/astro/types'

/** Screen-space picking keeps the hit target consistent at every zoom level.
 * Sphere occlusion rejects points on the far side, even when projections overlap.
 */
export function markerAtPointer(sites: LunarSite[], camera: THREE.PerspectiveCamera, globeMatrix: THREE.Matrix4, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  if (rect.width <= 0 || rect.height <= 0) return null
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
  const centre = new THREE.Vector3().setFromMatrixPosition(globeMatrix)
  const surface = new THREE.Sphere(centre, 1)
  let best: { site: LunarSite; x: number; y: number; distance: number } | null = null
  for (const site of sites) {
    const v = lunarVector(site.lat, site.lon, 1.006)
    const world = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(globeMatrix)
    const toPoint = world.clone().sub(origin)
    const occluder = new THREE.Ray(origin, toPoint.clone().normalize()).intersectSphere(surface, new THREE.Vector3())
    if (occluder && origin.distanceTo(occluder) < toPoint.length() - .012) continue
    const projected = world.clone().project(camera)
    if (projected.z < -1 || projected.z > 1) continue
    const x = (projected.x + 1) / 2 * rect.width
    const y = (1 - projected.y) / 2 * rect.height
    const distance = Math.hypot(clientX - rect.left - x, clientY - rect.top - y)
    if (distance <= 10 && (!best || distance < best.distance)) best = { site, x, y, distance }
  }
  return best
}
