import type { Catalog, QueryResult, SqlExecutor } from '@/core/contracts'
import { profileTable } from '@/core/catalog'
import type { ImportCandidate, ImportInspection, ImportIssue, ImportLimits, ImportSelection, LocalImportResult } from './contracts'
import { DEFAULT_IMPORT_LIMITS } from './contracts'
import { allocateSafeTableNames, validateImportCandidates } from './file-validation'
import type { XlsxWorkbookReader } from './xlsx-reader'
import { suggestRelationships } from './relationship-suggestions'

export interface LocalImportService {
  inspect(files: readonly File[]): Promise<ImportInspection>
  import(selection: readonly ImportSelection[], signal?: AbortSignal): Promise<LocalImportResult>
}

function identifier(name: string): string { return `"${name.replaceAll('"', '""')}"` }
function failure(code: ImportIssue['code'], fileName: string, message: string): ImportIssue { return { code, fileName, message } }
function count(result: QueryResult): number { const value = result.rows[0]?.row_count; return typeof value === 'number' ? value : Number(value) }

export function createLocalImportService(deps: { readonly executor: SqlExecutor; readonly xlsx: XlsxWorkbookReader; readonly limits?: Partial<ImportLimits> }): LocalImportService {
  const limits: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...deps.limits }
  let candidates = new Map<string, ImportCandidate>()
  let sheets = new Map<string, readonly { readonly name: string; readonly rowCount: number; readonly columnCount: number }[]>()
  let successfulTables: LocalImportResult['tables'][number][] = []
  const result = (issues: readonly ImportIssue[]): LocalImportResult => ({
    catalog: suggestRelationships({ tables: successfulTables.map((table) => table.schema), relationships: [] }),
    tables: successfulTables,
    issues
  })
  return {
    async inspect(files) {
      const validation = validateImportCandidates(files, limits)
      candidates = new Map(validation.candidates.map((candidate) => [candidate.id, candidate]))
      sheets = new Map()
      const issues = [...validation.issues]
      for (const candidate of validation.candidates) if (candidate.format === 'xlsx') {
        try { sheets.set(candidate.id, await deps.xlsx.listSheets(candidate.file)) }
        catch { issues.push(failure('parse_failed', candidate.file.name, 'The workbook could not be read.')) }
      }
      return { candidates: validation.candidates, sheets, issues }
    },
    async import(selection, signal) {
      const selected = selection.map((choice) => ({ choice, candidate: candidates.get(choice.candidateId) })).filter((value): value is { choice: ImportSelection; candidate: ImportCandidate } => value.candidate !== undefined)
      if (selected.length !== selection.length || selected.length === 0) return result([failure('invalid_sheet', '', 'Select inspected files before importing.')])
      if (successfulTables.length + selected.length > limits.maxTables) return result([failure('too_many_tables', '', 'Selected sources exceed the table limit.')])
      for (const { choice, candidate } of selected) if (candidate.format === 'xlsx' && (!choice.sheetName || !sheets.get(candidate.id)?.some((sheet) => sheet.name === choice.sheetName))) return { catalog: { tables: [], relationships: [] }, tables: [], issues: [failure('invalid_sheet', candidate.file.name, 'Select a worksheet from this workbook.')] }
      const names = allocateSafeTableNames(selected.map(({ choice, candidate }) => choice.sheetName === undefined ? { fileName: candidate.file.name } : { fileName: candidate.file.name, sheetName: choice.sheetName }), successfulTables.map((table) => table.name))
      const registered: string[] = []
      const tables: LocalImportResult['tables'][number][] = []
      try {
        for (const [index, item] of selected.entries()) {
          if (signal?.aborted) throw new Error('Import cancelled.')
          const name = names[index]!
          const parsed = item.candidate.format === 'xlsx' ? await deps.xlsx.toCsv(item.candidate.file, item.choice.sheetName!, limits.maxRows) : undefined
          const bytes: ArrayBuffer = parsed === undefined
            ? await item.candidate.file.arrayBuffer()
            : parsed.buffer.slice(parsed.byteOffset, parsed.byteOffset + parsed.byteLength) as ArrayBuffer
          await deps.executor.registerSource({ name, format: item.candidate.format === 'xlsx' ? 'csv' : item.candidate.format, bytes })
          registered.push(name)
          const rowCount = count(await deps.executor.query(`SELECT COUNT(*) AS row_count FROM ${identifier(name)};`, signal))
          if (!Number.isFinite(rowCount) || rowCount > limits.maxRows) throw new Error('Imported table exceeds the row limit.')
          const preview = await deps.executor.query(`SELECT * FROM ${identifier(name)} LIMIT ${limits.maxPreviewRows};`, signal)
          const previewSchema = profileTable(name, preview.columns, preview.rows)
          tables.push({ name, displayName: item.choice.sheetName ?? item.candidate.file.name, sourceFileName: item.candidate.file.name, format: item.candidate.format, ...(item.choice.sheetName ? { sheetName: item.choice.sheetName } : {}), schema: { ...previewSchema, rowCount }, preview })
        }
        successfulTables = [...successfulTables, ...tables]
        return result([])
      } catch (error) {
        await Promise.all(registered.map(async (name) => { try { await deps.executor.dropSource(name) } catch {} }))
        const reason = error instanceof Error ? error.message : String(error)
        return result([failure('import_failed', '', `Import failed locally: ${reason} No new tables were retained.`)])
      }
    }
  }
}
