import { evaluate } from 'mathjs'
import { calculateEnergy, type EnergyInputs, type EnergyResult } from './energy.ts'

/** A single action (or a necessary pair of battery changes) for the educational model. */
export type ScenarioPlan = {
  kind: 'production' | 'consumption' | 'storage' | 'batteryPower' | 'battery'
  label: string
  detail: string
  inputs: EnergyInputs
  result: EnergyResult
}

const LIMIT = 100
const EPSILON = 1e-9
const wholeUp = (n: number) => Math.ceil(n - EPSILON)
const wholeDown = (n: number) => Math.floor(n + EPSILON)
const calc = (expression: string, scope: Record<string, number>) => Number(evaluate(expression, scope))
const display = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)

/**
 * Finds simple, independent interventions satisfying a target duration. These
 * are alternatives, not an exhaustive search or an economic optimum. Controls
 * have whole-number steps and all values are bounded by 100, as in the UI.
 */
export function planScenarios(inputs: EnergyInputs, targetHours = 1): ScenarioPlan[] {
  const current = calculateEnergy(inputs)
  if (!Number.isFinite(targetHours) || targetHours <= 0) throw new RangeError('targetHours must be finite and positive')
  if (Object.values(inputs).some(value => value > LIMIT)) throw new RangeError('values must not exceed 100')
  const holds = (candidate: EnergyInputs): boolean => {
    const r = calculateEnergy(candidate)
    return r.deficitMW === 0 || (r.batteryCanCoverDeficit && r.autonomyHours !== null && r.autonomyHours + EPSILON >= targetHours)
  }
  if (holds(inputs)) return []
  const plans: ScenarioPlan[] = []
  const scope = { production: inputs.productionMW, demand: inputs.consumptionMW, energy: inputs.batteryMWh, power: inputs.batteryPowerMW, hours: targetHours }
  // The sustainable deficit is limited both by instantaneous power and stored energy.
  const sustainable = calc('min(power, energy / hours)', scope)
  const production = wholeUp(calc('max(production, demand - sustainable)', { ...scope, sustainable }))
  const consumption = wholeDown(calc('min(demand, production + sustainable)', { ...scope, sustainable }))
  const deficit = current.deficitMW
  const energy = wholeUp(calc('deficit * hours', { deficit, hours: targetHours }))
  const power = wholeUp(deficit)

  const addPlan = (kind: ScenarioPlan['kind'], label: string, detail: string, values: Partial<EnergyInputs>) => {
    const candidate = { ...inputs, ...values }
    if (Object.values(candidate).some(value => value < 0 || value > LIMIT) || !holds(candidate)) return
    plans.push({ kind, label, detail, inputs: candidate, result: calculateEnergy(candidate) })
  }
  if (production > inputs.productionMW) addPlan('production', 'Augmenter la production', `Passer à ${display(production)} MW (+${display(production - inputs.productionMW)} MW).`, { productionMW: production })
  if (consumption < inputs.consumptionMW) addPlan('consumption', 'Réduire la consommation', `Passer à ${display(consumption)} MW (−${display(inputs.consumptionMW - consumption)} MW).`, { consumptionMW: consumption })
  if (energy > inputs.batteryMWh) addPlan('storage', 'Augmenter le stockage', `Passer à ${display(energy)} MWh (+${display(energy - inputs.batteryMWh)} MWh).`, { batteryMWh: energy })
  if (power > inputs.batteryPowerMW) addPlan('batteryPower', 'Augmenter la puissance de décharge', `Passer à ${display(power)} MW (+${display(power - inputs.batteryPowerMW)} MW).`, { batteryPowerMW: power })
  if (energy > inputs.batteryMWh && power > inputs.batteryPowerMW) addPlan('battery', 'Renforcer la batterie', `Passer à ${display(energy)} MWh et ${display(power)} MW.`, { batteryMWh: energy, batteryPowerMW: power })
  return plans
}

/** Prepare the optional Z3 runtime only after a user asks for verification. */
export async function prepareZ3(): Promise<'ready' | 'reload-required'> {
  if (globalThis.crossOriginIsolated) return 'ready'
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    throw new Error('Z3 exige HTTPS et un navigateur autorisant les service workers.')
  }
  const base = import.meta.env.BASE_URL
  const registration = await navigator.serviceWorker.register(`${base}z3-isolation.js`, { scope: base })
  await navigator.serviceWorker.ready
  if (!registration.active) throw new Error('Le service worker nécessaire à Z3 ne peut pas démarrer.')
  return 'reload-required'
}

export type Z3Api = Awaited<ReturnType<typeof import('z3-solver')['init']>>
let z3ApiPromise: Promise<Z3Api> | undefined

export async function loadZ3(): Promise<Z3Api> {
  if (!globalThis.crossOriginIsolated) throw new Error('Activez Z3 et rechargez la page avant de vérifier les contraintes.')
  if (!z3ApiPromise) {
    z3ApiPromise = (async () => {
      const browserGlobal = globalThis as typeof globalThis & { global?: typeof globalThis; initZ3?: unknown }
      // z3-solver's browser entry expects Node's `global` alias.
      browserGlobal.global = globalThis
      const [{ default: scriptUrl }, { default: wasmUrl }] = await Promise.all([
        import('z3-solver/build/z3-built.js?url'),
        import('z3-solver/build/z3-built.wasm?url'),
      ])
      if (!browserGlobal.initZ3) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = scriptUrl
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Impossible de charger le moteur Z3.'))
          document.head.appendChild(script)
        })
      }
      const { init } = await import('z3-solver')
      return init({ locateFile: (file: string) => file.endsWith('.wasm') ? wasmUrl : scriptUrl })
    })()
    z3ApiPromise.catch(() => { z3ApiPromise = undefined })
  }
  return z3ApiPromise
}

/** Verify the proposed bounded actions with Z3; throws instead of silently falling back. */
export async function verifyWithZ3(plans: ScenarioPlan[], targetHours = 1): Promise<boolean[]> {
  if (!Number.isFinite(targetHours) || targetHours <= 0) throw new RangeError('targetHours must be finite and positive')
  const api = await loadZ3()
  const { Solver, Real, Or, And } = new api.Context('energy')
  const results: boolean[] = []
  for (const plan of plans) {
    const { productionMW, consumptionMW, batteryMWh, batteryPowerMW } = plan.inputs
    const solver = new Solver()
    const production = Real.val(String(productionMW)), consumption = Real.val(String(consumptionMW))
    const energy = Real.val(String(batteryMWh)), power = Real.val(String(batteryPowerMW))
    const deficit = consumption.sub(production)
    solver.add(And(
      production.ge(0), production.le(LIMIT), consumption.ge(0), consumption.le(LIMIT),
      energy.ge(0), energy.le(LIMIT), power.ge(0), power.le(LIMIT),
      Or(deficit.le(0), And(power.ge(deficit), energy.ge(deficit.mul(Real.val(String(targetHours))))))
    ))
    results.push(await solver.check() === 'sat')
  }
  return results
}
