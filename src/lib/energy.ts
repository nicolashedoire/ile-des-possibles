/** Inputs to the island's deliberately simplified, constant-power model. */
export type EnergyInputs = {
  productionMW: number
  consumptionMW: number
  batteryMWh: number
  batteryPowerMW: number
}

export type EnergyResult = {
  deficitMW: number
  surplusMW: number
  /** Full-demand coverage in hours; null if there is no deficit or insufficient battery power. */
  autonomyHours: number | null
  batteryCanCoverDeficit: boolean
}

/**
 * Computes a snapshot under constant demand and production, with no battery
 * losses. Storage energy (MWh) and maximum discharge power (MW) are distinct.
 */
export function calculateEnergy(inputs: EnergyInputs): EnergyResult {
  for (const name of ['productionMW', 'consumptionMW', 'batteryMWh', 'batteryPowerMW'] as const) {
    const value = inputs[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite, non-negative number`)
    }
  }

  const { productionMW, consumptionMW, batteryMWh, batteryPowerMW } = inputs
  const deficitMW = Math.max(0, consumptionMW - productionMW)
  const surplusMW = Math.max(0, productionMW - consumptionMW)
  const batteryCanCoverDeficit = batteryPowerMW >= deficitMW

  return {
    deficitMW,
    surplusMW,
    autonomyHours: deficitMW > 0 && batteryCanCoverDeficit ? batteryMWh / deficitMW : null,
    batteryCanCoverDeficit,
  }
}
