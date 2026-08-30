import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

const orders = await readFile('tests/fixtures/orders.csv')
const orderItems = await readFile('tests/fixtures/order_items.csv')
const parquetFixture = await readFile('tests/fixtures/null_list.parquet')

test('executes guarded local CSV queries in DuckDB-Wasm', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort()
    return route.continue()
  })
  await page.goto('/')
  const values = await page.evaluate(async ({ ordersBytes, orderItemsBytes }) => {
    const [{ DuckDbClient }, { createDemoCatalog }, { guardSql }] = await Promise.all([
      import(new URL('/src/workers/duckdb-client.ts', location.origin).href),
      import(new URL('/src/core/catalog.ts', location.origin).href),
      import(new URL('/src/core/sql-guard.ts', location.origin).href)
    ])
    const client = new DuckDbClient()
    try {
      await client.registerSource({ name: 'orders', format: 'csv', bytes: Uint8Array.from(ordersBytes).buffer })
      await client.registerSource({ name: 'order_items', format: 'csv', bytes: Uint8Array.from(orderItemsBytes).buffer })
      const catalog = createDemoCatalog()
      const guardedPrimary = guardSql("SELECT SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed';", catalog)
      const guardedVerification = guardSql("SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = 'Completed';", catalog)
      if (guardedPrimary.violations.length > 0 || guardedVerification.violations.length > 0) throw new Error('SQL guard rejected fixture query')
      const primary = await client.query(guardedPrimary.sql)
      const verification = await client.query(guardedVerification.sql)
      return { primary, verification }
    } finally {
      await client.close()
    }
  }, { ordersBytes: [...orders], orderItemsBytes: [...orderItems] })

  expect(values.primary.rows).toEqual([{ net_revenue: 125 }])
  expect(values.verification.rows).toEqual([{ item_level_revenue: 125 }])
})

test('registers and queries a local Parquet file in DuckDB-Wasm', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort()
    return route.continue()
  })
  page.on('response', (response) => {
    if (response.url().includes('parquet.duckdb_extension')) console.log('[extension]', response.status(), response.url())
  })
  await page.goto('/')

  const result = await page.evaluate(async (fixtureBytes) => {
    const { DuckDbClient } = await import(new URL('/src/workers/duckdb-client.ts', location.origin).href)
    const client = new DuckDbClient()
    try {
      await client.registerSource({
        name: 'parquet_fixture',
        format: 'parquet',
        bytes: Uint8Array.from(fixtureBytes).buffer
      })
      return await client.query('SELECT COUNT(*) AS row_count FROM parquet_fixture')
    } finally {
      await client.close()
    }
  }, [...parquetFixture])

  expect(result.rows).toHaveLength(1)
  expect(Number(result.rows[0]?.row_count)).toBeGreaterThan(0)
})
