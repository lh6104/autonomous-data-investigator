import { reportUploadSchema, type ReportDownload, type ReportRepository, type ReportUpload, type StoredReport } from './contracts'

export interface LocalReportUrlAdapter { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void }

export function createLocalReportRepository(adapter: LocalReportUrlAdapter): ReportRepository {
  const reports = new Map<string, { token: string; url: string }>()
  return {
    async save(upload: ReportUpload): Promise<StoredReport> {
      const parsed = reportUploadSchema.parse(upload)
      const existing = reports.get(parsed.reportId)
      if (existing) adapter.revokeObjectURL(existing.url)
      const objectUrl = adapter.createObjectURL(parsed.pdf)
      reports.set(parsed.reportId, { token: parsed.sessionToken, url: objectUrl })
      return { reportId: parsed.reportId, kind: 'local_download', objectUrl }
    },
    async getDownload(reportId: string, sessionToken: string): Promise<ReportDownload> {
      const report = reports.get(reportId)
      if (!report || report.token !== sessionToken) throw new Error('report not found')
      return { kind: 'local_download', url: report.url }
    }
  }
}
