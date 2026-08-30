import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { createXlsxWorkbookReader } from '@/features/import/xlsx-reader'

async function fixture(): Promise<File> {
  const book = new ExcelJS.Workbook()
  const orders = book.addWorksheet('Orders')
  orders.addRow(['customer, name', 'customer, name', '', 'created'])
  orders.addRow(['A\nB', '"quoted"', 12, new Date('2026-01-02T03:04:05.000Z')])
  book.addWorksheet('Customers').addRow(['id'])
  return new File([await book.xlsx.writeBuffer()], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

describe('createXlsxWorkbookReader', () => {
  it('lists sheets and converts only the selected sheet to escaped CSV', async () => {
    const reader = createXlsxWorkbookReader()
    const file = await fixture()
    expect((await reader.listSheets(file)).map((sheet) => sheet.name)).toEqual(['Orders', 'Customers'])
    const value = new TextDecoder().decode(await reader.toCsv(file, 'Orders', 100))
    expect(value).toContain('"customer, name","customer, name_2",column_3,created')
    expect(value).toContain('"A\nB","""quoted""",12,2026-01-02T03:04:05.000Z')
  })

  it('rejects missing sheets and sheets beyond the row cap', async () => {
    const reader = createXlsxWorkbookReader()
    const file = await fixture()
    await expect(reader.toCsv(file, 'Missing', 100)).rejects.toThrow('not found')
    await expect(reader.toCsv(file, 'Orders', 0)).rejects.toThrow('row limit')
  })
})
