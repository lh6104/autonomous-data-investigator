import { execFileSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDemoCatalog } from '@/core/catalog'
import type { AnalysisRequest, QueryPlan, QueryResult, SqlExecutor, SqlSource } from '@/core/contracts'
import { createDeterministicAnalyzer } from '@/core/analyzer'
import { compileMetricQuery } from '@/core/metrics'
import { guardSql } from '@/core/sql-guard'

const root = resolve(import.meta.dirname, '../..')
const dataDir = resolve(root, 'public/demo-data')
const verifier = resolve(root, 'scripts/verify-demo-data.mjs')
const catalog = createDemoCatalog()

function result(rows: readonly Readonly<Record<string, unknown>>[], columns: readonly string[]): QueryResult {
  return { columns, rows, rowCount: rows.length, durationMs: 1, truncated: false }
}

class FakeExecutor implements SqlExecutor {
  readonly calls: string[] = []
  readonly queryResults = new Map<string, QueryResult>()

  async registerSource(source: SqlSource): Promise<void> {
    this.calls.push(`register:${source.name}`)
  }

  async explain(sql: string): Promise<void> {
    this.calls.push(`explain:${sql}`)
  }

  async query(sql: string): Promise<QueryResult> {
    this.calls.push(`query:${sql}`)
    const queryResult = this.queryResults.get(sql)
    if (queryResult === undefined) throw new Error(`unexpected query: ${sql}`)
    return queryResult
  }

  cancel(requestId: string): void {
    this.calls.push(`cancel:${requestId}`)
  }

  async close(): Promise<void> {}
}

describe('deterministic analysis integration', () => {
  it('keeps certified metric, guarded SQL, evidence, and Trust Report consistent', async () => {
    const compiled = compileMetricQuery({ metricId: 'net_revenue', intent: 'kpi' }, catalog)
    const primaryGuard = guardSql(compiled.sql, catalog)
    const verificationGuard = guardSql(compiled.verificationSql, catalog)
    expect(primaryGuard.violations).toEqual([])
    expect(verificationGuard.violations).toEqual([])

    const executor = new FakeExecutor()
    executor.queryResults.set(compiled.sql, result([{ net_revenue: 125 }], ['net_revenue']))
    executor.queryResults.set(compiled.verificationSql, result([{ item_level_revenue: 125 }], ['item_level_revenue']))
    const plan: QueryPlan = {
      intent: 'kpi',
      metricId: compiled.metric.id,
      sql: compiled.sql,
      verificationSql: compiled.verificationSql,
      expectedShape: compiled.expectedShape,
      assumptions: compiled.assumptions
    }
    const request: AnalysisRequest = { question: 'What is net revenue?', plan }
    const analysis = await createDeterministicAnalyzer({ catalog, executor }).run(request)

    expect(compiled.metric).toMatchObject({ id: 'net_revenue', status: 'certified' })
    expect(analysis).toMatchObject({
      question: request.question,
      sql: compiled.sql,
      rows: [{ net_revenue: 125 }],
      trust: { verdict: 'verified' }
    })
    expect(executor.calls).toEqual([
      `explain:${compiled.sql}`,
      `query:${compiled.sql}`,
      `explain:${compiled.verificationSql}`,
      `query:${compiled.verificationSql}`
    ])
    expect(analysis.evidence).toEqual([
      expect.objectContaining({ id: 'query:primary', kind: 'query_result', sql: compiled.sql, rowCount: 1 }),
      expect.objectContaining({ id: 'verification:net_revenue', kind: 'verification', sql: compiled.verificationSql, rowCount: 1 })
    ])
    expect(analysis.trust.checks).toEqual(analysis.checks)
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'net_revenue_reconciliation', status: 'pass', evidenceIds: ['verification:net_revenue'] })
    ]))
    expect(analysis.warnings).toEqual([])
  })

  it('verifies prepared Kaggle files for every catalog table', async () => {
    const output = execFileSync(process.execPath, [verifier], { cwd: root, encoding: 'utf8' })
    expect(output).toMatch(/Demo data verified: 6 tables, \d+ rows, \d+ bytes/)

    await Promise.all(catalog.tables.map(async (table) => {
      await access(resolve(dataDir, `${table.name}.csv`))
    }))
  })
})
