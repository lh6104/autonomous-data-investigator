import type { AnalysisResult } from '@/core/contracts'
import { AI_LIMITS, parseSynthesisRequest, type ChartSpec, type SynthesisRequest } from './contracts'
export function serializedPayloadBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
function scalar(value: unknown): value is string | number | boolean | null { return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) }
export function createSynthesisRequest(question: string, interpretedQuestion: string, analysis: AnalysisResult, chart: ChartSpec): SynthesisRequest {
  let remaining = AI_LIMITS.maxEvidenceRows
  const evidence = analysis.evidence.map((item) => { const rows = item.rows.filter((row) => Object.values(row).every(scalar)).slice(0, remaining).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => scalar(value)))); remaining -= rows.length; return { id: item.id, columns: [...item.columns], rows } })
  const request = { question, interpretedQuestion, evidence, trust: { verdict: analysis.trust.verdict, checks: analysis.trust.checks.map(({ id, status, severity, message, evidenceIds }) => ({ id, status, severity, message, evidenceIds })) }, chart }
  const parsed = parseSynthesisRequest(request)
  if (serializedPayloadBytes(parsed) > AI_LIMITS.maxPayloadBytes) throw new Error('synthesis payload exceeds 128 KiB')
  return parsed
}
