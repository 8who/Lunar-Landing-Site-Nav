import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createLunarTerrain } from './lunarTerrain'
import { createObserver } from '../lib/astro/observer'
import { panelNormalSky, tiltArcPoints } from '../lib/astro/panel'
import { isTerrainCritical } from '../lib/astro/sites'
import type { LunarSite, SkySample } from '../lib/astro/types'
import { deg } from '../lib/format'

interface Props {
  site: LunarSite
  /** UTC epoch ms */
  t: number
  /** Best fixed panel to mark on the sky, or null to hide it. */
  panel?: { tiltDeg: number; azimuthDeg: number } | null
}

const RAD = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Scene units. Bodies sit on this shell; the ground is closer, so it occludes them. */
const SKY_RADIUS = 100
const GROUND_RADIUS = 55
const STAR_RADIUS = 320

/** Real angular sizes are unreadable at 70° FOV; the caption says so. */
const SIZE_BOOST = 3
const MIN_SIZE_DEG = 0.5

const PITCH_MIN_DEG = -89
const PITCH_MAX_DEG = 89
const DRAG_RAD_PER_PX = 0.004

/**
 * Azimuth / elevation -> three.js vector.
 * North is -z, east is +x, up is +y, matching a yaw of 0 looking north.
 */
function skyVector(azimuthDeg: number, elevationDeg: number, distance: number): THREE.Vector3 {
  const az = azimuthDeg * RAD
  const el = elevationDeg * RAD
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  ).multiplyScalar(distance)
}

/** Radius on the sky shell for an apparent diameter, after the exaggeration. */
function bodyRadius(angularDiameterDeg: number): number {
  const apparent = Math.max(angularDiameterDeg * SIZE_BOOST, MIN_SIZE_DEG)
  return Math.tan((apparent * RAD) / 2) * SKY_RADIUS
}

/** Soft radial glow, generated on a canvas so we need no texture assets. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.16, 'rgba(255, 245, 220, 0.75)')
  gradient.addColorStop(0.45, 'rgba(255, 230, 190, 0.2)')
  gradient.addColorStop(1, 'rgba(255, 220, 170, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Static starfield on the upper half of a sphere, with a fixed seed. */
function makeStars(): THREE.Points {
  const count = 1_200
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  let seed = 20_260_113
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    return seed / 4_294_967_296
  }
  for (let i = 0; i < count; i++) {
    const y = random() // upper hemisphere only: the ground hides the rest
    const theta = random() * Math.PI * 2
    const r = Math.sqrt(1 - y * y)
    positions[i * 3] = Math.cos(theta) * r * STAR_RADIUS
    positions[i * 3 + 1] = y * STAR_RADIUS
    positions[i * 3 + 2] = Math.sin(theta) * r * STAR_RADIUS

    const warm = random()
    const brightness = 0.55 + random() * 0.45
    colors[i * 3] = brightness * (warm > 0.8 ? 1 : 0.88)
    colors[i * 3 + 1] = brightness * 0.92
    colors[i * 3 + 2] = brightness * (warm > 0.8 ? 0.78 : 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  return new THREE.Points(geometry, material)
}

export default function SkyView({ site, t, panel }: Props) {
  const controlsRef = useRef<(action: 'in' | 'out' | 'reset' | 'sun' | 'earth' | 'terrain') => void>(() => {})
  const [terrainStatus, setTerrainStatus] = useState('Loading NASA terrain…')
  const [seeThrough, setSeeThrough] = useState(false)
  const [fov, setFov] = useState(70)
  const hostRef = useRef<HTMLDivElement>(null)
  const updateRef = useRef<(sample: SkySample, siteId: string) => void>(() => {})
  const updatePanelRef = useRef<(panel: Props['panel']) => void>(() => {})
  // The scene effect runs once, so it reads the latest prop through this ref.
  const latestPanelRef = useRef<Props['panel']>(panel ?? null)
  latestPanelRef.current = panel ?? null
  const [sky, setSky] = useState<SkySample | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    setSeeThrough(false)
    setFov(70)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x010206)

    const camera = new THREE.PerspectiveCamera(70, 1, 0.00001, 2_000)
    camera.rotation.order = 'YXZ'

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)

    // Ground: the lower half of a sphere. Everything under y = 0 is inside it,
    // so a Sun or Earth below the horizon is occluded instead of drawn.
    const sphereGeometry = new THREE.SphereGeometry(1, 32, 24)
    // Illustrative regolith, not a map of the selected landing site.
    const groundCanvas = document.createElement('canvas')
    groundCanvas.width = groundCanvas.height = 512
    const groundContext = groundCanvas.getContext('2d')!
    const pixels = groundContext.createImageData(512, 512)
    let seed = 42
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < pixels.data.length; i += 4) {
      const shade = 95 + random() * 65
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade
      pixels.data[i + 3] = 255
    }
    groundContext.putImageData(pixels, 0, 0)
    // Broad, softly shaded depressions give the grain a readable surface scale.
    // Wrap every mark across the tile edges so repetition has no hard seams.
    for (let i = 0; i < 100; i++) {
      const x = random() * 512
      const y = random() * 512
      const radius = 3 + random() * 28
      for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
        const gradient = groundContext.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius)
        gradient.addColorStop(0, 'rgba(35,35,35,0.45)')
        gradient.addColorStop(0.65, 'rgba(55,55,55,0.3)')
        gradient.addColorStop(0.85, 'rgba(210,210,210,0.18)')
        gradient.addColorStop(1, 'rgba(130,130,130,0)')
        groundContext.fillStyle = gradient
        groundContext.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2)
      }
    }
    const groundTexture = new THREE.CanvasTexture(groundCanvas)
    groundTexture.colorSpace = THREE.SRGBColorSpace
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping
    groundTexture.repeat.set(4, 4)
    groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    // A closed lower sky hemisphere cannot be near-clipped or expose a plane edge.
    const groundGeometry = new THREE.SphereGeometry(GROUND_RADIUS, 96, 64, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
    // Project onto a disk using angular distance from nadir. Unlike sphere UVs,
    // this has no longitude seam or collapsed texture coordinates at the pole.
    const position = groundGeometry.getAttribute('position')
    const uv = groundGeometry.getAttribute('uv')
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      const radial = Math.hypot(x, z)
      const angle = Math.acos(clamp(-position.getY(i) / GROUND_RADIUS, 0, 1))
      const scale = radial > 1e-6 ? angle / Math.PI / radial : 0
      uv.setXY(i, 0.5 + x * scale, 0.5 + z * scale)
    }
    uv.needsUpdate = true
    const groundMaterial = new THREE.MeshStandardMaterial({
      map: groundTexture, roughness: 1, metalness: 0, side: THREE.BackSide, transparent: true,
    })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.renderOrder = 10
    scene.add(ground)

    const ambient = new THREE.HemisphereLight(0x9fb3cf, 0x0d1118, 0.4)
    const sunLight = new THREE.DirectionalLight(0xfff1cf, 1)
    const lightTarget = new THREE.Object3D()
    sunLight.target = lightTarget
    scene.add(ambient, sunLight, lightTarget)

    const stars = makeStars()
    scene.add(stars)

    const glowTexture = makeGlowTexture()

    const sun = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({ color: 0xfff6d8 }))
    const sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffcf82,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    const sunGroup = new THREE.Group()
    sunGroup.add(sun, sunGlow)
    scene.add(sunGroup)

    const earth = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({ color: 0x2f6fca }))
    const clouds = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xeaf4ff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    )
    const earthGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x9ad4ff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    const earthGroup = new THREE.Group()
    earthGroup.add(earth, clouds, earthGlow)
    scene.add(earthGroup)

    // Best fixed-panel marker: cyan ring at the normal, an arc from the zenith
    // down to it, and a tick at the zenith. Hidden until a panel is provided.
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: 0x4fd6e8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const panelGroup = new THREE.Group()
    panelGroup.visible = false

    const panelMarker = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 48), panelMaterial)
    panelGroup.add(panelMarker)

    const panelArc = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x4fd6e8, transparent: true, opacity: 0.6 }),
    )
    panelGroup.add(panelArc)

    const zenithTick = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), panelMaterial)
    zenithTick.position.copy(skyVector(0, 90, SKY_RADIUS - 2))
    panelGroup.add(zenithTick)

    scene.add(panelGroup)

    // Camera state lives outside React: dragging must not re-render the tree.
    const yaw = { current: 0 }
    const pitch = { current: 0 }
    let aimedFor = ''

    let terrain: ReturnType<typeof createLunarTerrain> | null = null
    let terrainDisposed = false
    const abortTerrain = new AbortController()
    setTerrainStatus('Loading NASA terrain…')
    const terrainMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}moon.jpg`, () => { dirty = true })
    terrainMap.colorSpace = THREE.SRGBColorSpace
    terrainMap.wrapS = THREE.RepeatWrapping
    terrainMap.anisotropy = renderer.capabilities.getMaxAnisotropy()
    fetch(`${import.meta.env.BASE_URL}moon-elevation.f32`, { signal: abortTerrain.signal })
      .then(response => { if (!response.ok) throw new Error('Elevation unavailable'); return response.arrayBuffer() })
      .then(buffer => {
        if (terrainDisposed) return
        if (buffer.byteLength !== 1440 * 720 * 4) throw new Error('Invalid elevation grid')
        terrain = createLunarTerrain(new Float32Array(buffer), site, terrainMap)
        terrain.material.opacity = groundMaterial.opacity
        terrain.material.depthWrite = groundMaterial.depthWrite
        scene.add(terrain)
        setTerrainStatus('NASA LRO / LOLA terrain · 4 pixels/degree · regional detail')
        dirty = true
      }).catch(() => { if (!terrainDisposed) setTerrainStatus('Terrain unavailable · illustrative ground fallback') })
    let latestSample: SkySample | null = null
    let dirty = true
    const zoom = (value: number) => {
      camera.fov = clamp(value, 10, 90)
      camera.updateProjectionMatrix()
      setFov(camera.fov)
      dirty = true
    }
    controlsRef.current = action => {
      if (action === 'terrain') {
        const enabled = groundMaterial.opacity === 1
        groundMaterial.opacity = enabled ? 0.18 : 1
        groundMaterial.depthWrite = !enabled
        if (terrain) {
          terrain.material.opacity = enabled ? 0.18 : 1
          terrain.material.depthWrite = !enabled
        }
        setSeeThrough(enabled)
        dirty = true
      }
      else if (action === 'in') zoom(camera.fov / 1.25)
      else if (action === 'out') zoom(camera.fov * 1.25)
      else if (action === 'reset') zoom(70)
      else if (latestSample) {
        const target = latestSample[action]
        yaw.current = -target.azimuth * RAD
        pitch.current = clamp(target.elevation, PITCH_MIN_DEG, PITCH_MAX_DEG) * RAD
        dirty = true
      }
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom(camera.fov * Math.exp(clamp(event.deltaY, -100, 100) * 0.002))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!dirty) return
      dirty = false
      camera.rotation.set(pitch.current, yaw.current, 0)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(draw)

    updateRef.current = (sample, siteId) => {
      latestSample = sample
      const sunRadius = bodyRadius(sample.sun.angularDiameterDeg)
      const earthRadius = bodyRadius(sample.earth.angularDiameterDeg)

      sun.scale.setScalar(sunRadius)
      sunGlow.scale.setScalar(sunRadius * 7)
      sunGroup.position.copy(skyVector(sample.sun.azimuth, sample.sun.elevation, SKY_RADIUS))

      earth.scale.setScalar(earthRadius)
      clouds.scale.setScalar(earthRadius * 1.015)
      earthGlow.scale.setScalar(earthRadius * 2.2)
      earthGroup.position.copy(skyVector(sample.earth.azimuth, sample.earth.elevation, SKY_RADIUS))

      // No atmosphere and no scattering: the ground is lit by the Sun only.
      sunLight.intensity = 0.15 + 1.15 * Math.max(0, Math.sin(sample.sun.elevation * RAD))
      sunLight.position.copy(
        skyVector(sample.sun.azimuth, clamp(sample.sun.elevation, 2, 90), GROUND_RADIUS),
      )
      lightTarget.position.set(0, 0, 0)

      // Point the view at the Earth when it is up, otherwise at the Sun.
      if (aimedFor !== siteId) {
        aimedFor = siteId
        const target = sample.earth.elevation > 0 ? sample.earth : sample.sun
        yaw.current = -target.azimuth * RAD
        pitch.current = clamp(target.elevation, PITCH_MIN_DEG, PITCH_MAX_DEG) * RAD
      }
      dirty = true
    }

    updatePanelRef.current = (next) => {
      if (!next) {
        panelGroup.visible = false
        dirty = true
        return
      }

      const normal = panelNormalSky(next.tiltDeg, next.azimuthDeg)
      panelMarker.position.copy(skyVector(normal.azimuth, normal.elevation, SKY_RADIUS - 2))
      panelMarker.lookAt(0, 0, 0)

      const angles = tiltArcPoints(next.tiltDeg, next.azimuthDeg)
      const positions = new Float32Array(angles.length * 3)
      for (let i = 0; i < angles.length; i++) {
        const point = skyVector(angles[i].azimuth, angles[i].elevation, SKY_RADIUS - 2)
        positions[i * 3] = point.x
        positions[i * 3 + 1] = point.y
        positions[i * 3 + 2] = point.z
      }
      // Replacing the attribute needs a fresh geometry: dispose the old one.
      panelArc.geometry.dispose()
      panelArc.geometry = new THREE.BufferGeometry()
      panelArc.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

      const flat = next.tiltDeg === 0
      panelArc.visible = !flat
      zenithTick.visible = !flat
      panelGroup.visible = true
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

    let dragging = false
    let lastX = 0
    let lastY = 0
    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      try {
        host.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointers (tests, some touch stacks) cannot be captured.
      }
      host.classList.add('dragging')
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      yaw.current -= (event.clientX - lastX) * DRAG_RAD_PER_PX
      pitch.current = clamp(
        pitch.current - (event.clientY - lastY) * DRAG_RAD_PER_PX,
        PITCH_MIN_DEG * RAD,
        PITCH_MAX_DEG * RAD,
      )
      lastX = event.clientX
      lastY = event.clientY
      dirty = true
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
      host.classList.remove('dragging')
    }
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerUp)

    // The scene effect runs once: apply the panel present on first mount.
    updatePanelRef.current(latestPanelRef.current)

    return () => {
      terrainDisposed = true
      abortTerrain.abort()
      terrainMap.dispose()
      controlsRef.current = () => {}
      host.removeEventListener('wheel', onWheel)
      groundTexture.dispose()
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      updateRef.current = () => {}
      updatePanelRef.current = () => {}
      scene.traverse((object) => {
        // Sprite geometries are shared by every Sprite in the module: never dispose them.
        if (!(object as THREE.Sprite).isSprite) (object as THREE.Mesh).geometry?.dispose()
        const material = (object as THREE.Mesh).material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose()
      })
      glowTexture.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
  }, [site.lat, site.lon])

  useEffect(() => {
    const sample = createObserver(site).skyAt(t)
    updateRef.current(sample, site.id)
    setSky(sample)
  }, [site, t])

  useEffect(() => {
    updatePanelRef.current(panel ?? null)
  }, [panel])

  return (
    <div className="sky-view">
      <div className="sky-canvas" ref={hostRef} />
      {sky && (
        <div className="sky-overlay">
          <p className={sky.sunlit ? 'sun-text' : 'bad-text'}>
            Sun: {sky.sunlit ? 'visible' : 'below horizon'} (elev {deg(sky.sun.elevation)})
          </p>
          <p className={sky.earthVisible ? 'earth-text' : 'bad-text'}>
            Earth: {sky.earthVisible ? 'visible' : 'below horizon'} (elev{' '}
            {deg(sky.earth.elevation)})
          </p>
          {panel && (
            <p className="panel-text">
              {panel.tiltDeg === 0
                ? 'Best fixed panel: flat (points at zenith)'
                : `Best fixed panel: tilt ${panel.tiltDeg}° · heading ${panel.azimuthDeg}°${
                    isTerrainCritical(site) ? ' (heading not meaningful at polar sites)' : ''
                  }`}
            </p>
          )}
        </div>
      )}
      <div className="sky-controls" aria-label="Sky camera controls">
        <button onClick={() => controlsRef.current('sun')} title="Look toward the Sun, including when below the horizon">Focus Sun</button>
        <button onClick={() => controlsRef.current('earth')} title="Look toward Earth, including when below the horizon">Focus Earth</button>
        <button aria-pressed={seeThrough} onClick={() => controlsRef.current('terrain')}>{seeThrough ? 'Restore ground' : 'See through ground'}</button>
        <button aria-label="Zoom in" disabled={fov <= 10} onClick={() => controlsRef.current('in')}>+</button>
        <button aria-label="Zoom out" disabled={fov >= 90} onClick={() => controlsRef.current('out')}>−</button>
        <button aria-label="Reset zoom" onClick={() => controlsRef.current('reset')}>{(70 / fov).toFixed(1)}×</button>
      </div>
      {seeThrough && <div className="sky-cutaway" role="status">
        <strong>See-through ground · illustration only</strong>
        <span>{sky?.sunlit ? 'Sunlight available geometrically' : 'Sun below horizon: no direct sunlight'}</span>
        <span>{sky?.earthVisible ? 'Earth above horizon' : 'Earth below horizon: no direct Earth communication'}</span>
      </div>}
      <p className="sky-caption">{terrainStatus} · Terrain is visual only; visibility uses a geometric horizon · Scroll to zoom ·

        Angular sizes exaggerated ×{SIZE_BOOST} (minimum {MIN_SIZE_DEG}°), not to scale
      </p>
    </div>
  )
}
