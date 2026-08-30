import { analysisHistoryRecordSchema, type AnalysisHistoryRecord, type AnalysisHistoryRepository } from './contracts'
function redactSqlLiterals(sql: string): string { return sql.replace(/'(?:''|[^'])*'/g, "'[redacted]'") }
export function createInMemoryAnalysisHistoryRepository(): AnalysisHistoryRepository {
  const records: AnalysisHistoryRecord[] = []
  return { async save(record) { const parsed = analysisHistoryRecordSchema.parse(record); records.push({ ...parsed, sql: redactSqlLiterals(parsed.sql) }) }, async list(sessionHash) { return records.filter((record) => record.sessionHash === sessionHash).map((record) => ({ ...record })) } }
}
