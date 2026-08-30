import type { AnalysisResult, Catalog } from '@/core/contracts'
import { compileMetricQuery, getMetric } from '@/core/metrics'
import type { AnalysisPlanResponse, ChartSpec, SynthesisResponse } from './contracts'
export function createDeterministicPlan(question: string, catalog: Catalog): AnalysisPlanResponse | undefined {
  const normalized = question.toLowerCase(); if (!/revenue/.test(normalized)) return undefined
  const intent = /trend|month|monthly|over time/.test(normalized) ? 'trend' : 'kpi'
  const compiled = compileMetricQuery({ metricId: 'net_revenue', intent, ...(intent === 'trend' ? { dimension: 'month' } : {}) }, catalog)
  return { interpretedQuestion: question, intent, metricId: 'net_revenue', sql: compiled.sql, verificationSql: compiled.verificationSql, expectedShape: compiled.expectedShape, assumptions: [...compiled.assumptions], chart: intent === 'trend' ? { kind: 'line', x: 'month', y: 'net_revenue' } : { kind: 'kpi', y: 'net_revenue' } }
}
export function createDeterministicSynthesis(analysis: AnalysisResult): SynthesisResponse {
  const ids = analysis.evidence.map((item) => item.id); const evidenceIds = ids.length > 0 ? [ids[0]!] : ['query:primary']
  const verdict = analysis.trust.verdict.replaceAll('_', ' ')
  return { summary: `Deterministic summary: Trust verdict is ${verdict}. Review the displayed KPIs, evidence, and caveats; no values were recalculated.`, recommendations: [
    { priority: 1, action: 'Review the verified KPI and its Trust Report before making decisions.', evidenceIds },
    { priority: 2, action: 'Investigate any caveats or failed verification checks shown in the evidence.', evidenceIds },
    { priority: 3, action: 'Use the guarded query and chart as the basis for a follow-up analysis.', evidenceIds }
  ] }
}
export function certifiedMetric() { return getMetric('net_revenue')! }
