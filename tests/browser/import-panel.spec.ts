import { expect, test } from '@playwright/test'

test('rejects unsupported files before data reaches DuckDB', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Choose CSV, XLSX, or Parquet files').setInputFiles({
    name: 'customers.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"customer_id": 1}')
  })

  await expect(page.getByRole('alert')).toContainText('Only CSV, XLSX, and Parquet files are supported.')
  await expect(page.getByRole('button', { name: 'Import selected data' })).toBeDisabled()
})
