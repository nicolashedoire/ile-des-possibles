import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateEnergy } from './energy.ts'

const base = { productionMW: 30, consumptionMW: 40, batteryMWh: 10, batteryPowerMW: 20 }

test('10 MWh covers a 10 MW deficit for one hour', () => {
  assert.deepEqual(calculateEnergy(base), {
    deficitMW: 10,
    surplusMW: 0,
    autonomyHours: 1,
    batteryCanCoverDeficit: true,
  })
})

test('a 16 MW deficit gives 37 minutes and 30 seconds of full coverage', () => {
  const result = calculateEnergy({ ...base, consumptionMW: 46 })
  assert.equal(result.deficitMW, 16)
  assert.equal(result.autonomyHours, 0.625)
})

test('surplus and exact balance have no deficit autonomy to calculate', () => {
  assert.deepEqual(calculateEnergy({ ...base, productionMW: 45, batteryPowerMW: 0 }), {
    deficitMW: 0,
    surplusMW: 5,
    autonomyHours: null,
    batteryCanCoverDeficit: true,
  })
  assert.equal(calculateEnergy({ ...base, productionMW: 40 }).autonomyHours, null)
})

test('the battery cannot cover full demand if its power limit is too low', () => {
  const result = calculateEnergy({ ...base, batteryPowerMW: 9 })
  assert.equal(result.batteryCanCoverDeficit, false)
  assert.equal(result.autonomyHours, null)
})

test('a power limit equal to the deficit works; empty storage lasts zero hours', () => {
  const result = calculateEnergy({ ...base, batteryMWh: 0, batteryPowerMW: 10 })
  assert.equal(result.batteryCanCoverDeficit, true)
  assert.equal(result.autonomyHours, 0)
})

test('negative and non-finite inputs are rejected', () => {
  for (const key of Object.keys(base) as (keyof typeof base)[]) {
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      assert.throws(() => calculateEnergy({ ...base, [key]: value }), RangeError)
    }
  }
})
