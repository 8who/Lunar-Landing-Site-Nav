import { expect, it } from 'vitest'
import { elevationAt } from './terrain'
it('interpolates cell centres and wraps longitude', () => {
  const grid = new Float32Array(1440*720)
  grid[360*1440+720] = 4
  expect(elevationAt(grid,-0.125,0.125)).toBe(4)
  expect(elevationAt(grid,-0.125,360.125)).toBe(4)
  expect(elevationAt(grid,-0.125,0.25)).toBe(2)
})
it('clamps polar sampling to valid rows', () => {
  const grid = new Float32Array(1440*720).fill(1.25)
  expect(elevationAt(grid,90,0)).toBe(1.25)
  expect(elevationAt(grid,-90,180)).toBe(1.25)
})
