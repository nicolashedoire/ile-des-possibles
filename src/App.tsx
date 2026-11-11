import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, Battery, BatteryCharging, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Database, Factory, GitCompareArrows, Pause, Play, RotateCcw, Upload, Wind, X, Zap } from 'lucide-react'
import IslandScene from '@/components/IslandScene'
import ScenarioCompare from '@/components/ScenarioCompare'
import { importEnergyData } from '@/lib/import-energy-data'
import { simulateDay, type BatteryConfig, type HourInput, type HourResult } from '@/lib/timeline'
import { previewWhatIfMany } from '@/lib/what-if'

type Site = 'production' | 'consommation' | 'batterie'
type Panel = Site | 'data' | 'compare' | 'help' | null
const initialBattery: BatteryConfig = { capacityMWh: 120, initialMWh: 100, maxChargeMW: 20, maxDischargeMW: 20, chargeEfficiency: .95, dischargeEfficiency: .95 }
type SavedDay = { rows: HourInput[]; originalRows: HourInput[]; battery: BatteryConfig; hourIndex: number; fileName: string }
const savedDayKey = 'ile-day-z3-reload-v1'
const eps = 1e-7
const fmt = (value: number, decimals = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimals }).format(Math.abs(value) < 1e-8 ? 0 : value)

function readSavedDay(): SavedDay | null {
  try {
    const raw = sessionStorage.getItem(savedDayKey)
    if (!raw) return null
    const saved = JSON.parse(raw) as SavedDay
    simulateDay(saved.rows, saved.battery)
    simulateDay(saved.originalRows, saved.battery)
    if (!Number.isInteger(saved.hourIndex) || saved.hourIndex < 0 || saved.hourIndex >= saved.rows.length || typeof saved.fileName !== 'string') return null
    return saved
  } catch { return null }
}

function consequence(step: HourResult, battery: BatteryConfig) {
  const deficit = step.consumptionMW - step.productionMW
  if (step.unservedMW > eps) {
    const cause = step.batteryStartMWh <= eps ? 'Batterie vide' : deficit > battery.maxDischargeMW + eps ? 'Puissance de batterie insuffisante' : 'Batterie épuisée pendant l’heure'
    const when = step.shortageStartsAfterMinutes && step.shortageStartsAfterMinutes > eps ? `après ${fmt(step.shortageStartsAfterMinutes, 0)} min` : 'dès le début'
    return { title: `${fmt(step.unservedMW)} MWh non servis`, detail: `${cause} · ${when}`, danger: true }
  }
  if (step.chargeMW > eps) return { title: `Batterie +${fmt(step.batteryEndMWh - step.batteryStartMWh)} MWh`, detail: step.curtailedMW > eps ? `${fmt(step.curtailedMW)} MWh de surplus non stocké` : 'Le surplus recharge la batterie', danger: false }
  if (deficit > eps) return { title: `Batterie −${fmt(step.batteryStartMWh - step.batteryEndMWh)} MWh`, detail: 'La batterie complète la production', danger: false }
  if (step.curtailedMW > eps) return { title: `${fmt(step.curtailedMW)} MWh non stockés`, detail: 'La batterie ne peut pas absorber le surplus', danger: false }
  return { title: 'Demande couverte', detail: 'Production et demande à l’équilibre', danger: false }
}

function ValueField({ label, unit, value, onChange, max = 1000 }: { label: string; unit: string; value: number; onChange: (value: number) => void; max?: number }) {
  return <label className="control-field"><span>{label}</span><span className="input-wrap"><input type="number" min="0" max={max} step="1" value={value} onChange={event => {const n = Number(event.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(0, n)))}} /><small>{unit}</small></span></label>
}

type Curve = 'productionMW' | 'consumptionMW'
type Draft = Array<{ index: number; changes: Partial<Record<Curve, number>> }>

function IntegratedChart({ steps, reference, index, capacity, playing, speed, editing, curve, draft, onChange, onPlay, onSpeed, onEdit, onRestore }: { steps: HourResult[]; reference: HourResult[]; index: number; capacity: number; playing: boolean; speed: number; editing: boolean; curve: Curve; draft: Draft | null; onChange: (i: number) => void; onPlay: () => void; onSpeed: () => void; onEdit: (i: number, value: number) => void; onRestore: (draft: Draft | null) => void }) {
  // The reference is immutable during the trial, keeping the scale fixed under the pointer.
  const rawMax = Math.max(0, ...reference.flatMap(step => [step.productionMW, step.consumptionMW]))
  const maxPower = rawMax > 0 ? Math.max(10, Math.ceil(rawMax * 1.25 / 10) * 10) : 10
  const x = (i: number) => steps.length === 1 ? 500 : 10 + 980 * i / (steps.length - 1)
  const powerY = (n: number) => 88 - n / maxPower * 75
  const chargeY = (n: number) => 88 - (capacity > 0 ? Math.min(1, n / capacity) : 0) * 75
  const points = (data: HourResult[], get: (step: HourResult) => number, y: (n: number) => number) => data.map((step, i) => `${x(i)},${y(get(step))}`).join(' ')
  // Power is constant for each hour; transitions occur between hourly sample centres.
  const powerPoints = (data: HourResult[], get: (step: HourResult) => number) => data.flatMap((step, i) => {
    if (i === 0) return [`${x(i)},${powerY(get(step))}`]
    const edge = (x(i - 1) + x(i)) / 2
    return [`${edge},${powerY(get(data[i - 1]))}`, `${edge},${powerY(get(step))}`, `${x(i)},${powerY(get(step))}`]
  }).join(' ')
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ pointer: number; index: number; x: number; y: number; moved: boolean; before: Draft | null } | null>(null)
  const suppressClick = useRef(false)
  const pointIndex = (clientX: number) => {
    const rect = svg.current!.getBoundingClientRect()
    if (steps.length === 1) return 0
    return Math.max(0, Math.min(steps.length - 1, Math.round((((clientX - rect.left) / rect.width * 1000 - 10) / 980) * (steps.length - 1))))
  }
  const pointValue = (clientY: number) => {
    const rect = svg.current!.getBoundingClientRect()
    return Math.round(Math.max(0, Math.min(maxPower, (88 - (clientY - rect.top) / rect.height * 100) / 75 * maxPower)) * 10) / 10
  }
  return <div className={`chart-overlay ${editing ? 'is-editing' : ''}`} aria-label="Graphique horaire interactif">
    <div className="chart-top"><div className="chart-label"><span className="chart-dot"/> JOURNÉE <span className="chart-current">/ {steps[index].hour}</span></div><div className="legend" aria-label="Légende"><span><i className="legend-production"/><b className="legend-long">Production</b><b className="legend-short">Prod.</b> <small>MW</small></span><span><i className="legend-consumption"/><b className="legend-long">Consommation</b><b className="legend-short">Conso.</b> <small>MW</small></span><span title="Réserve en fin d’heure"><i className="legend-battery"/><b className="legend-long">Batterie</b><b className="legend-short">Stock</b> <small>MWh</small></span></div><div className="timeline-controls"><button className="control-icon" aria-label="Heure précédente" title="Heure précédente" onClick={() => onChange(index - 1)} disabled={index <= 0}><ChevronLeft size={15}/></button><button className="play-control" aria-label={playing ? 'Mettre en pause' : 'Lire la journée'} title={playing ? 'Pause' : 'Lire la journée'} onClick={onPlay}>{playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}</button><button className="control-icon" aria-label="Heure suivante" title="Heure suivante" onClick={() => onChange(index + 1)} disabled={index >= steps.length - 1}><ChevronRight size={15}/></button><button className="speed" aria-label={`Vitesse ${fmt(speed)} fois. Changer la vitesse`} onClick={onSpeed}>{fmt(speed)}×</button></div></div>
    <div className="chart-plot" onPointerDown={event => {
      if (!editing || event.button !== 0 || !svg.current) return
      const i = pointIndex(event.clientX)
      onChange(i)
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { pointer: event.pointerId, index: i, x: event.clientX, y: event.clientY, moved: false, before: draft }
    }} onPointerMove={event => {
      const active = drag.current
      if (!active || active.pointer !== event.pointerId) return
      if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 4) return
      active.moved = true
      onEdit(active.index, pointValue(event.clientY))
    }} onPointerUp={event => {
      if (drag.current?.pointer !== event.pointerId) return
      suppressClick.current = drag.current.moved
      if (suppressClick.current) window.setTimeout(() => { suppressClick.current = false }, 0)
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }} onPointerCancel={event => {
      if (drag.current?.pointer !== event.pointerId) return
      onRestore(drag.current.before)
      drag.current = null
      suppressClick.current = false
    }}><span className="scale-power">0–{fmt(maxPower)} MW</span><span className="scale-battery">0–{fmt(capacity)} MWh</span><svg ref={svg} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><line x1="10" x2="990" y1="88" y2="88" className="chart-grid"/><line x1="10" x2="990" y1="50" y2="50" className="chart-grid subtle"/><line x1={x(index)} x2={x(index)} y1="8" y2="91" className="chart-marker"/>{draft && <><polyline points={powerPoints(reference, s => s.productionMW)} className="line-production line-reference"/><polyline points={powerPoints(reference, s => s.consumptionMW)} className="line-consumption line-reference"/><polyline points={points(reference, s => s.batteryEndMWh, chargeY)} className="line-battery line-reference"/></>}<polyline points={powerPoints(steps, s => s.productionMW)} className="line-production"/><polyline points={powerPoints(steps, s => s.consumptionMW)} className="line-consumption"/><polyline points={points(steps, s => s.batteryEndMWh, chargeY)} className="line-battery"/>{draft?.flatMap(edit => (['productionMW', 'consumptionMW'] as Curve[]).filter(key => edit.changes[key] !== undefined).map(key => <circle key={`${edit.index}-${key}`} cx={x(edit.index)} cy={powerY(steps[edit.index][key])} r="3" className={`point-edited ${key === 'productionMW' ? 'point-production' : 'point-consumption'}`}/>))}<circle cx={x(index)} cy={powerY(steps[index].productionMW)} r="4" className="point-production"/><circle cx={x(index)} cy={powerY(steps[index].consumptionMW)} r="4" className="point-consumption"/><circle cx={x(index)} cy={chargeY(steps[index].batteryEndMWh)} r="4" className="point-battery"/></svg><div className="chart-hits" role="group" aria-label={editing ? 'Choisir une heure, puis flèches haut ou bas pour modifier la courbe' : 'Choisir une heure'}>{steps.map((step, i) => <button key={step.hour} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } onChange(i) }} onKeyDown={event => { if (!editing || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return; event.preventDefault(); onChange(i); onEdit(i, Math.max(0, Math.min(maxPower, Math.round((step[curve] + (event.key === 'ArrowUp' ? 1 : -1)) * 10) / 10))) }} aria-pressed={i === index} aria-label={`${step.hour} : production ${fmt(step.productionMW)} MW, consommation ${fmt(step.consumptionMW)} MW, batterie ${fmt(step.batteryEndMWh)} MWh${step.unservedMW > eps ? ', demande non couverte' : ''}${draft?.some(edit => edit.index === i) ? ', heure modifiée' : ''}${editing ? '. Flèches haut et bas pour modifier' : ''}`} title={step.hour}><span>{steps.length <= 8 || i % 4 === 0 || i === steps.length - 1 ? step.hour.slice(0, 2) : ''}</span></button>)}</div></div>
  </div>
}

function App() {
  const [savedDay] = useState(readSavedDay)
  const [rows, setRows] = useState<HourInput[]>([])
  const [originalRows, setOriginalRows] = useState<HourInput[]>([])
  const [fileName, setFileName] = useState('Journée sur l’île')
  const [loadStatus, setLoadStatus] = useState('Chargement…')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadSequence = useRef(0)
  const [battery, setBattery] = useState<BatteryConfig>(initialBattery)
  const [hourIndex, setHourIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState<Site>('production')
  const [panel, setPanel] = useState<Panel>(null)
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [curve, setCurve] = useState<Curve>('productionMW')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches)
  const [validation, setValidation] = useState<{ key: string; state: 'busy' | 'reload' | 'success' | 'error'; message: string } | null>(null)

  const load = async (getFile: () => Promise<File>, name: string) => {
    const seq = ++loadSequence.current
    setLoading(true); setEditing(false); setLoadError(''); setLoadStatus('Chargement…'); setPlaying(false)
    try {
      const file = await getFile()
      const parsed = await importEnergyData(file)
      if (seq !== loadSequence.current) return
      setRows(parsed); setOriginalRows(parsed.map(row => ({ ...row }))); setHourIndex(0); setFileName(name); setLoadStatus(`${parsed.length} heures`)
    } catch (error) {
      if (seq !== loadSequence.current) return
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger les données.'); setLoadStatus('')
    } finally { if (seq === loadSequence.current) setLoading(false) }
  }
  const loadExample = () => load(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}energy-example.csv`)
    if (!response.ok) throw new Error('Impossible de charger la journée d’exemple.')
    return new File([await response.blob()], 'energy-example.csv', { type: 'text/csv' })
  }, 'Journée sur l’île')
  useEffect(() => {
    if (savedDay) {
      setRows(savedDay.rows); setOriginalRows(savedDay.originalRows); setBattery(savedDay.battery); setHourIndex(savedDay.hourIndex); setFileName(savedDay.fileName); setLoadStatus(`${savedDay.rows.length} heures`); setLoading(false)
      try { sessionStorage.removeItem(savedDayKey) } catch { /* session storage may be unavailable */ }
    } else void loadExample()
    return () => { loadSequence.current++ }
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const change = () => setNarrow(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const day = useMemo(() => rows.length ? simulateDay(rows, battery) : null, [rows, battery])
  const trial = useMemo(() => draft && rows.length ? previewWhatIfMany(rows, battery, draft.map(edit => ({ index: edit.index, ...edit.changes }))) : null, [rows, battery, draft])
  const displayedDay = trial?.preview ?? day
  const validationKey = JSON.stringify({ rows, battery })
  const activeValidation = validation?.key === validationKey ? validation : null
  const verifyDay = async () => {
    if (!day) return
    const key = validationKey
    setValidation({ key, state: 'busy', message: 'Vérification…' })
    try {
      const { prepareZ3 } = await import('@/lib/scenario-planner')
      if (await prepareZ3() === 'reload-required') {
        setValidation({ key, state: 'reload', message: 'Rechargez pour activer Z3. La journée sera conservée.' })
        return
      }
      const { verifyDayWithZ3 } = await import('@/lib/day-verifier')
      const ok = await verifyDayWithZ3(day, battery)
      setValidation(ok ? { key, state: 'success', message: 'Bilans de la journée vérifiés par Z3.' } : { key, state: 'error', message: 'Incohérence détectée par Z3.' })
    } catch (error) { setValidation({ key, state: 'error', message: error instanceof Error ? `Vérification indisponible : ${error.message}` : 'Vérification Z3 indisponible.' }) }
  }
  const reloadForZ3 = () => {
    try { sessionStorage.setItem(savedDayKey, JSON.stringify({ rows, originalRows, battery, hourIndex, fileName } satisfies SavedDay)); window.location.reload() }
    catch { setValidation({ key: validationKey, state: 'error', message: 'Impossible de conserver la journée.' }) }
  }
  const step = displayedDay?.steps[Math.min(hourIndex, displayedDay.steps.length - 1)]
  const outcome = step ? consequence(step, battery) : null
  const modified = rows.some((row, i) => row.productionMW !== originalRows[i]?.productionMW || row.consumptionMW !== originalRows[i]?.consumptionMW)
  useEffect(() => {
    if (!playing || !rows.length) return
    const timer = window.setInterval(() => setHourIndex(index => Math.min(index + 1, rows.length - 1)), 1100 / speed)
    return () => window.clearInterval(timer)
  }, [playing, rows.length, speed])
  useEffect(() => { if (playing && rows.length && hourIndex >= rows.length - 1) setPlaying(false) }, [playing, hourIndex, rows.length])
  const selectHour = (next: number) => { setHourIndex(Math.max(0, Math.min(rows.length - 1, next))); setPlaying(false) }
  const updateHour = (key: 'productionMW' | 'consumptionMW', value: number) => setRows(current => current.map((row, i) => i === hourIndex ? { ...row, [key]: value } : row))
  const updateBattery = (key: 'capacityMWh' | 'initialMWh' | 'maxChargeMW' | 'maxDischargeMW', value: number) => setBattery(current => ({ ...current, [key]: value, ...(key === 'capacityMWh' ? { initialMWh: Math.min(current.initialMWh, value) } : {}), ...(key === 'initialMWh' ? { initialMWh: Math.min(current.capacityMWh, value) } : {}) }))
  const selectSite = (site: Site) => { setSelected(site); if (!editing) setPanel(site); setMore(false) }
  const editPoint = (index: number, value: number) => {
    setPanel(null)
    setPlaying(false)
    setDraft(current => {
      const changes = { ...current?.find(edit => edit.index === index)?.changes, [curve]: value }
      if (changes.productionMW === rows[index].productionMW) delete changes.productionMW
      if (changes.consumptionMW === rows[index].consumptionMW) delete changes.consumptionMW
      const others = current?.filter(edit => edit.index !== index) ?? []
      const next = Object.keys(changes).length ? [...others, { index, changes }] : others
      return next.length ? next : null
    })
  }
  const reset = () => { setRows(originalRows.map(row => ({ ...row }))); setBattery(initialBattery); setPlaying(false) }
  const inspector = panel === 'production' || panel === 'consommation' || panel === 'batterie'
  const shortageLabel = (shortage: { hour: string; minutesIntoHour: number } | null) => {
    if (!shortage) return 'aucune'
    const minute = Math.round(shortage.minutesIntoHour)
    const hours = Number(shortage.hour.slice(0, 2)) + Math.floor(minute / 60)
    return `${String(hours).padStart(2, '0')}h${String(minute % 60).padStart(2, '0')}`
  }
  const stepLabel = step ? `${step.hour.slice(0, 2)}h` : '—'
  const siteName: Record<Site, string> = { production: 'Production', consommation: 'Consommation', batterie: 'Batterie' }
  const panelName: Record<Exclude<Panel, null>, string> = { ...siteName, data: 'Données', compare: 'Comparer', help: 'Le modèle' }

  return <div className="app-shell"><header className="topbar"><a href="#accueil" className="brand" aria-label="Île, accueil"><span className="brand-mark">◈</span>île<span className="brand-dot">.</span></a><span className="top-divider"/><span className="top-label">Laboratoire énergétique</span><div className="top-right"><span className="source-name" title={fileName}><span/> {loading ? 'Chargement' : fileName}</span><button className={`top-action ${panel === 'data' ? 'active' : ''}`} onClick={() => setPanel(panel === 'data' ? null : 'data')} disabled={!!draft} aria-label="Données" title="Données"><Database size={16}/><span>Données</span></button><button className={`top-action ${panel === 'compare' ? 'active' : ''}`} onClick={() => setPanel(panel === 'compare' ? null : 'compare')} disabled={!!draft} aria-label="Comparer les journées" title="Comparer les journées"><GitCompareArrows size={16}/><span>Comparer</span></button><button className={`top-action icon-only ${panel === 'help' ? 'active' : ''}`} onClick={() => setPanel(panel === 'help' ? null : 'help')} disabled={!!draft} aria-label="À propos du modèle" title="À propos du modèle"><CircleHelp size={17}/></button></div></header>
    <main id="accueil" className="experience" aria-label="Île énergétique interactive">
      {step && day && displayedDay && outcome ? <>
        <div className="world"><IslandScene productionMW={step.productionMW} consumptionMW={step.consumptionMW} batteryMWh={step.batteryEndMWh} deficitMW={Math.max(0, step.consumptionMW - step.productionMW)} chargeMW={step.chargeMW} dischargeMW={step.dischargeMW} unservedMW={step.unservedMW} selected={selected} onSelect={selectSite} annotationBottomInset={165} annotationRightInset={inspector && !narrow ? 290 : 0}/></div>
        <div className="world-meta"><span><i/> SIMULATION</span><strong>{stepLabel}<small> — {String(Number(step.hour.slice(0, 2)) + 1).padStart(2, '0')}h</small></strong></div>
        <div className="world-values" aria-label="Valeurs à l’heure sélectionnée"><button className={selected === 'production' && panel === 'production' ? 'active' : ''} onClick={() => selectSite('production')}><Wind size={15}/><span>Production</span><strong>{fmt(step.productionMW)}<small> MW</small></strong></button><button className={selected === 'consommation' && panel === 'consommation' ? 'active' : ''} onClick={() => selectSite('consommation')}><Factory size={15}/><span>Consommation</span><strong>{fmt(step.consumptionMW)}<small> MW</small></strong></button><button className={selected === 'batterie' && panel === 'batterie' ? 'active' : ''} onClick={() => selectSite('batterie')}><Battery size={15}/><span>Batterie</span><strong>{fmt(step.batteryEndMWh)}<small> MWh</small></strong></button></div>
        <button className={`outcome ${outcome.danger ? 'danger' : ''}`} onClick={() => setMore(!more)} aria-expanded={more} aria-label={`${outcome.title} : ${outcome.detail}`}><span className="outcome-dot"/><span><strong>{outcome.title} <em>Pourquoi ?</em></strong>{more && <small>Déficit {fmt(Math.max(0, step.consumptionMW - step.productionMW))} MW · réserve {fmt(step.batteryStartMWh)} MWh · décharge max. {fmt(battery.maxDischargeMW)} MW<br/>{outcome.detail}</small>}</span><ChevronDown size={14} className={more ? 'rotate' : ''}/></button>
        <div className={`whatif ${editing ? 'active' : ''}`}>
          {!editing ? <button className="whatif-start" disabled={loading} onClick={() => { setEditing(true); setPanel(null); setPlaying(false) }}>✳ &nbsp;Et si ? <span>Modifier une courbe</span></button> : <>
            <div className="whatif-controls"><span className="whatif-title" title={draft ? `${draft.length} heure${draft.length > 1 ? 's' : ''} modifiée${draft.length > 1 ? 's' : ''}` : undefined}>{draft ? `${draft.length} H` : 'ET SI ?'}</span><div className="curve-switch" aria-label="Courbe à modifier"><button aria-pressed={curve === 'productionMW'} onClick={() => setCurve('productionMW')}>Production</button><button aria-pressed={curve === 'consumptionMW'} onClick={() => setCurve('consumptionMW')}>Conso.</button></div><span className="whatif-hint">{draft ? 'Modifier d’autres points · ↑↓ au clavier' : 'Glisser un point · ↑↓ au clavier'}</span><div className="whatif-actions">{draft ? <><button onClick={() => setDraft(null)}>Annuler</button><button className="apply" onClick={() => { if (trial) setRows(trial.rows); setDraft(null); setEditing(false); setPlaying(false) }}>Appliquer</button></> : <button onClick={() => setEditing(false)} aria-label="Fermer le mode Et si">Fermer</button>}</div></div>
            {trial && <div className="trial-summary" role="status"><span><i/> Réf. <i/> Essai</span><span>Manque : <strong>{fmt(trial.baseline.summary.totalUnservedMWh)} → {fmt(trial.preview.summary.totalUnservedMWh)} MWh</strong></span><span title="Début de la première pénurie">Alerte : <strong>{shortageLabel(trial.comparison.firstShortageBaseline)} → {shortageLabel(trial.comparison.firstShortagePreview)}</strong></span></div>}
          </>}
        </div>
        <IntegratedChart steps={displayedDay.steps} reference={day.steps} index={hourIndex} capacity={battery.capacityMWh} playing={playing} speed={speed} editing={editing} curve={curve} draft={draft} onChange={selectHour} onEdit={editPoint} onRestore={setDraft} onPlay={() => {if (hourIndex >= rows.length - 1) setHourIndex(0); setPlaying(!playing)}} onSpeed={() => setSpeed(speed === 1 ? 2 : speed === 2 ? .5 : 1)}/>
        {inspector && <aside className="inspector-panel" aria-label={`Réglages ${panelName[panel]}`}><div className="panel-top"><div><small>RÉGLAGES · {panel === 'batterie' ? 'JOURNÉE' : stepLabel}</small><h2>{panelName[panel]}</h2></div><button className="close" onClick={() => setPanel(null)} aria-label="Fermer les réglages"><X size={16}/></button></div><div className="panel-fields">{panel === 'production' && <><ValueField label="Puissance" unit="MW" value={step.productionMW} onChange={value => updateHour('productionMW', value)}/><button className="scenario-action" onClick={() => updateHour('productionMW', Math.round(step.productionMW * .5 * 10) / 10)}><CloudOff size={15}/> Baisse de 50 % <ArrowDownRight size={14}/></button></>}{panel === 'consommation' && <><ValueField label="Demande" unit="MW" value={step.consumptionMW} onChange={value => updateHour('consumptionMW', value)}/><button className="scenario-action" onClick={() => updateHour('consumptionMW', Math.min(1000, Math.round((step.consumptionMW + 10) * 10) / 10))}><Zap size={15}/> Pointe de 10 MW <ArrowDownRight size={14}/></button></>}{panel === 'batterie' && <><ValueField label="Capacité" unit="MWh" value={battery.capacityMWh} onChange={value => updateBattery('capacityMWh', value)}/><ValueField label="Réserve initiale" unit="MWh" value={battery.initialMWh} onChange={value => updateBattery('initialMWh', value)} max={battery.capacityMWh}/><ValueField label="Charge max." unit="MW" value={battery.maxChargeMW} onChange={value => updateBattery('maxChargeMW', value)}/><ValueField label="Décharge max." unit="MW" value={battery.maxDischargeMW} onChange={value => updateBattery('maxDischargeMW', value)}/><small className="efficiency">Rendements de charge et décharge : 95 %</small></>}</div><button className="reset-action" disabled={!modified && JSON.stringify(battery) === JSON.stringify(initialBattery)} onClick={reset}><RotateCcw size={13}/> Rétablir les valeurs</button></aside>}
        {panel === 'compare' && <div className="dialog-backdrop" onClick={() => setPanel(null)}><div className="dialog-panel compare-dialog" role="dialog" aria-modal="true" aria-label="Comparer les journées" onClick={e => e.stopPropagation()}><button className="dialog-close" onClick={() => setPanel(null)} aria-label="Fermer"><X size={16}/></button><ScenarioCompare rows={rows} battery={battery} day={day} onApply={(referenceRows, referenceBattery) => {setRows(referenceRows); setBattery(referenceBattery); setHourIndex(0); setPlaying(false); setPanel(null)}}/></div></div>}
      </> : <div className="loading-state" role="status"><span className="loader"/>{loading ? loadStatus : 'Aucune donnée chargée'}</div>}
      {loadError && <div className="error-toast" role="alert">{loadError}<button onClick={() => setLoadError('')} aria-label="Fermer"><X size={14}/></button></div>}
      {panel === 'data' && <aside className="utility-panel" aria-label="Données"><div className="panel-top"><div><small>JOURNÉE</small><h2>Données</h2></div><button className="close" onClick={() => setPanel(null)} aria-label="Fermer"><X size={16}/></button></div><div className="source-card"><Database size={16}/><span><strong>{fileName}</strong><small>{loadStatus}</small></span></div><button className="utility-action" onClick={() => {void loadExample(); setPanel(null)}} disabled={loading}><RotateCcw size={15}/> Recharger l’exemple</button><label className={`utility-action ${loading ? 'disabled' : ''}`}><Upload size={15}/> Importer un CSV<input type="file" accept=".csv,text/csv" disabled={loading} onChange={event => {const f = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (f) {void load(async () => f, f.name); setPanel(null)}}}/></label><small className="utility-note">CSV horaire · heure, production_mw, consommation_mw<br/>Les données restent sur cet appareil.</small></aside>}
      {panel === 'help' && <aside className="utility-panel" aria-label="À propos du modèle"><div className="panel-top"><div><small>SIMULATION</small><h2>Le modèle</h2></div><button className="close" onClick={() => setPanel(null)} aria-label="Fermer"><X size={16}/></button></div><div className="help-lines"><p>1 pas = 1 heure · MW = puissance · MWh = énergie.</p><p>Les données sont fictives. Les flux 3D sont schématiques.</p><p>Charge et décharge : rendement de 95 %. Sans import électrique extérieur.</p></div><button className="utility-action" onClick={() => void verifyDay()} disabled={!day || activeValidation?.state === 'busy'}><BatteryCharging size={15}/> {activeValidation?.state === 'busy' ? 'Vérification…' : 'Vérifier les bilans avec Z3'}</button>{activeValidation?.state === 'reload' && <button className="utility-action" onClick={reloadForZ3}>Recharger et conserver la journée</button>}<small role="status" className="utility-note">{activeValidation?.message ?? 'Z3 vérifie le modèle, pas une prévision réelle. Chargement facultatif : environ 9 Mo.'}</small></aside>}
    </main></div>
}
export default App
