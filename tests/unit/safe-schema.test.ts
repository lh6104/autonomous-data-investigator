import { describe, expect, it } from 'vitest'
import { profileTable } from '@/core/catalog'
import { createAnalysisPlanRequest, createSafeSchemaContext } from '@/ai/safe-schema'
import { getMetric } from '@/core/metrics'
import type { Catalog } from '@/core/contracts'

describe('safe schema', () => {
  it('does not serialize profile examples or ranges', () => {
    const context = createSafeSchemaContext({ tables: [profileTable('people', ['email', 'name', 'value'], [{ email: 'a@example.test', name: 'Ada', value: 'ok' }])], relationships: [] })
    const json = JSON.stringify(context)
    expect(json).not.toContain('a@example.test'); expect(json).not.toContain('Ada'); expect(json).not.toContain('topValues')
  })
  it('validates certified metrics before provider use', () => {
    expect(() => createAnalysisPlanRequest('q', { tables: [], relationships: [] }, [])).toThrow()
  })
  it('rejects oversized serialized plan payloads', () => {
    const catalog: Catalog = { tables: [], relationships: Array.from({ length: 4_000 }, (_, index) => ({ fromTable: `a${index}`, fromColumn: 'x'.repeat(63), toTable: `b${index}`, toColumn: 'y'.repeat(63), status: 'confirmed' as const, matchRate: 1 })) }
    expect(() => createAnalysisPlanRequest('q', catalog, [getMetric('net_revenue')!])).toThrow(/128 KiB/)
  })
})
