import {
  DEFAULT_IMPORT_LIMITS,
  type ImportCandidate,
  type ImportFormat,
  type ImportIssue,
  type ImportLimits
} from './contracts'

const MIME_TYPES: Readonly<Record<ImportFormat, readonly string[]>> = {
  csv: ['text/csv', 'application/csv', 'text/plain'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  parquet: ['application/vnd.apache.parquet', 'application/parquet', 'application/octet-stream']
}

const EXTENSIONS: Readonly<Record<ImportFormat, string>> = {
  csv: '.csv',
  xlsx: '.xlsx',
  parquet: '.parquet'
}

function issue(code: ImportIssue['code'], fileName: string, message: string): ImportIssue {
  return { code, fileName, message }
}

export function detectImportFormat(file: Pick<File, 'name' | 'type'>): ImportFormat | null {
  const lowerName = file.name.toLowerCase()
  const format = (Object.keys(EXTENSIONS) as ImportFormat[]).find((candidate) => lowerName.endsWith(EXTENSIONS[candidate]))
  if (!format) return null
  if (file.type && !MIME_TYPES[format].includes(file.type.toLowerCase())) return null
  return format
}

export function validateImportCandidates(
  files: readonly File[],
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS
): { readonly candidates: readonly ImportCandidate[]; readonly issues: readonly ImportIssue[] } {
  const issues: ImportIssue[] = []
  if (files.length === 0) issues.push(issue('empty_selection', '', 'Select at least one CSV, XLSX, or Parquet file.'))
  if (files.length > limits.maxFiles) issues.push(issue('too_many_files', '', `Select at most ${limits.maxFiles} files.`))
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  if (totalBytes > limits.maxTotalBytes) issues.push(issue('total_too_large', '', 'Selected files exceed the total import size limit.'))

  const candidates: ImportCandidate[] = []
  for (const [index, file] of files.entries()) {
    const format = detectImportFormat(file)
    if (!format) {
      issues.push(issue('unsupported_type', file.name, 'Only CSV, XLSX, and Parquet files are supported.'))
      continue
    }
    if (file.size === 0) {
      issues.push(issue('empty_file', file.name, 'This file is empty.'))
      continue
    }
    if (format === 'xlsx' && file.size > limits.maxXlsxBytes) {
      issues.push(issue('file_too_large', file.name, 'This XLSX file exceeds the workbook size limit.'))
      continue
    }
    candidates.push({ id: `file-${index}`, file, format, displayName: file.name })
  }
  return { candidates, issues }
}

function baseName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot >= 0 ? fileName.slice(0, lastDot) : fileName
}

function normalizedPart(value: string): string {
  return value.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function proposedName(input: { readonly fileName: string; readonly sheetName?: string }): string {
  const parts = [normalizedPart(baseName(input.fileName)), input.sheetName === undefined ? '' : normalizedPart(input.sheetName)].filter(Boolean)
  let name = parts.join('_') || 'data_table'
  if (/^[0-9]/.test(name)) name = `data_${name}`
  return name.slice(0, 63)
}

export function allocateSafeTableNames(
  inputs: readonly { readonly fileName: string; readonly sheetName?: string }[],
  existing: readonly string[] = []
): readonly string[] {
  const used = new Set(existing.map((name) => name.toLowerCase()))
  return inputs.map((input) => {
    const base = proposedName(input)
    let attempt = base
    let suffix = 2
    while (used.has(attempt.toLowerCase())) {
      const postfix = `_${suffix}`
      attempt = `${base.slice(0, 63 - postfix.length)}${postfix}`
      suffix += 1
    }
    used.add(attempt.toLowerCase())
    return attempt
  })
}
