import type { Catalog } from '@/core/contracts'
import { createDeterministicPlan } from './fallbacks'
import {
  parseAnalysisPlanResponse,
  parseSqlRepairResponse,
  parseSynthesisResponse,
  type ProviderCallOptions,
  type SynthesisRequest
} from './contracts'
import { ProviderContractError, type AnalystProvider } from './provider'

function assertActive(options?: ProviderCallOptions): void {
  if (options?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
}

function evidenceIds(request: SynthesisRequest): string[] {
  return [...new Set(request.evidence.map((item) => item.id))]
}

export function createLocalDemoAnalystProvider(catalog: Catalog): AnalystProvider {
  return {
    async plan(input, options) {
      assertActive(options)
      const plan = createDeterministicPlan(input.question, catalog)
      if (!plan) throw new ProviderContractError('The local demo supports only the certified Net Revenue metric.')
      return parseAnalysisPlanResponse(plan)
    },

    async repairSql(input, options) {
      assertActive(options)
      const plan = createDeterministicPlan(input.question, catalog)
      if (!plan) throw new ProviderContractError('The local demo cannot repair an unsupported metric.')
      return parseSqlRepairResponse({
        sql: plan.sql,
        verificationSql: plan.verificationSql,
        expectedShape: plan.expectedShape
      })
    },

    async synthesize(input, options) {
      assertActive(options)
      const ids = evidenceIds(input)
      if (ids.length === 0) throw new ProviderContractError('Verified evidence is required before synthesis.')
      const verdict = input.trust.verdict.replaceAll('_', ' ')
      return parseSynthesisResponse({
        summary: `Local deterministic demo: the Trust Engine verdict is ${verdict}. The displayed values come directly from locally executed evidence.`,
        recommendations: [
          { priority: 1, action: 'Review the Net Revenue movement and confirm the governed Completed-order filter matches your business definition.', evidenceIds: ids },
          { priority: 2, action: 'Inspect Trust Report caveats before using this result for an operational decision.', evidenceIds: ids },
          { priority: 3, action: 'Compare the next period using the same certified metric and verification query.', evidenceIds: ids }
        ]
      })
    }
  }
}
