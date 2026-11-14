import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { lunarVector, vectorToLatLon, yawToFaceLon } from '../lib/astro/globeMath'
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

export default function MoonGlobe({ sites, selected, onPick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<(list: LunarSite[], selectedId: string | null) => void>(() => {})
  const focusRef = useRef<(site: LunarSite) => void>(() => {})
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
    // SphereGeometry's pole is +Y, but the group below rotates the lunar frame
    // so +z is up. Tilt the textured sphere by the inverse angle.
    sphere.rotation.x = Math.PI / 2

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

    // Rotation axis: lunar +z is the north pole, so the line runs along local z
    // and inherits the globe tilt, ending up world-vertical. It pokes out past
    // the surface so the poles are readable from any angle; depth testing hides
    // the half behind the sphere.
    const axisLength = RADIUS * 1.5
    const axisGroup = new THREE.Group()
    const axisMaterial = new THREE.MeshBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.95, depthWrite: false })
    const axisTube = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS*0.009, RADIUS*0.009, axisLength*2, 16), axisMaterial)
    axisTube.rotation.x = Math.PI / 2
    axisGroup.add(axisTube)
    const labels: {texture: THREE.CanvasTexture; sprite: THREE.Sprite}[] = []
    const addPole = (text: string, color: string, z: number) => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80
      const ctx = canvas.getContext('2d')!
      ctx.font = '600 32px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(5,12,22,0.82)'; ctx.lineWidth = 7; ctx.strokeText(text,128,40)
      ctx.fillStyle = color; ctx.fillText(text,128,40)
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}))
      sprite.position.z = z; sprite.scale.set(RADIUS*0.44,RADIUS*0.13,1); axisGroup.add(sprite); labels.push({texture,sprite})
    }
    addPole('NORTH','#9fe5ff',axisLength*0.74)
    addPole('SOUTH','#ffd18a',-axisLength*0.74)
    globe.add(axisGroup)

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
      },
      undefined,
      () => {
        // Keep the procedural Moon so the globe still renders offline.
      },
    )

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
    const pickAt = (clientX: number, clientY: number) => {
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
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
      pickRef.current(lat, lon)
    }

    let dragging = false
    let moved = 0
    let lastX = 0
    let lastY = 0
    const onPointerDown = (event: PointerEvent) => {
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
    const onWheel = (event: WheelEvent) => {
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

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      host.removeEventListener('wheel', onWheel)
      markersRef.current = () => {}
      focusRef.current = () => {}
      markers.geometry.dispose()
      markers.material.dispose()
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
    const list = selected && !sites.some((s) => s.id === selected.id) ? [...sites, selected] : sites
    markersRef.current(list, selected?.id ?? null)
    if (selected) focusRef.current(selected)
  }, [sites, selected])

  return <div className="moon-globe" ref={hostRef} />
}
