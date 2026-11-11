import { useEffect, useRef, useState } from 'react'
import { Download, RotateCcw, Save, Upload } from 'lucide-react'
import type { Doc } from '@automerge/automerge/slim'
import { Button } from '@/components/ui/button'
import { simulateDay, type HourInput, type BatteryConfig, type DaySimulation } from '@/lib/timeline'

type ScenarioDocument = { schemaVersion: 2; rows: HourInput[]; battery: BatteryConfig }
type ScenarioCompareProps = { rows: HourInput[]; battery: BatteryConfig; day: DaySimulation; onApply: (rows: HourInput[], battery: BatteryConfig) => void }
type AutomergeModule = typeof import('@automerge/automerge/slim')

// A new key intentionally excludes references saved by the old snapshot model.
const storageKey = 'ile-journee-reference-v2'
const maxBytes = 256_000
const rowFields = ['hour', 'productionMW', 'consumptionMW'] as const
const batteryFields = ['capacityMWh', 'initialMWh', 'maxChargeMW', 'maxDischargeMW', 'chargeEfficiency', 'dischargeEfficiency'] as const
const number = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
let automergePromise: Promise<AutomergeModule> | null = null

function loadAutomerge() {
  if (!automergePromise) {
    automergePromise = Promise.all([
      import('@automerge/automerge/slim'),
      import('@automerge/automerge/automerge.wasm?url'),
    ]).then(async ([automerge, wasm]) => {
      if (!automerge.isWasmInitialized()) await automerge.initializeWasm(wasm.default)
      return automerge
    }).catch(error => { automergePromise = null; throw error })
  }
  return automergePromise
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function validateDocument(value: unknown, automerge: AutomergeModule): Doc<ScenarioDocument> {
  if (!isExactObject(value, ['schemaVersion', 'rows', 'battery']) || value.schemaVersion !== 2 || !Array.isArray(value.rows) || !isExactObject(value.battery, batteryFields)) {
    throw new Error('Ce fichier ne contient pas une journée reconnue.')
  }
  if (value.rows.length < 1 || value.rows.length > 24 || value.rows.some(row => !isExactObject(row, rowFields))) throw new Error('Le fichier ne contient pas des heures reconnues.')
  const doc = value as unknown as Doc<ScenarioDocument>
  if (automerge.getConflicts(doc, 'schemaVersion') || automerge.getConflicts(doc, 'rows') || automerge.getConflicts(doc, 'battery')) throw new Error('Ce fichier contient des versions concurrentes. Exportez une journée sans conflit.')
  for (const field of batteryFields) if (automerge.getConflicts(doc.battery, field)) throw new Error('Ce fichier contient des valeurs concurrentes. Exportez une journée sans conflit.')
  for (let i = 0; i < doc.rows.length; i++) {
    if (automerge.getConflicts(doc.rows, i)) throw new Error('Ce fichier contient des versions horaires concurrentes.')
    for (const field of rowFields) if (automerge.getConflicts(doc.rows[i], field)) throw new Error('Ce fichier contient des valeurs horaires concurrentes.')
  }
  // The simulation's validation is the single source of truth for time order,
  // numeric values, available energy, power limits, and efficiencies.
  simulateDay(doc.rows, doc.battery)
  return doc
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, item => String.fromCharCode(item)).join(''))
}

function decode(encoded: string): Uint8Array {
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error('La journée enregistrée est trop volumineuse.')
  const binary = atob(encoded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function copyRows(rows: HourInput[]): HourInput[] {
  return rows.map(({ hour, productionMW, consumptionMW }) => ({ hour, productionMW, consumptionMW }))
}

function copyBattery(battery: BatteryConfig): BatteryConfig {
  const { capacityMWh, initialMWh, maxChargeMW, maxDischargeMW, chargeEfficiency, dischargeEfficiency } = battery
  return { capacityMWh, initialMWh, maxChargeMW, maxDischargeMW, chargeEfficiency, dischargeEfficiency }
}

function range(rows: HourInput[]) {
  return rows.length ? `${rows[0].hour} – ${rows[rows.length - 1].hour} · ${rows.length} h` : 'Aucune heure'
}

export default function ScenarioCompare({ rows, battery, day, onApply }: ScenarioCompareProps) {
  const [doc, setDoc] = useState<Doc<ScenarioDocument> | null>(null)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved) {
          const automerge = await loadAutomerge()
          const loaded = validateDocument(automerge.load(decode(saved)), automerge)
          if (active) setDoc(loaded)
        }
      } catch {
        if (active) setMessage('La référence enregistrée ne peut pas être lue. Enregistrez-en une nouvelle.')
      } finally { if (active) setBusy(false) }
    }
    void restore()
    return () => { active = false }
  }, [])

  const persist = (bytes: Uint8Array) => {
    try {
      localStorage.setItem(storageKey, encode(bytes))
      return true
    } catch { return false }
  }

  const capture = async () => {
    setBusy(true)
    setMessage('')
    try {
      const automerge = await loadAutomerge()
      const snapshotRows = copyRows(rows), snapshotBattery = copyBattery(battery)
      simulateDay(snapshotRows, snapshotBattery)
      const next = doc
        ? automerge.change(doc, draft => { draft.rows = snapshotRows; draft.battery = snapshotBattery })
        : automerge.from<ScenarioDocument>({ schemaVersion: 2, rows: snapshotRows, battery: snapshotBattery })
      const bytes = automerge.save(next)
      if (bytes.length > maxBytes) throw new Error('L’historique est trop volumineux. Importez une nouvelle journée.')
      setDoc(next)
      setMessage(persist(bytes) ? 'Journée de référence enregistrée dans ce navigateur.' : 'Référence conservée pour cette session ; le stockage local est indisponible.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Impossible d’enregistrer la journée.') }
    finally { setBusy(false) }
  }

  const exportFile = async () => {
    if (!doc) return
    setBusy(true)
    try {
      const automerge = await loadAutomerge()
      const bytes = automerge.save(doc)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'ile-journee.automerge'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Fichier prêt à être partagé. Aucun envoi automatique n’a été effectué.')
    } catch { setMessage('Impossible d’exporter la référence.') }
    finally { setBusy(false) }
  }

  const importFile = async (file: File) => {
    if (file.size === 0 || file.size > maxBytes) { setMessage('Choisissez un document Automerge non vide de 256 Ko maximum.'); return }
    setBusy(true)
    setMessage('')
    try {
      const automerge = await loadAutomerge()
      const loaded = validateDocument(automerge.load(new Uint8Array(await file.arrayBuffer())), automerge)
      const bytes = automerge.save(loaded)
      if (bytes.length > maxBytes) throw new Error('Le document est trop volumineux.')
      setDoc(loaded)
      setMessage(persist(bytes) ? 'Journée importée et enregistrée dans ce navigateur.' : 'Journée importée pour cette session ; le stockage local est indisponible.')
    } catch (error) {
      setMessage(error instanceof Error && /journée reconnue|heures reconnues|concurrent|volumineux|doit|doivent|dépasse/.test(error.message) ? error.message : 'Ce fichier n’est pas un document de journée valide.')
    } finally { setBusy(false) }
  }

  const baseline = doc ? simulateDay(doc.rows, doc.battery) : null
  const matchingPeriods = doc && doc.rows.length === rows.length && doc.rows.every((row, index) => row.hour === rows[index].hour)
  const comparisonRows = baseline && doc ? [
    { label: 'Production totale', reference: `${number(baseline.summary.totalProductionMWh)} MWh`, current: `${number(day.summary.totalProductionMWh)} MWh` },
    { label: 'Consommation totale', reference: `${number(baseline.summary.totalConsumptionMWh)} MWh`, current: `${number(day.summary.totalConsumptionMWh)} MWh` },
    { label: 'Énergie non servie', reference: `${number(baseline.summary.totalUnservedMWh)} MWh`, current: `${number(day.summary.totalUnservedMWh)} MWh` },
    { label: 'Créneaux avec manque', reference: `${baseline.summary.hoursWithShortage} / ${doc.rows.length}`, current: `${day.summary.hoursWithShortage} / ${rows.length}` },
    { label: 'Surplus non utilisé', reference: `${number(baseline.summary.totalCurtailedMWh)} MWh`, current: `${number(day.summary.totalCurtailedMWh)} MWh` },
    { label: 'Pertes de batterie', reference: `${number(baseline.summary.totalLossesMWh)} MWh`, current: `${number(day.summary.totalLossesMWh)} MWh` },
    { label: 'Batterie en fin de période', reference: `${number(baseline.summary.finalBatteryMWh)} MWh`, current: `${number(day.summary.finalBatteryMWh)} MWh` },
  ] : []

  return <section aria-labelledby="comparison-title" className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><span className="text-[11px] font-semibold tracking-[0.12em] text-zinc-500">COMPARER</span><h2 id="comparison-title" className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">Deux journées, côte à côte</h2><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">Enregistrez une référence complète, puis modifiez la journée ou la batterie pour comparer leurs conséquences.</p></div>
      <Button variant="outline" size="sm" onClick={() => void capture()} disabled={busy}><Save size={14} /> {baseline ? 'Remplacer la référence' : 'Enregistrer la référence'}</Button>
    </div>
    {baseline && doc ? <><div className="mt-5 overflow-x-auto rounded-md border border-zinc-200"><table className="w-full min-w-[440px] border-collapse text-left text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th scope="col" className="px-4 py-3 font-medium">Bilan de la période</th><th scope="col" className="px-4 py-3 font-medium">Référence<br/><span className="font-normal">{range(doc.rows)}</span></th><th scope="col" className="px-4 py-3 font-medium">Actuelle<br/><span className="font-normal">{range(rows)}</span></th></tr></thead><tbody>{comparisonRows.map(row => <tr key={row.label} className="border-t border-zinc-100"><th scope="row" className="px-4 py-3 font-medium text-zinc-600">{row.label}</th><td className="px-4 py-3 tabular-nums text-zinc-600">{row.reference}</td><td className="px-4 py-3 font-medium tabular-nums text-zinc-950">{row.current}</td></tr>)}</tbody></table></div>{!matchingPeriods && <p className="mt-2 text-xs leading-5 text-amber-700">Les périodes ne couvrent pas les mêmes heures : comparez les totaux avec prudence.</p>}</> : <div className="mt-5 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-sm leading-6 text-zinc-600">Aucune référence pour le moment. Enregistrez la journée actuelle ou importez un fichier partagé.</div>}
    <div className="mt-4 flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={busy || !doc} onClick={() => { if (doc) onApply(copyRows(doc.rows), copyBattery(doc.battery)) }}><RotateCcw size={14}/> Restaurer</Button><Button variant="outline" size="sm" disabled={busy || !doc} onClick={() => void exportFile()}><Download size={14}/> Exporter</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14}/> Importer</Button><input ref={fileInput} className="sr-only" type="file" accept=".automerge,application/octet-stream" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }}/></div>
    <p className="mt-3 text-xs leading-5 text-zinc-500">Un créneau avec manque est une heure durant laquelle une partie de la demande n’est pas couverte, même quelques minutes. La référence comprend les valeurs de chaque heure et les paramètres de batterie. Elle reste dans ce navigateur ; le partage est manuel par fichier, sans collaboration en direct.</p>
    {message && <p role="status" className="mt-3 text-sm leading-5 text-zinc-700">{message}</p>}
  </section>
}
