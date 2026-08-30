import { AiContractError, parseAnalysisPlanRequest, parseAnalysisPlanResponse, parseSqlRepairRequest, parseSqlRepairResponse, parseSynthesisRequest, parseSynthesisResponse, type ProviderCallOptions } from './contracts'
import { ProviderContractError, ProviderTimeoutError, ProviderUnavailableError, type AnalystProvider } from './provider'
export interface HttpAnalystProviderOptions { readonly baseUrl?: string; readonly fetch?: typeof fetch; readonly timeoutMs?: number }
function joinSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup(): void; timedOut(): boolean } {
  const controller = new AbortController(); let timeout = false
  const timer = setTimeout(() => { timeout = true; controller.abort() }, timeoutMs)
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }, timedOut: () => timeout }
}
export function createHttpAnalystProvider(options: HttpAnalystProviderOptions = {}): AnalystProvider {
  const fetcher = options.fetch ?? fetch, baseUrl = options.baseUrl ?? '', timeoutMs = options.timeoutMs ?? 20_000
  async function post<T>(path: string, body: unknown, parseRequest: (value: unknown) => unknown, parseResponse: (value: unknown) => T, callOptions?: ProviderCallOptions): Promise<T> {
    let request: unknown; try { request = parseRequest(body) } catch (error) { throw new ProviderContractError('invalid provider request', error) }
    const combined = joinSignal(callOptions?.signal, timeoutMs)
    try {
      const response = await fetcher(`${baseUrl}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(request), signal: combined.signal })
      if (!response.ok) throw new ProviderUnavailableError(`Analyst provider returned ${response.status}`)
      let json: unknown; try { json = await response.json() } catch (error) { throw new ProviderContractError('provider returned invalid JSON', error) }
      try { return parseResponse(json) } catch (error) { throw new ProviderContractError('provider response violates contract', error) }
    } catch (error) {
      if (callOptions?.signal?.aborted) throw error
      if (combined.timedOut()) throw new ProviderTimeoutError()
      if (error instanceof ProviderUnavailableError || error instanceof ProviderContractError) throw error
      if (error instanceof AiContractError) throw new ProviderContractError(error.message, error)
      throw new ProviderUnavailableError('Analyst provider request failed', error)
    } finally { combined.cleanup() }
  }
  return { plan: (input, callOptions) => post('/api/analyze', input, parseAnalysisPlanRequest, parseAnalysisPlanResponse, callOptions), repairSql: (input, callOptions) => post('/api/repair-sql', input, parseSqlRepairRequest, parseSqlRepairResponse, callOptions), synthesize: (input, callOptions) => post('/api/synthesize', input, parseSynthesisRequest, parseSynthesisResponse, callOptions) }
}
