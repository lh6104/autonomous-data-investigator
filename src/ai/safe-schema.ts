import type { Catalog, MetricDefinition } from '@/core/contracts'
import { AI_LIMITS, parseAnalysisPlanRequest, type AnalysisPlanRequest } from './contracts'

export function serializedPayloadBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength }

export function createSafeSchemaContext(catalog: Catalog): AnalysisPlanRequest['schema'] {
  return {
    tables: catalog.tables.slice(0, AI_LIMITS.maxTables).map((table) => ({
      name: table.name, rowCount: table.rowCount,
      columns: table.columns.slice(0, AI_LIMITS.maxColumnsPerTable).map((column) => ({ name: column.name, type: column.type, pii: column.pii, nullable: column.nullable, nullCount: column.nullCount, nullRate: column.nullRate, distinctCount: column.distinctCount }))
    })),
    relationships: catalog.relationships.filter((relationship) => relationship.status === 'confirmed').map(({ fromTable, fromColumn, toTable, toColumn, matchRate }) => ({ fromTable, fromColumn, toTable, toColumn, ...(matchRate === undefined ? {} : { matchRate }) }))
  }
}
export function createAnalysisPlanRequest(question: string, catalog: Catalog, metrics: readonly MetricDefinition[]): AnalysisPlanRequest {
  const request = { question, schema: createSafeSchemaContext(catalog), metrics: metrics.filter((metric) => metric.id === 'net_revenue' && metric.status === 'certified').map((metric) => ({ id: 'net_revenue' as const, name: metric.name, description: metric.description, source: metric.source, grain: metric.grain, expression: metric.expression, requiredFilter: metric.requiredFilter, status: 'certified' as const, dimensions: [...metric.dimensions] })) }
  const parsed = parseAnalysisPlanRequest(request)
  if (serializedPayloadBytes(parsed) > AI_LIMITS.maxPayloadBytes) throw new Error('analysis plan payload exceeds 128 KiB')
  return parsed
}
