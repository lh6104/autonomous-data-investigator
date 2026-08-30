import { describe, expect, it } from 'vitest'
import { createLocalDemoAnalystProvider } from '@/ai/local-demo-provider'
import { createDemoCatalog } from '@/core/catalog'
import { getMetric } from '@/core/metrics'
import { createAnalysisPlanRequest } from '@/ai/safe-schema'

describe('local demo analyst provider', () => {
  it('plans certified revenue questions and returns three evidence-linked actions', async () => {
    const catalog = createDemoCatalog()
    const provider = createLocalDemoAnalystProvider(catalog)
    const request = createAnalysisPlanRequest('Show monthly revenue trend', catalog, [getMetric('net_revenue')!])

    const plan = await provider.plan(request)
    expect(plan).toMatchObject({ metricId: 'net_revenue', intent: 'trend' })

    const synthesis = await provider.synthesize({
      question: request.question,
      interpretedQuestion: plan.interpretedQuestion,
      evidence: [{ id: 'query:primary', columns: ['net_revenue'], rows: [{ net_revenue: 125 }] }],
      trust: { verdict: 'verified', checks: [] },
      chart: plan.chart
    })
    expect(synthesis.recommendations).toHaveLength(3)
    expect(synthesis.recommendations.every((item) => item.evidenceIds.includes('query:primary'))).toBe(true)
  })

  it('rejects questions outside the governed metric domain', async () => {
    const catalog = createDemoCatalog()
    const provider = createLocalDemoAnalystProvider(catalog)
    const request = createAnalysisPlanRequest('Show inventory risk', catalog, [getMetric('net_revenue')!])
    await expect(provider.plan(request)).rejects.toThrow('certified Net Revenue')
  })
})
