import test from 'node:test'
import assert from 'node:assert/strict'
import { init, killThreads } from 'z3-solver'
import { simulateDay } from './timeline.ts'
import { verifyDayWithZ3Api } from './day-verifier.ts'

const battery = { capacityMWh: 40, initialMWh: 10, maxChargeMW: 20, maxDischargeMW: 20, chargeEfficiency: 0.9, dischargeEfficiency: 0.85 }
const rows = Array.from({length: 24}, (_, i) => ({ hour: `${String(i).padStart(2, '0')}:00`, productionMW: 15 + (i * 13 % 40), consumptionMW: 20 + (i * 29 % 45) }))

test('Z3 independently validates the complete hourly day and rejects tampering', { timeout: 15000 }, async () => {
  const api = await init()
  try {
    const original = simulateDay(rows, battery)
    assert.equal(await verifyDayWithZ3Api(api, original, battery), true, 'valid 24-hour simulation')
    const brokenStart = structuredClone(original)
    brokenStart.steps[1].batteryStartMWh += 1
    assert.equal(await verifyDayWithZ3Api(api, brokenStart, battery), false, 'battery continuity')
    const brokenBalance = structuredClone(original)
    brokenBalance.steps[4].unservedMW += 1
    assert.equal(await verifyDayWithZ3Api(api, brokenBalance, battery), false, 'grid power balance')
    const brokenLosses = structuredClone(original)
    brokenLosses.steps[5].lossesMWh += 1
    assert.equal(await verifyDayWithZ3Api(api, brokenLosses, battery), false, 'charging and discharging losses')
    const brokenTotals = structuredClone(original)
    brokenTotals.summary.totalUnservedMWh += 1
    assert.equal(await verifyDayWithZ3Api(api, brokenTotals, battery), false, 'day summary')
    const brokenTime = structuredClone(original)
    brokenTime.steps[1].hour = '04:00'
    assert.equal(await verifyDayWithZ3Api(api, brokenTime, battery), false, 'chronology')
    const emptyBattery = { ...battery, initialMWh: 0, chargeEfficiency: 1, dischargeEfficiency: 1 }
    const inefficientDispatch = simulateDay([{hour:'00:00',productionMW:20,consumptionMW:10}], emptyBattery)
    // Although grid and storage balances still hold, wasting energy while room
    // and charging power are available violates the engine's dispatch policy.
    inefficientDispatch.steps[0].chargeMW = 5
    inefficientDispatch.steps[0].curtailedMW = 5
    inefficientDispatch.steps[0].batteryEndMWh = 5
    inefficientDispatch.summary.totalCurtailedMWh = 5
    inefficientDispatch.summary.finalBatteryMWh = 5
    assert.equal(await verifyDayWithZ3Api(api, inefficientDispatch, emptyBattery), false, 'greedy charging policy')
  } finally {
    await killThreads(api.em)
  }
})
