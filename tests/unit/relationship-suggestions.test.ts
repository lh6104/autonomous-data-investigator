import { describe, expect, it } from 'vitest'
import { confirmRelationships, suggestRelationships } from '@/features/import/relationship-suggestions'

const catalog = { tables: [
  { name: 'orders', rowCount: 1, columns: [{ name: 'user_id', type: 'string', pii: 'identifier', nullable: false, nullCount: 0, nullRate: 0, distinctCount: 1, topValues: [] }] },
  { name: 'users', rowCount: 1, columns: [{ name: 'user_id', type: 'string', pii: 'identifier', nullable: false, nullCount: 0, nullRate: 0, distinctCount: 1, topValues: [] }] }
], relationships: [] } as const

it('only suggests matching identifier columns and requires an explicit decision', () => {
  const suggested = suggestRelationships(catalog)
  expect(suggested.relationships).toHaveLength(1)
  expect(suggested.relationships).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'suggested', fromTable: 'orders', toTable: 'users' })]))
  const key = 'orders.user_id->users.user_id'
  expect(confirmRelationships(suggested, { [key]: 'confirmed' }).relationships.find((relationship) => relationship.fromTable === 'orders' && relationship.toTable === 'users')?.status).toBe('confirmed')
})
