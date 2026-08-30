import { describe, expect, it } from 'vitest'
import type { QueryResult, SqlExecutor, SqlSource } from '@/core/contracts'
import { createLocalImportService } from '@/features/import/local-import-service'
import type { XlsxWorkbookReader } from '@/features/import/xlsx-reader'

function file(name: string, content = 'id,value\n1,ok\n'): File { return new File([content], name, { type: name.endsWith('.csv') ? 'text/csv' : '' }) }
class Executor implements SqlExecutor {
  readonly registered: SqlSource[] = []; readonly dropped: string[] = []; readonly sql: string[] = []
  async registerSource(source: SqlSource) { this.registered.push(source) }
  async dropSource(name: string) { this.dropped.push(name) }
  async explain() {}
  async query(sql: string): Promise<QueryResult> { this.sql.push(sql); return sql.startsWith('SELECT COUNT') ? { columns: ['row_count'], rows: [{ row_count: 1 }], rowCount: 1, durationMs: 1, truncated: false } : { columns: ['user_id'], rows: [{ user_id: 'u1' }], rowCount: 1, durationMs: 1, truncated: false } }
  cancel() {}
  async close() {}
}
const xlsx: XlsxWorkbookReader = { async listSheets() { return [{ name: 'Orders', rowCount: 2, columnCount: 1 }, { name: 'Users', rowCount: 2, columnCount: 1 }] }, async toCsv() { return new TextEncoder().encode('user_id\nu1\n') } }

describe('LocalImportService', () => {
  it('imports CSV, Parquet, and selected sheets with generated safe SQL identifiers', async () => {
    const executor = new Executor(); const service = createLocalImportService({ executor, xlsx })
    const inspection = await service.inspect([file('Sales FY24.csv'), file('snapshot.parquet'), file('book.xlsx')])
    const result = await service.import([{ candidateId: inspection.candidates[0]!.id }, { candidateId: inspection.candidates[1]!.id }, { candidateId: inspection.candidates[2]!.id, sheetName: 'Orders' }])
    expect(result.issues).toEqual([]); expect(executor.registered.map((source) => source.format)).toEqual(['csv', 'parquet', 'csv'])
    expect(executor.sql.every((sql) => sql.includes('"'))).toBe(true)
    expect(result.tables[0]?.schema.rowCount).toBe(1)
  })
})
