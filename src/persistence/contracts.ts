import { z } from 'zod'

const hash = z.string().regex(/^[A-Fa-f0-9]{32,128}$/)
export const analysisHistoryRecordSchema = z.object({
  id: z.string().min(1).max(128), sessionHash: hash, questionFingerprint: hash,
  interpretation: z.string().max(2_000), sql: z.string().max(20_000), createdAt: z.string().datetime()
}).strict()
export type AnalysisHistoryRecord = z.infer<typeof analysisHistoryRecordSchema>
export interface AnalysisHistoryRepository { save(record: AnalysisHistoryRecord): Promise<void>; list(sessionHash: string): Promise<readonly AnalysisHistoryRecord[]> }

export interface ReportUpload { readonly reportId: string; readonly sessionToken: string; readonly contentType: 'application/pdf'; readonly pdf: Blob }
export const reportUploadSchema = z.object({
  reportId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sessionToken: z.string().min(16).max(512), contentType: z.literal('application/pdf'),
  pdf: z.instanceof(Blob).refine((value) => value.type === 'application/pdf', 'PDF Blob required').refine((value) => value.size <= 10 * 1024 * 1024, 'report exceeds 10 MiB')
}).strict()
export interface StoredReport { readonly reportId: string; readonly kind: 'local_download'; readonly objectUrl: string }
export interface ReportDownload { readonly kind: 'local_download'; readonly url: string }
export interface ReportRepository { save(upload: ReportUpload): Promise<StoredReport>; getDownload(reportId: string, sessionToken: string): Promise<ReportDownload> }
