import { useEffect, useRef, useState } from 'react'
import { Download, RotateCcw, Save, Upload } from 'lucide-react'
import type { Doc } from '@automerge/automerge/slim'
import { Button } from '@/components/ui/button'
import { calculateEnergy, type EnergyInputs } from '@/lib/energy'

type ScenarioDocument = { schemaVersion: 1; scenario: EnergyInputs }
type ScenarioCompareProps = { scenario: EnergyInputs; onApply: (scenario: EnergyInputs) => void }
type AutomergeModule = typeof import('@automerge/automerge/slim')

const storageKey = 'ile-scenario-reference-v1'
const maxBytes = 256_000
const fields = ['productionMW', 'consumptionMW', 'batteryMWh', 'batteryPowerMW'] as const
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

function duration(hours: number | null) {
  if (hours === null) return '—'
  const seconds = Math.round(hours * 3600)
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}${s ? ` ${s} s` : ''}` : `${m} min${s ? ` ${s} s` : ''}`
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function validateDocument(value: unknown, automerge: AutomergeModule): Doc<ScenarioDocument> {
  if (!isExactObject(value, ['schemaVersion', 'scenario']) || value.schemaVersion !== 1 || !isExactObject(value.scenario, fields)) throw new Error('Le document ne contient pas un scénario reconnu.')
  for (const key of fields) {
    const entry = value.scenario[key]
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 100) throw new Error('Les valeurs doivent être comprises entre 0 et 100.')
  }
  const doc = value as unknown as Doc<ScenarioDocument>
  if (automerge.getConflicts(doc, 'schemaVersion') || automerge.getConflicts(doc, 'scenario')) throw new Error('Ce document contient des versions concurrentes. Exportez un scénario sans conflit.')
  for (const field of fields) if (automerge.getConflicts(doc.scenario, field)) throw new Error('Ce document contient des valeurs concurrentes. Exportez un scénario sans conflit.')
  return doc
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, item => String.fromCharCode(item)).join(''))
}

function decode(encoded: string): Uint8Array {
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error('Le document enregistré est trop volumineux.')
  const binary = atob(encoded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export default function ScenarioCompare({ scenario, onApply }: ScenarioCompareProps) {
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
      const snapshot: EnergyInputs = { productionMW: scenario.productionMW, consumptionMW: scenario.consumptionMW, batteryMWh: scenario.batteryMWh, batteryPowerMW: scenario.batteryPowerMW }
      const next = doc ? automerge.change(doc, draft => { draft.scenario = snapshot }) : automerge.from<ScenarioDocument>({ schemaVersion: 1, scenario: snapshot })
      const bytes = automerge.save(next)
      if (bytes.length > maxBytes) throw new Error('L’historique est trop volumineux. Importez un nouveau scénario ou actualisez la page.')
      setDoc(next)
      setMessage(persist(bytes) ? 'Référence enregistrée dans ce navigateur.' : 'Référence enregistrée pour cette session ; le stockage local est indisponible.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Impossible d’enregistrer le scénario.') }
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
      link.download = 'ile-scenario.automerge'
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
      setMessage(persist(bytes) ? 'Référence importée et enregistrée dans ce navigateur.' : 'Référence importée pour cette session ; le stockage local est indisponible.')
    } catch (error) { setMessage(error instanceof Error && /scénario reconnu|valeurs doivent|versions concurrentes|valeurs concurrentes|volumineux/.test(error.message) ? error.message : 'Ce fichier n’est pas un document de scénario valide.') }
    finally { setBusy(false) }
  }

  const baseline = doc?.scenario
  const baselineResult = baseline ? calculateEnergy(baseline) : null
  const currentResult = calculateEnergy(scenario)
  const comparisonRows = baseline && baselineResult ? [
    { label: 'Production', reference: `${number(baseline.productionMW)} MW`, current: `${number(scenario.productionMW)} MW` },
    { label: 'Consommation', reference: `${number(baseline.consumptionMW)} MW`, current: `${number(scenario.consumptionMW)} MW` },
    { label: 'Stockage disponible', reference: `${number(baseline.batteryMWh)} MWh`, current: `${number(scenario.batteryMWh)} MWh` },
    { label: 'Puissance batterie', reference: `${number(baseline.batteryPowerMW)} MW`, current: `${number(scenario.batteryPowerMW)} MW` },
    { label: 'Déficit', reference: `${number(baselineResult.deficitMW)} MW`, current: `${number(currentResult.deficitMW)} MW` },
    { label: 'Autonomie théorique', reference: duration(baselineResult.autonomyHours), current: duration(currentResult.autonomyHours) },
  ] : []

  return <section aria-labelledby="comparison-title" className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><span className="text-[11px] font-semibold tracking-[0.12em] text-zinc-500">COMPARER</span><h2 id="comparison-title" className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">Deux scénarios, côte à côte</h2><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">Enregistrez une référence, puis modifiez les paramètres pour comparer les résultats.</p></div>
      <Button variant="outline" size="sm" onClick={() => void capture()} disabled={busy}><Save size={14} /> {baseline ? 'Remplacer la référence' : 'Enregistrer la référence'}</Button>
    </div>
    {baseline ? <div className="mt-5 overflow-x-auto rounded-md border border-zinc-200"><table className="w-full min-w-[380px] border-collapse text-left text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th scope="col" className="px-4 py-3 font-medium">Indicateur</th><th scope="col" className="px-4 py-3 font-medium">Référence</th><th scope="col" className="px-4 py-3 font-medium">Actuel</th></tr></thead><tbody>{comparisonRows.map(row => <tr key={row.label} className="border-t border-zinc-100"><th scope="row" className="px-4 py-3 font-medium text-zinc-600">{row.label}</th><td className="px-4 py-3 tabular-nums text-zinc-600">{row.reference}</td><td className="px-4 py-3 font-medium tabular-nums text-zinc-950">{row.current}</td></tr>)}</tbody></table></div> : <div className="mt-5 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-sm leading-6 text-zinc-600">Aucune référence pour le moment. Enregistrez le scénario actuel ou importez un fichier partagé.</div>}
    <div className="mt-4 flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={busy || !baseline} onClick={() => { if (baseline) onApply({ productionMW: baseline.productionMW, consumptionMW: baseline.consumptionMW, batteryMWh: baseline.batteryMWh, batteryPowerMW: baseline.batteryPowerMW }) }}><RotateCcw size={14}/> Restaurer</Button><Button variant="outline" size="sm" disabled={busy || !baseline} onClick={() => void exportFile()}><Download size={14}/> Exporter</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14}/> Importer</Button><input ref={fileInput} className="sr-only" type="file" accept=".automerge,application/octet-stream" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }}/></div>
    <p className="mt-3 text-xs leading-5 text-zinc-500">La référence est conservée dans ce navigateur. Le partage se fait manuellement par fichier ; il n’y a pas de collaboration en direct.</p>
    {message && <p role="status" className="mt-3 text-sm leading-5 text-zinc-700">{message}</p>}
  </section>
}
