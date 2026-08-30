import ExcelJS from 'exceljs'

export interface XlsxSheet {
  readonly name: string
  readonly rowCount: number
  readonly columnCount: number
}

export interface XlsxWorkbookReader {
  listSheets(file: File): Promise<readonly XlsxSheet[]>
  toCsv(file: File, sheetName: string, maxRows: number): Promise<Uint8Array>
}

function scalar(value: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value ?? null
  if (typeof value === 'object' && 'formula' in value) {
    const result = value.result
    return result === null || result === undefined || typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || result instanceof Date ? result ?? null : null
  }
  return null
}

function text(value: string | number | boolean | Date | null): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function csv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

async function workbook(file: File): Promise<ExcelJS.Workbook> {
  const result = new ExcelJS.Workbook()
  await result.xlsx.load(await file.arrayBuffer())
  return result
}

function headers(sheet: ExcelJS.Worksheet): string[] {
  const used = new Set<string>()
  const first = sheet.getRow(1)
  const count = Math.max(first.cellCount, sheet.columnCount)
  return Array.from({ length: count }, (_, index) => {
    const raw = text(scalar(first.getCell(index + 1).value)).trim() || `column_${index + 1}`
    let value = raw
    let suffix = 2
    while (used.has(value.toLowerCase())) value = `${raw}_${suffix++}`
    used.add(value.toLowerCase())
    return value
  })
}

export function createXlsxWorkbookReader(): XlsxWorkbookReader {
  return {
    async listSheets(file) {
      const book = await workbook(file)
      return book.worksheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount }))
    },
    async toCsv(file, sheetName, maxRows) {
      const book = await workbook(file)
      const sheet = book.getWorksheet(sheetName)
      if (!sheet) throw new Error('Selected worksheet was not found.')
      if (sheet.rowCount - 1 > maxRows) throw new Error('Selected worksheet exceeds the row limit.')
      const names = headers(sheet)
      if (names.length === 0) throw new Error('Selected worksheet has no usable header row.')
      const lines = [names.map(csv).join(',')]
      for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
        const row = sheet.getRow(rowIndex)
        lines.push(names.map((_, index) => csv(text(scalar(row.getCell(index + 1).value)))).join(','))
      }
      return new TextEncoder().encode(`${lines.join('\r\n')}\r\n`)
    }
  }
}
