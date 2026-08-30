import { describe, expect, it } from 'vitest'
import { parseAnalysisPlanRequest, parseSynthesisResponse } from '@/ai/contracts'

describe('AI contracts', () => {
  it('rejects unknown fields, oversized questions, and non-three recommendations', () => {
    expect(() => parseAnalysisPlanRequest({ question: 'x'.repeat(2001), schema: { tables: [], relationships: [] }, metrics: [] })).toThrow()
    expect(() => parseSynthesisResponse({ summary: 'x', recommendations: [{ priority: 1, action: 'x', evidenceIds: ['query:primary'] }] })).toThrow()
  })
})
