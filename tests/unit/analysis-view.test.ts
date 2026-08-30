import { describe, expect, it } from 'vitest'
import { canInvestigate } from '@/features/analysis/AnalysisPanel'
import { createDemoCatalog } from '@/core/catalog'

describe('analysis view readiness', () => {
  it('requires compatible orders and order_items tables', () => {
    expect(canInvestigate(null)).toBe(false)
    expect(canInvestigate(createDemoCatalog())).toBe(true)
    expect(canInvestigate({ tables: [], relationships: [] })).toBe(false)
  })
})
