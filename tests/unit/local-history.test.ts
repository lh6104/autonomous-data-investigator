import { describe, expect, it } from 'vitest'
import { createInMemoryAnalysisHistoryRepository } from '@/persistence/local-history'

describe('local history', () => { it('redacts SQL literals', async () => { const repo = createInMemoryAnalysisHistoryRepository(); const hash = 'a'.repeat(64); await repo.save({ id: '1', sessionHash: hash, questionFingerprint: hash, interpretation: 'safe', sql: "SELECT 'secret'", createdAt: '2026-08-30T00:00:00.000Z' }); expect((await repo.list(hash))[0]?.sql).not.toContain('secret') }) })
