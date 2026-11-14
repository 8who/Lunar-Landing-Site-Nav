/** NASA SVS LOLA ldem_4: 1440×720, float32 kilometres above 1737.4 km. */
export function elevationAt(grid: Float32Array, lat: number, lon: number): number {
  const x = ((lon + 180) / 360 * 1440 - 0.5 + 1440) % 1440
  const y = Math.max(0, Math.min(719, (90 - lat) / 180 * 720 - 0.5))
  const x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0
  const at = (xx: number, yy: number) => grid[Math.min(719, yy) * 1440 + xx % 1440]
  return (at(x0,y0)*(1-dx)+at(x0+1,y0)*dx)*(1-dy)+(at(x0,y0+1)*(1-dx)+at(x0+1,y0+1)*dx)*dy
}
