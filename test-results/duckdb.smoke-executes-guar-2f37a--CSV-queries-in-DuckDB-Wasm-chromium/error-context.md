# Test info

- Name: executes guarded local CSV queries in DuckDB-Wasm
- Location: /home/longha/Desktop/ai-riser-research/tests/browser/duckdb.smoke.spec.ts:7:1

# Error details

```
Error: browserType.launch: Executable doesn't exist at /home/longha/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     npx playwright install                                              ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
```

# Test source

```ts
   1 | import { readFile } from 'node:fs/promises'
   2 | import { test, expect } from '@playwright/test'
   3 |
   4 | const orders = await readFile('tests/fixtures/orders.csv')
   5 | const orderItems = await readFile('tests/fixtures/order_items.csv')
   6 |
>  7 | test('executes guarded local CSV queries in DuckDB-Wasm', async ({ page, baseURL }) => {
     | ^ Error: browserType.launch: Executable doesn't exist at /home/longha/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
   8 |   const origin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin
   9 |   await page.route('**/*', async (route) => {
  10 |     if (new URL(route.request().url()).origin !== origin) return route.abort()
  11 |     return route.continue()
  12 |   })
  13 |   await page.goto('/')
  14 |   const values = await page.evaluate(async ({ ordersBytes, orderItemsBytes }) => {
  15 |     const [{ DuckDbClient }, { createDemoCatalog }, { guardSql }] = await Promise.all([
  16 |       import(new URL('/src/workers/duckdb-client.ts', location.origin).href),
  17 |       import(new URL('/src/core/catalog.ts', location.origin).href),
  18 |       import(new URL('/src/core/sql-guard.ts', location.origin).href)
  19 |     ])
  20 |     const client = new DuckDbClient()
  21 |     try {
  22 |       await client.registerSource({ name: 'orders', format: 'csv', bytes: Uint8Array.from(ordersBytes).buffer })
  23 |       await client.registerSource({ name: 'order_items', format: 'csv', bytes: Uint8Array.from(orderItemsBytes).buffer })
  24 |       const catalog = createDemoCatalog()
  25 |       const guardedPrimary = guardSql("SELECT SUM(total_amount) AS net_revenue FROM orders WHERE order_status = 'Completed';", catalog)
  26 |       const guardedVerification = guardSql("SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.order_status = 'Completed';", catalog)
  27 |       if (guardedPrimary.violations.length > 0 || guardedVerification.violations.length > 0) throw new Error('SQL guard rejected fixture query')
  28 |       const primary = await client.query(guardedPrimary.sql)
  29 |       const verification = await client.query(guardedVerification.sql)
  30 |       return { primary, verification }
  31 |     } finally {
  32 |       await client.close()
  33 |     }
  34 |   }, { ordersBytes: [...orders], orderItemsBytes: [...orderItems] })
  35 |
  36 |   expect(values.primary.rows).toEqual([{ net_revenue: 125 }])
  37 |   expect(values.verification.rows).toEqual([{ item_level_revenue: 125 }])
  38 | })
  39 |
```