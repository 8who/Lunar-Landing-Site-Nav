import { describe, it, expect } from 'vitest'
import { findWindows } from './timeline'

describe('window search range boundary', () => {
  it('detects a rise in the final partial step', () => {
    const windows = findWindows(t => t > 9500, 0, 10000, 3000)
    expect(windows).toHaveLength(1)
    expect(windows[0].start).toBeGreaterThanOrEqual(9000)
    expect(windows[0].end).toBe(10000)
    expect(windows[0].closed).toBe(false)
  })
  it('closes a window in the final partial step', () => {
    const windows = findWindows(t => t < 9500, 0, 10000, 3000)
    expect(windows).toHaveLength(1)
    expect(windows[0].closed).toBe(true)
    expect(windows[0].end).toBeLessThan(10000)
  })
})
