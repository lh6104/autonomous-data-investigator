import { useEffect, useMemo, useState } from 'react'
import type { Catalog } from '@/core/contracts'
import { createDeterministicAnalyzer } from '@/core/analyzer'
import { getMetric } from '@/core/metrics'
import { createAnalysisOrchestrator } from '@/ai/orchestrator'
import { createHttpAnalystProvider } from '@/ai/http-provider'
import { createLocalDemoAnalystProvider } from '@/ai/local-demo-provider'
import { AnalysisPanel } from '@/features/analysis/AnalysisPanel'
import { ImportPanel } from '@/features/import/ImportPanel'
import type { ImportSelection, LocalImportResult } from '@/features/import/contracts'
import { createLocalImportService } from '@/features/import/local-import-service'
import { confirmRelationships } from '@/features/import/relationship-suggestions'
import { createXlsxWorkbookReader } from '@/features/import/xlsx-reader'
import { DuckDbClient } from '@/workers/duckdb-client'
import './app.css'

const EMPTY_CATALOG: Catalog = Object.freeze({ tables: Object.freeze([]), relationships: Object.freeze([]) })
const METRICS = Object.freeze([getMetric('net_revenue')!])
const DEMO_TABLES = Object.freeze(['users', 'products', 'orders', 'order_items', 'reviews', 'events'])

function relationshipKey(relationship: Catalog['relationships'][number]): string {
  return `${relationship.fromTable}.${relationship.fromColumn}->${relationship.toTable}.${relationship.toColumn}`
}

function confirmAllSuggested(catalog: Catalog): Catalog {
  return confirmRelationships(
    catalog,
    Object.fromEntries(catalog.relationships.map((relationship) => [relationshipKey(relationship), 'confirmed' as const]))
  )
}

async function demoFiles(): Promise<File[]> {
  return Promise.all(DEMO_TABLES.map(async (table) => {
    const response = await fetch(`/demo-data/${table}.csv`)
    if (!response.ok) throw new Error(`Could not load demo table ${table}.`)
    return new File([await response.blob()], `${table}.csv`, { type: 'text/csv' })
  }))
}

export function App() {
  const [client] = useState(() => new DuckDbClient())
  const [service] = useState(() => createLocalImportService({ executor: client, xlsx: createXlsxWorkbookReader() }))
  const [workspace, setWorkspace] = useState<LocalImportResult | null>(null)
  const [demoStatus, setDemoStatus] = useState('')
  const [loadingDemo, setLoadingDemo] = useState(false)
  const catalog = workspace?.catalog ?? null
  const activeCatalog = catalog ?? EMPTY_CATALOG
  const analystMode = import.meta.env.VITE_ANALYST_MODE === 'http' ? 'gemini' : 'local'

  const analyzer = useMemo(
    () => createDeterministicAnalyzer({ catalog: activeCatalog, executor: client }),
    [activeCatalog, client]
  )
  const provider = useMemo(
    () => analystMode === 'gemini' ? createHttpAnalystProvider() : createLocalDemoAnalystProvider(activeCatalog),
    [activeCatalog, analystMode]
  )
  const orchestrator = useMemo(
    () => createAnalysisOrchestrator({ analyzer, provider }),
    [analyzer, provider]
  )

  useEffect(() => {
    const closeClient = () => { void client.close() }
    window.addEventListener('pagehide', closeClient, { once: true })
    return () => window.removeEventListener('pagehide', closeClient)
  }, [client])

  async function loadDemo(): Promise<void> {
    if (loadingDemo) return
    setLoadingDemo(true)
    setDemoStatus('Loading the local demo workspace…')
    try {
      const inspection = await service.inspect(await demoFiles())
      if (inspection.issues.length > 0) throw new Error(inspection.issues.map((issue) => issue.message).join(' '))
      const selection: ImportSelection[] = inspection.candidates.map((candidate) => ({ candidateId: candidate.id }))
      const result = await service.import(selection)
      if (result.issues.length > 0) throw new Error(result.issues.map((issue) => issue.message).join(' '))
      const next = { ...result, catalog: confirmAllSuggested(result.catalog) }
      setWorkspace(next)
      setDemoStatus(`Demo ready: ${next.tables.length} tables are queryable locally.`)
    } catch (error) {
      setDemoStatus(error instanceof Error ? error.message : 'The demo workspace could not be loaded.')
    } finally {
      setLoadingDemo(false)
    }
  }

  return <main>
    <header className="hero">
      <div>
        <p className="hero__kicker">Synapse · AI business analyst</p>
        <h1>From local data to a verified decision.</h1>
        <p className="hero__copy">Import operational files, ask a business question, inspect the SQL, and see whether the evidence can be trusted.</p>
      </div>
      <div className="hero__badges" aria-label="Runtime capabilities">
        <span>DuckDB · browser local</span>
        <span>{analystMode === 'gemini' ? 'Gemini · server connected' : 'Deterministic demo · AI Studio pending'}</span>
        <span>No login</span>
      </div>
    </header>

    <section className="demo-callout" aria-labelledby="demo-title">
      <div><h2 id="demo-title">Try the e-commerce demo</h2><p>Loads six bundled CSV tables into your browser and confirms the demo relationships.</p></div>
      <button type="button" onClick={() => void loadDemo()} disabled={loadingDemo}>{loadingDemo ? 'Loading demo…' : 'Load demo workspace'}</button>
      {demoStatus && <p role="status">{demoStatus}</p>}
    </section>

    <div className="workspace-grid">
      <ImportPanel service={service} onImported={setWorkspace} />
      <AnalysisPanel orchestrator={orchestrator} catalog={catalog} metrics={METRICS} />
    </div>

    <footer>
      <p>Raw datasets stay in your browser. Gemini integration uses only redacted schema metadata and bounded aggregate evidence.</p>
    </footer>
  </main>
}
