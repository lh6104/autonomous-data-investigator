import { describe, expect, it } from 'vitest'
import { createSynthesisRequest } from '@/ai/privacy'
import type { AnalysisResult } from '@/core/contracts'

describe('AI privacy', () => {
  it('bounds evidence to 100 scalar rows', () => {
    const analysis: AnalysisResult = { question: 'q', sql: 'SELECT 1', rows: [], evidence: [{ id: 'query:primary', kind: 'query_result', sql: 'SELECT 1', columns: ['n'], rowCount: 101, rows: Array.from({ length: 101 }, (_, n) => ({ n })) }], checks: [], trust: { verdict: 'verified', checks: [] }, warnings: [] }
    expect(createSynthesisRequest('q', 'q', analysis, { kind: 'kpi', y: 'n' }).evidence[0]?.rows).toHaveLength(100)
  })
})
