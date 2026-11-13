import { describe, expect, it } from 'vitest'
import {
  SCRUB_MAX_MIN,
  SCRUB_SPAN_MS,
  minutesOfDayUtc,
  sliderMinutesToTime,
  timeToSliderMinutes,
  utcDay,
  utcDayStart,
  windowPercent,
} from './scrub'

const START = Date.parse('2026-11-13T00:00:00Z')

describe('sliderMinutesToTime / timeToSliderMinutes', () => {
  it('round-trips whole minutes inside the window', () => {
    for (const minutes of [0, 15, 720, 14_400, SCRUB_MAX_MIN]) {
      expect(timeToSliderMinutes(START, sliderMinutesToTime(START, minutes))).toBe(minutes)
    }
  })

  it('clamps at the start and the end', () => {
    expect(sliderMinutesToTime(START, -1)).toBe(START)
    expect(sliderMinutesToTime(START, SCRUB_MAX_MIN + 60)).toBe(START + SCRUB_SPAN_MS)
    expect(timeToSliderMinutes(START, START - 60_000)).toBe(0)
    expect(timeToSliderMinutes(START, START + SCRUB_SPAN_MS + 60_000)).toBe(SCRUB_MAX_MIN)
  })
})

describe('minutesOfDayUtc', () => {
  it('rounds down to five minutes', () => {
    expect(minutesOfDayUtc(Date.parse('2026-11-13T00:00:00Z'))).toBe(0)
    expect(minutesOfDayUtc(Date.parse('2026-11-13T12:07:59Z'))).toBe(725)
    expect(minutesOfDayUtc(Date.parse('2026-11-13T23:59:59Z'))).toBe(1435)
  })

  it('never exceeds 1435 and stays on a five-minute boundary', () => {
    for (let minute = 0; minute < 1440; minute++) {
      const value = minutesOfDayUtc(START + minute * 60_000)
      expect(value).toBeLessThanOrEqual(1435)
      expect(value % 5).toBe(0)
    }
  })
})

describe('utcDay / utcDayStart', () => {
  it('uses UTC calendar days', () => {
    expect(utcDay(Date.parse('2026-11-13T23:59:59Z'))).toBe('2026-11-13')
    expect(utcDay(Date.parse('2026-11-14T00:00:00Z'))).toBe('2026-11-14')
    expect(utcDayStart(Date.parse('2026-11-13T23:59:59Z'))).toBe(START)
  })
})

describe('windowPercent', () => {
  it('maps the window to 0..100 and clamps outside it', () => {
    expect(windowPercent(START, START)).toBe(0)
    expect(windowPercent(START, START + SCRUB_SPAN_MS / 2)).toBe(50)
    expect(windowPercent(START, START + SCRUB_SPAN_MS)).toBe(100)
    expect(windowPercent(START, START - 1)).toBe(0)
    expect(windowPercent(START, START + SCRUB_SPAN_MS + 1)).toBe(100)
  })
})

// Mission jumps must preserve the minute selected by the planner.
it('preserves minute precision through the end of a UTC day', () => {
  expect(minutesOfDayUtc(Date.parse('2026-11-14T23:59:00Z'), 1)).toBe(1439)
  expect(minutesOfDayUtc(Date.parse('2026-11-14T12:03:00Z'), 1)).toBe(723)
})
