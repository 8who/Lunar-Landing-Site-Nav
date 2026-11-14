import * as THREE from 'three'
import { elevationAt } from '../lib/astro/terrain'
import type { LunarSite } from '../lib/astro/types'

/** Seamless, illustrative fine regolith; regional features still come from LOLA. */
function makeSurfaceDetail() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(512, 512)
  let seed = 48127
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < pixels.data.length; i += 4) {
    const shade = Math.floor(112 + random() * 32)
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade
    pixels.data[i + 3] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  for (let i = 0; i < 260; i++) {
    const x = random() * 512, y = random() * 512, radius = 2 + random() * 12
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius)
      gradient.addColorStop(0, 'rgba(55,55,55,0.42)')
      gradient.addColorStop(0.65, 'rgba(85,85,85,0.25)')
      gradient.addColorStop(0.84, 'rgba(190,190,190,0.28)')
      gradient.addColorStop(1, 'rgba(128,128,128,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.channel = 1
  texture.repeat.set(1, 1)
  return texture
}

/** Regional terrain patch, 300 km across; scene scale 0.1 units per km. */
export function createLunarTerrain(grid: Float32Array, site: LunarSite, map: THREE.Texture) {
  const rad = Math.PI / 180, lat = site.lat * rad, lon = site.lon * rad
  const up = new THREE.Vector3(Math.cos(lat)*Math.cos(lon), Math.cos(lat)*Math.sin(lon), Math.sin(lat))
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0)
  const north = new THREE.Vector3().crossVectors(up, east)
  const base = 1737.4 + elevationAt(grid, site.lat, site.lon)
  // Concentrate vertices around the observer while retaining the 300 km extent.
  const geometry = new THREE.PlaneGeometry(300, 300, 384, 384)
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
  const detailUv = new Float32Array(positions.count * 2)
  const craters = [[18, 24, 7], [-27, 16, 10], [36, -22, 6], [-13, -32, 5], [42, 8, 3], [-43, -18, 4], [5, -49, 8], [-52, 37, 5]]
  const detailHeight = (e: number, n: number) => {
    const x = e * 1000, z = n * 1000, distance = Math.hypot(x,z)
    const fade = 1 - THREE.MathUtils.smoothstep(distance, 60, 120)
    // Metre-scale illustrative terrain, fading smoothly into measured relief.
    let h = 0.18 * Math.sin(x * 0.31 + Math.sin(z * 0.08)) * Math.sin(z * 0.27)
      + 0.42 * Math.sin(x * 0.12) * Math.sin(z * 0.095)
      + 0.85 * Math.sin(x * 0.027 + Math.sin(z * 0.018)) * Math.sin(z * 0.031)
    for (const [cx, cz, radius] of craters) {
      const r = Math.hypot(x-cx,z-cz) / radius
      h += 0.55 * Math.exp(-(((r-1)/0.18)**2)) - 1.1 * Math.exp(-((r/0.7)**2))
    }
    return h * fade / 1000
  }
  const originDetail = detailHeight(0,0)
  const surface = (e: number, n: number) => {
    const direction = up.clone().multiplyScalar(1737.4).addScaledVector(east,e).addScaledVector(north,n).normalize()
    const latitude = Math.asin(direction.z) / rad, longitude = Math.atan2(direction.y,direction.x) / rad
    const point = direction.multiplyScalar(1737.4 + elevationAt(grid,latitude,longitude)).addScaledVector(up,-base)
    return { latitude, longitude, position: new THREE.Vector3(point.dot(east)*0.1,
      (point.dot(up)+detailHeight(e,n)-originDetail)*0.1-0.0002, -point.dot(north)*0.1) }
  }
  for (let i = 0; i < positions.count; i++) {
    const warp = (v: number) => Math.sign(v) * Math.pow(Math.abs(v)/150,3) * 150
    const e = warp(positions.getX(i)), n = warp(positions.getY(i))
    const { latitude, longitude, position } = surface(e,n)
    const edge = Math.max(Math.abs(positions.getX(i)), Math.abs(positions.getY(i)))
    position.y *= 1 - THREE.MathUtils.smoothstep(edge, 142, 150)
    positions.setXYZ(i,position.x,position.y,position.z)
    const delta = ((longitude-site.lon+540)%360)-180
    uv.setXY(i,(site.lon+delta+180)/360,(latitude+90)/180)
    detailUv[i*2] = e / 0.012
    detailUv[i*2+1] = n / 0.012
  }
  geometry.setAttribute('uv1',new THREE.BufferAttribute(detailUv,2))
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({map, bumpMap: makeSurfaceDetail(), bumpScale: 0.000035, roughness:1,side:THREE.DoubleSide,transparent:true})
  const mesh = new THREE.Mesh(geometry,material)
  mesh.renderOrder = 11
  geometry.computeBoundingSphere()
  return mesh
}
