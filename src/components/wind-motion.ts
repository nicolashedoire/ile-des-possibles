/** Illustrative angular speed in radians per second; production is total island power. */
export function windRotorSpeed(productionMW: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(productionMW) || productionMW <= 0) return 0
  return Math.min(productionMW, 100) * 0.024
}
