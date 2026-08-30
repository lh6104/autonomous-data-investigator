import { describe, expect, it } from 'vitest'
import { createDemoCatalog, profileTable } from '@/core/catalog'

describe('profileTable', () => {
  it('profiles logical types, nulls, counts, ranges, and deterministic top values', () => {
    const table = profileTable('mixed', ['count', 'amount', 'active', 'day', 'instant', 'label'], [
      { count: '2', amount: '1.50', active: 'true', day: '2025-01-01', instant: '2025-01-01T10:00:00Z', label: 'b' },
      { count: '1', amount: '2.00', active: 'false', day: '2025-01-02', instant: '2025-01-02T10:00:00Z', label: 'a' },
      { count: null, amount: '', active: null, day: null, instant: null, label: 'b' }
    ])
    const byName = Object.fromEntries(table.columns.map((column) => [column.name, column]))
    expect(byName.count).toMatchObject({ type: 'integer', nullCount: 1, nullRate: 1 / 3, distinctCount: 2, min: 1, max: 2 })
    expect(byName.amount).toMatchObject({ type: 'decimal', min: 1.5, max: 2, distinctCount: 2 })
    expect(byName.active).toMatchObject({ type: 'boolean', nullCount: 1 })
    expect(byName.day).toMatchObject({ type: 'date', min: '2025-01-01T00:00:00.000Z' })
    expect(byName.instant).toMatchObject({ type: 'timestamp', max: '2025-01-02T10:00:00.000Z' })
    expect(byName.label).toMatchObject({ type: 'string', topValues: [{ value: 'b', count: 2 }, { value: 'a', count: 1 }] })
  })

  it('classifies PII and identifiers', () => {
    const table = profileTable('people', ['email', 'name', 'user_id', 'city', 'value'], [{ email: 'a@example.test', name: 'Synthetic', user_id: 'U1', city: 'Hanoi', value: 'x' }])
    const byName = Object.fromEntries(table.columns.map((column) => [column.name, column]))
    expect(byName.email?.pii).toBe('direct')
    expect(byName.name?.pii).toBe('quasi')
    expect(byName.user_id?.pii).toBe('identifier')
    expect(byName.city?.pii).toBe('quasi')
    expect(byName.value?.pii).toBe('none')
  })
})

describe('createDemoCatalog', () => {
  it('contains six tables and confirmed demo relationships without samples', () => {
    const catalog = createDemoCatalog()
    expect(catalog.tables.map((table) => table.name)).toEqual(['users', 'products', 'orders', 'order_items', 'reviews', 'events'])
    expect(catalog.relationships.filter((relationship) => relationship.status === 'confirmed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromTable: 'orders', fromColumn: 'order_id', toTable: 'order_items', toColumn: 'order_id' }),
      expect.objectContaining({ fromTable: 'users', fromColumn: 'user_id', toTable: 'orders', toColumn: 'user_id' }),
      expect.objectContaining({ fromTable: 'products', fromColumn: 'product_id', toTable: 'order_items', toColumn: 'product_id' })
    ]))
    expect(JSON.stringify(catalog)).not.toContain('@example')
  })
})
