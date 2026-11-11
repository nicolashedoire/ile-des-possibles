import test from 'node:test'
import assert from 'node:assert/strict'
import { windRotorSpeed } from './wind-motion.ts'

test('illustrative rotor speed responds to production and stops at zero', () => {
  assert.equal(windRotorSpeed(0, false), 0)
  assert.equal(windRotorSpeed(-1, false), 0)
  assert.equal(windRotorSpeed(NaN, false), 0)
  assert.equal(windRotorSpeed(40, false), 2 * windRotorSpeed(20, false))
  assert.equal(windRotorSpeed(150, false), windRotorSpeed(100, false))
})

test('reduced motion stops the rotor at every production level', () => {
  assert.equal(windRotorSpeed(80, true), 0)
})
