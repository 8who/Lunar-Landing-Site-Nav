import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { elevationAt } from '../lib/astro/terrain'
import { lunarVector, vectorToLatLon, yawToFaceLon } from '../lib/astro/globeMath'
import type { LunarSite } from '../lib/astro/types'
import { markerAtPointer } from './globeMarkers'
import { illuminationAt, loadIlluminationMap } from '../lib/illuminationData'
import {
  LAYER_INFO,
  legendGradient,
  paintAltitude,
  paintLight,
  paintTemperature,
  temperatureAt,
  type MoonLayer,
} from '../lib/moonLayers'
import { loadTerrainGrid } from '../lib/terrainData'
import { loadPolarCap, type PolarCap } from '../lib/polarData'
import { CAP_EDGE_LAT, capValue, paintCap } from '../lib/moonLayers'
import { polarXY, type Pole } from '../lib/astro/polar'

interface Props {
  sites: LunarSite[]
  selected: LunarSite | null
  onPick: (lat: number, lon: number) => void
  onSelectSite: (site: LunarSite) => void
  /** Instant for the temperature layer, UTC epoch ms (defaults to now) */
  t?: number
}

const LAYER_BUTTONS: { id: MoonLayer; label: string }[] = [
  { id: 'none', label: 'Photo' },
  { id: 'light', label: 'Light / shadow' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'altitude', label: 'Altitude' },
]

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const RADIUS = 1
const PITCH_LIMIT = 80 * RAD
const CLICK_SLOP_PX = 5
const DRAG_RAD_PER_PX = 0.006
/** A newly selected site farther than this from the view centre is rotated in. */
const FOCUS_MAX_DEG = 40
/** Keep polar sites off the limb instead of showing them edge-on. */
const FOCUS_PITCH_LIMIT = 35 * RAD
const FOCUS_MS = 400

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

export default function MoonGlobe({ sites, selected, onPick, onSelectSite, t }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<(canvas: HTMLCanvasElement | null) => void>(() => {})
  const tiltRef = useRef<(pitchRad: number) => void>(() => {})
  const capRef = useRef<(pole: Pole, canvas: HTMLCanvasElement | null) => void>(() => {})
  const [caps, setCaps] = useState<Partial<Record<Pole, PolarCap>>>({})
  const [layer, setLayer] = useState<MoonLayer>('none')
  const [grid, setGrid] = useState<Float32Array | null>(null)
  const [light, setLight] = useState<Uint8Array | null>(null)
  const [layerError, setLayerError] = useState(false)
  const markersRef = useRef<(list: LunarSite[], selectedId: string | null) => void>(() => {})
  const focusRef = useRef<(site: LunarSite) => void>(() => {})
  const pickRef = useRef(onPick)
  const selectRef = useRef(onSelectSite)
  const [showAll, setShowAll] = useState(false)
  const [hover, setHover] = useState<{ site: LunarSite; x: number; y: number } | null>(null)

  useEffect(() => {
    pickRef.current = onPick
    selectRef.current = onSelectSite
  }, [onPick, onSelectSite])
  useEffect(() => { setShowAll(false); setHover(null) }, [selected?.id, selected?.lat, selected?.lon])

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
    // SphereGeometry's pole is +Y, but the group below rotates the lunar frame
    // so +z is up. Tilt the textured sphere by the inverse angle.
    sphere.rotation.x = Math.PI / 2

    // The sphere is modelled with lunar +z at its pole, so tip it to put the
    // north pole up. Everything below inherits that rotation.
    const globe = new THREE.Group()
    globe.rotation.x = -Math.PI / 2
    globe.add(sphere)

    // Data layer: an unlit, slightly larger sphere with the same UV layout as
    // moon.jpg, so a canvas painted in lat/lon lands on the right place.
    const overlayGeometry = new THREE.SphereGeometry(RADIUS * 1.002, 128, 96)
    const overlayMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.88, depthWrite: false })
    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial)
    overlay.rotation.x = Math.PI / 2
    overlay.visible = false
    globe.add(overlay)
    // High-resolution polar caps (80-90 deg) from LOLA ldem_16: their own
    // polar-stereographic textures, so the poles are not squeezed into the
    // top and bottom rows of the global map.
    const capMeshes = new Map<Pole, THREE.Mesh>()
    for (const pole of ['south', 'north'] as const) {
      const rings = 48
      const segs = 256
      const positions: number[] = []
      const uvs: number[] = []
      const index: number[] = []
      // Half-width (km) of the cap rasters (811 px at 0.75 km), for the UVs.
      const half = (811 * 0.75) / 2
      for (let r = 0; r <= rings; r++) {
        const colat = (90 - CAP_EDGE_LAT) * (1 - r / rings)
        const lat = pole === 'south' ? -90 + colat : 90 - colat
        for (let k = 0; k <= segs; k++) {
          const lon = -180 + (360 * k) / segs
          const v = lunarVector(lat, lon, RADIUS * 1.003)
          positions.push(v.x, v.y, v.z)
          const xy = polarXY(pole, lat, lon)
          uvs.push((xy.x + half) / (2 * half), (xy.y + half) / (2 * half))
        }
      }
      for (let r = 0; r < rings; r++) {
        for (let k = 0; k < segs; k++) {
          const a = r * (segs + 1) + k
          const b = a + segs + 1
          index.push(a, b, a + 1, b, b + 1, a + 1)
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geometry.setIndex(index)
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0.95,
      })
      const mesh = new THREE.Mesh(geometry, mat)
      mesh.visible = false
      globe.add(mesh)
      capMeshes.set(pole, mesh)
    }
    capRef.current = (pole, canvas) => {
      const mesh = capMeshes.get(pole)
      if (!mesh) return
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      if (canvas) {
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        mat.map = tex
        mesh.visible = true
      } else {
        mat.map = null
        mesh.visible = false
      }
      mat.needsUpdate = true
      dirty = true
    }

    overlayRef.current = (canvas) => {
      overlayMaterial.map?.dispose()
      if (!canvas) {
        overlayMaterial.map = null
        overlay.visible = false
      } else {
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        overlayMaterial.map = tex
        overlay.visible = true
      }
      overlayMaterial.needsUpdate = true
      dirty = true
    }

    const markerCanvas = document.createElement('canvas')
    markerCanvas.width = markerCanvas.height = 64
    const markerContext = markerCanvas.getContext('2d')!
    markerContext.fillStyle = getComputedStyle(host).getPropertyValue('--site-marker-outline').trim()
    markerContext.beginPath(); markerContext.arc(32, 32, 30, 0, Math.PI * 2); markerContext.fill()
    markerContext.fillStyle = 'white'
    markerContext.beginPath(); markerContext.arc(32, 32, 22, 0, Math.PI * 2); markerContext.fill()
    const markerTexture = new THREE.CanvasTexture(markerCanvas)
    markerTexture.colorSpace = THREE.SRGBColorSpace
    const markers = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: 14,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        map: markerTexture,
        alphaTest: .4,
      }),
    )
    globe.add(markers)

    // Rotation axis: lunar +z is the north pole, so the line runs along local z
    // and inherits the globe tilt, ending up world-vertical. It pokes out past
    // the surface so the poles are readable from any angle; depth testing hides
    // the half behind the sphere.
    const axisLength = RADIUS * 1.5
    const axisGroup = new THREE.Group()
    const poleStyle = getComputedStyle(host)
    const axisMaterial = new THREE.MeshBasicMaterial({ color: poleStyle.getPropertyValue('--pole-axis').trim(), transparent: true, opacity: 0.95, depthWrite: false })
    const axisTube = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS*0.009, RADIUS*0.009, axisLength*2, 16), axisMaterial)
    axisTube.rotation.x = Math.PI / 2
    axisGroup.add(axisTube)
    const labels: {texture: THREE.CanvasTexture; sprite: THREE.Sprite; redraw: () => void}[] = []
    const addPole = (text: string, color: string, z: number) => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80
      const ctx = canvas.getContext('2d')!
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
      const redraw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.font = '500 34px "Source Sans 3", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(16,18,15,0.92)'
        ctx.lineWidth = 4
        ctx.strokeText(text, 128, 40)
        ctx.fillStyle = color
        ctx.fillText(text, 128, 40)
        texture.needsUpdate = true
      }
      redraw()
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}))
      sprite.position.z = z; sprite.scale.set(RADIUS*0.44,RADIUS*0.13,1); axisGroup.add(sprite); labels.push({texture,sprite,redraw})
    }
    addPole('North',poleStyle.getPropertyValue('--pole-north').trim(),axisLength*0.74)
    addPole('South',poleStyle.getPropertyValue('--pole-south').trim(),-axisLength*0.74)
    globe.add(axisGroup)
    // Canvas text does not automatically repaint when the bundled font arrives.
    document.fonts.load('500 34px "Source Sans 3"').then(() => {
      if (disposed) return
      labels.forEach(label => label.redraw())
      dirty = true
    }).catch(() => {})

    // Drag rotates this wrapper, never the globe itself: the mapping from a
    // clicked point to lat/lon stays in the sphere's own frame.
    const orbit = new THREE.Group()
    orbit.add(globe)
    scene.add(orbit)

    scene.add(new THREE.AmbientLight(0x8899aa, 0.5))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5)
    keyLight.position.set(2.4, 1.6, 3.4)
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x4fd8ff, 0.3)
    rimLight.position.set(-3, -2, 1)
    scene.add(rimLight)

    const yaw = { current: yawToFaceLon(selected?.lon ?? 0) }
    const pitch = {
      current: Math.max(
        -FOCUS_PITCH_LIMIT,
        Math.min(FOCUS_PITCH_LIMIT, (selected?.lat ?? 0) * RAD),
      ),
    }
    // Rotation to a newly picked site; driven from the render loop so it is
    // frame-rate independent while the slider/selection keeps changing.
    const anim = {
      active: false,
      start: 0,
      duration: FOCUS_MS,
      fromYaw: yaw.current,
      fromPitch: pitch.current,
      toYaw: yaw.current,
      toPitch: pitch.current,
    }
    const easeOut = (u: number) => 1 - (1 - u) ** 3

    let dirty = true
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (anim.active) {
        const u = Math.min(1, Math.max(0, (now - anim.start) / anim.duration))
        const eased = easeOut(u)
        yaw.current = anim.fromYaw + (anim.toYaw - anim.fromYaw) * eased
        pitch.current = anim.fromPitch + (anim.toPitch - anim.fromPitch) * eased
        if (u >= 1) anim.active = false
        dirty = true
      }
      if (!dirty) return
      dirty = false
      orbit.rotation.set(pitch.current, yaw.current, 0)
      renderer.render(scene, camera)
    }
    // Apply the initial view even if the first animation frame is delayed.
    orbit.rotation.set(pitch.current, yaw.current, 0)
    raf = requestAnimationFrame(draw)

    // Real map: public/moon.jpg (NASA SVS, 2048x1024, longitude 0 at centre,
    // north up). The procedural texture paints the globe until it arrives and
    // stays as the fallback if the image cannot be loaded.
    let disposed = false
    new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}moon.jpg`,
      (loaded) => {
        if (disposed) {
          loaded.dispose()
          return
        }
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.anisotropy = renderer.capabilities.getMaxAnisotropy()
        const previous = material.map
        material.map = loaded
        material.needsUpdate = true
        if (previous && previous !== loaded) previous.dispose()
        dirty = true
        // Then the 8K LROC mosaic (8192 x 4096) where the GPU can hold it.
        if (renderer.capabilities.maxTextureSize >= 8192) {
          new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}moon-8k.jpg`, (hi) => {
            if (disposed) {
              hi.dispose()
              return
            }
            hi.colorSpace = THREE.SRGBColorSpace
            hi.anisotropy = renderer.capabilities.getMaxAnisotropy()
            const before = material.map
            material.map = hi
            material.needsUpdate = true
            if (before && before !== hi) before.dispose()
            dirty = true
          })
        }
      },
      undefined,
      () => {
        // Keep the procedural Moon so the globe still renders offline.
      },
    )

    let visibleSites: LunarSite[] = []
    markersRef.current = (list, selectedId) => {
      visibleSites = list
      setHover(null)
      const positions = new Float32Array(list.length * 3)
      const colors = new Float32Array(list.length * 3)
      const passive = new THREE.Color(poleStyle.getPropertyValue('--site-marker').trim())
      const active = new THREE.Color(poleStyle.getPropertyValue('--site-selected').trim())
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

    // Angle between the view centre and a selenographic point, in degrees.
    const X_AXIS = new THREE.Vector3(1, 0, 0)
    const Y_AXIS = new THREE.Vector3(0, 1, 0)
    const facingAngleDeg = (lat: number, lon: number) => {
      const v = lunarVector(lat, lon, 1)
      const point = new THREE.Vector3(v.x, v.y, v.z)
      // Same order as the scene graph: globe tilt, orbit yaw, orbit pitch.
      point.applyAxisAngle(X_AXIS, -Math.PI / 2)
      point.applyAxisAngle(Y_AXIS, yaw.current)
      point.applyAxisAngle(X_AXIS, pitch.current)
      return Math.acos(Math.min(1, Math.max(-1, point.z / point.length()))) * DEG
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
    const markerAt = (clientX: number, clientY: number) => {
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld()
      return markerAtPointer(visibleSites, camera, globe.matrixWorld, host.getBoundingClientRect(), clientX, clientY)
    }
    const pickAt = (clientX: number, clientY: number) => {
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const marker = markerAt(clientX, clientY)
      if (marker) {
        setShowAll(false)
        setHover(null)
        selectRef.current(marker.site)
        return
      }
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      scene.updateMatrixWorld(true)
      // rAF can be paused (background/occluded tab); do not rely on the last
      // render having refreshed the camera matrices.
      camera.updateMatrixWorld()
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(sphere, false)[0]
      if (!hit) return
      const local = globe.worldToLocal(hit.point.clone())
      const { lat, lon } = vectorToLatLon(local.x, local.y, local.z)
      setShowAll(false)
      setHover(null)
      pickRef.current(lat, lon)
    }

    let dragging = false
    let moved = 0
    let lastX = 0
    let lastY = 0
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element).closest('.globe-site-controls')) return
      setHover(null)
      host.style.cursor = ''
      // A drag takes over from any in-flight focus animation.
      anim.active = false
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
      if (!dragging) {
        const hit = (event.target as Element).closest('.globe-site-controls') ? null : markerAt(event.clientX, event.clientY)
        setHover((previous) => hit && previous?.site.id === hit.site.id && previous.x === hit.x && previous.y === hit.y ? previous : hit)
        host.style.cursor = hit ? 'pointer' : ''
        return
      }
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
    const clearHover = () => { setHover(null); host.style.cursor = '' }
    const onPointerCancel = () => { dragging = false; host.classList.remove('dragging'); clearHover() }
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerCancel)
    host.addEventListener('pointerleave', clearHover)
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.globe-site-controls')) return
      clearHover()
      event.preventDefault()
      camera.position.z = Math.max(1.35, Math.min(5.5, camera.position.z * Math.exp(event.deltaY * 0.001)))
      camera.updateProjectionMatrix()
      dirty = true
    }
    host.addEventListener('wheel', onWheel, { passive: false })

    // Selecting a site far from the current centre swings it into view.
    focusRef.current = (site) => {
      if (dragging) return
      if (facingAngleDeg(site.lat, site.lon) <= FOCUS_MAX_DEG) return
      const targetPitch = Math.max(
        -FOCUS_PITCH_LIMIT,
        Math.min(FOCUS_PITCH_LIMIT, site.lat * RAD),
      )
      // Shortest way round: a longitude repeats every full turn.
      const targetYaw = yawToFaceLon(site.lon)
      const delta =
        (((targetYaw - yaw.current + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) -
        Math.PI
      // Polar sites keep their clamped pitch, so a re-selection may need no move.
      if (Math.abs(delta) < 1e-6 && Math.abs(targetPitch - pitch.current) < 1e-6) return
      anim.fromYaw = yaw.current
      anim.fromPitch = pitch.current
      anim.toYaw = yaw.current + delta
      anim.toPitch = targetPitch
      anim.start = performance.now()
      anim.duration = FOCUS_MS
      anim.active = true
      dirty = true
    }

    // Swing the view to a given pitch (keeps the yaw), e.g. to look down on a pole.
    tiltRef.current = (target) => {
      if (dragging) return
      anim.fromYaw = yaw.current
      anim.fromPitch = pitch.current
      anim.toYaw = yaw.current
      anim.toPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, target))
      anim.start = performance.now()
      anim.duration = 700
      anim.active = true
      dirty = true
    }

    return () => {
      disposed = true
      tiltRef.current = () => {}
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerCancel)
      host.removeEventListener('pointerleave', clearHover)
      host.removeEventListener('wheel', onWheel)
      markersRef.current = () => {}
      focusRef.current = () => {}
      overlayRef.current = () => {}
      capRef.current = () => {}
      for (const mesh of capMeshes.values()) {
        ;(mesh.material as THREE.MeshBasicMaterial).map?.dispose()
        ;(mesh.material as THREE.Material).dispose()
        mesh.geometry.dispose()
      }
      overlayMaterial.map?.dispose()
      overlayMaterial.dispose()
      overlayGeometry.dispose()
      markers.geometry.dispose()
      markers.material.dispose()
      markerTexture.dispose()
      markers.parent?.remove(markers)
      axisGroup.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); if ((o as THREE.Sprite).isSprite) ((o as THREE.Sprite).material as THREE.SpriteMaterial).dispose() })
      labels.forEach(label => label.texture.dispose())
      axisGroup.parent?.remove(axisGroup)
      geometry.dispose()
      // Dispose whichever map is bound: the real one if it loaded, else the
      // procedural fallback. A late load disposes itself via `disposed`.
      material.map?.dispose()
      material.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    // Custom picks are not part of the curated list; keep their marker visible.
    const all = selected && !sites.some((s) => s.id === selected.id) ? [...sites, selected] : sites
    const list = showAll || !selected ? all : [selected]
    markersRef.current(list, selected?.id ?? null)
  }, [sites, selected, showAll])

  // Re-focus only when the site itself moves, not when the same site comes back
  // as a new object (e.g. once its terrain skyline is attached): that would
  // undo a user's drag or the pole tilt of the light layer.
  useEffect(() => {
    if (selected) focusRef.current(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.lat, selected?.lon])

  // Data for the layers loads only once a layer is first asked for.
  useEffect(() => {
    if (layer === 'none') return
    let cancelled = false
    Promise.all([loadPolarCap('south'), loadPolarCap('north')]).then(([south, north]) => {
      if (!cancelled) setCaps({ south: south ?? undefined, north: north ?? undefined })
    })
    Promise.all([loadTerrainGrid(), layer === 'altitude' ? Promise.resolve(null) : loadIlluminationMap()]).then(
      ([g, l]) => {
        if (cancelled) return
        if (g) setGrid(g)
        if (l) setLight(l)
        setLayerError(!g || (layer !== 'altitude' && !l))
      },
    )
    return () => {
      cancelled = true
    }
  }, [layer])

  // Temperature follows the instant, but repainting 260k cells per slider tick
  // is wasteful: refresh at most every ~2 h of simulated time.
  const instant = t ?? Date.now()
  const tempBucket = Math.round(instant / 7_200_000) * 7_200_000

  useEffect(() => {
    if (layer === 'none') {
      overlayRef.current(null)
      return
    }
    const canvas = document.createElement('canvas')
    if (layer === 'altitude' && grid) paintAltitude(canvas, grid)
    else if (layer === 'light' && light) paintLight(canvas, light)
    else if (layer === 'temperature' && grid && light) paintTemperature(canvas, grid, light, tempBucket)
    else {
      overlayRef.current(null)
      return
    }
    overlayRef.current(canvas)
  }, [layer, grid, light, layer === 'temperature' ? tempBucket : 0])

  // Polar caps follow the same layer at 4x the resolution.
  useEffect(() => {
    for (const pole of ['south', 'north'] as const) {
      const cap = caps[pole]
      if (layer === 'none' || !cap) {
        capRef.current(pole, null)
        continue
      }
      const canvas = document.createElement('canvas')
      paintCap(canvas, pole, cap, layer, tempBucket)
      capRef.current(pole, canvas)
    }
  }, [layer, caps, layer === 'temperature' ? tempBucket : 0])

  const readout = useMemo(() => {
    if (!selected || layer === 'none') return null
    const capPole: Pole = selected.lat < 0 ? 'south' : 'north'
    const cap = Math.abs(selected.lat) >= CAP_EDGE_LAT ? caps[capPole] : undefined
    const hi = cap ? capValue(cap, layer, selected.lat, selected.lon, layer === 'temperature' ? tempBucket : instant) : undefined
    if (hi !== undefined) {
      if (layer === 'altitude') return `${hi.toFixed(2)} km · 1.9 km data`
      if (layer === 'light') {
        const v = Math.round(hi)
        return `${v === 0 ? '0% · permanent shadow' : `${v}% of the year in sunlight`} · 1.9 km data`
      }
      return `${Math.round(hi)} K (${Math.round(hi - 273.15)} °C) · 1.9 km data`
    }
    if (layer === 'altitude' && grid) return `${elevationAt(grid, selected.lat, selected.lon).toFixed(2)} km`
    if (layer === 'light' && light) {
      const v = illuminationAt(light, selected.lat, selected.lon)
      return v === 0 ? '0% · permanent shadow' : `${v}% of the year in sunlight`
    }
    if (layer === 'temperature' && grid && light) {
      const k = temperatureAt(grid, light, tempBucket, selected.lat, selected.lon)
      return `${Math.round(k)} K (${Math.round(k - 273.15)} °C)`
    }
    return null
  }, [layer, grid, light, selected, instant, tempBucket, caps])

  const info = layer === 'none' ? null : LAYER_INFO[layer]

  return (
    <div className="moon-globe-wrap">
      <div className="moon-globe" ref={hostRef} role="group" aria-label="Interactive Moon landing sites">
        <div className="globe-site-controls">
          <button type="button" aria-pressed={showAll} onClick={() => { setHover(null); setShowAll((value) => !value) }}>{showAll ? 'Show selected site only' : 'Browse all sites'}</button>
          {showAll && <label><span>Choose a named site</span><select value={sites.some((site) => site.id === selected?.id) ? selected!.id : ''} onChange={(event) => {
            const next = sites.find((site) => site.id === event.target.value)
            if (next) { setShowAll(false); onSelectSite(next) }
          }}><option value="" disabled>Select a landing site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
        </div>
        {hover && <div className="globe-site-tooltip" role="tooltip" style={{ left: Math.max(110, Math.min(hover.x, (hostRef.current?.clientWidth ?? 400) - 110)), top: Math.max(80, hover.y - 14) }}><strong>{hover.site.name}</strong><span>Click to select this site</span></div>}
      </div>
      <div className="moon-layers" role="group" aria-label="Map layer">
        {LAYER_BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={layer === b.id ? 'active' : ''}
            aria-pressed={layer === b.id}
            onClick={() => {
              setLayer(b.id)
              // Bring polar terrain into view without hiding a selected site
              // elsewhere on the Moon.
              if (b.id === 'light' && layer !== 'light' && selected && Math.abs(selected.lat) >= CAP_EDGE_LAT) {
                tiltRef.current((selected.lat < 0 ? -1 : 1) * PITCH_LIMIT)
              }
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      {info && (
        <div className="moon-legend">
          <div className="moon-legend-head">
            <strong>{info.label}</strong>
            {readout && <span>Selected site: {readout}</span>}
          </div>
          {layer === 'temperature' && <span className="moon-legend-time">Map sample: {new Date(tempBucket).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>}
          <div className="moon-legend-bar" style={{ background: legendGradient(info.stops) }} />
          <div className="moon-legend-ticks">
            {info.ticks.map((tick) => (
              <span
                key={tick.label}
                style={{
                  left: `${((tick.at - info.stops[0][0]) / (info.stops[info.stops.length - 1][0] - info.stops[0][0])) * 100}%`,
                }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <p className="moon-legend-source">
            {layerError ? 'Layer data could not be loaded.' : info.source}
          </p>
        </div>
      )}
    </div>
  )
}
