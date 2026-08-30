import type { Catalog, ColumnProfile, ColumnType, PiiClass, TableSchema } from './contracts'

const MAX_TOP_VALUES = 5

function isNull(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

function classifyPii(name: string): PiiClass {
  const normalized = name.toLowerCase()
  if (normalized === 'email' || normalized.endsWith('_email') || normalized.includes('email')) return 'direct'
  if (normalized.endsWith('_id') || normalized === 'id') return 'identifier'
  if (/name|phone|address|city/.test(normalized)) return 'quasi'
  return 'none'
}

function classifyType(values: readonly unknown[]): ColumnType {
  const present = values.filter((value) => !isNull(value))
  if (present.length === 0) return 'unknown'
  if (present.every((value) => typeof value === 'boolean' || value === 'true' || value === 'false')) return 'boolean'
  if (present.every((value) => typeof value === 'number' && Number.isInteger(value) || typeof value === 'string' && /^[-+]?\d+$/.test(value))) return 'integer'
  if (present.every((value) => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^[-+]?(?:\d+\.\d*|\d*\.\d+)$/.test(value))) return 'decimal'
  if (present.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date'
  if (present.every((value) => value instanceof Date || typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /T|\d{2}:\d{2}/.test(value))) return 'timestamp'
  return 'string'
}

function normalizedValue(value: unknown, type: ColumnType): string | number | boolean {
  if (type === 'timestamp' && value instanceof Date) return value.toISOString()
  if (type === 'timestamp' && typeof value === 'string') return new Date(value).toISOString()
  if (type === 'date' && typeof value === 'string') return `${value}T00:00:00.000Z`
  if (type === 'boolean' && typeof value === 'string') return value === 'true'
  if ((type === 'integer' || type === 'decimal') && typeof value === 'string') return Number(value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function valueKey(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function profileTable(tableName: string, columns: readonly string[], rows: readonly Readonly<Record<string, unknown>>[]): TableSchema {
  const profiles = columns.map((name): ColumnProfile => {
    const values = rows.map((row) => row[name])
    const type = classifyType(values)
    const present = values.filter((value) => !isNull(value))
    const normalized = present.map((value) => normalizedValue(value, type))
    const counts = new Map<string, number>()
    for (const value of present) {
      const key = valueKey(normalizedValue(value, type))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const topValues = [...counts.entries()]
      .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
      .slice(0, MAX_TOP_VALUES)
      .map(([value, count]) => ({ value, count }))
    const sorted = [...normalized].sort((left, right) => String(left).localeCompare(String(right)))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    return {
      name,
      type,
      pii: classifyPii(name),
      nullable: values.some((value) => isNull(value)),
      nullCount: values.length - present.length,
      nullRate: values.length === 0 ? 0 : (values.length - present.length) / values.length,
      distinctCount: counts.size,
      topValues,
      ...(first === undefined ? {} : { min: first }),
      ...(last === undefined ? {} : { max: last })
    }
  })
  return { name: tableName, rowCount: rows.length, columns: profiles }
}

function knownColumn(name: string, type: ColumnType, pii: PiiClass = classifyPii(name)): ColumnProfile {
  return {
    name,
    type,
    pii,
    nullable: true,
    nullCount: 0,
    nullRate: 0,
    distinctCount: 0,
    topValues: []
  }
}

const demoTables: readonly TableSchema[] = [
  { name: 'users', rowCount: 0, columns: [knownColumn('user_id', 'string'), knownColumn('name', 'string'), knownColumn('email', 'string', 'direct'), knownColumn('gender', 'string'), knownColumn('city', 'string'), knownColumn('signup_date', 'date')] },
  { name: 'products', rowCount: 0, columns: [knownColumn('product_id', 'string'), knownColumn('product_name', 'string', 'quasi'), knownColumn('category', 'string'), knownColumn('price', 'decimal'), knownColumn('rating', 'decimal')] },
  { name: 'orders', rowCount: 0, columns: [knownColumn('order_id', 'string'), knownColumn('user_id', 'string'), knownColumn('order_date', 'timestamp'), knownColumn('order_status', 'string'), knownColumn('total_amount', 'decimal')] },
  { name: 'order_items', rowCount: 0, columns: [knownColumn('order_item_id', 'string'), knownColumn('order_id', 'string'), knownColumn('product_id', 'string'), knownColumn('quantity', 'integer'), knownColumn('item_price', 'decimal')] },
  { name: 'reviews', rowCount: 0, columns: [knownColumn('review_id', 'string'), knownColumn('user_id', 'string'), knownColumn('product_id', 'string'), knownColumn('rating', 'integer'), knownColumn('review_text', 'string'), knownColumn('review_date', 'date')] },
  { name: 'events', rowCount: 0, columns: [knownColumn('event_id', 'string'), knownColumn('user_id', 'string'), knownColumn('product_id', 'string'), knownColumn('event_type', 'string'), knownColumn('event_timestamp', 'timestamp')] }
]

export function createDemoCatalog(): Catalog {
  return {
    tables: demoTables,
    relationships: [
      { fromTable: 'orders', fromColumn: 'order_id', toTable: 'order_items', toColumn: 'order_id', status: 'confirmed', matchRate: 1 },
      { fromTable: 'users', fromColumn: 'user_id', toTable: 'orders', toColumn: 'user_id', status: 'confirmed', matchRate: 1 },
      { fromTable: 'products', fromColumn: 'product_id', toTable: 'order_items', toColumn: 'product_id', status: 'confirmed', matchRate: 1 }
    ]
  }
}
