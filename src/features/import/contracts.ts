import type { Catalog, QueryResult, TableSchema } from '@/core/contracts'

export type ImportFormat = 'csv' | 'xlsx' | 'parquet'

export interface ImportLimits {
  readonly maxFiles: number
  readonly maxTables: number
  readonly maxTotalBytes: number
  readonly maxXlsxBytes: number
  readonly maxPreviewRows: number
  readonly maxRows: number
}

export const DEFAULT_IMPORT_LIMITS = {
  maxFiles: 10,
  maxTables: 10,
  maxTotalBytes: 250 * 1024 ** 2,
  maxXlsxBytes: 25 * 1024 ** 2,
  maxPreviewRows: 1_000,
  maxRows: 2_000_000
} as const satisfies ImportLimits

export type ImportIssueCode =
  | 'empty_selection'
  | 'unsupported_type'
  | 'empty_file'
  | 'too_many_files'
  | 'total_too_large'
  | 'file_too_large'
  | 'too_many_tables'
  | 'invalid_sheet'
  | 'too_many_rows'
  | 'parse_failed'
  | 'import_failed'

export interface ImportIssue {
  readonly code: ImportIssueCode
  readonly fileName: string
  readonly message: string
}

export interface ImportCandidate {
  readonly id: string
  readonly file: File
  readonly format: ImportFormat
  readonly displayName: string
}

export interface ImportSelection {
  readonly candidateId: string
  readonly sheetName?: string
}

export interface ImportedTable {
  readonly name: string
  readonly displayName: string
  readonly sourceFileName: string
  readonly format: ImportFormat
  readonly sheetName?: string
  readonly schema: TableSchema
  readonly preview: QueryResult
}

export interface LocalImportResult {
  readonly catalog: Catalog
  readonly tables: readonly ImportedTable[]
  readonly issues: readonly ImportIssue[]
}

export interface ImportInspection {
  readonly candidates: readonly ImportCandidate[]
  readonly sheets: ReadonlyMap<string, readonly { readonly name: string; readonly rowCount: number; readonly columnCount: number }[]>
  readonly issues: readonly ImportIssue[]
}
