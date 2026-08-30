import type {
  Catalog,
  ExpectedResultShape,
  MetricDefinition,
  QueryIntent
} from './contracts'

export interface MetricQueryRequest {
  readonly metricId: string
  readonly intent: QueryIntent
  readonly dimension?: string | undefined
  readonly table?: string | undefined
}

export interface CompiledMetricQuery {
  readonly metric: MetricDefinition
  readonly sql: string
  readonly verificationSql: string
  readonly expectedShape: ExpectedResultShape
  readonly assumptions: readonly string[]
}

const netRevenue: MetricDefinition = Object.freeze({
  id: 'net_revenue',
  name: 'Net Revenue',
  description: 'Revenue from completed orders',
  source: 'orders',
  grain: 'order',
  expression: 'SUM(total_amount)',
  requiredFilter: "order_status = 'Completed'",
  status: 'certified',
  dimensions: Object.freeze(['month'])
})

const metricRegistry: Readonly<Record<string, MetricDefinition>> = Object.freeze({
  [netRevenue.id]: netRevenue
})

export function getMetric(id: string): MetricDefinition | undefined {
  return metricRegistry[id]
}

function fail(message: string): never {
  throw new Error(`Metric compilation failed: ${message}`)
}

function hasColumn(catalog: Catalog, tableName: string, columnName: string): boolean {
  return catalog.tables.some((table) => table.name === tableName && table.columns.some((column) => column.name === columnName))
}

function requireCatalogTable(catalog: Catalog, tableName: string): void {
  if (!catalog.tables.some((table) => table.name === tableName)) fail(`unknown table '${tableName}'`)
}

function requireMetricColumns(metric: MetricDefinition, catalog: Catalog, dimension: string | undefined): void {
  requireCatalogTable(catalog, metric.source)
  if (!hasColumn(catalog, metric.source, 'total_amount') || !hasColumn(catalog, metric.source, 'order_status')) {
    fail(`table '${metric.source}' does not satisfy metric '${metric.id}'`)
  }
  if (dimension === 'month' && !hasColumn(catalog, metric.source, 'order_date')) {
    fail(`table '${metric.source}' has no order_date column`)
  }
}

export function compileMetricQuery(request: MetricQueryRequest, catalog: Catalog): CompiledMetricQuery {
  const metric = getMetric(request.metricId)
  if (!metric) fail(`unknown metric '${request.metricId}'`)
  if (request.table !== undefined) {
    if (!catalog.tables.some((table) => table.name === request.table)) fail(`unknown table '${request.table}'`)
    if (request.table !== metric.source) fail(`metric '${metric.id}' cannot use table '${request.table}'`)
  }
  if (request.intent !== 'kpi' && request.intent !== 'trend') {
    fail(`unsupported intent '${String(request.intent)}'`)
  }

  const dimension = request.dimension
  if (request.intent === 'kpi') {
    if (dimension !== undefined) fail(`dimension '${dimension}' is unsupported for KPI queries`)
    requireMetricColumns(metric, catalog, undefined)
    return {
      metric,
      sql: "SELECT SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed';",
      verificationSql: "SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = 'Completed';",
      expectedShape: { kind: 'single_value', valueColumn: 'net_revenue' },
      assumptions: Object.freeze(["Net Revenue includes only orders where order_status = 'Completed'."])
    }
  }

  if (dimension === undefined) fail('trend queries require a dimension')
  if (!metric.dimensions.includes(dimension)) fail(`unknown dimension '${dimension}' for metric '${metric.id}'`)
  if (dimension !== 'month') fail(`unsupported dimension '${dimension}'`)
  requireMetricColumns(metric, catalog, dimension)

  return {
    metric,
    sql: "SELECT date_trunc('month', order_date) AS month, SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed' GROUP BY month ORDER BY month;",
    verificationSql: "SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = 'Completed';",
    expectedShape: { kind: 'time_series', valueColumn: 'net_revenue', dimensionColumn: 'month' },
    assumptions: Object.freeze(["Net Revenue includes only orders where order_status = 'Completed'.", 'Dates are grouped by UTC calendar month.'])
  }
}
