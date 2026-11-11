import { simulateDay, type BatteryConfig, type DaySimulation, type HourInput } from './timeline.ts'

export type WhatIfChanges = {
  productionMW?: number
  consumptionMW?: number
}

export type WhatIfEdit = WhatIfChanges & { index: number }

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
  /** A fresh copy of the scenario with all requested hours changed. */
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
 * Preview the consequences of changing any number of hours, without modifying
 * the inputs. Each index occurs at most once; changes may arrive in any order.
 * Both paths go through the same deterministic battery model. This is a
 * counterfactual comparison, not a search for or validation of an optimal plan.
 */
export function previewWhatIfMany(rows: HourInput[], battery: BatteryConfig, edits: WhatIfEdit[]): WhatIfResult {
  if (!Array.isArray(rows)) throw new TypeError('Une journée est requise.')
  if (!Array.isArray(edits)) throw new TypeError('Les modifications sont requises.')
  const byIndex = new Map<number, WhatIfEdit>()
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
      throw new TypeError('Les modifications de production ou de consommation sont requises.')
    }
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= rows.length) {
      throw new RangeError('Choisissez une heure présente dans la journée.')
    }
    if (byIndex.has(edit.index)) throw new RangeError('Une heure ne peut apparaître deux fois.')
    for (const key of Object.keys(edit)) {
      if (key !== 'index' && key !== 'productionMW' && key !== 'consumptionMW') throw new TypeError('Modification inconnue.')
      if (key === 'index') continue
      const value = edit[key as keyof WhatIfChanges]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new RangeError('Les puissances doivent être des nombres finis positifs ou nuls.')
      }
    }
    byIndex.set(edit.index, edit)
  }

  // simulateDay validates the complete inputs and battery, and returns fresh values.
  const baseline = simulateDay(rows, battery)
  const alteredRows = rows.map((row, i) => {
    const edit = byIndex.get(i)
    return { ...row, productionMW: edit?.productionMW ?? row.productionMW, consumptionMW: edit?.consumptionMW ?? row.consumptionMW }
  })
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

/** Backward-compatible convenience wrapper for a single hour. */
export function previewWhatIf(rows: HourInput[], battery: BatteryConfig, index: number, changes: WhatIfChanges): WhatIfResult {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('Les modifications de production ou de consommation sont requises.')
  }
  if (Object.keys(changes).some(key => key !== 'productionMW' && key !== 'consumptionMW')) {
    throw new TypeError('Modification inconnue.')
  }
  return previewWhatIfMany(rows, battery, [{ ...changes, index }])
}
