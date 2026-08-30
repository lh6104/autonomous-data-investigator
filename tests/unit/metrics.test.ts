import { describe, expect, it } from 'vitest'
import { createDemoCatalog } from '@/core/catalog'
import { compileMetricQuery, getMetric } from '@/core/metrics'

const catalog = createDemoCatalog()

describe('certified metrics', () => {
  it('registers exactly one certified Net Revenue metric', () => {
    const metric = getMetric('net_revenue')
    expect(metric).toMatchObject({
      name: 'Net Revenue',
      source: 'orders',
      grain: 'order',
      expression: 'SUM(total_amount)',
      requiredFilter: "order_status = 'Completed'",
      status: 'certified'
    })
    expect(metric?.dimensions).toEqual(['month'])
    expect(getMetric('missing')).toBeUndefined()
  })

  it('compiles the primary KPI and reconciliation query', () => {
    expect(compileMetricQuery({ metricId: 'net_revenue', intent: 'kpi' }, catalog)).toEqual({
      metric: getMetric('net_revenue'),
      sql: "SELECT SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed';",
      verificationSql: "SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = 'Completed';",
      expectedShape: { kind: 'single_value', valueColumn: 'net_revenue' },
      assumptions: ["Net Revenue includes only orders where order_status = 'Completed'."]
    })
  })

  it('compiles the UTC monthly trend with deterministic ordering', () => {
    const compiled = compileMetricQuery({ metricId: 'net_revenue', intent: 'trend', dimension: 'month' }, catalog)
    expect(compiled.sql).toBe("SELECT date_trunc('month', order_date) AS month, SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed' GROUP BY month ORDER BY month;")
    expect(compiled.expectedShape).toEqual({ kind: 'time_series', valueColumn: 'net_revenue', dimensionColumn: 'month' })
    expect(compiled.assumptions).toContain('Dates are grouped by UTC calendar month.')
  })

  it('rejects unknown metrics, tables, dimensions, and unsupported intents', () => {
    expect(() => compileMetricQuery({ metricId: 'missing', intent: 'kpi' }, catalog)).toThrow("unknown metric 'missing'")
    expect(() => compileMetricQuery({ metricId: 'net_revenue', intent: 'kpi', table: 'users' }, catalog)).toThrow("cannot use table 'users'")
    expect(() => compileMetricQuery({ metricId: 'net_revenue', intent: 'kpi', dimension: 'month' }, catalog)).toThrow("dimension 'month' is unsupported for KPI queries")
    expect(() => compileMetricQuery({ metricId: 'net_revenue', intent: 'trend' }, catalog)).toThrow('trend queries require a dimension')
    expect(() => compileMetricQuery({ metricId: 'net_revenue', intent: 'trend', dimension: 'year' }, catalog)).toThrow("unknown dimension 'year'")
    expect(() => compileMetricQuery({ metricId: 'net_revenue', intent: 'trend', dimension: 'month', table: 'users' }, catalog)).toThrow("cannot use table 'users'")
    expect(() => compileMetricQuery({ metricId: 'net_revenue', intent: 'other' as 'kpi' }, catalog)).toThrow("unsupported intent 'other'")
  })
})
