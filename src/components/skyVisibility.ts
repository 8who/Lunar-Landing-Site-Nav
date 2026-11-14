import * as THREE from 'three'
import { horizonDipDeg } from '../lib/astro/observer'
import type { LunarSite } from '../lib/astro/types'

/** The very same bins/interpolation as observer.horizonElevation/horizonAt.
 * No visual DEM, exaggeration or foreground geometry decides occultation.
 */
export function skylineValues(site: LunarSite): Float32Array {
  return site.horizon
    ? new Float32Array(site.horizon.elevations)
    : new Float32Array([-horizonDipDeg(site.mastHeightM ?? 0, 1737.4 + (site.elevationM ?? 0) / 1000)])
}

export function apparentBodyRadius(diameterDeg: number, distance: number): number {
  // A sphere's tangent rays subtend asin(radius/distance).
  return Math.sin(diameterDeg * Math.PI / 360) * distance
}

export function createSkylineMask(site: LunarSite) {
  const makeTexture = (values: Float32Array) => {
    const texture = new THREE.DataTexture(values, values.length, 1, THREE.RedFormat, THREE.FloatType)
    texture.minFilter = texture.magFilter = THREE.NearestFilter
    texture.wrapS = THREE.RepeatWrapping
    texture.needsUpdate = true
    return texture
  }
  let texture = makeTexture(skylineValues(site))
  const uniforms = {
    uSkyline: { value: texture },
    uSkylineBins: { value: texture.image.width },
    uSkyCutaway: { value: 0 },
  }
  let profile = site.horizon
  let mast = site.mastHeightM
  return {
    uniforms,
    update(next: LunarSite) {
      if (next.horizon === profile && next.mastHeightM === mast) return
      profile = next.horizon
      mast = next.mastHeightM
      const values = skylineValues(next)
      // WebGL immutable storage cannot resize the initial 1-bin fallback to
      // a 120-bin profile. Allocate a new texture when dimensions change.
      if (texture.image.width !== values.length) {
        texture.dispose()
        texture = makeTexture(values)
        uniforms.uSkyline.value = texture
      } else {
        texture.image.data = values
        texture.needsUpdate = true
      }
      uniforms.uSkylineBins.value = values.length
    },
    dispose() { texture.dispose() },
  }
}

const declarations = `
  uniform sampler2D uSkyline;
  uniform float uSkylineBins;
  uniform float uSkyCutaway;
  varying vec3 vSkyRay;
  float skylineAtRay() {
    vec3 ray = normalize(vSkyRay);
    float az = mod(atan(ray.x, -ray.z) + 6.28318530718, 6.28318530718);
    float index = az / 6.28318530718 * uSkylineBins;
    float a = texture2D(uSkyline, vec2((floor(index) + 0.5) / uSkylineBins, 0.5)).r;
    float b = texture2D(uSkyline, vec2((mod(floor(index) + 1.0, uSkylineBins) + 0.5) / uSkylineBins, 0.5)).r;
    return mix(a, b, fract(index));
  }
`

/** Apply to the backdrop/terrain and to both celestial materials. Ground keeps
 * only rays below the calculated skyline; bodies keep the complementary rays.
 * This also removes illustrative foreground peaks from the scientific skyline.
 */
export function applySkylineMask(material: THREE.Material, mask: ReturnType<typeof createSkylineMask>, ground = false) {
  const fragmentTest = ground
    ? 'if (degrees(asin(clamp(normalize(vSkyRay).y, -1.0, 1.0))) > skylineAtRay()) discard;'
    : 'if (uSkyCutaway < 0.5 && degrees(asin(clamp(normalize(vSkyRay).y, -1.0, 1.0))) <= skylineAtRay()) discard;'
  const augment = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) => {
    Object.assign(shader.uniforms, mask.uniforms)
    shader.vertexShader = 'varying vec3 vSkyRay;\n' + shader.vertexShader.replace('void main() {', 'void main() {\n vSkyRay = (modelMatrix * vec4(position, 1.0)).xyz;')
    shader.fragmentShader = declarations + shader.fragmentShader.replace('void main() {', `void main() {\n ${fragmentTest}`)
  }
  if (material instanceof THREE.ShaderMaterial) augment(material)
  else material.onBeforeCompile = augment
  material.customProgramCacheKey = () => `scientific-skyline-${ground ? 'ground' : 'body'}`
}
