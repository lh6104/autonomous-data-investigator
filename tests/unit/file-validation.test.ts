import { describe, expect, it } from 'vitest'
import { allocateSafeTableNames, detectImportFormat, validateImportCandidates } from '@/features/import/file-validation'

function file(name: string, size: number, type = ''): File {
  return { name, size, type } as File
}

describe('detectImportFormat', () => {
  it('accepts supported extensions with blank browser MIME values', () => {
    expect(detectImportFormat(file('orders.csv', 1))).toBe('csv')
    expect(detectImportFormat(file('orders.xlsx', 1))).toBe('xlsx')
    expect(detectImportFormat(file('orders.parquet', 1))).toBe('parquet')
  })

  it('requires a matching extension and known MIME type when supplied', () => {
    expect(detectImportFormat(file('orders.csv', 1, 'text/csv'))).toBe('csv')
    expect(detectImportFormat(file('orders.xlsx', 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe('xlsx')
    expect(detectImportFormat(file('orders.parquet', 1, 'application/vnd.apache.parquet'))).toBe('parquet')
    expect(detectImportFormat(file('orders.csv.exe', 1, 'text/csv'))).toBeNull()
    expect(detectImportFormat(file('orders.csv', 1, 'application/json'))).toBeNull()
    expect(detectImportFormat(file('orders.xls', 1))).toBeNull()
    expect(detectImportFormat(file('orders.xlsm', 1))).toBeNull()
    expect(detectImportFormat(file('orders.json', 1))).toBeNull()
  })
})

describe('validateImportCandidates', () => {
  it('reports empty, unsupported, file-count, total-size, and xlsx-size limits', () => {
    expect(validateImportCandidates([]).issues.map((issue) => issue.code)).toEqual(['empty_selection'])
    expect(validateImportCandidates([file('bad.json', 1)]).issues[0]).toMatchObject({ code: 'unsupported_type', fileName: 'bad.json' })
    expect(validateImportCandidates([file('empty.csv', 0)]).issues[0]).toMatchObject({ code: 'empty_file' })
    expect(validateImportCandidates(Array.from({ length: 11 }, (_, index) => file(`file-${index}.csv`, 1))).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'too_many_files' })]))
    expect(validateImportCandidates([file('big.csv', 250 * 1024 ** 2 + 1)]).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'total_too_large' })]))
    expect(validateImportCandidates([file('big.xlsx', 25 * 1024 ** 2 + 1)]).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'file_too_large' })]))
  })
})

describe('allocateSafeTableNames', () => {
  it('normalizes and de-duplicates names deterministically within DuckDB limits', () => {
    expect(allocateSafeTableNames([
      { fileName: 'Sales FY24.xlsx', sheetName: 'Q1 sales' },
      { fileName: 'Sales FY24.xlsx', sheetName: 'Q1 sales' },
      { fileName: '123 café.csv' },
      { fileName: '.csv' }
    ])).toEqual(['sales_fy24_q1_sales', 'sales_fy24_q1_sales_2', 'data_123_cafe', 'data_table'])
    const [name] = allocateSafeTableNames([{ fileName: `${'a'.repeat(90)}.csv` }])
    expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/)
    expect(allocateSafeTableNames([{ fileName: 'orders.csv' }], ['ORDERS'])).toEqual(['orders_2'])
  })
})
