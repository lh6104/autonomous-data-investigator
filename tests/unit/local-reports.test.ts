import { describe, expect, it } from 'vitest'
import { createLocalReportRepository } from '@/persistence/local-reports'
const token = 't'.repeat(16)
describe('local reports', () => {
  it('returns an injected local URL and checks capability token', async () => { const repo = createLocalReportRepository({ createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }); const saved = await repo.save({ reportId: 'report-1', sessionToken: token, contentType: 'application/pdf', pdf: new Blob(['x'], { type: 'application/pdf' }) }); expect(saved.objectUrl).toBe('blob:test'); await expect(repo.getDownload('report-1', 'wrong')).rejects.toThrow() })
  it('validates ids, token, content type and size', async () => { const repo = createLocalReportRepository({ createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }); await expect(repo.save({ reportId: 'bad id', sessionToken: token, contentType: 'application/pdf', pdf: new Blob(['x'], { type: 'application/pdf' }) })).rejects.toThrow(); await expect(repo.save({ reportId: 'ok', sessionToken: 'short', contentType: 'application/pdf', pdf: new Blob(['x'], { type: 'application/pdf' }) })).rejects.toThrow(); await expect(repo.save({ reportId: 'ok', sessionToken: token, contentType: 'application/pdf', pdf: new Blob(['x'], { type: 'text/plain' }) })).rejects.toThrow() })
})
