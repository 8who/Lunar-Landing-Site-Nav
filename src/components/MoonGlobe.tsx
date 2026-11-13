import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { LunarSite } from '../lib/astro/types'

interface Props {
  sites: LunarSite[]
  selected: LunarSite | null
  onPick: (lat: number, lon: number) => void
}

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const RADIUS = 1
const PITCH_LIMIT = 80 * RAD
const CLICK_SLOP_PX = 5
const DRAG_RAD_PER_PX = 0.006

/** Lunar body-fixed vector (z = north) for a selenographic coordinate. */
function lunarVector(lat: number, lon: number, radius: number): THREE.Vector3 {
  const la = lat * RAD
  const lo = lon * RAD
  return new THREE.Vector3(
    Math.cos(la) * Math.cos(lo),
    Math.cos(la) * Math.sin(lo),
    Math.sin(la),
  ).multiplyScalar(radius)
}

/** Equirectangular grey Moon: maria plus a few hundred craters, fixed seed. */
function makeMoonTexture(): THREE.CanvasTexture {
  const width = 1_024
  const height = 512
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#8b8b8d'
  ctx.fillRect(0, 0, width, height)

  let seed = 42
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    return seed / 4_294_967_296
  }

  // Maria: broad dark patches.
  for (let i = 0; i < 16; i++) {
    const x = random() * width
    const y = random() * height
    const r = 40 + random() * 110
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
    gradient.addColorStop(0, 'rgba(74, 74, 78, 0.75)')
    gradient.addColorStop(1, 'rgba(74, 74, 78, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Craters: soft light centre with a darker rim.
  for (let i = 0; i < 260; i++) {
    const x = random() * width
    const y = random() * height
    const r = 1.5 + random() * 11
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
    gradient.addColorStop(0, 'rgba(196, 196, 200, 0.6)')
    gradient.addColorStop(0.65, 'rgba(140, 140, 144, 0.45)')
    gradient.addColorStop(1, 'rgba(105, 105, 110, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export default function MoonGlobe({ sites, selected, onPick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<(list: LunarSite[], selectedId: string | null) => void>(() => {})
  const pickRef = useRef(onPick)

  useEffect(() => {
    pickRef.current = onPick
  }, [onPick])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
    camera.position.set(0, 0, 3.1)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const texture = makeMoonTexture()
    const geometry = new THREE.SphereGeometry(RADIUS, 96, 64)
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
    const sphere = new THREE.Mesh(geometry, material)

    // The sphere is modelled with lunar +z at its pole, so tip it to put the
    // north pole up. Everything below inherits that rotation.
    const globe = new THREE.Group()
    globe.rotation.x = -Math.PI / 2
    globe.add(sphere)

    const markers = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: 6,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    )
    globe.add(markers)

    // Drag rotates this wrapper, never the globe itself: the mapping from a
    // clicked point to lat/lon stays in the sphere's own frame.
    const orbit = new THREE.Group()
    orbit.add(globe)
    scene.add(orbit)

    scene.add(new THREE.AmbientLight(0x8899aa, 0.35))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5)
    keyLight.position.set(2.4, 1.6, 3.4)
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x4fd8ff, 0.3)
    rimLight.position.set(-3, -2, 1)
    scene.add(rimLight)

    const yaw = { current: 0 }
    const pitch = { current: 0 }
    let dirty = true
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!dirty) return
      dirty = false
      orbit.rotation.set(pitch.current, yaw.current, 0)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(draw)

    markersRef.current = (list, selectedId) => {
      const positions = new Float32Array(list.length * 3)
      const colors = new Float32Array(list.length * 3)
      const passive = new THREE.Color(0x9fd8ff)
      const active = new THREE.Color(0xffb547)
      list.forEach((site, index) => {
        const v = lunarVector(site.lat, site.lon, RADIUS * 1.006)
        positions[index * 3] = v.x
        positions[index * 3 + 1] = v.y
        positions[index * 3 + 2] = v.z
        const color = site.id === selectedId ? active : passive
        colors[index * 3] = color.r
        colors[index * 3 + 1] = color.g
        colors[index * 3 + 2] = color.b
      })
      const next = new THREE.BufferGeometry()
      next.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      next.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      markers.geometry.dispose()
      markers.geometry = next
      dirty = true
    }

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      dirty = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const pickAt = (clientX: number, clientY: number) => {
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      scene.updateMatrixWorld(true)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(sphere, false)[0]
      if (!hit) return
      const local = sphere.worldToLocal(hit.point.clone())
      const radius = local.length()
      if (radius === 0) return
      const lat = Math.asin(Math.min(1, Math.max(-1, local.z / radius))) * DEG
      const lon = Math.atan2(local.y, local.x) * DEG
      pickRef.current(lat, lon)
    }

    let dragging = false
    let moved = 0
    let lastX = 0
    let lastY = 0
    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      moved = 0
      lastX = event.clientX
      lastY = event.clientY
      try {
        host.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointers cannot be captured.
      }
      host.classList.add('dragging')
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      moved += Math.abs(dx) + Math.abs(dy)
      yaw.current -= dx * DRAG_RAD_PER_PX
      pitch.current = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch.current - dy * DRAG_RAD_PER_PX))
      lastX = event.clientX
      lastY = event.clientY
      dirty = true
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      host.classList.remove('dragging')
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
      if (moved < CLICK_SLOP_PX) pickAt(event.clientX, event.clientY)
    }
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerUp)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      markersRef.current = () => {}
      markers.geometry.dispose()
      markers.material.dispose()
      markers.parent?.remove(markers)
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    markersRef.current(sites, selected?.id ?? null)
  }, [sites, selected])

  return <div className="moon-globe" ref={hostRef} />
}
