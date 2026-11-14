import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { markerAtPointer } from './globeMarkers'
import { lunarVector } from '../lib/astro/globeMath'
import { customSite } from '../lib/astro/sites'

const rect = { left: 50, top: 80, width: 400, height: 400 }
const matrix = new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
const front = customSite(0, 0, 'Near-side marker')
const back = customSite(0, 180, 'Far-side marker')
function cameraAt(z: number) {
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 50)
  camera.position.z = z
  camera.updateMatrixWorld()
  return camera
}

describe('named lunar marker selection', () => {
  it('returns the exact site and rejects the overlapping far-side projection', () => {
    const camera = cameraAt(3.1)
    expect(markerAtPointer([back, front], camera, matrix, rect, 250, 280)?.site).toBe(front)
    expect(markerAtPointer([back], camera, matrix, rect, 250, 280)).toBeNull()
  })
  it('keeps a constant screen-space hit radius while zooming', () => {
    for (const z of [1.35, 3.1, 5.5]) {
      const camera = cameraAt(z)
      expect(markerAtPointer([front], camera, matrix, rect, 259, 280)?.site).toBe(front)
      expect(markerAtPointer([front], camera, matrix, rect, 261, 280)).toBeNull()
    }
  })
  it('chooses the nearest projected site in a close cluster', () => {
    const other = customSite(2, 0, 'Nearby marker')
    const camera = cameraAt(3.1)
    const v = lunarVector(other.lat, other.lon, 1.006)
    const point = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(matrix).project(camera)
    const x = rect.left + (point.x + 1) / 2 * rect.width
    const y = rect.top + (1 - point.y) / 2 * rect.height
    expect(markerAtPointer([front, other], camera, matrix, rect, x, y)?.site).toBe(other)
  })
  it('cannot pick markers after selection hides them', () => {
    expect(markerAtPointer([], cameraAt(3.1), matrix, rect, 250, 280)).toBeNull()
    expect(markerAtPointer([front], cameraAt(3.1), matrix, { ...rect, width: 0 }, 250, 280)).toBeNull()
  })
})
