import { useMemo, useState } from 'react'
import type { Catalog } from '@/core/contracts'
import type { ImportInspection, ImportSelection, LocalImportResult } from './contracts'
import type { LocalImportService } from './local-import-service'
import { confirmRelationships } from './relationship-suggestions'
import './import-panel.css'

export interface ImportPanelProps {
  readonly service: LocalImportService
  readonly onImported: (result: LocalImportResult) => void
}

export function ImportPanel({ service, onImported }: ImportPanelProps) {
  const [inspection, setInspection] = useState<ImportInspection | null>(null)
  const [selected, setSelected] = useState<readonly ImportSelection[]>([])
  const [result, setResult] = useState<LocalImportResult | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [status, setStatus] = useState('Ready to import local files.')
  const issues = useMemo(() => result?.issues ?? inspection?.issues ?? [], [inspection, result])

  async function inspect(files: FileList | null): Promise<void> {
    const next = await service.inspect(files ? Array.from(files) : [])
    setInspection(next); setResult(null); setCatalog(null)
    setSelected(next.candidates.filter((candidate) => candidate.format !== 'xlsx').map((candidate) => ({ candidateId: candidate.id })))
    setStatus(next.issues.length ? 'Some selected files need attention.' : 'Choose workbook sheets, then import.')
  }

  function choose(candidateId: string, sheetName: string, checked: boolean): void {
    setSelected((current) => checked
      ? [...current, { candidateId, sheetName }]
      : current.filter((selection) => selection.candidateId !== candidateId || selection.sheetName !== sheetName))
  }

  async function runImport(): Promise<void> {
    setStatus('Importing files locally…')
    const next = await service.import(selected)
    setResult(next); setCatalog(next.catalog); onImported(next)
    setStatus(next.issues.length ? 'Import did not complete.' : `Imported ${next.tables.length} local table${next.tables.length === 1 ? '' : 's'}.`)
  }

  function decide(key: string, status: 'confirmed' | 'rejected'): void {
    if (!catalog || !result) return
    const nextCatalog = confirmRelationships(catalog, { [key]: status })
    setCatalog(nextCatalog)
    onImported({ ...result, catalog: nextCatalog })
  }

  return <section className="import-panel" aria-labelledby="import-title">
    <h2 id="import-title">Import local data</h2>
    <p>Raw files and previews stay in this browser. This import flow does not send data to AI services.</p>
    <label htmlFor="dataset-files">Choose CSV, XLSX, or Parquet files</label>
    <input id="dataset-files" type="file" multiple accept=".csv,text/csv,.parquet,application/vnd.apache.parquet,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void inspect(event.currentTarget.files)} />
    <p role="status" aria-live="polite">{status}</p>
    {issues.length > 0 && <ul className="import-panel__issues" role="alert" aria-live="assertive">{issues.map((issue, index) => <li key={`${issue.code}-${issue.fileName}-${index}`}>{issue.fileName ? `${issue.fileName}: ` : ''}{issue.message}</li>)}</ul>}
    {inspection?.candidates.filter((candidate) => candidate.format === 'xlsx').map((candidate) => <fieldset key={candidate.id}>
      <legend>Select sheets from {candidate.displayName}</legend>
      {(inspection.sheets.get(candidate.id) ?? []).map((sheet) => {
        const checked = selected.some((selection) => selection.candidateId === candidate.id && selection.sheetName === sheet.name)
        return <label key={sheet.name}><input type="checkbox" checked={checked} onChange={(event) => choose(candidate.id, sheet.name, event.currentTarget.checked)} /> {sheet.name} ({sheet.rowCount} rows)</label>
      })}
    </fieldset>)}
    {inspection && <button type="button" onClick={() => void runImport()} disabled={selected.length === 0}>Import selected data</button>}
    {result?.tables.map((table) => <article className="import-panel__table" key={table.name}>
      <h3>{table.name}</h3><p>{table.displayName} · {table.schema.rowCount} rows · preview: {table.preview.rows.length}</p>
      <ul>{table.schema.columns.map((column) => <li key={column.name}>{column.name}: {column.type} ({column.pii})</li>)}</ul>
    </article>)}
    {catalog?.relationships.map((relationship) => {
      const key = `${relationship.fromTable}.${relationship.fromColumn}->${relationship.toTable}.${relationship.toColumn}`
      return <div className="import-panel__relationship" key={key}><span>{key}: {relationship.status}</span>{relationship.status === 'suggested' && <><button type="button" onClick={() => decide(key, 'confirmed')}>Confirm</button><button type="button" onClick={() => decide(key, 'rejected')}>Reject</button></>}</div>
    })}
  </section>
}
