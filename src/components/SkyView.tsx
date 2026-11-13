import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createObserver } from '../lib/astro/observer'
import type { LunarSite, SkySample } from '../lib/astro/types'
import { deg } from '../lib/format'

interface Props {
  site: LunarSite
  /** UTC epoch ms */
  t: number
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

const PITCH_MIN_DEG = -10
const PITCH_MAX_DEG = 80
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

export default function SkyView({ site, t }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const updateRef = useRef<(sample: SkySample, siteId: string) => void>(() => {})
  const [sky, setSky] = useState<SkySample | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x010206)

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2_000)
    camera.rotation.order = 'YXZ'

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)

    // Ground: the lower half of a sphere. Everything under y = 0 is inside it,
    // so a Sun or Earth below the horizon is occluded instead of drawn.
    const sphereGeometry = new THREE.SphereGeometry(1, 32, 24)
    const groundGeometry = new THREE.SphereGeometry(
      GROUND_RADIUS,
      64,
      32,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    )
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a7280,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
    })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
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

    // Camera state lives outside React: dragging must not re-render the tree.
    const yaw = { current: 0 }
    const pitch = { current: 0 }
    let aimedFor = ''

    let dirty = true
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

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      updateRef.current = () => {}
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
  }, [])

  useEffect(() => {
    const sample = createObserver(site).skyAt(t)
    updateRef.current(sample, site.id)
    setSky(sample)
  }, [site, t])

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
        </div>
      )}
      <p className="sky-caption">
        Angular sizes exaggerated ×{SIZE_BOOST} (minimum {MIN_SIZE_DEG}°), not to scale
      </p>
    </div>
  )
}
