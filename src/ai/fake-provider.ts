import { parseAnalysisPlanResponse, parseSqlRepairResponse, parseSynthesisResponse, type AnalysisPlanRequest, type AnalysisPlanResponse, type ProviderCallOptions, type SqlRepairRequest, type SqlRepairResponse, type SynthesisRequest, type SynthesisResponse } from './contracts'
import type { AnalystProvider } from './provider'
type Script<T> = readonly (T | Error)[]
export interface FakeProviderScript { readonly plans?: Script<AnalysisPlanResponse>; readonly repairs?: Script<SqlRepairResponse>; readonly syntheses?: Script<SynthesisResponse> }
export interface FakeAnalystProvider extends AnalystProvider { readonly calls: readonly { readonly stage: 'plan' | 'repair' | 'synthesize'; readonly input: unknown; readonly options?: ProviderCallOptions }[] }
export function createFakeAnalystProvider(script: FakeProviderScript = {}): FakeAnalystProvider {
  const plans = [...(script.plans ?? [])], repairs = [...(script.repairs ?? [])], syntheses = [...(script.syntheses ?? [])]
  const calls: { stage: 'plan' | 'repair' | 'synthesize'; input: unknown; options?: ProviderCallOptions }[] = []
  async function next<T>(stage: 'plan' | 'repair' | 'synthesize', input: unknown, options: ProviderCallOptions | undefined, queue: (T | Error)[], parser: (value: unknown) => T): Promise<T> { calls.push({ stage, input: structuredClone(input), ...(options === undefined ? {} : { options }) }); const item = queue.shift(); if (item === undefined) throw new Error(`no scripted ${stage} response`); if (item instanceof Error) throw item; return parser(item) }
  return { calls, plan: (input, options) => next('plan', input, options, plans, parseAnalysisPlanResponse), repairSql: (input, options) => next('repair', input, options, repairs, parseSqlRepairResponse), synthesize: (input, options) => next('synthesize', input, options, syntheses, parseSynthesisResponse) }
}
