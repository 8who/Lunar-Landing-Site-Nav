import { describe, expect, it } from 'vitest'
import { assessMission, assessMissionChunks, DEFAULT_MISSION_REQUIREMENTS, integrateBatteryInterval, type MissionRequirements } from './missionAssessment'
import { createObserver, KM_PER_AU, SOLAR_CONSTANT_WM2 } from './observer'
import { siteSeesStation, stationSkyPoints } from './earthView'
import type { LunarSite } from './types'

const H = 3_600_000
const T = Date.parse('2028-01-01T00:00:00Z')
const site: LunarSite = { id: 'apollo11', name: 'Apollo 11', lat: 0.674, lon: 23.473, category: 'apollo' }
const req = (overrides: Partial<MissionRequirements> = {}): MissionRequirements => ({ ...DEFAULT_MISSION_REQUIREMENTS, ...overrides })
const storage = { capacityWh: 100, chargeEfficiency: 0.8, dischargeEfficiency: 0.5 }

function levelHorizon(elevation: number): LunarSite {
  return { ...site, horizon: {
    stepDeg: 90, elevations: new Float32Array(4).fill(elevation), groundElevationM: 0,
    eyeHeightM: 0, maxElevationDeg: elevation, maxAzimuthDeg: 0, maxDistanceKm: 1,
    source: 'synthetic test skyline', cellKm: 1,
  } }
}

describe('constant-power battery integration', () => {
  it.each([
    { label: 'surplus charging loses 20%', initial: 10, generation: 100, demand: 50, hours: 1, final: 50, shortfall: 0, unmetHours: 0 },
    { label: 'full battery clips surplus', initial: 90, generation: 100, demand: 0, hours: 1, final: 100, shortfall: 0, unmetHours: 0 },
    { label: 'discharge losses debit storage', initial: 100, generation: 20, demand: 40, hours: 1, final: 60, shortfall: 0, unmetHours: 0 },
    { label: 'depletion partway through interval', initial: 30, generation: 0, demand: 30, hours: 1, final: 0, shortfall: 15, unmetHours: 0.5 },
    { label: 'zero capacity leaves load unserved', initial: 0, generation: 10, demand: 30, hours: 1, final: 0, shortfall: 20, unmetHours: 1 },
    { label: 'exact depletion serves all demand', initial: 100, generation: 0, demand: 50, hours: 1, final: 0, shortfall: 0, unmetHours: 0 },
    { label: 'balanced generation bypasses storage losses', initial: 30, generation: 10, demand: 10, hours: 1, final: 30, shortfall: 0, unmetHours: 0 },
    { label: 'partial interval uses actual duration', initial: 10, generation: 0, demand: 20, hours: 0.5, final: 0, shortfall: 5, unmetHours: 0.25 },
  ])('$label', ({ initial, generation, demand, hours, final, shortfall, unmetHours }) => {
    const result = integrateBatteryInterval(initial, generation, demand, hours * H, { ...storage, capacityWh: initial === 0 ? 0 : 100 })
    expect(result.batteryWh).toBeCloseTo(final, 10)
    expect(result.shortfallWh).toBeCloseTo(shortfall, 10)
    expect(result.unmetMs).toBeCloseTo(unmetHours * H, 7)
    expect(result.unmetW).toBeCloseTo(shortfall / hours, 10)
  })

  it('round-trip losses cannot create energy', () => {
    const charged = integrateBatteryInterval(0, 100, 0, H, storage)
    const discharged = integrateBatteryInterval(charged.batteryWh, 0, 100, H, storage)
    expect(charged.batteryWh).toBe(80)
    expect(discharged.batteryWh).toBe(0)
    expect(discharged.shortfallWh).toBe(60)
  })

  it.each([
    [-1, 0, 0, H, storage], [101, 0, 0, H, storage], [0, -1, 0, H, storage],
    [0, 0, NaN, H, storage], [0, 0, 0, 0, storage],
    [0, 0, 0, H, { ...storage, chargeEfficiency: 0 }],
    [0, 0, 0, H, { ...storage, dischargeEfficiency: 1.1 }],
  ] as const)('rejects invalid helper input %#', (battery, generated, demand, duration, config) => {
    expect(() => integrateBatteryInterval(battery, generated, demand, duration, config)).toThrow(RangeError)
  })
})

describe('mission assessment', () => {
  it('uses midpoint geometry, integrates the final partial step and includes initial charge in the minimum', () => {
    const requirements = req({ arrayAreaM2: 0, demandW: 10, capacityWh: 10, initialChargePct: 100, dischargeEfficiency: 0.5, maxBlackoutHours: 3 })
    const result = assessMission(site, T, T + 2.5 * H, H, requirements)
    expect(result.samples.map(s => s.t)).toEqual([T + H / 2, T + 1.5 * H, T + 2.25 * H])
    expect(result.samples.map(s => s.batteryWh)).toEqual([0, 0, 0])
    expect(result.samples.map(s => s.unmetW)).toEqual([5, 10, 10])
    expect(result.shortfallWh).toBe(20)
    expect(result.unmetDurationMs).toBe(2 * H)
    expect(result.generationBelowDemandMs).toBe(2.5 * H)
    expect(result.minBatteryWh).toBe(0)
    expect(result.passes).toBe(false)
    expect(result.reasons).toHaveLength(1)
    expect(result.site).toBe(site)
    expect(result.requirements).toEqual(requirements)
    expect([result.t0, result.t1, result.stepMs]).toEqual([T, T + 2.5 * H, H])
    expect(result.assumptions.some(a => a.includes('midpoint'))).toBe(true)
  })

  it('has physically dark solar flux at Apollo 11 on the Horizons reference night', () => {
    const result = assessMission(site, T, T + H, H, req({ demandW: 0 }))
    expect(result.samples[0].solarFluxWm2).toBe(0)
    expect(result.samples[0].generatedW).toBe(0)
    expect(result.earthPct).toBe(100)
    expect(result.longestEarthBlackoutMs).toBe(0)
    expect(result.passes).toBe(true)
  })

  it('uses solar distance, panel incidence and partial disc share from the same terrain skyline', () => {
    const midpoint = Date.parse('1969-07-20T20:17:00Z')
    const sky = createObserver(site).skyAt(midpoint)
    const terrainSite = levelHorizon(sky.sun.elevation)
    const terrainSky = createObserver(terrainSite).skyAt(midpoint)
    const requirements = req({ demandW: 0, arrayAreaM2: 3, efficiency: 0.25 })
    const evaluate = (orientation: MissionRequirements['orientation'], tiltDeg = 0, azimuthDeg = 0) =>
      assessMission(terrainSite, midpoint - 500, midpoint + 500, H, { ...requirements, orientation, tiltDeg, azimuthDeg }).samples[0]
    const tracking = evaluate('tracking')
    const flat = evaluate('horizontal', 90, 180)
    const facing = evaluate('fixed', 90 - sky.sun.elevation, sky.sun.azimuth)
    const away = evaluate('fixed', 90, (sky.sun.azimuth + 180) % 360)
    expect(terrainSky.sun.visibleFraction).toBeCloseTo(0.5, 4)
    const expectedFlux = SOLAR_CONSTANT_WM2 * (KM_PER_AU / sky.sun.distanceKm) ** 2 * terrainSky.sun.visibleFraction!
    expect(tracking.solarFluxWm2).toBeCloseTo(expectedFlux, 7)
    expect(tracking.generatedW).toBeCloseTo(expectedFlux * 0.75, 7)
    expect(flat.solarFluxWm2 / tracking.solarFluxWm2).toBeCloseTo(Math.sin(sky.sun.elevation * Math.PI / 180), 10)
    expect(facing.solarFluxWm2).toBeCloseTo(tracking.solarFluxWm2, 8)
    expect(away.generatedW).toBe(0)
  })

  it('keeps the initial minimum when the battery only charges', () => {
    const t = Date.parse('1969-07-20T20:17:00Z')
    const result = assessMission(site, t, t + H, H, req({ demandW: 0, initialChargePct: 0 }))
    expect(result.samples[0].batteryWh).toBeGreaterThan(0)
    expect(result.minBatteryWh).toBe(0)
    expect(result.shortfallWh).toBe(0)
    expect(result.passes).toBe(true)
  })

  it('screens each station geometrically and honors masks on both sides of the fixed DSN default', () => {
    const observer = createObserver(site)
    const requirements = req({ demandW: 0, stationMaskDeg: 0 })
    const zero = assessMission(site, T, T + 24.5 * H, H, requirements)
    let usableBelowTen = false
    for (const sample of zero.samples) {
      const points = stationSkyPoints(site, sample.t, observer.skyAt(sample.t).earth)
      const visible = [...points].filter(([, p]) => siteSeesStation(p, observer.skyline.at))
      expect(sample.stations).toEqual(visible.map(([id]) => id))
      if (visible.some(([, p]) => p.siteElevationAtStation < 10)) usableBelowTen = true
    }
    expect(usableBelowTen).toBe(true)
    const high = assessMission(site, T, T + 24.5 * H, H, { ...requirements, stationMaskDeg: 80 })
    expect(high.samples.some(s => s.stations.length < zero.samples.find(z => z.t === s.t)!.stations.length)).toBe(true)
    for (const sample of high.samples) {
      const points = stationSkyPoints(site, sample.t, observer.skyAt(sample.t).earth)
      expect(sample.stations).toEqual([...points].filter(([, p]) => siteSeesStation(p, observer.skyline.at) && p.siteElevationAtStation >= 80).map(([id]) => id))
    }
  })

  it('weights availability by duration and counts leading, interior and trailing blackout runs', () => {
    const requirements = req({ demandW: 0, stationMaskDeg: 60, maxBlackoutHours: 48 })
    const result = assessMission(site, T, T + 48.25 * H, H, requirements)
    let visible = 0
    let current = 0
    let longest = 0
    result.samples.forEach((s, i) => {
      const dt = i === result.samples.length - 1 ? H / 4 : H
      if (s.dsnAccess) visible += dt
      current = s.dsnAccess ? 0 : current + dt
      longest = Math.max(longest, current)
    })
    expect(visible).toBeGreaterThan(0)
    expect(longest).toBeGreaterThan(0)
    expect(result.dsnPct).toBeCloseTo(100 * visible / (48.25 * H), 10)
    expect(result.longestDsnBlackoutMs).toBe(longest)
    expect(result.earthPct).toBe(100)
  })

  it('terrain can fully hide Sun, Earth and DSN; blackout tolerance accepts exact equality', () => {
    const hidden = levelHorizon(90)
    const requirements = req({ demandW: 0, maxBlackoutHours: 2.5 })
    const result = assessMission(hidden, T, T + 2.5 * H, H, requirements)
    expect(result.samples.every(s => s.generatedW === 0 && !s.earthVisible && !s.dsnAccess && s.stations.length === 0)).toBe(true)
    expect(result.earthPct).toBe(0)
    expect(result.dsnPct).toBe(0)
    expect(result.longestEarthBlackoutMs).toBe(2.5 * H)
    expect(result.longestDsnBlackoutMs).toBe(2.5 * H)
    expect(result.passes).toBe(true)
    const failed = assessMission(hidden, T, T + 2.5 * H, H, { ...requirements, maxBlackoutHours: 2 })
    expect(failed.passes).toBe(false)
    expect(failed.reasons).toHaveLength(1)
    expect(failed.reasons[0]).toContain('DSN')
  })

  it('does not mutate inputs or defaults and returns deterministic results', () => {
    const requirements = Object.freeze(req({ demandW: 0 }))
    const frozenSite = Object.freeze({ ...site })
    const result = assessMission(frozenSite, T, T + H, H, requirements)
    expect(result).toEqual(assessMission(frozenSite, T, T + H, H, requirements))
    expect(result.requirements).not.toBe(requirements)
    expect(Object.isFrozen(DEFAULT_MISSION_REQUIREMENTS)).toBe(true)
  })

  it('yields every 72 samples and returns the identical synchronous assessment', () => {
    const requirements = req({ demandW: 0 })
    const chunks = assessMissionChunks(site, T, T + 145.5 * H, H, requirements)
    expect(chunks.next()).toEqual({ done: false, value: 72 })
    expect(chunks.next()).toEqual({ done: false, value: 144 })
    const final = chunks.next()
    expect(final.done).toBe(true)
    expect(final.value).toEqual(assessMission(site, T, T + 145.5 * H, H, requirements))
    const short = assessMissionChunks(site, T, T + H / 2, H, requirements).next()
    expect(short.done).toBe(true)
  })
})

describe('mission input validation', () => {
  it.each([
    { demandW: -1 }, { arrayAreaM2: -1 }, { efficiency: 1.01 }, { efficiency: NaN },
    { capacityWh: -1 }, { initialChargePct: 101 }, { initialChargePct: -1 },
    { chargeEfficiency: 0 }, { dischargeEfficiency: Infinity }, { maxBlackoutHours: -1 },
    { stationMaskDeg: 91 }, { stationMaskDeg: -1 }, { tiltDeg: 91 }, { azimuthDeg: 361 },
    { orientation: 'other' as MissionRequirements['orientation'] },
  ])('rejects invalid requirements %j', invalid => {
    expect(() => assessMission(site, T, T + H, H, req(invalid))).toThrow(RangeError)
  })

  it.each([[NaN, T + H, H], [T, Infinity, H], [T, T, H], [T, T - 1, H], [T, T + H, 0], [T, T + H, -1], [T, T + H, Infinity], [T, T + H, Number.MIN_VALUE]])('rejects invalid range %#', (start, end, step) => {
    expect(() => assessMission(site, start, end, step, req())).toThrow(RangeError)
  })

  it.each([{ lat: 91 }, { lon: NaN }, { elevationM: -2_000_000 }, { mastHeightM: -1 }])('rejects invalid site %j', invalid => {
    expect(() => assessMission({ ...site, ...invalid }, T, T + H, H, req())).toThrow(RangeError)
  })

  it('rejects malformed terrain before sampling', () => {
    const invalid = levelHorizon(0)
    invalid.horizon!.elevations[0] = NaN
    expect(() => assessMission(invalid, T, T + H, H, req())).toThrow(RangeError)
    invalid.horizon!.elevations = new Float32Array()
    expect(() => assessMission(invalid, T, T + H, H, req())).toThrow(RangeError)
  })
})
