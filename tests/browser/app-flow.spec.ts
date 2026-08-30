import { expect, test } from '@playwright/test'

test('imports local tables and completes a verified revenue investigation', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Choose CSV, XLSX, or Parquet files').setInputFiles([
    'tests/fixtures/orders.csv',
    'tests/fixtures/order_items.csv'
  ])

  await expect(page.getByRole('status').filter({ hasText: 'Choose workbook sheets' })).toBeVisible()
  await page.getByRole('button', { name: 'Import selected data' }).click()
  await expect(page.getByText('orders', { exact: true })).toBeVisible()
  await expect(page.getByText('order_items', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Confirm' }).click()
  const question = page.getByLabel('Business question')
  await expect(question).toBeEnabled()
  await question.fill('What is net revenue?')
  await page.getByRole('button', { name: 'Run investigation' }).click()

  await expect(page.getByText('Analysis complete')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Trust report: verified/i })).toBeVisible()
  await expect(page.getByText('125', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.synthesis ol > li')).toHaveCount(3)
})
