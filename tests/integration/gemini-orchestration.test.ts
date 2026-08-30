import { describe, expect, it } from 'vitest'
import { createAnalysisOrchestrator } from '@/ai/orchestrator'
import { createFakeAnalystProvider } from '@/ai/fake-provider'
import { createDeterministicAnalyzer } from '@/core/analyzer'
import { createDemoCatalog } from '@/core/catalog'
import { compileMetricQuery, getMetric } from '@/core/metrics'
import type { QueryResult, SqlExecutor, SqlSource } from '@/core/contracts'

const catalog = createDemoCatalog(); const compiled = compileMetricQuery({ metricId: 'net_revenue', intent: 'kpi' }, catalog)
class Executor implements SqlExecutor {
  calls: string[] = []
  async registerSource(_source: SqlSource): Promise<void> {} async dropSource(_name: string): Promise<void> {}
  async explain(sql: string): Promise<void> { this.calls.push(`explain:${sql}`) }
  async query(sql: string): Promise<QueryResult> { this.calls.push(`query:${sql}`); if (sql === compiled.sql) return { columns: ['net_revenue'], rows: [{ net_revenue: 125 }], rowCount: 1, durationMs: 1, truncated: false }; if (sql === compiled.verificationSql) return { columns: ['item_level_revenue'], rows: [{ item_level_revenue: 125 }], rowCount: 1, durationMs: 1, truncated: false }; throw new Error(`unexpected ${sql}`) }
  cancel(): void {} async close(): Promise<void> {}
}
const plan = { interpretedQuestion: 'Net revenue', intent: 'kpi' as const, metricId: 'net_revenue' as const, sql: compiled.sql, verificationSql: compiled.verificationSql, expectedShape: compiled.expectedShape, assumptions: [...compiled.assumptions], chart: { kind: 'kpi' as const, y: 'net_revenue' } }
const synth = { summary: 'Revenue is verified.', recommendations: [{ priority: 1 as const, action: 'Review revenue', evidenceIds: ['query:primary'] }, { priority: 2 as const, action: 'Monitor reconciliation', evidenceIds: ['verification:net_revenue'] }, { priority: 3 as const, action: 'Continue analysis', evidenceIds: ['query:primary'] }] }
function execute(provider: ReturnType<typeof createFakeAnalystProvider>, executor = new Executor()) { return { executor, result: createAnalysisOrchestrator({ provider, analyzer: createDeterministicAnalyzer({ catalog, executor }) }).run({ question: 'What is net revenue?', catalog, metrics: [getMetric('net_revenue')!] }) } }
describe('Gemini orchestration integration', () => {
  it('runs fake provider plan through real deterministic analyzer and synthesis', async () => { const { result, executor } = execute(createFakeAnalystProvider({ plans: [plan], syntheses: [synth] })); expect((await result).status).toBe('completed'); expect(executor.calls).toHaveLength(4) })
  it('repairs a guarded unsafe plan then runs the repaired query through analyzer', async () => { const unsafe = { ...plan, sql: 'DELETE FROM orders;' }; const provider = createFakeAnalystProvider({ plans: [unsafe], repairs: [{ sql: compiled.sql, verificationSql: compiled.verificationSql, expectedShape: compiled.expectedShape }], syntheses: [synth] }); const { result, executor } = execute(provider); expect((await result).status).toBe('completed'); expect(provider.calls.map((call) => call.stage)).toEqual(['plan', 'repair', 'synthesize']); expect(executor.calls).toHaveLength(4) })
})
