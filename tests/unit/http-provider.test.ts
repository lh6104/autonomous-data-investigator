import { describe, expect, it } from 'vitest'
import { createHttpAnalystProvider } from '@/ai/http-provider'
import { ProviderContractError, ProviderTimeoutError, ProviderUnavailableError } from '@/ai/provider'
const request = { question: 'q', schema: { tables: [], relationships: [] }, metrics: [{ id: 'net_revenue' as const, name: 'n', description: '', source: 'o', grain: 'o', expression: 'SUM(n)', requiredFilter: '', status: 'certified' as const, dimensions: [] }] }
const response = { interpretedQuestion: 'q', intent: 'kpi', metricId: 'net_revenue', sql: 'SELECT 1', verificationSql: 'SELECT 1', expectedShape: { kind: 'single_value', valueColumn: 'n' }, assumptions: [], chart: { kind: 'kpi', y: 'n' } }

describe('HTTP provider', () => {
  it('posts validated JSON with same-origin credentials', async () => {
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => { expect(String(url)).toBe('/api/analyze'); expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' }); expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json'); expect(JSON.parse(String(init?.body))).toEqual(request); return new Response(JSON.stringify(response)) }
    await expect(createHttpAnalystProvider({ fetch: fetcher as typeof fetch }).plan(request)).resolves.toMatchObject(response)
  })
  it('maps malformed JSON and contract violations', async () => {
    await expect(createHttpAnalystProvider({ fetch: (async () => new Response('nope')) as typeof fetch }).plan(request)).rejects.toBeInstanceOf(ProviderContractError)
    await expect(createHttpAnalystProvider({ fetch: (async () => new Response(JSON.stringify({ nope: true }))) as typeof fetch }).plan(request)).rejects.toBeInstanceOf(ProviderContractError)
  })
  it('maps non-2xx and timeout', async () => {
    await expect(createHttpAnalystProvider({ fetch: (async () => new Response('', { status: 503 })) as typeof fetch }).plan(request)).rejects.toBeInstanceOf(ProviderUnavailableError)
    const hanging = (_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))))
    await expect(createHttpAnalystProvider({ fetch: hanging as typeof fetch, timeoutMs: 1 }).plan(request)).rejects.toBeInstanceOf(ProviderTimeoutError)
  })
  it('preserves caller cancellation', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(createHttpAnalystProvider({ fetch: (async () => { throw new DOMException('abort', 'AbortError') }) as typeof fetch }).plan(request, { signal: controller.signal })).rejects.toThrow('abort')
  })
})
