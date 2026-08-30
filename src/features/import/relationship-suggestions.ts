import type { Catalog, Relationship } from '@/core/contracts'

function identifier(name: string): boolean {
  return name === 'id' || name.endsWith('_id')
}

export function suggestRelationships(catalog: Catalog): Catalog {
  const relationships: Relationship[] = []
  for (const [fromIndex, from] of catalog.tables.entries()) for (const column of from.columns) {
    if (!identifier(column.name)) continue
    for (const to of catalog.tables.slice(fromIndex + 1)) {
      const match = to.columns.find((candidate) => candidate.name === column.name && candidate.type === column.type)
      if (match) relationships.push({ fromTable: from.name, fromColumn: column.name, toTable: to.name, toColumn: match.name, status: 'suggested' })
    }
  }
  return { ...catalog, relationships }
}

export function confirmRelationships(catalog: Catalog, decisions: Readonly<Record<string, 'confirmed' | 'rejected'>>): Catalog {
  return { ...catalog, relationships: catalog.relationships.map((relationship) => {
    const key = `${relationship.fromTable}.${relationship.fromColumn}->${relationship.toTable}.${relationship.toColumn}`
    const status = decisions[key]
    return status ? { ...relationship, status } : relationship
  }) }
}
