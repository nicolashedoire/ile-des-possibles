import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planScenarios } from './scenario-planner.ts'

const base = { productionMW: 30, consumptionMW: 46, batteryMWh: 10, batteryPowerMW: 20 }

test('finds three distinct interventions that sustain the example for one hour', () => {
  const plans = planScenarios(base)
  assert.deepEqual(plans.map(p => p.kind), ['production', 'consumption', 'storage'])
  assert.equal(plans[0].inputs.productionMW, 36)
  assert.equal(plans[1].inputs.consumptionMW, 40)
  assert.equal(plans[2].inputs.batteryMWh, 16)
  for (const p of plans) assert.ok(p.result.autonomyHours! >= 1)
})

test('never proposes storage alone if the discharge power cannot cover the deficit', () => {
  const plans = planScenarios({ ...base, batteryPowerMW: 5 })
  assert.ok(!plans.some(p => p.kind === 'storage'))
  assert.ok(plans.some(p => p.kind === 'battery'))
  for (const p of plans) assert.ok(p.result.deficitMW === 0 || (p.result.batteryCanCoverDeficit && p.result.autonomyHours! >= 1))
})

test('reports no change when already feasible and rejects invalid target duration', () => {
  assert.deepEqual(planScenarios({ ...base, consumptionMW: 40 }), [])
  assert.throws(() => planScenarios(base, 0), RangeError)
})

test('respects available ranges and arbitrary longer targets', () => {
  for (const plan of planScenarios(base, 2)) {
    assert.ok(Object.values(plan.inputs).every(n => n >= 0 && n <= 100))
    assert.ok(plan.result.deficitMW === 0 || plan.result.autonomyHours! >= 2)
  }
})
