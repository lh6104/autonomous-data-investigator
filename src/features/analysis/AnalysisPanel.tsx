import { useRef, useState } from 'react'
import type { Catalog, MetricDefinition } from '@/core/contracts'
import type { AnalysisOrchestrator, InvestigationResult } from '@/ai/orchestrator'
import './analysis-panel.css'

export interface AnalysisPanelProps {
  readonly orchestrator: AnalysisOrchestrator
  readonly catalog: Catalog | null
  readonly metrics: readonly MetricDefinition[]
}

type Mode = 'ask' | 'investigate'

export function canInvestigate(catalog: Catalog | null): boolean {
  if (catalog === null) return false
  const required: Readonly<Record<string, readonly string[]>> = {
    orders: ['order_id', 'order_date', 'order_status', 'total_amount'],
    order_items: ['order_id', 'quantity', 'item_price']
  }
  return Object.entries(required).every(([tableName, columns]) => {
    const table = catalog.tables.find((item) => item.name === tableName)
    return table !== undefined && columns.every((column) => table.columns.some((item) => item.name === column))
  })
}

function statusLabel(result: InvestigationResult): string {
  if (result.status === 'fallback') return 'Deterministic fallback used'
  if (result.status === 'rejected') return 'Query rejected safely'
  if (result.status === 'failed') return 'Analysis unavailable'
  return 'Analysis complete'
}
function cell(value: unknown): string { return value === null || value === undefined ? '—' : typeof value === 'number' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) : String(value) }

export function AnalysisPanel({ orchestrator, catalog, metrics }: AnalysisPanelProps) {
  const [mode, setMode] = useState<Mode>('ask')
  const [question, setQuestion] = useState('What is net revenue?')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<InvestigationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const ready = canInvestigate(catalog)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || catalog === null || !question.trim() || running) return
    const next = new AbortController(); controller.current = next
    setRunning(true); setError(null); setResult(null)
    try { setResult(await orchestrator.run({ question: question.trim(), catalog, metrics, signal: next.signal })) }
    catch (cause) { if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : 'Analysis could not be completed.') }
    finally { if (controller.current === next) controller.current = null; setRunning(false) }
  }
  function cancel() { controller.current?.abort(); controller.current = null; setRunning(false) }
  const analysis = result?.analysis
  const columns = analysis?.evidence.find((item) => item.id === 'query:primary')?.columns ?? (analysis?.rows[0] === undefined ? [] : Object.keys(analysis.rows[0]))

  return <section className="analysis-panel" aria-labelledby="analysis-title">
    <header className="analysis-header"><div><p className="eyebrow">Local-first analyst</p><h2 id="analysis-title">Ask and investigate</h2></div><div className="mode-tabs" role="tablist" aria-label="Analysis mode"><button type="button" role="tab" aria-selected={mode === 'ask'} onClick={() => setMode('ask')}>Ask</button><button type="button" role="tab" aria-selected={mode === 'investigate'} onClick={() => setMode('investigate')}>Investigate</button></div></header>
    <p className="privacy-notice">Your uploaded rows stay in this browser. Only redacted schema metadata, certified metrics, and bounded aggregate evidence may be sent for analysis.</p>
    {!ready && <p className="panel-notice" role="status">Import compatible <code>orders</code> and <code>order_items</code> tables before investigating.</p>}
    <form onSubmit={submit} className="question-form"><label htmlFor="analysis-question">Business question</label><textarea id="analysis-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} disabled={!ready || running} rows={3} /> <div className="form-actions"><span>{question.length}/2000</span>{running ? <button type="button" onClick={cancel}>Cancel analysis</button> : <button type="submit" disabled={!ready || !question.trim()}>Run investigation</button>}</div></form>
    {running && <ol className="analysis-timeline" aria-label="Analysis progress"><li>Preparing redacted schema context</li><li>Creating an analysis plan</li><li>Running guarded SQL locally</li><li>Verifying evidence and composing findings</li></ol>}
    {error && <p className="panel-error" role="alert">{error}</p>}
    {result && <div className="analysis-result"><p className={`result-status status-${result.status}`} role="status">{statusLabel(result)}</p>
      {result.warnings.length > 0 && <aside className="warnings"><h3>Warnings</h3><ul>{result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></aside>}
      {result.plan && <details><summary>SQL plan (executed locally after guard approval)</summary><pre><code>{result.plan.sql}</code></pre><p>{result.plan.assumptions.join(' ')}</p></details>}
      {analysis && <section className="trust-report"><h3>Trust report: {analysis.trust.verdict.replaceAll('_', ' ')}</h3><ul>{analysis.trust.checks.map((check) => <li key={check.id}><strong>{check.status}</strong> — {check.message}</li>)}</ul></section>}
      {analysis && columns.length > 0 && <section className="result-data"><h3>Computed result</h3>{analysis.rows.length === 1 && typeof analysis.rows[0]?.[columns[0]!] === 'number' && <p className="kpi-value">{cell(analysis.rows[0]?.[columns[0]!])}</p>}<div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{analysis.rows.slice(0, 100).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{cell(row[column])}</td>)}</tr>)}</tbody></table></div></section>}
      {result.synthesis && <section className="synthesis"><h3>Findings</h3><p>{result.synthesis.summary}</p><h3>Recommended next actions</h3><ol>{result.synthesis.recommendations.map((recommendation) => <li key={recommendation.priority}>{recommendation.action}</li>)}</ol></section>}
    </div>}
  </section>
}
