/** Import and summarize local CSV in a browser worker; no data leaves the device. */
export type ImportedEnergy = { productionMW: number; consumptionMW: number; rows: number }

export async function importEnergyData(file: File): Promise<ImportedEnergy> {
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
      const result = await connection.query(`
        SELECT count(*) AS rows,
          count(*) FILTER (WHERE p IS NULL OR c IS NULL OR NOT isfinite(p) OR NOT isfinite(c) OR p < 0 OR c < 0 OR p > 100 OR c > 100) AS invalid,
          avg(p) AS production, avg(c) AS consumption
        FROM (SELECT try_cast(production_mw AS DOUBLE) AS p, try_cast(consommation_mw AS DOUBLE) AS c FROM read_csv('energy.csv', header=true))
      `)
      const row = result.get(0)
      const rows = Number(row?.rows ?? 0)
      if (!rows || Number(row?.invalid ?? 0) !== 0) throw new Error('Les valeurs doivent être numériques, comprises entre 0 et 100, et présentes sur chaque ligne.')
      return { productionMW: Math.round(Number(row?.production) * 10) / 10, consumptionMW: Math.round(Number(row?.consumption) * 10) / 10, rows }
    } finally {
      await connection.close()
    }
  } catch (error) {
    if (error instanceof Error && /valeurs doivent/.test(error.message)) throw error
    throw new Error('Impossible de lire ce CSV. Il doit contenir les colonnes production_mw et consommation_mw.')
  } finally {
    await db.terminate()
  }
}
