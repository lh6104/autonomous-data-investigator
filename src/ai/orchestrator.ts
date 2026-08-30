import type { AnalysisResult, Catalog, MetricDefinition, QueryPlan } from '@/core/contracts'
import type { DeterministicAnalyzer } from '@/core/analyzer'
import { createAnalysisPlanRequest } from './safe-schema'
import { createSynthesisRequest } from './privacy'
import type { AnalysisPlanResponse, ChartSpec, SynthesisResponse } from './contracts'
import type { AnalystProvider } from './provider'
import { AiContractError } from './contracts'
import { ProviderContractError, ProviderTimeoutError, ProviderUnavailableError } from './provider'
import { createDeterministicPlan, createDeterministicSynthesis } from './fallbacks'

export type InvestigationStatus = 'completed' | 'fallback' | 'rejected' | 'failed'
export interface InvestigationRequest { readonly question: string; readonly catalog: Catalog; readonly metrics: readonly MetricDefinition[]; readonly signal?: AbortSignal }
export interface InvestigationResult { readonly status: InvestigationStatus; readonly plan?: QueryPlan; readonly analysis?: AnalysisResult; readonly synthesis?: SynthesisResponse; readonly chart?: ChartSpec; readonly warnings: readonly string[]; readonly providerAttempts: number; readonly repairAttempted: boolean }
export interface AnalysisOrchestrator { run(input: InvestigationRequest): Promise<InvestigationResult> }
export interface AnalysisOrchestratorDependencies { readonly provider: AnalystProvider; readonly analyzer: DeterministicAnalyzer }
function isAborted(signal: AbortSignal | undefined): boolean { return signal?.aborted === true }
function callOptions(signal: AbortSignal | undefined, schemaFeedback?: string) { return { ...(signal === undefined ? {} : { signal }), ...(schemaFeedback === undefined ? {} : { schemaFeedback }) } }
function analyzerRequest(question: string, plan: QueryPlan, signal: AbortSignal | undefined) { return { question, plan, ...(signal === undefined ? {} : { signal }) } }
async function retry<T>(signal: AbortSignal | undefined, operation: (schemaFeedback?: string) => Promise<T>): Promise<{ value?: T; attempts: number; warning?: string }> {
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isAborted(signal)) throw new DOMException('The operation was aborted', 'AbortError')
    try { return { value: await operation(attempt === 0 ? undefined : 'Return only JSON matching the required schema.'), attempts: attempt + 1 } } catch (error) { if (isAborted(signal)) throw error; if (!(error instanceof ProviderUnavailableError || error instanceof ProviderTimeoutError || error instanceof ProviderContractError || error instanceof AiContractError)) throw error; last = error }
  }
  return { attempts: 2, warning: last instanceof Error ? last.message : String(last) }
}
function toPlan(response: AnalysisPlanResponse): QueryPlan { return { intent: response.intent, metricId: response.metricId, sql: response.sql, verificationSql: response.verificationSql, expectedShape: response.expectedShape, assumptions: response.assumptions } }
function guardRejection(analysis: AnalysisResult) { return analysis.checks.find((check) => check.id === 'sql_guard_primary' || check.id === 'sql_guard_verification') }
export function createAnalysisOrchestrator(deps: AnalysisOrchestratorDependencies): AnalysisOrchestrator {
  return { async run(input) {
    if (input.question.length === 0 || input.question.length > 2_000) return { status: 'failed', warnings: ['Question must be between 1 and 2,000 characters.'], providerAttempts: 0, repairAttempted: false }
    const warnings: string[] = []
    const request = createAnalysisPlanRequest(input.question, input.catalog, input.metrics)
    const planned = await retry(input.signal, (schemaFeedback) => deps.provider.plan(request, callOptions(input.signal, schemaFeedback)))
    let attempts = planned.attempts
    let response = planned.value
    let usedFallback = false
    if (response === undefined) { warnings.push(`Gemini planning unavailable: ${planned.warning ?? 'unknown error'}`); response = createDeterministicPlan(input.question, input.catalog); usedFallback = true }
    if (response === undefined) return { status: 'failed', warnings, providerAttempts: attempts, repairAttempted: false }
    let plan = toPlan(response)
    let analysis = await deps.analyzer.run(analyzerRequest(input.question, plan, input.signal))
    let repairAttempted = false
    const rejection = guardRejection(analysis)
    if (rejection !== undefined) {
      repairAttempted = true
      const repair = await retry(input.signal, (schemaFeedback) => deps.provider.repairSql({ question: input.question, rejectedSql: plan.sql, rejection: [{ code: rejection.id, message: rejection.message }], schema: request.schema }, callOptions(input.signal, schemaFeedback)))
      attempts += repair.attempts
      if (repair.value === undefined) return { status: 'rejected', plan, analysis, warnings: [...warnings, `Gemini SQL repair unavailable: ${repair.warning ?? 'unknown error'}`], providerAttempts: attempts, repairAttempted }
      plan = { ...plan, sql: repair.value.sql, verificationSql: repair.value.verificationSql, expectedShape: repair.value.expectedShape }
      analysis = await deps.analyzer.run(analyzerRequest(input.question, plan, input.signal))
      if (guardRejection(analysis) !== undefined) return { status: 'rejected', plan, analysis, warnings, providerAttempts: attempts, repairAttempted }
    }
    if (analysis.checks.some((check) => check.id === 'primary_execution' && check.status === 'fail')) return { status: 'failed', plan, analysis, warnings: [...warnings, ...analysis.warnings], providerAttempts: attempts, repairAttempted }
    let synthesis: SynthesisResponse
    try {
      const synthesisRequest = createSynthesisRequest(input.question, response.interpretedQuestion, analysis, response.chart)
      const generated = await retry(input.signal, (schemaFeedback) => deps.provider.synthesize(synthesisRequest, callOptions(input.signal, schemaFeedback)))
      attempts += generated.attempts
      if (generated.value === undefined) { warnings.push(`Gemini synthesis unavailable: ${generated.warning ?? 'unknown error'}`); synthesis = createDeterministicSynthesis(analysis); usedFallback = true } else synthesis = generated.value
    } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); synthesis = createDeterministicSynthesis(analysis); usedFallback = true }
    return { status: usedFallback ? 'fallback' : 'completed', plan, analysis, synthesis, chart: response.chart, warnings: [...warnings, ...analysis.warnings], providerAttempts: attempts, repairAttempted }
  } }
}
