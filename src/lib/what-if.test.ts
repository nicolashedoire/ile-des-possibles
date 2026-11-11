import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { previewWhatIf } from './what-if.ts'
import type { BatteryConfig, HourInput } from './timeline.ts'

const battery: BatteryConfig = { capacityMWh: 120, initialMWh: 100, maxChargeMW: 20, maxDischargeMW: 20, chargeEfficiency: .95, dischargeEfficiency: .95 }
const exampleRows: HourInput[] = readFileSync(new URL('../../public/energy-example.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map(line => {
  const [hour, production, consumption] = line.split(',')
  return { hour, productionMW: Number(production), consumptionMW: Number(consumption) }
})
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`)

test('08:00 production 26→37 avoids that shortage but the shortage returns at 09:00', () => {
  const result = previewWhatIf(exampleRows, battery, 8, { productionMW: 37 })
  near(result.baseline.steps[8].unservedMW, 11)
  near(result.preview.steps[8].unservedMW, 0)
  near(result.comparison.totalUnservedMWhDelta, -11)
  assert.equal(result.comparison.firstShortageBaseline?.hour, '08:00')
  assert.equal(result.comparison.firstShortagePreview?.hour, '09:00')
  near(result.comparison.firstShortageBaseline!.minutesIntoHour, 27)
  near(result.comparison.firstShortageShiftMinutes!, 33)
  near(result.preview.steps[9].shortageStartsAfterMinutes!, 0)
  assert.equal(result.comparison.perHour[8].productionMWDelta, 11)
  near(result.comparison.perHour[8].unservedMWhDelta, -11)
})

test('a change never mutates the source array or objects and keeps unedited data identical', () => {
  const before = structuredClone(exampleRows)
  const result = previewWhatIf(exampleRows, battery, 8, { productionMW: 37 })
  assert.deepEqual(exampleRows, before)
  assert.notEqual(result.rows, exampleRows)
  assert.notEqual(result.rows[0], exampleRows[0])
  assert.deepEqual(result.rows.slice(0, 8), before.slice(0, 8))
  assert.deepEqual(result.rows.slice(9), before.slice(9))
  result.rows[0].productionMW = 999
  assert.deepEqual(exampleRows, before)
})

test('an early surplus charges storage and changes later deficits', () => {
  const small: BatteryConfig = { capacityMWh: 10, initialMWh: 0, maxChargeMW: 10, maxDischargeMW: 10, chargeEfficiency: 1, dischargeEfficiency: 1 }
  const rows: HourInput[] = [{hour:'00:00', productionMW:2, consumptionMW:2}, {hour:'01:00', productionMW:0, consumptionMW:8}]
  const result = previewWhatIf(rows, small, 0, { productionMW:12 })
  assert.equal(result.baseline.steps[1].unservedMW, 8)
  assert.equal(result.preview.steps[0].batteryEndMWh, 10)
  assert.equal(result.preview.steps[1].unservedMW, 0)
  assert.equal(result.preview.steps[1].batteryEndMWh, 2)
  assert.equal(result.comparison.totalUnservedMWhDelta, -8)
  assert.equal(result.comparison.shortageSlotsDelta, -1)
  assert.equal(result.comparison.firstShortageBaseline?.hour, '01:00')
  assert.equal(result.comparison.firstShortagePreview, null)
  assert.equal(result.comparison.firstShortageShiftMinutes, null)
  assert.equal(result.comparison.perHour[1].batteryEndMWhDelta, 2)
})

test('consumption increases show negative consequences and can create the first shortage', () => {
  const full: BatteryConfig = { capacityMWh: 5, initialMWh: 5, maxChargeMW: 5, maxDischargeMW: 5, chargeEfficiency: 1, dischargeEfficiency: 1 }
  const rows: HourInput[] = [{hour:'00:00', productionMW:5, consumptionMW:5}, {hour:'01:00', productionMW:5, consumptionMW:5}]
  const result = previewWhatIf(rows, full, 0, { consumptionMW:15 })
  assert.equal(result.comparison.totalUnservedMWhDelta, 5)
  assert.equal(result.comparison.shortageSlotsDelta, 1)
  assert.equal(result.comparison.finalBatteryMWhDelta, -5)
  assert.equal(result.comparison.firstShortageBaseline, null)
  assert.deepEqual(result.comparison.firstShortagePreview, { index: 0, hour: '00:00', minutesIntoHour: 0 })
})

test('rejects invalid hours, powers and changes and validates the shared battery model', () => {
  assert.throws(() => previewWhatIf(exampleRows, battery, -1, { productionMW: 0 }), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, battery, 24, { productionMW: 0 }), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, battery, 0.5, { productionMW: 0 }), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, battery, 1, { productionMW: -1 }), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, battery, 1, { consumptionMW: Infinity }), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, battery, 1, { consumptionMW: NaN }), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, { ...battery, initialMWh: 121 }, 1, {}), RangeError)
  assert.throws(() => previewWhatIf(exampleRows, battery, 1, { extra: 1 } as never), TypeError)
})
