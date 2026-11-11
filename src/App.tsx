import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BatteryCharging, CircleHelp, Factory, Gauge, Minus, Plus, RotateCcw, Upload, Wind, Zap } from 'lucide-react'
import { layoutNextLine, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { calculateEnergy, type EnergyInputs } from '@/lib/energy'
import IslandScene from '@/components/IslandScene'
import ScenarioCompare from '@/components/ScenarioCompare'
import type { ScenarioPlan } from '@/lib/scenario-planner'

type Scenario = EnergyInputs
type ElementId = 'production' | 'consommation' | 'batterie'
const initialScenario: Scenario = { productionMW: 30, consumptionMW: 40, batteryMWh: 10, batteryPowerMW: 20 }
const restoreScenario = (): Scenario => {
  try {
    const raw = sessionStorage.getItem('ile-z3-scenario')
    if (!raw) return initialScenario
    sessionStorage.removeItem('ile-z3-scenario')
    const saved = JSON.parse(raw) as Scenario
    if (['productionMW', 'consumptionMW', 'batteryMWh', 'batteryPowerMW'].every(key => typeof saved[key as keyof Scenario] === 'number' && Number.isFinite(saved[key as keyof Scenario]) && saved[key as keyof Scenario] >= 0 && saved[key as keyof Scenario] <= 100)) return saved
  } catch { /* Restore the default scenario when session storage is unavailable. */ }
  return initialScenario
}
const format = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
const duration = (hours: number | null) => {
  if (hours === null) return '—'
  const seconds = Math.round(hours * 3600)
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60
  if (h > 0) return `${h} h${m ? ` ${m} min` : ''}${s ? ` ${s} s` : ''}`
  return `${m} min${s ? ` ${s} s` : ''}`
}

function Control({ label, description, value, unit, onChange }: { label: string; description: string; value: number; unit: string; onChange: (value: number) => void }) {
  return <div className="control">
    <div className="control-top"><div><div className="control-name">{label}</div><div className="control-description">{description}</div></div><div className="control-value">{format(value)} <span>{unit}</span></div></div>
    <div className="control-input"><button type="button" className="stepper" aria-label={`Réduire ${label}`} onClick={() => onChange(Math.max(0, value - 1))}><Minus size={13} /></button><Slider aria-label={label} value={[value]} min={0} max={100} step={1} onValueChange={([next]) => onChange(next)} /><button type="button" className="stepper" aria-label={`Augmenter ${label}`} onClick={() => onChange(Math.min(100, value + 1))}><Plus size={13} /></button></div>
  </div>
}

function FlowText({ text }: { text: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    let active = true
    const update = () => {
      if (!container.current || !active) return
      const width = container.current.clientWidth
      if (width < 50) return
      try {
        const prepared = prepareWithSegments(text, '14px Arial')
        let cursor: LayoutCursor | undefined
        const next: string[] = []
        let complete = false
        for (let i = 0; i < 100; i++) {
          const line = layoutNextLine(prepared, width, cursor)
          if (!line) { complete = true; break }
          next.push(line.text)
          cursor = line.end
        }
        setLines(complete ? next : [])
      } catch { setLines([]) }
    }
    const observer = new ResizeObserver(update)
    if (container.current) observer.observe(container.current)
    void document.fonts.ready.then(update)
    update()
    return () => { active = false; observer.disconnect() }
  }, [text])
  return <div ref={container} className="explanation-text" aria-label={text}>{lines.length ? <div aria-hidden="true">{lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)}</div> : <span aria-hidden="true">{text}</span>}</div>
}

const mapDetails: Record<ElementId, { title: string; description: string; icon: typeof Wind }> = {
  production: { title: 'Production', description: 'L’énergie produite alimente directement le réseau de l’île.', icon: Wind },
  consommation: { title: 'Consommation', description: 'Les habitations et les activités utilisent l’énergie disponible.', icon: Factory },
  batterie: { title: 'Batterie', description: 'La batterie peut compenser un déficit, selon son énergie et sa puissance disponibles.', icon: BatteryCharging },
}

function SystemMap({ scenario, selected, setSelected }: { scenario: Scenario; selected: ElementId; setSelected: (value: ElementId) => void }) {
  return <div className="system-map">
    <div className="map-meta"><span><span className="map-live-dot" /> MODÈLE ACTIF</span><span>01 / SYSTÈME ÉNERGÉTIQUE</span></div>
    <div className="scene-canvas"><IslandScene productionMW={scenario.productionMW} consumptionMW={scenario.consumptionMW} batteryMWh={scenario.batteryMWh} deficitMW={Math.max(0, scenario.consumptionMW - scenario.productionMW)} /></div>
    <div className="map-footer"><span>VUE 3D · FLUX SCHÉMATIQUES</span><span>Glissez pour explorer</span></div>
    <div className="map-selection" aria-label="Explorer les éléments du système">
      <button className={`map-selector ${selected === 'production' ? 'selected' : ''}`} onClick={() => setSelected('production')} aria-pressed={selected === 'production'}><Wind size={16}/><span>Production</span><strong>{format(scenario.productionMW)} <small>MW</small></strong></button>
      <button className={`map-selector ${selected === 'consommation' ? 'selected' : ''}`} onClick={() => setSelected('consommation')} aria-pressed={selected === 'consommation'}><Factory size={16}/><span>Consommation</span><strong>{format(scenario.consumptionMW)} <small>MW</small></strong></button>
      <button className={`map-selector ${selected === 'batterie' ? 'selected' : ''}`} onClick={() => setSelected('batterie')} aria-pressed={selected === 'batterie'}><BatteryCharging size={16}/><span>Batterie</span><strong>{format(scenario.batteryMWh)} <small>MWh</small></strong></button>
    </div>
  </div>
}

function App() {
  const [scenario, setScenario] = useState(restoreScenario)
  const [importState, setImportState] = useState<{busy: boolean; message: string; error: boolean}>({busy: false, message: '', error: false})
  const importFile = async (file: File) => {
    setImportState({busy: true, message: 'Analyse locale du fichier…', error: false})
    try {
      const { importEnergyData } = await import('@/lib/import-energy-data')
      const data = await importEnergyData(file)
      setScenario(current => ({ ...current, productionMW: data.productionMW, consumptionMW: data.consumptionMW }))
      setImportState({busy: false, message: `${data.rows} ligne${data.rows > 1 ? 's' : ''} analysée${data.rows > 1 ? 's' : ''} ; moyennes appliquées.`, error: false})
    } catch (error) {
      setImportState({busy: false, message: error instanceof Error ? error.message : 'Import impossible.', error: true})
    }
  }
  const [selected, setSelected] = useState<ElementId>('production')
  const [assumptions, setAssumptions] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [planningResult, setPlanningResult] = useState<{ key: string; plans: ScenarioPlan[] } | null>(null)
  const [planningError, setPlanningError] = useState<{ key: string; message: string } | null>(null)
  const [z3State, setZ3State] = useState<{ key: string; status: 'busy' | 'reload' | 'verified' | 'failed'; message: string } | null>(null)
  const scenarioKey = JSON.stringify(scenario)
  const calculatePlans = async () => {
    const key = scenarioKey
    setPlanning(true)
    setPlanningError(null)
    try {
      const { planScenarios } = await import('@/lib/scenario-planner')
      setPlanningResult({ key, plans: planScenarios(scenario, 1) })
    } catch {
      setPlanningError({ key, message: 'Impossible de calculer les options. Veuillez réessayer.' })
    } finally { setPlanning(false) }
  }
  const currentPlans = planningResult?.key === scenarioKey ? planningResult.plans : null
  const currentPlanError = planningError?.key === scenarioKey ? planningError.message : null
  const currentZ3 = z3State?.key === scenarioKey ? z3State : null
  const verifyPlans = async () => {
    if (!currentPlans?.length) return
    const key = scenarioKey
    setZ3State({ key, status: 'busy', message: 'Chargement du solveur et vérification des contraintes…' })
    try {
      const { prepareZ3, verifyWithZ3 } = await import('@/lib/scenario-planner')
      if (await prepareZ3() === 'reload-required') {
        setZ3State({ key, status: 'reload', message: 'Pour activer Z3, la page doit être rechargée. Votre scénario sera conservé ; recalculez ensuite les options et lancez la vérification.' })
        return
      }
      const checked = await verifyWithZ3(currentPlans, 1)
      setZ3State(checked.every(Boolean) ? { key, status: 'verified', message: `${checked.length} option${checked.length > 1 ? 's' : ''} vérifiée${checked.length > 1 ? 's' : ''} par Z3 : les contraintes du modèle sont satisfaites.` } : { key, status: 'failed', message: 'Au moins une option ne satisfait pas les contraintes Z3. Ne l’appliquez pas sans la revoir.' })
    } catch (error) {
      setZ3State({ key, status: 'failed', message: error instanceof Error ? `Vérification Z3 indisponible : ${error.message}` : 'Vérification Z3 indisponible dans ce navigateur.' })
    }
  }
  const reloadForZ3 = () => {
    try { sessionStorage.setItem('ile-z3-scenario', JSON.stringify(scenario)); window.location.reload() }
    catch { setZ3State({ key: scenarioKey, status: 'failed', message: 'Impossible de conserver le scénario pour le rechargement. La vérification Z3 est indisponible.' }) }
  }
  const result = calculateEnergy(scenario)
  const update = (key: keyof Scenario) => (value: number) => setScenario(current => ({ ...current, [key]: value }))
  const { deficitMW, surplusMW, autonomyHours, batteryCanCoverDeficit } = result
  const isDeficit = deficitMW > 0
  const explanation = !isDeficit ? `La production couvre la demande${surplusMW > 0 ? `, avec un surplus de ${format(surplusMW)} MW` : ''}. La batterie n’est pas sollicitée dans ce modèle.` : !batteryCanCoverDeficit ? `La demande dépasse la production de ${format(deficitMW)} MW. La puissance maximale de la batterie ne suffit pas à couvrir cet écart.` : `La demande dépasse la production de ${format(deficitMW)} MW. La batterie peut compenser cet écart pendant ${duration(autonomyHours)}, dans les conditions actuelles.`
  const selectedInfo = mapDetails[selected]
  const SelectedIcon = selectedInfo.icon
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#accueil" aria-label="Île, accueil"><span className="brand-mark"><span /></span><span>île</span><span className="brand-dot">.</span></a><div className="top-divider"/><span className="top-label">Laboratoire interactif</span><div className="top-right"><span className="top-version">UN PROTOTYPE OUVERT</span><a href="https://github.com/nicolashedoire/ile-des-possibles" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13}/></a></div></header>
    <main id="accueil" className="main-content">
      <div className="breadcrumbs"><span>LABORATOIRE</span><span className="breadcrumb-separator">/</span><span>ÉNERGIE</span><span className="breadcrumb-separator">/</span><span className="crumb-active">EXPLORATION 01</span></div>
      <div className="page-heading"><div><div className="heading-eyebrow"><span className="eyebrow-dot"/> MODÈLE INTERACTIF</div><h1>Comprendre <span>l’équilibre énergétique.</span></h1><p>Explorez les liens entre production, consommation et stockage.</p></div><div className="heading-side"><span>SCÉNARIO EN COURS</span><strong>Île énergétique <ArrowDownRight size={15}/></strong></div></div>
      <section className="workspace" aria-label="Simulateur énergétique">
        <aside className="sidebar"><div className="side-heading"><div><span className="section-label">PARAMÈTRES</span><h2>Votre scénario</h2></div><Button variant="ghost" size="icon" className="reset" aria-label="Réinitialiser le scénario" title="Réinitialiser le scénario" onClick={() => { setScenario(initialScenario); setSelected('production') }}><RotateCcw size={15}/></Button></div><p className="side-intro">Ajustez les variables pour observer leurs effets sur le système.</p><div className="controls"><Control label="Production" description="Puissance disponible" value={scenario.productionMW} unit="MW" onChange={update('productionMW')}/><Control label="Consommation" description="Demande de l’île" value={scenario.consumptionMW} unit="MW" onChange={update('consumptionMW')}/><Control label="Stockage" description="Énergie disponible" value={scenario.batteryMWh} unit="MWh" onChange={update('batteryMWh')}/><Control label="Puissance batterie" description="Décharge maximale" value={scenario.batteryPowerMW} unit="MW" onChange={update('batteryPowerMW')}/></div><div className="sidebar-tip"><span>ESSAYER</span><p>Passez la consommation à <strong>46 MW</strong> et observez l’autonomie. <ArrowRight size={13}/></p></div></aside>
        <div className="main-panel"><div className="panel-top"><div><span className="section-label">VUE D’ENSEMBLE</span><h2>Équilibre énergétique</h2></div><span className="live-chip"><span/> En direct</span></div>
          <SystemMap scenario={scenario} selected={selected} setSelected={setSelected}/>
          <div className="map-detail"><span className="detail-icon"><SelectedIcon size={17}/></span><div><div className="detail-title">{selectedInfo.title}<span> / ÉLÉMENT SÉLECTIONNÉ</span></div><p>{selectedInfo.description}</p></div><ArrowUpRight className="detail-arrow" size={16}/></div>
          <div className="results-header"><div><span className="section-label">ANALYSE DU SCÉNARIO</span><h2>Ce qui se passe</h2></div><span className={`status-chip ${isDeficit ? 'status-deficit' : ''}`}><span/> {isDeficit ? 'Déficit de production' : 'Production suffisante'}</span></div>
          <div className="results-grid"><div className="metric"><div className="metric-top"><span>{isDeficit ? 'Déficit' : 'Surplus'}</span><Gauge size={15}/></div><div className="metric-value">{format(isDeficit ? deficitMW : surplusMW)} <small>MW</small></div><div className="metric-note">Différence entre demande et production</div></div><div className="metric"><div className="metric-top"><span>Autonomie théorique</span><Zap size={15}/></div><div className="metric-value">{isDeficit && batteryCanCoverDeficit ? duration(autonomyHours) : '—'}</div><div className="metric-note">Couverture du déficit par la batterie</div></div><div className="insight"><div className="insight-top"><span>EN CLAIR</span><span>↗</span></div><FlowText text={explanation}/></div></div>
          <div className="planner"><div className="planner-heading"><div><span className="section-label">EXPLORER LES OPTIONS</span><h2>Tenir une heure</h2><p>Comparez des modifications compatibles avec le modèle actuel.</p></div><Button variant="outline" size="sm" onClick={calculatePlans} disabled={planning}>{planning ? 'Calcul en cours…' : 'Calculer les options'} <ArrowRight size={14}/></Button></div>
            {currentPlanError && <p role="alert" className="planner-message">{currentPlanError}</p>}
            {currentPlans && currentPlans.length === 0 && <p className="planner-message">{!isDeficit || (batteryCanCoverDeficit && autonomyHours !== null && autonomyHours >= 1) ? 'Le scénario actuel tient déjà au moins une heure.' : 'Aucune option simple ne respecte les limites de ce modèle.'}</p>}
            {currentPlans && currentPlans.length > 0 && <div className="plan-list">{currentPlans.map(plan => <div className="plan-row" key={plan.kind}><span className="plan-num">{String(currentPlans.indexOf(plan) + 1).padStart(2, '0')}</span><div><strong>{plan.label}</strong><p>{plan.detail}</p></div><Button variant="ghost" size="sm" onClick={() => setScenario(plan.inputs)}>Appliquer <ArrowUpRight size={14}/></Button></div>)}</div>}
            {currentPlans && currentPlans.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={() => void verifyPlans()} disabled={currentZ3?.status === 'busy'}>{currentZ3?.status === 'busy' ? 'Vérification…' : 'Vérifier avec Z3'}</Button>{currentZ3?.status === 'reload' && <Button variant="outline" size="sm" onClick={reloadForZ3}>Recharger et conserver le scénario</Button>}<p role="status" className="text-xs leading-5 text-zinc-600">{currentZ3?.message ?? 'Vérification facultative des contraintes. Premier chargement : environ 9 Mo.'}</p></div>}
          </div>
        </div>
      </section>
      <ScenarioCompare scenario={scenario} onApply={setScenario}/>
      <section className="data-import" aria-labelledby="import-title"><div><span className="section-label">DONNÉES LOCALES</span><h2 id="import-title">Explorer vos données</h2><p>Importez un CSV : la moyenne de production et de consommation alimente le scénario. Le fichier reste dans votre navigateur.</p><small>Colonnes : <code>production_mw</code> et <code>consommation_mw</code> · valeurs de 0 à 100. <a href={`${import.meta.env.BASE_URL}energy-example.csv`} download>Télécharger un exemple</a></small></div><div className="data-import-action"><label className={`import-button ${importState.busy ? 'disabled' : ''}`}><Upload size={15}/>{importState.busy ? 'Analyse en cours…' : 'Importer un CSV'}<input type="file" accept=".csv,text/csv" disabled={importState.busy} onChange={event => {const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file)}} /></label><p role="status" className={importState.error ? 'import-error' : ''}>{importState.message}</p></div></section>
      <section className="model-section" id="hypotheses"><button type="button" className="model-toggle" aria-expanded={assumptions} onClick={() => setAssumptions(!assumptions)}><span className="model-icon"><CircleHelp size={17}/></span><span><strong>À propos du modèle</strong><small>Hypothèses et limites de cette expérience</small></span><span className="model-plus">{assumptions ? '−' : '+'}</span></button>{assumptions && <div className="model-body"><p>Ce modèle pédagogique suppose une production et une consommation constantes. Il ne représente pas un réseau électrique réel.</p><ul><li>Le déficit est la différence positive entre consommation et production.</li><li>Si la puissance de la batterie couvre le déficit, son autonomie correspond à l’énergie disponible divisée par le déficit.</li><li>Les pertes, la recharge, la météo et les contraintes du réseau ne sont pas modélisées.</li></ul></div>}</section>
      <footer className="footer"><div><span className="footer-logo">◈</span> ÎLE <span className="footer-divider">/</span> UN MONDE À COMPRENDRE</div><span>UN PROJET EXPLORATOIRE · 01</span></footer>
    </main>
  </div>
}
export default App
