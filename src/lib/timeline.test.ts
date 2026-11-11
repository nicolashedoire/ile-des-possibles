import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateDay, type BatteryConfig, type HourInput } from './timeline.ts'

const defaultBattery: BatteryConfig = { capacityMWh: 20, initialMWh: 10, maxChargeMW: 20, maxDischargeMW: 20, chargeEfficiency: 1, dischargeEfficiency: 1 }
const row = (hour: string, productionMW: number, consumptionMW: number): HourInput => ({ hour, productionMW, consumptionMW })
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

test('battery bridges a deficit until it runs out, then unmet demand begins', () => {
  const { steps, summary } = simulateDay([row('00:00', 30, 40), row('01:00', 30, 40)], defaultBattery)
  assert.equal(steps[0].batteryStartMWh, 10)
  assert.equal(steps[0].batteryEndMWh, 0)
  assert.equal(steps[0].unservedMW, 0)
  assert.equal(steps[1].unservedMW, 10)
  assert.equal(steps[1].shortageStartsAfterMinutes, 0)
  assert.equal(summary.totalUnservedMWh, 10)
  assert.equal(summary.hoursWithShortage, 1)
  assert.equal(summary.finalBatteryMWh, 0)
})

test('36 MW deficit with 20 MW discharge limit leaves at least 16 MW unmet immediately', () => {
  const { steps } = simulateDay([row('18:00', 23, 59)], { ...defaultBattery, capacityMWh: 40, initialMWh: 40 })
  assert.equal(steps[0].dischargeMW, 20)
  assert.equal(steps[0].unservedMW, 16)
  assert.equal(steps[0].shortageStartsAfterMinutes, 0)
  assert.equal(steps[0].batteryEndMWh, 20)
})

test('reports an outage beginning partway through the hour when energy is exhausted', () => {
  const { steps } = simulateDay([row('00:00', 30, 50)], { ...defaultBattery, maxDischargeMW: 20 })
  assert.equal(steps[0].dischargeMW, 10)
  assert.equal(steps[0].unservedMW, 10)
  assert.equal(steps[0].shortageStartsAfterMinutes, 30)
})

test('surplus charging is limited by power and remaining capacity, with explicit loss and curtailment', () => {
  const cfg = { ...defaultBattery, initialMWh: 18, maxChargeMW: 5, chargeEfficiency: 0.8 }
  const { steps } = simulateDay([row('00:00', 40, 30)], cfg)
  near(steps[0].chargeMW, 2.5)
  near(steps[0].batteryEndMWh, 20)
  near(steps[0].curtailedMW, 7.5)
  near(steps[0].lossesMWh, 0.5)
})

test('charging and discharging losses preserve the whole-day energy balance', () => {
  const cfg = { ...defaultBattery, initialMWh: 2, capacityMWh: 10, chargeEfficiency: 0.8, dischargeEfficiency: 0.9 }
  const { steps, summary } = simulateDay([row('00:00', 10, 0), row('01:00', 0, 20)], cfg)
  near(steps[0].chargeMW, 10)
  near(steps[0].batteryEndMWh, 10)
  near(steps[0].lossesMWh, 2)
  near(steps[1].dischargeMW, 9)
  near(steps[1].batteryEndMWh, 0)
  near(steps[1].lossesMWh, 1)
  near(summary.totalLossesMWh, 3)
  // Generation + initial storage = served demand + unused generation + losses + final storage.
  near(summary.totalProductionMWh + cfg.initialMWh, summary.totalConsumptionMWh - summary.totalUnservedMWh + summary.totalCurtailedMWh + summary.totalLossesMWh + summary.finalBatteryMWh)
})

test('zero battery still reports unmet demand and unused surplus', () => {
  const cfg = { ...defaultBattery, capacityMWh: 0, initialMWh: 0, maxChargeMW: 0, maxDischargeMW: 0 }
  const { steps } = simulateDay([row('00:00', 20, 10), row('01:00', 10, 20)], cfg)
  assert.equal(steps[0].curtailedMW, 10)
  assert.equal(steps[1].unservedMW, 10)
  assert.equal(steps[1].shortageStartsAfterMinutes, 0)
})

test('validates interval sequence, units, storage and efficiencies explicitly', () => {
  assert.throws(() => simulateDay([], defaultBattery), RangeError)
  assert.throws(() => simulateDay([row('00:30', 1, 1)], defaultBattery), /HH:00/)
  assert.throws(() => simulateDay([row('00:00', 1, 1), row('02:00', 1, 1)], defaultBattery), /consécutives/)
  assert.throws(() => simulateDay([row('00:00', -1, 1)], defaultBattery), /production/)
  assert.throws(() => simulateDay([row('00:00', 1, NaN)], defaultBattery), /consommation/)
  assert.throws(() => simulateDay([row('00:00', 1, 1)], { ...defaultBattery, initialMWh: 21 }), /capacité/)
  assert.throws(() => simulateDay([row('00:00', 1, 1)], { ...defaultBattery, chargeEfficiency: 0 }), /rendement/)
  assert.throws(() => simulateDay([row('00:00', 1, 1)], { ...defaultBattery, dischargeEfficiency: 1.1 }), /rendement/)
})

test('an exact boundary with fractional efficiency is not reported as a shortage from floating-point noise', () => {
  const demand = 63.8, dischargeEfficiency = 0.7, energyRequired = demand / dischargeEfficiency
  const { steps, summary } = simulateDay([row('00:00', 0, demand)], { ...defaultBattery, capacityMWh: 100, initialMWh: energyRequired, maxDischargeMW: 100, dischargeEfficiency })
  assert.equal(steps[0].unservedMW, 0)
  assert.equal(steps[0].shortageStartsAfterMinutes, null)
  assert.equal(summary.hoursWithShortage, 0)
  near(steps[0].batteryEndMWh, 0)
})

test('when power and energy are both insufficient, unmet power is the hourly average, not just the power gap', () => {
  const { steps } = simulateDay([row('18:00', 23, 59)], { ...defaultBattery, capacityMWh: 20, initialMWh: 5, maxDischargeMW: 20 })
  // At most 5 MWh can be delivered during the hour, although initial instantaneous power can reach 20 MW.
  assert.equal(steps[0].dischargeMW, 5)
  assert.equal(steps[0].unservedMW, 31)
  assert.equal(steps[0].shortageStartsAfterMinutes, 0)
  near(steps[0].productionMW + steps[0].dischargeMW + steps[0].unservedMW, steps[0].consumptionMW + steps[0].chargeMW + steps[0].curtailedMW)
})

test('hourly and daily energy balances hold across a diverse 24-hour series', () => {
  const rows = Array.from({ length: 24 }, (_, i) => row(`${String(i).padStart(2, '0')}:00`, 12 + (i * 17 % 49), 15 + (i * 31 % 45)))
  const cfg: BatteryConfig = { capacityMWh: 64, initialMWh: 17, maxChargeMW: 13, maxDischargeMW: 11, chargeEfficiency: 0.87, dischargeEfficiency: 0.91 }
  const { steps, summary } = simulateDay(rows, cfg)
  for (const s of steps) {
    assert.ok(s.batteryStartMWh >= 0 && s.batteryEndMWh >= 0 && s.batteryEndMWh <= cfg.capacityMWh)
    assert.ok(s.chargeMW <= cfg.maxChargeMW && s.dischargeMW <= cfg.maxDischargeMW)
    assert.ok(s.chargeMW === 0 || s.dischargeMW === 0)
    near(s.productionMW + s.dischargeMW + s.unservedMW, s.consumptionMW + s.chargeMW + s.curtailedMW)
    near(s.batteryStartMWh + s.chargeMW, s.batteryEndMWh + s.dischargeMW + s.lossesMWh)
  }
  near(summary.totalProductionMWh + cfg.initialMWh + summary.totalUnservedMWh, summary.totalConsumptionMWh + summary.totalCurtailedMWh + summary.totalLossesMWh + summary.finalBatteryMWh)
})
