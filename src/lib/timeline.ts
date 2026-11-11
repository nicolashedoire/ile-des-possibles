/** An hourly, deliberately simplified energy balance. Power is in MW, energy in MWh. */
export type HourInput = {
  /** Beginning of this one-hour interval, between 00:00 and 23:00. */
  hour: string
  productionMW: number
  consumptionMW: number
}

export type BatteryConfig = {
  capacityMWh: number
  initialMWh: number
  maxChargeMW: number
  maxDischargeMW: number
  /** Stored energy divided by energy drawn from the grid; in (0, 1]. */
  chargeEfficiency: number
  /** Energy delivered to the grid divided by energy taken from storage; in (0, 1]. */
  dischargeEfficiency: number
}

export type HourResult = HourInput & {
  batteryStartMWh: number
  batteryEndMWh: number
  /** Average power from the grid into the battery during this one-hour step. */
  chargeMW: number
  /** Average power delivered to the grid by the battery during this one-hour step. */
  dischargeMW: number
  /** Average unmet demand during the hour; numerically equal to the energy in MWh over the one-hour step. */
  unservedMW: number
  /** Average unused production during the hour. */
  curtailedMW: number
  lossesMWh: number
  /** First instant of unmet demand measured in minutes from this interval's start. */
  shortageStartsAfterMinutes: number | null
}

export type DaySummary = {
  totalProductionMWh: number
  totalConsumptionMWh: number
  totalUnservedMWh: number
  totalCurtailedMWh: number
  totalLossesMWh: number
  hoursWithShortage: number
  /** Largest hourly average of unserved demand, not the instantaneous maximum. */
  peakUnservedMW: number
  finalBatteryMWh: number
}

export type DaySimulation = { steps: HourResult[]; summary: DaySummary }

function nonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} doit être un nombre fini positif ou nul.`)
  }
}

function efficiency(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${label} doit être strictement supérieur à 0 et inférieur ou égal à 1.`)
  }
}

/**
 * Simulates constant production and demand inside each one-hour interval.
 * The battery absorbs surplus before curtailment and covers deficits up to its
 * available energy and power limits. Shortages and curtailment are returned as
 * hour-average powers, not a sub-hourly power-flow simulation. There is no grid
 * import/export, self-discharge, reserve, or state carried across invocations.
 */
export function simulateDay(rows: HourInput[], battery: BatteryConfig): DaySimulation {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 24) {
    throw new RangeError('La journée doit contenir entre 1 et 24 lignes horaires.')
  }
  if (!battery || typeof battery !== 'object') throw new RangeError('Les paramètres de la batterie sont requis.')
  nonNegative(battery.capacityMWh, 'La capacité de la batterie')
  nonNegative(battery.initialMWh, 'L’énergie initiale')
  nonNegative(battery.maxChargeMW, 'La puissance de charge')
  nonNegative(battery.maxDischargeMW, 'La puissance de décharge')
  efficiency(battery.chargeEfficiency, 'Le rendement de charge')
  efficiency(battery.dischargeEfficiency, 'Le rendement de décharge')
  if (battery.initialMWh > battery.capacityMWh) throw new RangeError('L’énergie initiale dépasse la capacité de la batterie.')

  let previousHour: number | undefined
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || typeof row.hour !== 'string' || !/^(?:[01]\d|2[0-3]):00$/.test(row.hour)) {
      throw new RangeError(`L’heure de la ligne ${index + 1} doit être au format HH:00 (de 00:00 à 23:00).`)
    }
    const hour = Number(row.hour.slice(0, 2))
    if (previousHour !== undefined && hour !== previousHour + 1) {
      throw new RangeError(`Les heures doivent être ordonnées, consécutives et sans doublon (ligne ${index + 1}).`)
    }
    previousHour = hour
    nonNegative(row.productionMW, `La production de la ligne ${index + 1}`)
    nonNegative(row.consumptionMW, `La consommation de la ligne ${index + 1}`)
  })

  let stored = battery.initialMWh
  const steps: HourResult[] = rows.map(row => {
    const batteryStartMWh = stored
    const netMW = row.productionMW - row.consumptionMW
    let chargeMW = 0
    let dischargeMW = 0
    let unservedMW = 0
    let curtailedMW = 0
    let lossesMWh = 0
    let shortageStartsAfterMinutes: number | null = null

    if (netMW > 0) {
      // One hour: a MW average has the same numerical value as MWh.
      chargeMW = Math.min(netMW, battery.maxChargeMW, Math.max(0, battery.capacityMWh - stored) / battery.chargeEfficiency)
      const storedGain = chargeMW * battery.chargeEfficiency
      stored = Math.min(battery.capacityMWh, stored + storedGain)
      lossesMWh = chargeMW - storedGain
      curtailedMW = Math.max(0, netMW - chargeMW)
    } else if (netMW < 0) {
      const deficit = -netMW
      dischargeMW = Math.min(deficit, battery.maxDischargeMW, stored * battery.dischargeEfficiency)
      const removed = dischargeMW / battery.dischargeEfficiency
      stored = Math.max(0, stored - removed)
      lossesMWh = Math.max(0, removed - dischargeMW)
      const residual = Math.max(0, deficit - dischargeMW)
      // Multiplication/division by a fractional efficiency can leave a residual
      // of a few floating-point ulps when storage is mathematically exact.
      // Do not turn that numerical noise into a spurious hour of shortage.
      const roundingTolerance = 8 * Number.EPSILON * Math.max(1, deficit, dischargeMW)
      unservedMW = residual <= roundingTolerance ? 0 : residual
      if (unservedMW > 0) {
        // If the discharge power limit is insufficient, demand is unmet from
        // minute zero. Otherwise the shortage starts when storage runs out.
        shortageStartsAfterMinutes = deficit > battery.maxDischargeMW
          ? 0
          : Math.min(60, batteryStartMWh * battery.dischargeEfficiency / deficit * 60)
      }
    }

    return { ...row, batteryStartMWh, batteryEndMWh: stored, chargeMW, dischargeMW, unservedMW, curtailedMW, lossesMWh, shortageStartsAfterMinutes }
  })

  const summary: DaySummary = {
    totalProductionMWh: 0,
    totalConsumptionMWh: 0,
    totalUnservedMWh: 0,
    totalCurtailedMWh: 0,
    totalLossesMWh: 0,
    hoursWithShortage: 0,
    peakUnservedMW: 0,
    finalBatteryMWh: stored,
  }
  for (const step of steps) {
    summary.totalProductionMWh += step.productionMW
    summary.totalConsumptionMWh += step.consumptionMW
    summary.totalUnservedMWh += step.unservedMW
    summary.totalCurtailedMWh += step.curtailedMW
    summary.totalLossesMWh += step.lossesMWh
    if (step.unservedMW > 0) summary.hoursWithShortage++
    summary.peakUnservedMW = Math.max(summary.peakUnservedMW, step.unservedMW)
  }
  return { steps, summary }
}
