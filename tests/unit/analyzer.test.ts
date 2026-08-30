import { describe, expect, it } from 'vitest'
import { createDemoCatalog } from '@/core/catalog'
import type { AnalysisRequest, QueryPlan, QueryResult, SqlExecutor } from '@/core/contracts'
import { createDeterministicAnalyzer } from '@/core/analyzer'

const catalog = createDemoCatalog()
const primarySql = "SELECT SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed';"
const verificationSql = "SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = 'Completed';"

function plan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    intent: 'kpi',
    metricId: 'net_revenue',
    sql: primarySql,
    verificationSql,
    expectedShape: { kind: 'single_value', valueColumn: 'net_revenue' },
    assumptions: [],
    ...overrides
  }
}

function result(rows: readonly Readonly<Record<string, unknown>>[], columns: readonly string[]): QueryResult {
  return { columns, rows, rowCount: rows.length, durationMs: 1, truncated: false }
}

class FakeExecutor implements SqlExecutor {
  readonly calls: string[] = []
  readonly queryResults = new Map<string, QueryResult>()
  readonly queryErrors = new Map<string, Error>()
  readonly explainErrors = new Map<string, Error>()

  async registerSource(): Promise<void> {}

  async dropSource(): Promise<void> {}

  async explain(sql: string): Promise<void> {
    this.calls.push(`explain:${sql}`)
    const error = this.explainErrors.get(sql)
    if (error) throw error
  }

  async query(sql: string): Promise<QueryResult> {
    this.calls.push(`query:${sql}`)
    const error = this.queryErrors.get(sql)
    if (error) throw error
    const queryResult = this.queryResults.get(sql)
    if (queryResult === undefined) throw new Error(`unexpected query: ${sql}`)
    return queryResult
  }

  cancel(requestId: string): void {
    this.calls.push(`cancel:${requestId}`)
  }

  async close(): Promise<void> {}
}

function request(overrides: Partial<QueryPlan> = {}): AnalysisRequest {
  return { question: 'What is net revenue?', plan: plan(overrides) }
}

describe('createDeterministicAnalyzer', () => {
  it('runs validation, guards, explain/query pairs, evidence, and trust in order', async () => {
    const executor = new FakeExecutor()
    executor.queryResults.set(primarySql, result([{ net_revenue: 125 }], ['net_revenue']))
    executor.queryResults.set(verificationSql, result([{ item_level_revenue: 125 }], ['item_level_revenue']))

    const analysis = await createDeterministicAnalyzer({ catalog, executor }).run(request())

    expect(executor.calls).toEqual([
      `explain:${primarySql}`,
      `query:${primarySql}`,
      `explain:${verificationSql}`,
      `query:${verificationSql}`
    ])
    expect(analysis).toMatchObject({
      question: 'What is net revenue?',
      sql: primarySql,
      rows: [{ net_revenue: 125 }],
      trust: { verdict: 'verified' }
    })
    expect(analysis.evidence).toEqual([
      expect.objectContaining({ id: 'query:primary', kind: 'query_result', sql: primarySql, rowCount: 1 }),
      expect.objectContaining({ id: 'verification:net_revenue', kind: 'verification', sql: verificationSql, rowCount: 1 })
    ])
    expect(analysis.checks.map((check) => check.id)).toEqual(['result_sanity', 'net_revenue_reconciliation'])
  })

  it('guards both statements before executing either one', async () => {
    const executor = new FakeExecutor()
    const unsafe = plan({ sql: 'DELETE FROM orders;' })

    const analysis = await createDeterministicAnalyzer({ catalog, executor }).run({
      question: 'Delete nothing',
      plan: unsafe
    })

    expect(executor.calls).toEqual([])
    expect(analysis.rows).toEqual([])
    expect(analysis.evidence).toEqual([])
    expect(analysis.trust.verdict).toBe('do_not_trust')
    expect(analysis.checks).toEqual([
      expect.objectContaining({ id: 'sql_guard_primary', status: 'fail', severity: 'critical' })
    ])
    expect(analysis.warnings.join(' ')).toContain('forbidden SQL keyword')
  })

  it('preserves primary output and warning when verification times out', async () => {
    const executor = new FakeExecutor()
    executor.queryResults.set(primarySql, result([{ net_revenue: 125 }], ['net_revenue']))
    executor.queryErrors.set(verificationSql, new Error('query timed out'))

    const analysis = await createDeterministicAnalyzer({ catalog, executor }).run(request())

    expect(analysis.rows).toEqual([{ net_revenue: 125 }])
    expect(analysis.evidence).toEqual([
      expect.objectContaining({ id: 'query:primary', rowCount: 1 })
    ])
    expect(analysis.trust.verdict).toBe('verified_with_caveats')
    expect(analysis.warnings.join(' ')).toContain('query timed out')
  })

  it('retains both outputs but refuses trust when reconciliation mismatches', async () => {
    const executor = new FakeExecutor()
    executor.queryResults.set(primarySql, result([{ net_revenue: 125 }], ['net_revenue']))
    executor.queryResults.set(verificationSql, result([{ item_level_revenue: 100 }], ['item_level_revenue']))

    const analysis = await createDeterministicAnalyzer({ catalog, executor }).run(request())

    expect(analysis.rows).toEqual([{ net_revenue: 125 }])
    expect(analysis.evidence).toHaveLength(2)
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'net_revenue_reconciliation', status: 'fail', severity: 'critical' })
    ]))
    expect(analysis.trust.verdict).toBe('do_not_trust')
  })

  it('reports an empty primary result as a caveat without inventing a value', async () => {
    const executor = new FakeExecutor()
    executor.queryResults.set(primarySql, result([], ['net_revenue']))
    executor.queryResults.set(verificationSql, result([], ['item_level_revenue']))

    const analysis = await createDeterministicAnalyzer({ catalog, executor }).run(request())

    expect(analysis.rows).toEqual([])
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'result_sanity', status: 'caveat', severity: 'warning' })
    ]))
    expect(analysis.trust.verdict).toBe('verified_with_caveats')
    expect(analysis.warnings.join(' ')).toContain('no rows')
  })

  it('validates the plan before SQL guards or execution', async () => {
    const executor = new FakeExecutor()

    await expect(createDeterministicAnalyzer({ catalog, executor }).run({
      question: 'What is net revenue?',
      plan: { ...plan(), expectedShape: { kind: 'single_value', valueColumn: '' } }
    })).rejects.toSatisfy((error: unknown) => error instanceof Error && error.name === 'ContractError')
    expect(executor.calls).toEqual([])
  })
})
