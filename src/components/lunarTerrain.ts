import * as THREE from 'three'
import { elevationAt } from '../lib/astro/terrain'
import type { LunarSite } from '../lib/astro/types'

/** Regional terrain patch, 300 km across; scene scale 0.1 units per km. */
export function createLunarTerrain(grid: Float32Array, site: LunarSite, map: THREE.Texture) {
  const rad = Math.PI / 180, lat = site.lat * rad, lon = site.lon * rad
  const up = new THREE.Vector3(Math.cos(lat)*Math.cos(lon), Math.cos(lat)*Math.sin(lon), Math.sin(lat))
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0)
  const north = new THREE.Vector3().crossVectors(up, east)
  const base = 1737.4 + elevationAt(grid, site.lat, site.lon)
  const geometry = new THREE.PlaneGeometry(300, 300, 128, 128)
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i++) {
    const e = positions.getX(i), n = positions.getY(i)
    const direction = up.clone().multiplyScalar(1737.4).addScaledVector(east,e).addScaledVector(north,n).normalize()
    const latitude = Math.asin(direction.z) / rad, longitude = Math.atan2(direction.y,direction.x) / rad
    const point = direction.multiplyScalar(1737.4 + elevationAt(grid,latitude,longitude)).addScaledVector(up,-base)
    positions.setXYZ(i,point.dot(east)*0.1,point.dot(up)*0.1-0.0002,-point.dot(north)*0.1)
    // Keep longitude continuous across the date line; texture wraps horizontally.
    const delta = ((longitude-site.lon+540)%360)-180
    uv.setXY(i,(site.lon+delta+180)/360,(latitude+90)/180)
  }
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({map,roughness:1,side:THREE.DoubleSide,transparent:true})
  const mesh = new THREE.Mesh(geometry,material)
  mesh.renderOrder = 11
  return mesh
}
