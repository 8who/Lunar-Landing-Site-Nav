import { describe, expect, it } from 'vitest'
import { findMissionWindow } from './mission'
const H = 3_600_000
const w = (start: number, end: number) => ({ start, end, durationMs: end - start, closed: true })

describe('mission operation windows', () => {
  it('uses the remaining time in an active window', () => {
    expect(findMissionWindow([w(0, 4 * H)], H, 2)?.start).toBe(H)
  })
  it('skips expired and too-short windows', () => {
    expect(findMissionWindow([w(0, H), w(2 * H, 3 * H), w(4 * H, 8 * H)], 2 * H, 2)?.start).toBe(4 * H)
  })
  it('rounds up to a selectable minute before checking duration', () => {
    expect(findMissionWindow([w(1, H + 1)], 0, 1)).toBeUndefined()
    expect(findMissionWindow([w(1, 2 * H)], 0, 1)?.start).toBe(60_000)
  })
  it('accepts an exact fit and preserves a clipped search boundary', () => {
    const result = findMissionWindow([{ ...w(0, H), closed: false }], 0, 1)
    expect(result?.durationMs).toBe(H)
    expect(result?.closed).toBe(false)
  })
  it('returns no result for an empty search or invalid duration', () => {
    expect(findMissionWindow([], 0, 1)).toBeUndefined()
    expect(findMissionWindow([w(0, H)], 0, 0)).toBeUndefined()
  })
})
