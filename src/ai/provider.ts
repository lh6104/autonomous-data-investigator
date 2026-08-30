import type { AnalysisPlanRequest, AnalysisPlanResponse, ProviderCallOptions, SqlRepairRequest, SqlRepairResponse, SynthesisRequest, SynthesisResponse } from './contracts'
export interface AnalystProvider {
  plan(input: AnalysisPlanRequest, options?: ProviderCallOptions): Promise<AnalysisPlanResponse>
  repairSql(input: SqlRepairRequest, options?: ProviderCallOptions): Promise<SqlRepairResponse>
  synthesize(input: SynthesisRequest, options?: ProviderCallOptions): Promise<SynthesisResponse>
}
export class ProviderUnavailableError extends Error { constructor(message = 'Analyst provider is unavailable', readonly cause?: unknown) { super(message); this.name = 'ProviderUnavailableError' } }
export class ProviderTimeoutError extends ProviderUnavailableError { constructor(message = 'Analyst provider timed out') { super(message); this.name = 'ProviderTimeoutError' } }
export class ProviderContractError extends Error { constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'ProviderContractError' } }
