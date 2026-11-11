import RBush from 'rbush'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'

export type Rect = { minX: number; minY: number; maxX: number; maxY: number }
export type AnnotationRequest = { id: string; anchor: Rect; width: number; height: number }
export type AnnotationPlacement = { id: string; x: number; y: number; width: number; height: number }

function rectangle(r: Rect): Polygon {
  return [[[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY], [r.minX, r.minY]]]
}
function area(geometry: MultiPolygon) {
  const ringArea = (ring: [number, number][]) => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]
    return sum + p[0] * q[1] - q[0] * p[1]
  }, 0) / 2)
  return geometry.reduce((total, polygon) => total + ringArea(polygon[0]) - polygon.slice(1).reduce((n, ring) => n + ringArea(ring), 0), 0)
}

/**
 * Search for unobstructed annotation rectangles next to each actual installation.
 * RBush narrows collision candidates; polygon subtraction checks the remaining
 * drawable area. Viewport edges and annotation/installation geometry are obstacles.
 */
export function placeAnnotations(requests: AnnotationRequest[], width: number, height: number, obstacles: Rect[]): AnnotationPlacement[] {
  const index = new RBush<Rect>()
  index.load(obstacles.filter(r => r.maxX > r.minX && r.maxY > r.minY))
  const placed: AnnotationPlacement[] = []
  const margin = 10, topMargin = 39, bottomMargin = 38, gap = 9
  for (const request of requests) {
    const { anchor: a, width: w, height: h } = request
    const centerX = (a.minX + a.maxX) / 2, centerY = (a.minY + a.maxY) / 2
    const candidates: [number, number][] = [
      [a.maxX + gap, centerY - h / 2], [a.minX - gap - w, centerY - h / 2],
      [centerX - w / 2, a.minY - gap - h], [centerX - w / 2, a.maxY + gap],
      [a.maxX + gap, a.minY - gap - h], [a.minX - gap - w, a.minY - gap - h],
      [a.maxX + gap, a.maxY + gap], [a.minX - gap - w, a.maxY + gap],
    ]
    for (const [x, y] of candidates) {
      const candidate: Rect = { minX: x, minY: y, maxX: x + w, maxY: y + h }
      if (x < margin || y < topMargin || x + w > width - margin || y + h > height - bottomMargin) continue
      const nearby = index.search(candidate).filter(o => o.minX < candidate.maxX && o.maxX > candidate.minX && o.minY < candidate.maxY && o.maxY > candidate.minY)
      const free = nearby.length ? polygonClipping.difference(rectangle(candidate), ...nearby.map(rectangle)) : [rectangle(candidate)]
      if (area(free) < w * h - 0.01) continue
      placed.push({ id: request.id, x, y, width: w, height: h })
      index.insert(candidate)
      break
    }
  }
  return placed
}
