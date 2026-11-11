import type { HourInput } from './timeline'

/** Parse hourly CSV locally in DuckDB; order is significant and data stays on the device. */
export async function importEnergyData(file: File): Promise<HourInput[]> {
  if (file.size === 0 || file.size > 5_000_000) throw new Error('Choisissez un fichier CSV non vide de 5 Mo maximum.')
  const [{ AsyncDuckDB, VoidLogger }, wasm, workerUrl] = await Promise.all([
    import('@duckdb/duckdb-wasm'),
    import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'),
    import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'),
  ])
  const worker = new Worker(workerUrl.default)
  const db = new AsyncDuckDB(new VoidLogger(), worker)
  try {
    await db.instantiate(wasm.default)
    await db.registerFileText('energy.csv', await file.text())
    const connection = await db.connect()
    try {
      const table = await connection.query(`SELECT trim(heure) AS heure, try_cast(production_mw AS DOUBLE) AS production, try_cast(consommation_mw AS DOUBLE) AS consommation FROM read_csv('energy.csv', header=true, all_varchar=true)`)
      const rows: HourInput[] = table.toArray().map(row => {
        const production = row.production === null ? NaN : Number(row.production)
        const consumption = row.consommation === null ? NaN : Number(row.consommation)
        return { hour: String(row.heure ?? ''), productionMW: production, consumptionMW: consumption }
      })
      if (!rows.length || rows.length > 24) throw new Error('Le CSV doit contenir entre 1 et 24 lignes horaires.')
      let previousHour = -1
      for (const row of rows) {
        if (!/^(?:[01]\d|2[0-3]):00$/.test(row.hour)) throw new Error('Chaque heure doit être au format HH:00, entre 00:00 et 23:00.')
        const hour = Number(row.hour.slice(0, 2))
        if (previousHour >= 0 && hour !== previousHour + 1) throw new Error('Les heures doivent être consécutives, ordonnées et sans doublon.')
        if (!Number.isFinite(row.productionMW) || !Number.isFinite(row.consumptionMW) || row.productionMW < 0 || row.consumptionMW < 0) throw new Error('La production et la consommation doivent être des nombres positifs ou nuls.')
        previousHour = hour
      }
      return rows
    } finally { await connection.close() }
  } catch (error) {
    if (error instanceof Error && /Le CSV doit|Chaque heure|Les heures doivent|La production et/.test(error.message)) throw error
    throw new Error('Impossible de lire ce CSV. Il doit contenir les colonnes heure, production_mw et consommation_mw.')
  } finally { await db.terminate() }
}
