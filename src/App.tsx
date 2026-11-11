import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Battery, BatteryCharging, Check, CircleHelp, CloudOff, Factory, Pause, Play, RotateCcw, SlidersHorizontal, Upload, Wind, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IslandScene from '@/components/IslandScene'
import ScenarioCompare from '@/components/ScenarioCompare'
import { importEnergyData } from '@/lib/import-energy-data'
import { simulateDay, type BatteryConfig, type HourInput, type HourResult } from '@/lib/timeline'

type Site = 'production' | 'consommation' | 'batterie'
const initialBattery: BatteryConfig = { capacityMWh: 120, initialMWh: 100, maxChargeMW: 20, maxDischargeMW: 20, chargeEfficiency: .95, dischargeEfficiency: .95 }
type SavedDay = { rows: HourInput[]; originalRows: HourInput[]; battery: BatteryConfig; hourIndex: number; fileName: string }
const savedDayKey = 'ile-day-z3-reload-v1'
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
const fmt = (n: number, max = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: max }).format(Math.abs(n) < 1e-8 ? 0 : n)
const epsilon = 1e-7

function explanation(s: HourResult, battery: BatteryConfig): { title: string; description: string } {
  const deficit = s.consumptionMW - s.productionMW
  if (s.unservedMW > epsilon) {
    const when = s.shortageStartsAfterMinutes === null ? '' : s.shortageStartsAfterMinutes <= epsilon ? ' dès le début de cette heure' : ` après environ ${fmt(s.shortageStartsAfterMinutes, 0)} min`
    const causes: string[] = []
    if (deficit > battery.maxDischargeMW + epsilon) causes.push(`sa puissance maximale de décharge (${fmt(battery.maxDischargeMW)} MW) est inférieure au déficit`)
    if (s.batteryEndMWh <= epsilon) causes.push(s.batteryStartMWh <= epsilon ? 'sa réserve est déjà vide au début de l’heure' : 'sa réserve s’épuise pendant cette heure')
    return { title: `La demande n’est pas entièrement couverte${when}.`, description: `Le déficit est de ${fmt(deficit)} MW ; ${fmt(s.unservedMW)} MWh restent non servis pendant l’heure. ${causes.length ? `Pour la batterie, ${causes.join(' et ')}. ` : ''}Elle fournit ${fmt(s.dischargeMW)} MWh au réseau et sa réserve passe de ${fmt(s.batteryStartMWh)} à ${fmt(s.batteryEndMWh)} MWh.` }
  }
  if (deficit > epsilon) return { title: 'La batterie complète la production.', description: `La demande dépasse la production de ${fmt(deficit)} MW. La batterie livre ${fmt(s.dischargeMW)} MWh sur l’heure ; sa réserve passe de ${fmt(s.batteryStartMWh)} à ${fmt(s.batteryEndMWh)} MWh.` }
  if (s.chargeMW > epsilon) return { title: 'Le surplus recharge la batterie.', description: `La production dépasse la demande de ${fmt(-deficit)} MW. La batterie absorbe ${fmt(s.chargeMW)} MWh sur l’heure et termine à ${fmt(s.batteryEndMWh)} MWh${s.curtailedMW > epsilon ? ` ; ${fmt(s.curtailedMW)} MWh de surplus ne sont pas stockés` : ''}.` }
  if (s.curtailedMW > epsilon) return { title: 'Une partie du surplus n’est pas utilisée.', description: `La production dépasse la demande de ${fmt(-deficit)} MW. La batterie ne peut pas absorber davantage : ${fmt(s.curtailedMW)} MWh ne sont pas stockés pendant cette heure.` }
  return { title: 'La production couvre la demande.', description: `À cette heure, l’île utilise ${fmt(s.consumptionMW)} MWh et la batterie reste à ${fmt(s.batteryEndMWh)} MWh.` }
}

function ValueField({ label, unit, value, onChange, max = 1000 }: { label: string; unit: string; value: number; onChange: (value: number) => void; max?: number }) {
  return <label className="value-field"><span>{label}</span><span className="value-input"><input type="number" min="0" max={max} step="1" value={value} onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(0, n))) }} /><small>{unit}</small></span></label>
}

function HourChart({ steps, index, capacity, onChange }: { steps: HourResult[]; index: number; capacity: number; onChange: (index: number) => void }) {
  const maxPower = Math.max(1, ...steps.flatMap(s => [s.productionMW, s.consumptionMW]))
  const reserveY = (energy: number) => 55 - (capacity > 0 ? Math.min(1, energy / capacity) : 0) * 48
  const reserveX = (i: number) => steps.length === 1 ? 500 : 10 + 980 * i / (steps.length - 1)
  const points = steps.map((s, i) => `${reserveX(i)},${reserveY(s.batteryEndMWh)}`).join(' ')
  return <div className="chart-shell"><div className="chart-head"><div><span className="eyebrow">LES DONNÉES DANS LE TEMPS</span><h3>La journée en un regard</h3></div><div className="chart-legend"><span><i className="legend-prod"/>Production</span><span><i className="legend-demand"/>Consommation</span></div></div>
    <div className="hour-chart" role="group" aria-label="Choisir une heure de la journée">{steps.map((s, i) => <button key={`${s.hour}-${i}`} type="button" onClick={() => onChange(i)} className={`hour-column ${i === index ? 'is-current' : ''}`} aria-label={`${s.hour} : production ${fmt(s.productionMW)} MW, consommation ${fmt(s.consumptionMW)} MW, batterie en fin d’heure ${fmt(s.batteryEndMWh)} MWh${s.unservedMW > epsilon ? ', énergie non servie' : ''}`} aria-pressed={i === index}><span className="hour-bars"><i className="bar production" style={{ height: `${Math.max(2, s.productionMW / maxPower * 100)}%` }}/><i className="bar demand" style={{ height: `${Math.max(2, s.consumptionMW / maxPower * 100)}%` }}/></span><span className="hour-tick">{steps.length <= 12 || i % 3 === 0 || i === steps.length - 1 ? s.hour.slice(0, 2) : ''}</span></button>)}</div><p className="chart-caption">Une paire de barres = une heure. Sélectionnez une heure pour en observer les conséquences.</p>
    <div className="reserve-chart"><div><span>Réserve de la batterie</span><strong>{fmt(steps[index].batteryEndMWh)} <small>MWh</small></strong></div><svg viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true"><line x1="10" y1="55" x2="990" y2="55" stroke="#e2e9e3" strokeWidth="1" vectorEffect="non-scaling-stroke"/><polyline points={points} fill="none" stroke="#589872" strokeWidth="2" vectorEffect="non-scaling-stroke"/><circle cx={reserveX(index)} cy={reserveY(steps[index].batteryEndMWh)} r="4" fill="#2c7750" vectorEffect="non-scaling-stroke"/></svg><div className="reserve-range"><span>0 MWh</span><span>{fmt(capacity)} MWh de capacité</span></div></div></div>
}

function App() {
  const [savedDay] = useState(readSavedDay)
  const [rows, setRows] = useState<HourInput[]>([])
  const [originalRows, setOriginalRows] = useState<HourInput[]>([])
  const [fileName, setFileName] = useState('Journée sur l’île')
  const [loadStatus, setLoadStatus] = useState('Chargement de la journée…')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadSequence = useRef(0)
  const [battery, setBattery] = useState<BatteryConfig>(initialBattery)
  const [hourIndex, setHourIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState<Site>('production')
  const [showModel, setShowModel] = useState(false)
  const [validation, setValidation] = useState<{key: string; state: 'busy' | 'reload' | 'success' | 'error'; message: string} | null>(null)

  const load = async (getFile: () => Promise<File>, name: string) => {
    const seq = ++loadSequence.current
    setLoading(true); setLoadError(''); setLoadStatus('Lecture de la journée dans votre navigateur…'); setPlaying(false)
    try {
      const file = await getFile()
      const parsed = await importEnergyData(file)
      if (seq !== loadSequence.current) return
      setRows(parsed); setOriginalRows(parsed.map(row => ({ ...row }))); setHourIndex(0); setFileName(name); setLoadStatus(`${parsed.length} heures chargées`)
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
      setRows(savedDay.rows); setOriginalRows(savedDay.originalRows); setBattery(savedDay.battery); setHourIndex(savedDay.hourIndex); setFileName(savedDay.fileName); setLoadStatus(`${savedDay.rows.length} heures restaurées`); setLoading(false)
      try { sessionStorage.removeItem(savedDayKey) } catch { /* session storage may be unavailable */ }
    } else void loadExample()
    return () => { loadSequence.current++ }
  }, [])

  const day = useMemo(() => rows.length ? simulateDay(rows, battery) : null, [rows, battery])
  const validationKey = JSON.stringify({ rows, battery })
  const activeValidation = validation?.key === validationKey ? validation : null
  const verifyDay = async () => {
    if (!day) return
    const key = validationKey
    setValidation({ key, state: 'busy', message: 'Chargement de Z3 et vérification des bilans horaires…' })
    try {
      const { prepareZ3 } = await import('@/lib/scenario-planner')
      if (await prepareZ3() === 'reload-required') {
        setValidation({ key, state: 'reload', message: 'Z3 nécessite un rechargement pour être activé. La journée et ses réglages seront conservés ; relancez ensuite la vérification.' })
        return
      }
      const { verifyDayWithZ3 } = await import('@/lib/day-verifier')
      const ok = await verifyDayWithZ3(day, battery)
      setValidation(ok ? { key, state: 'success', message: 'Bilans et contraintes de la journée vérifiés par Z3 pour ce modèle.' } : { key, state: 'error', message: 'Z3 a détecté une incohérence dans les bilans de la journée.' })
    } catch (error) {
      setValidation({ key, state: 'error', message: error instanceof Error ? `Vérification indisponible : ${error.message}` : 'Vérification Z3 indisponible.' })
    }
  }
  const reloadForZ3 = () => {
    try {
      sessionStorage.setItem(savedDayKey, JSON.stringify({ rows, originalRows, battery, hourIndex, fileName } satisfies SavedDay))
      window.location.reload()
    } catch { setValidation({ key: validationKey, state: 'error', message: 'Impossible de conserver la journée pour le rechargement.' }) }
  }
  const step = day?.steps[Math.min(hourIndex, day.steps.length - 1)]
  const insight = step ? explanation(step, battery) : null
  const hourNumber = step ? Number(step.hour.slice(0, 2)) : 0
  const hourLabel = step ? `${step.hour.slice(0, 2)}:00 — ${String(hourNumber + 1).padStart(2, '0')}:00` : '—'
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
  const editTitles: Record<Site, { title: string; text: string; icon: typeof Wind }> = {
    production: { title: 'Production', text: 'Modifiez la production pour cette heure uniquement.', icon: Wind },
    consommation: { title: 'Consommation', text: 'Modifiez la demande pour cette heure uniquement.', icon: Factory },
    batterie: { title: 'Batterie', text: 'Ces réglages s’appliquent à toute la journée.', icon: BatteryCharging },
  }
  const site = editTitles[selected], SiteIcon = site.icon
  return <div className="app"><header className="topbar"><a href="#accueil" className="brand" aria-label="Île, accueil"><span className="brand-mark">◈</span> île<span className="brand-dot">.</span></a><span className="top-divider"/><span className="top-label">Laboratoire énergétique</span><div className="top-right"><span className="top-version">UNE JOURNÉE À EXPLORER</span><a href="https://github.com/nicolashedoire/ile-des-possibles" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14}/></a></div></header>
    <main id="accueil" className="main-content"><div className="breadcrumbs">LABORATOIRE <span>/</span> ÉNERGIE <span>/</span> <strong>SIMULATION</strong></div><div className="page-heading"><div><span className="eyebrow"><i/> UNE ÎLE, UNE JOURNÉE</span><h1>Chaque choix change <span>l’équilibre.</span></h1><p>Faites défiler la journée, explorez l’île et observez les conséquences.</p></div><div className="data-source"><span>SOURCE DES DONNÉES</span><strong><i/> {fileName}</strong></div></div>
      {loadError && <div className="load-error" role="alert">{loadError} {rows.length ? 'Les données précédentes restent disponibles.' : ''}</div>}
      {loading && !step ? <div className="loading-panel" role="status">{loadStatus}</div> : step && day && insight ? <>
      <section className="workspace" aria-label="Exploration de l'île énergétique"><div className="scene-column"><div className="panel-header"><div><span className="eyebrow">VUE D’ENSEMBLE</span><h2>L’île à l’heure sélectionnée</h2></div><div className="hour-chip"><span/> {hourLabel}</div></div>
        <div className="scene-wrap"><div className="scene-meta"><span>● &nbsp; MODÈLE PÉDAGOGIQUE</span><span>EXPLORATION 3D</span></div><div className="scene-canvas"><IslandScene productionMW={step.productionMW} consumptionMW={step.consumptionMW} batteryMWh={step.batteryEndMWh} deficitMW={Math.max(0, step.consumptionMW - step.productionMW)} chargeMW={step.chargeMW} dischargeMW={step.dischargeMW} unservedMW={step.unservedMW} selected={selected} onSelect={setSelected}/></div><div className="scene-hint">Faites glisser pour explorer · sélectionnez une installation</div></div>
        <div className="site-tabs" role="group" aria-label="Explorer une installation"><button className={selected === 'production' ? 'active' : ''} onClick={() => setSelected('production')} aria-pressed={selected === 'production'}><Wind size={16}/><span>Production</span><strong>{fmt(step.productionMW)} <small>MW</small></strong></button><button className={selected === 'consommation' ? 'active' : ''} onClick={() => setSelected('consommation')} aria-pressed={selected === 'consommation'}><Factory size={16}/><span>Consommation</span><strong>{fmt(step.consumptionMW)} <small>MW</small></strong></button><button className={selected === 'batterie' ? 'active' : ''} onClick={() => setSelected('batterie')} aria-pressed={selected === 'batterie'}><Battery size={16}/><span>Batterie</span><strong>{fmt(step.batteryEndMWh)} <small>MWh</small></strong></button></div>
      </div><aside className="inspector"><div className="inspector-head"><div><span className="eyebrow">ÉLÉMENT SÉLECTIONNÉ</span><h2><SiteIcon size={19}/> {site.title}</h2></div><SlidersHorizontal size={17}/></div><p className="inspector-copy">{site.text}</p>
        <div className="inspector-fields">{selected === 'production' && <><ValueField label={`Production à ${step.hour}`} unit="MW" value={step.productionMW} onChange={value => updateHour('productionMW', value)}/><button className="incident" onClick={() => updateHour('productionMW', Math.round(step.productionMW * .5 * 10) / 10)}><CloudOff size={15}/><span>Simuler une baisse de 50 %</span><ArrowDownRight size={14}/></button><p className="field-note">La production est une valeur globale pour cette heure, pas une mesure par éolienne.</p></>}
        {selected === 'consommation' && <><ValueField label={`Demande à ${step.hour}`} unit="MW" value={step.consumptionMW} onChange={value => updateHour('consumptionMW', value)}/><button className="incident" onClick={() => updateHour('consumptionMW', Math.min(1000, Math.round((step.consumptionMW + 10) * 10) / 10))}><Zap size={15}/><span>Ajouter une pointe de 10 MW</span><ArrowDownRight size={14}/></button><p className="field-note">Cette modification concerne uniquement l’heure sélectionnée.</p></>}
        {selected === 'batterie' && <><ValueField label="Capacité" unit="MWh" value={battery.capacityMWh} onChange={value => updateBattery('capacityMWh', value)}/><ValueField label="Réserve initiale" unit="MWh" value={battery.initialMWh} onChange={value => updateBattery('initialMWh', value)} max={battery.capacityMWh}/><ValueField label="Charge max." unit="MW" value={battery.maxChargeMW} onChange={value => updateBattery('maxChargeMW', value)}/><ValueField label="Décharge max." unit="MW" value={battery.maxDischargeMW} onChange={value => updateBattery('maxDischargeMW', value)}/><p className="field-note">Rendements de charge et décharge : 95 % chacun. Les changements recalculent toute la journée.</p></>}
        </div><div className="inspector-bottom"><span className="eyebrow">SCÉNARIO</span><button disabled={!modified && JSON.stringify(battery) === JSON.stringify(initialBattery)} onClick={() => {setRows(originalRows.map(row => ({...row}))); setBattery(initialBattery); setPlaying(false)}}><RotateCcw size={14}/> Rétablir les valeurs</button></div></aside></section>
      <section className="timeline-panel" aria-label="Lecture de la journée"><div className="timeline-heading"><div><span className="eyebrow">LE TEMPS EN MOUVEMENT</span><h2>Parcourir la journée</h2><p>Chaque étape représente une heure complète.</p></div><div className="play-controls"><Button variant="outline" size="icon" aria-label="Heure précédente" onClick={() => selectHour(hourIndex - 1)} disabled={hourIndex === 0}><ArrowLeft size={16}/></Button><Button className="play-button" onClick={() => { if (hourIndex >= rows.length - 1) setHourIndex(0); setPlaying(!playing) }}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause' : 'Lire la journée'}</Button><Button variant="outline" size="icon" aria-label="Heure suivante" onClick={() => selectHour(hourIndex + 1)} disabled={hourIndex === rows.length - 1}><ArrowRight size={16}/></Button><label className="speed-control">Vitesse <select value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="Vitesse de lecture"><option value={.5}>0,5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div></div>
        <HourChart steps={day.steps} index={hourIndex} capacity={battery.capacityMWh} onChange={selectHour}/></section>
      <section className="consequence" aria-label="Conséquences à l’heure sélectionnée"><div className="consequence-heading"><div><span className="eyebrow">À CETTE HEURE</span><h2>Que se passe-t-il ?</h2></div><span className={`state-pill ${step.unservedMW > epsilon ? 'shortage' : ''}`}><i/>{step.unservedMW > epsilon ? 'Demande non couverte' : 'Demande couverte'}</span></div>
        <div className="metrics"><div className="metric"><span>Production</span><strong>{fmt(step.productionMW)} <small>MW</small></strong><p>Puissance disponible</p></div><div className="metric"><span>Consommation</span><strong>{fmt(step.consumptionMW)} <small>MW</small></strong><p>Puissance demandée</p></div><div className="metric"><span>Batterie en fin d’heure</span><strong>{fmt(step.batteryEndMWh)} <small>MWh</small></strong><p>Sur {fmt(battery.capacityMWh)} MWh de capacité</p><div className="battery-bar"><i style={{ width: `${battery.capacityMWh ? Math.min(100, step.batteryEndMWh / battery.capacityMWh * 100) : 0}%` }}/></div></div><div className="metric"><span>Énergie non servie</span><strong className={step.unservedMW > epsilon ? 'orange' : ''}>{fmt(step.unservedMW)} <small>MWh</small></strong><p>Sur cette heure</p></div></div>
        <div className={`explanation ${step.unservedMW > epsilon ? 'alert' : ''}`}><span className="explanation-icon">{step.unservedMW > epsilon ? '!' : <Check size={15}/>}</span><div><span className="eyebrow">COMPRENDRE L’EFFET</span><h3>{insight.title}</h3><p>{insight.description}</p></div></div>
        <div className="day-summary"><span><strong>{day.summary.hoursWithShortage} créneaux</strong> touchés par une pénurie</span><span><strong>{fmt(day.summary.totalUnservedMWh)} MWh</strong> non servis au total</span><span><strong>{fmt(day.summary.finalBatteryMWh)} MWh</strong> en fin de journée</span></div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={() => void verifyDay()} disabled={activeValidation?.state === 'busy'}>{activeValidation?.state === 'busy' ? 'Vérification…' : 'Vérifier les bilans avec Z3'}</Button>{activeValidation?.state === 'reload' && <Button variant="outline" size="sm" onClick={reloadForZ3}>Recharger et conserver la journée</Button>}<p role="status" className="text-xs leading-5 text-zinc-600">{activeValidation?.message ?? 'Facultatif · vérifie les contraintes du modèle, sans prévoir la réalité · premier chargement : environ 9 Mo.'}</p></div></section>
      <ScenarioCompare rows={rows} battery={battery} day={day} onApply={(referenceRows, referenceBattery) => { setRows(referenceRows); setBattery(referenceBattery); setHourIndex(0); setPlaying(false) }}/>
      </> : <div className="loading-panel">Aucune donnée n’est disponible. Importez un fichier ou rechargez l’exemple.</div>}
      <section className="data-import"><div><span className="eyebrow">DONNÉES LOCALES</span><h2>Changer de journée</h2><p>L’exemple est déjà chargé. Votre CSV reste dans votre navigateur.</p><small>1 à 24 heures consécutives · colonnes <code>heure</code>, <code>production_mw</code>, <code>consommation_mw</code> · heure au format HH:00.</small></div><div className="import-actions"><Button variant="outline" size="sm" onClick={() => void loadExample()} disabled={loading}><RotateCcw size={14}/> Recharger l’exemple</Button><label className={`import-button ${loading ? 'disabled' : ''}`}><Upload size={14}/>{loading ? 'Chargement…' : 'Importer un CSV'}<input type="file" accept=".csv,text/csv" disabled={loading} onChange={e => {const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void load(async () => f, f.name)}}/></label>{loadStatus && <span role="status">{loadStatus}</span>}</div></section>
      <section className="model-section"><button onClick={() => setShowModel(!showModel)} aria-expanded={showModel}><span className="model-icon"><CircleHelp size={16}/></span><span><strong>Comment fonctionne cette simulation ?</strong><small>Hypothèses, unités et limites du modèle</small></span><span className="model-expand">{showModel ? '−' : '+'}</span></button>{showModel && <div className="model-body"><p>Chaque ligne représente une heure à puissance constante. La production et la consommation sont exprimées en MW ; l’énergie de la batterie est en MWh. Le modèle calcule le stockage, les pertes, le surplus non stocké et l’énergie non servie, en respectant les limites de charge et de décharge.</p><p>Les données et installations sont fictives. Il s’agit d’un modèle pédagogique : il ne simule pas les flux électriques détaillés, les prévisions météorologiques ni les contraintes d’un réseau réel. La puissance des flux de la scène est schématique.</p><p>Le fichier d’exemple est toujours déficitaire : modifiez une heure pour créer un surplus et observer la recharge.</p></div>}</section>
      <footer><span>◈ &nbsp; ÎLE &nbsp; / &nbsp; UN MONDE À COMPRENDRE</span><span>MODÈLE PÉDAGOGIQUE · DONNÉES FICTIVES</span></footer></main></div>
}
export default App
