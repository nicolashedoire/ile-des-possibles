import assert from 'node:assert/strict'
import test from 'node:test'
import { placeAnnotations, type Rect } from './annotation-layout.ts'

const overlap = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY

test('places labels inside the viewport without crossing sites or each other', () => {
  const obstacles: Rect[] = [
    { minX: 90, minY: 100, maxX: 170, maxY: 170 },
    { minX: 300, minY: 110, maxX: 380, maxY: 180 },
    { minX: 220, minY: 260, maxX: 290, maxY: 320 },
  ]
  const labels = placeAnnotations(obstacles.map((anchor, i) => ({ id: String(i), anchor, width: 110, height: 38 })), 600, 420, obstacles)
  assert.equal(labels.length, 3)
  const bounds = labels.map(label => ({ minX: label.x, minY: label.y, maxX: label.x + label.width, maxY: label.y + label.height }))
  for (const rect of bounds) {
    assert.ok(rect.minX >= 10 && rect.maxX <= 590 && rect.minY >= 39 && rect.maxY <= 382)
    assert.ok(obstacles.every(site => !overlap(rect, site)))
  }
  assert.ok(!overlap(bounds[0], bounds[1]) && !overlap(bounds[0], bounds[2]) && !overlap(bounds[1], bounds[2]))
})

test('omits labels if obstacles leave no safe space', () => {
  const occupied = { minX: 0, minY: 0, maxX: 600, maxY: 420 }
  const result = placeAnnotations([{ id: 'site', anchor: { minX: 200, minY: 120, maxX: 260, maxY: 180 }, width: 110, height: 40 }], 600, 420, [occupied])
  assert.deepEqual(result, [])
})
