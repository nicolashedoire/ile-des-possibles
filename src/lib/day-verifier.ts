import type { Arith } from 'z3-solver'
import { loadZ3, type Z3Api } from './scenario-planner.ts'
import type { BatteryConfig, DaySimulation } from './timeline.ts'

/**
 * Verifies a day using the same browser Z3 runtime as the scenario explorer.
 * Call `prepareZ3` first; it may require an explicit user-approved reload.
 * This checks a computed day against the model, not real-world accuracy or an
 * optimised strategy. False means at least one constraint is not satisfied.
 */
export async function verifyDayWithZ3(day: DaySimulation, battery: BatteryConfig): Promise<boolean> {
  return verifyDayWithZ3Api(await loadZ3(), day, battery)
}

/** Dependency-injection entry point used to test exactly the same Z3 constraints in Node. */
export async function verifyDayWithZ3Api(api: Z3Api, day: DaySimulation, battery: BatteryConfig): Promise<boolean> {
  if (!day || !Array.isArray(day.steps) || day.steps.length < 1 || day.steps.length > 24 || !day.summary || !battery) return false
  const parameters = [battery.capacityMWh, battery.initialMWh, battery.maxChargeMW, battery.maxDischargeMW, battery.chargeEfficiency, battery.dischargeEfficiency]
  if (parameters.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0) || battery.initialMWh > battery.capacityMWh || battery.chargeEfficiency <= 0 || battery.chargeEfficiency > 1 || battery.dischargeEfficiency <= 0 || battery.dischargeEfficiency > 1) return false
  let previousHour: number | undefined
  for (const s of day.steps) {
    if (!s || typeof s.hour !== 'string' || !/^(?:[01]\d|2[0-3]):00$/.test(s.hour)) return false
    const hour = Number(s.hour.slice(0, 2))
    if (previousHour !== undefined && hour !== previousHour + 1) return false
    previousHour = hour
    const values = [s.productionMW, s.consumptionMW, s.batteryStartMWh, s.batteryEndMWh, s.chargeMW, s.dischargeMW, s.unservedMW, s.curtailedMW, s.lossesMWh]
    if (values.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return false
    if (s.shortageStartsAfterMinutes !== null && (typeof s.shortageStartsAfterMinutes !== 'number' || !Number.isFinite(s.shortageStartsAfterMinutes) || s.shortageStartsAfterMinutes < 0 || s.shortageStartsAfterMinutes > 60)) return false
    if ((s.unservedMW > 0) !== (s.shortageStartsAfterMinutes !== null)) return false
  }
  const summaryNumbers = [day.summary.totalProductionMWh, day.summary.totalConsumptionMWh, day.summary.totalUnservedMWh, day.summary.totalCurtailedMWh, day.summary.totalLossesMWh, day.summary.hoursWithShortage, day.summary.peakUnservedMW, day.summary.finalBatteryMWh]
  if (summaryNumbers.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0) || !Number.isInteger(day.summary.hoursWithShortage)) return false

  const { Solver, Real, Or } = new api.Context('energy-day')
  const solver = new Solver()
  type Num = Arith<'energy-day'>
  const val = (n: number): Num => Real.val(String(n))
  // 1e-10 relative (minimum 1e-10 MWh/MW) allows JS floating-point arithmetic
  // but is far below the one-decimal quantities displayed in the interface.
  const scale = Math.max(1, ...parameters, ...summaryNumbers, ...day.steps.flatMap(s => [s.productionMW, s.consumptionMW, s.batteryStartMWh, s.batteryEndMWh, s.chargeMW, s.dischargeMW, s.unservedMW, s.curtailedMW, s.lossesMWh]))
  const tol = val(scale * 1e-10)
  const near = (left: Num, right: Num) => {
    const delta = left.sub(right)
    return delta.le(tol).and(delta.ge(tol.neg()))
  }
  const le = (left: Num, right: Num) => left.le(right.add(tol))
  const zero = val(0), cap = val(battery.capacityMWh), maxCharge = val(battery.maxChargeMW), maxDischarge = val(battery.maxDischargeMW), chargeEff = val(battery.chargeEfficiency), dischargeEff = val(battery.dischargeEfficiency)
  let previousEnd: Num = val(battery.initialMWh)
  for (const s of day.steps) {
    const p = val(s.productionMW), c = val(s.consumptionMW), start = val(s.batteryStartMWh), end = val(s.batteryEndMWh), charge = val(s.chargeMW), discharge = val(s.dischargeMW), unmet = val(s.unservedMW), excess = val(s.curtailedMW), losses = val(s.lossesMWh)
    solver.add(
      near(start, previousEnd), le(start, cap), le(end, cap), le(charge, maxCharge), le(discharge, maxDischarge),
      near(p.add(discharge).add(unmet), c.add(charge).add(excess)),
      near(end, start.add(charge.mul(chargeEff)).sub(discharge.div(dischargeEff))),
      near(losses, charge.sub(charge.mul(chargeEff)).add(discharge.div(dischargeEff).sub(discharge))),
    )
    if (s.productionMW >= s.consumptionMW) {
      const surplus = p.sub(c), room = cap.sub(start).div(chargeEff)
      solver.add(near(unmet, zero), near(discharge, zero), le(charge, surplus), le(charge, room), Or(near(charge, surplus), near(charge, maxCharge), near(charge, room)))
    } else {
      const deficit = c.sub(p), available = start.mul(dischargeEff)
      solver.add(near(charge, zero), near(excess, zero), le(discharge, deficit), le(discharge, available), Or(near(discharge, deficit), near(discharge, maxDischarge), near(discharge, available)))
      if (s.shortageStartsAfterMinutes !== null) {
        const minutes = val(s.shortageStartsAfterMinutes)
        if (s.consumptionMW - s.productionMW > battery.maxDischargeMW) solver.add(near(minutes, zero))
        else solver.add(near(minutes.mul(deficit), start.mul(dischargeEff).mul(val(60))))
      }
    }
    previousEnd = end
  }
  const sum = (selector: (step: DaySimulation['steps'][number]) => number): Num => day.steps.reduce((acc: Num, step) => acc.add(val(selector(step))), zero)
  const actualShortageHours = day.steps.filter(s => s.unservedMW > 0).length
  const peak = val(day.summary.peakUnservedMW)
  solver.add(
    near(val(day.summary.totalProductionMWh), sum(s => s.productionMW)),
    near(val(day.summary.totalConsumptionMWh), sum(s => s.consumptionMW)),
    near(val(day.summary.totalUnservedMWh), sum(s => s.unservedMW)),
    near(val(day.summary.totalCurtailedMWh), sum(s => s.curtailedMW)),
    near(val(day.summary.totalLossesMWh), sum(s => s.lossesMWh)),
    near(val(day.summary.finalBatteryMWh), previousEnd),
    near(val(day.summary.hoursWithShortage), val(actualShortageHours)),
    ...day.steps.map(s => le(val(s.unservedMW), peak)),
    Or(...day.steps.map(s => near(peak, val(s.unservedMW)))),
  )
  const status = await solver.check()
  if (status === 'unknown') throw new Error('Z3 n’a pas pu conclure sur les contraintes de la journée.')
  return status === 'sat'
}
