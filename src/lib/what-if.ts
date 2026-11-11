import { simulateDay, type BatteryConfig, type DaySimulation, type HourInput } from './timeline.ts'

export type WhatIfChanges = {
  productionMW?: number
  consumptionMW?: number
}

export type ShortageMoment = {
  index: number
  hour: string
  /** Minutes elapsed since the beginning of the stated hour. */
  minutesIntoHour: number
}

export type HourlyDifference = {
  index: number
  hour: string
  /** Each input interval lasts one hour, so this is its unmet energy in MWh. */
  unservedMWhDelta: number
  batteryEndMWhDelta: number
  productionMWDelta: number
  consumptionMWDelta: number
}

export type WhatIfResult = {
  /** A fresh copy of the scenario with only the selected hour changed. */
  rows: HourInput[]
  baseline: DaySimulation
  preview: DaySimulation
  comparison: {
    /** Every delta is preview minus baseline; negative unmet energy is an improvement. */
    totalUnservedMWhDelta: number
    shortageSlotsDelta: number
    finalBatteryMWhDelta: number
    firstShortageBaseline: ShortageMoment | null
    firstShortagePreview: ShortageMoment | null
    /** Positive means the first shortage is later. Null if either has no shortage. */
    firstShortageShiftMinutes: number | null
    perHour: HourlyDifference[]
  }
}

function firstShortage(day: DaySimulation): ShortageMoment | null {
  const index = day.steps.findIndex(step => step.shortageStartsAfterMinutes !== null)
  if (index < 0) return null
  const step = day.steps[index]
  return { index, hour: step.hour, minutesIntoHour: step.shortageStartsAfterMinutes! }
}

function minuteOfDay(moment: ShortageMoment): number {
  return Number(moment.hour.slice(0, 2)) * 60 + moment.minutesIntoHour
}

/**
 * Preview the consequences of changing one hour, without modifying the input.
 * Both paths go through the same deterministic battery model. This is a
 * counterfactual comparison, not a search for or validation of an optimal plan.
 */
export function previewWhatIf(rows: HourInput[], battery: BatteryConfig, index: number, changes: WhatIfChanges): WhatIfResult {
  if (!Array.isArray(rows) || !Number.isInteger(index) || index < 0 || index >= rows.length) {
    throw new RangeError('Choisissez une heure présente dans la journée.')
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('Les modifications de production ou de consommation sont requises.')
  }
  for (const key of Object.keys(changes)) {
    if (key !== 'productionMW' && key !== 'consumptionMW') throw new TypeError('Modification inconnue.')
    const value = changes[key as keyof WhatIfChanges]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new RangeError('Les puissances doivent être des nombres finis positifs ou nuls.')
    }
  }

  // simulateDay validates the complete inputs and battery, and returns fresh values.
  const baseline = simulateDay(rows, battery)
  const alteredRows = rows.map((row, i) => i === index
    ? { ...row, productionMW: changes.productionMW ?? row.productionMW, consumptionMW: changes.consumptionMW ?? row.consumptionMW }
    : { ...row })
  const preview = simulateDay(alteredRows, battery)
  const firstShortageBaseline = firstShortage(baseline)
  const firstShortagePreview = firstShortage(preview)
  const perHour = preview.steps.map((step, i): HourlyDifference => ({
    index: i,
    hour: step.hour,
    unservedMWhDelta: step.unservedMW - baseline.steps[i].unservedMW,
    batteryEndMWhDelta: step.batteryEndMWh - baseline.steps[i].batteryEndMWh,
    productionMWDelta: step.productionMW - baseline.steps[i].productionMW,
    consumptionMWDelta: step.consumptionMW - baseline.steps[i].consumptionMW,
  }))
  return {
    rows: alteredRows,
    baseline,
    preview,
    comparison: {
      totalUnservedMWhDelta: preview.summary.totalUnservedMWh - baseline.summary.totalUnservedMWh,
      shortageSlotsDelta: preview.summary.hoursWithShortage - baseline.summary.hoursWithShortage,
      finalBatteryMWhDelta: preview.summary.finalBatteryMWh - baseline.summary.finalBatteryMWh,
      firstShortageBaseline,
      firstShortagePreview,
      firstShortageShiftMinutes: firstShortageBaseline && firstShortagePreview
        ? minuteOfDay(firstShortagePreview) - minuteOfDay(firstShortageBaseline)
        : null,
      perHour,
    },
  }
}
