import { describe, expect, it } from 'vitest'
import { createDemoCatalog } from '@/core/catalog'
import { guardSql } from '@/core/sql-guard'

const catalog = createDemoCatalog()
const primary = "SELECT SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed';"

function codes(sql: string, options?: Parameters<typeof guardSql>[2]): string[] {
  return guardSql(sql, catalog, options).violations.map((violation) => violation.code)
}

describe('guardSql', () => {
  it('accepts certified, bounded aggregate, and EXPLAIN queries', () => {
    expect(guardSql(` -- comment\n ${primary}`, catalog)).toMatchObject({ sql: primary, violations: [] })
    expect(codes('SELECT order_status, SUM(total_amount) AS revenue FROM orders GROUP BY order_status ORDER BY order_status LIMIT 100;')).toEqual([])
    expect(codes(`EXPLAIN ${primary}`)).toEqual([])
  })

  it('normalizes comments and whitespace without changing literals', () => {
    const guarded = guardSql("SELECT  order_status  FROM orders -- ignore this\n WHERE order_status = 'Completed' LIMIT 10;", catalog)
    expect(guarded.sql).toBe("SELECT order_status FROM orders WHERE order_status = 'Completed' LIMIT 10;")
    expect(guarded.violations).toEqual([])
  })

  it('rejects multiple statements and write or DDL operations', () => {
    expect(codes(`${primary} SELECT 1`)).toContain('multiple_statements')
    for (const keyword of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'COPY', 'ATTACH', 'INSTALL', 'LOAD']) {
      expect(codes(`${keyword} INTO orders SELECT 1`)).toContain('dangerous_keyword')
    }
  })

  it('rejects file readers, httpfs, and path or URL literals', () => {
    for (const expression of [
      "read_csv_auto('/tmp/orders.csv')",
      "read_parquet('https://example.test/orders.parquet')",
      "httpfs('s3://bucket/orders.parquet')"
    ]) {
      const violationCodes = codes(`SELECT * FROM ${expression};`)
      expect(violationCodes).toContain('dangerous_function')
      expect(violationCodes).toContain('path_literal')
    }
  })

  it('rejects unknown schema references and invalid joins', () => {
    expect(codes('SELECT unknown_column FROM orders LIMIT 10;')).toContain('unknown_column')
    expect(codes('SELECT order_id FROM missing_table LIMIT 10;')).toContain('unknown_table')
    expect(codes('SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = \'Completed\';')).toEqual([])
    expect(codes('SELECT o.order_id FROM orders o JOIN users u ON o.order_id = u.user_id LIMIT 10;')).toContain('invalid_join')
    expect(codes('SELECT * FROM orders CROSS JOIN users LIMIT 10;')).toContain('cross_join')
  })

  it('requires bounded detail output and enforces row, join, and CTE budgets', () => {
    expect(codes('SELECT order_id FROM orders;')).toContain('missing_limit')
    expect(codes('SELECT order_id FROM orders LIMIT 10001;')).toContain('row_limit')
    expect(codes('SELECT order_id FROM orders LIMIT 100;', { maxRows: 50 })).toContain('row_limit')
    expect(codes('SELECT o.order_id FROM orders o JOIN order_items oi ON o.order_id = oi.order_id LIMIT 10;', { maxJoins: 0 })).toContain('complexity')
    expect(codes('WITH completed AS (SELECT order_id FROM orders) SELECT order_id FROM completed LIMIT 10;', { maxCtes: 0 })).toContain('complexity')
  })
})
