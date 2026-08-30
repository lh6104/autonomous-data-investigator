import { describe, expect, it } from 'vitest'
import type { ExpectedResultShape, QueryResult, TrustCheck } from '@/core/contracts'
import { checkResultSanity, deriveTrustReport, reconcileNetRevenue } from '@/core/trust'

const kpiShape: ExpectedResultShape = { kind: 'single_value', valueColumn: 'net_revenue' }

function result(rows: readonly Readonly<Record<string, unknown>>[], columns = ['net_revenue']): QueryResult {
  return {
    columns,
    rows,
    rowCount: rows.length,
    durationMs: 1,
    truncated: false
  }
}

function check(status: TrustCheck['status'], severity: TrustCheck['severity'] = 'info'): TrustCheck {
  return {
    id: status,
    status,
    severity,
    message: status,
    evidenceIds: []
  }
}

describe('reconcileNetRevenue', () => {
  it.each([
    [100, 100.5, 'pass'],
    [100, 100.51, 'caveat'],
    [100, 103, 'caveat'],
    [100, 103.01, 'fail']
  ] as const)('classifies a %s versus %s difference as %s', (orderRevenue, itemRevenue, status) => {
    const reconciliation = reconcileNetRevenue(orderRevenue, itemRevenue)
    expect(reconciliation.status).toBe(status)
    expect(reconciliation.details).toMatchObject({ orderRevenue, itemRevenue, threshold: 0.005 })
    expect(reconciliation.evidenceIds).toEqual(['verification:net_revenue'])
  })

  it('compares rounded currency cents before calculating the difference', () => {
    const reconciliation = reconcileNetRevenue(100.004, 100.005)
    expect(reconciliation.status).toBe('pass')
    expect(reconciliation.details).toMatchObject({ comparisonUnit: 'cents', orderCents: 10000, itemCents: 10001 })
  })

  it('handles a zero denominator deterministically', () => {
    expect(reconcileNetRevenue(0, 0).status).toBe('pass')
    expect(reconcileNetRevenue(0, 1).status).toBe('fail')
    expect(reconcileNetRevenue(0, 1).severity).toBe('critical')
    expect(reconcileNetRevenue(0, 1).details).toMatchObject({ relativeDifference: Infinity })
  })

  it('fails non-finite revenue values critically', () => {
    const reconciliation = reconcileNetRevenue(Number.NaN, 100)
    expect(reconciliation).toMatchObject({ status: 'fail', severity: 'critical' })
    expect(reconciliation.evidenceIds.length).toBeGreaterThan(0)
  })
})

describe('checkResultSanity', () => {
  it('passes a single finite non-negative KPI value', () => {
    expect(checkResultSanity(result([{ net_revenue: 125 }]), kpiShape)).toMatchObject({
      id: 'result_sanity',
      status: 'pass',
      severity: 'info'
    })
  })

  it('catches missing columns and duplicate KPI rows', () => {
    expect(checkResultSanity(result([{ revenue: 125 }], ['revenue']), kpiShape)).toMatchObject({
      status: 'fail',
      severity: 'critical'
    })
    expect(checkResultSanity(result([{ net_revenue: 100 }, { net_revenue: 25 }]), kpiShape)).toMatchObject({
      status: 'fail',
      severity: 'critical'
    })
  })

  it('reports empty results as a warning caveat', () => {
    expect(checkResultSanity(result([]), kpiShape)).toMatchObject({
      status: 'caveat',
      severity: 'warning'
    })
  })

  it('detects non-finite and negative Net Revenue values', () => {
    expect(checkResultSanity(result([{ net_revenue: Infinity }]), kpiShape)).toMatchObject({
      status: 'fail',
      severity: 'critical'
    })
    expect(checkResultSanity(result([{ net_revenue: -1 }]), kpiShape)).toMatchObject({
      status: 'caveat',
      severity: 'warning'
    })
  })

  it('requires both columns for a time series', () => {
    const shape: ExpectedResultShape = { kind: 'time_series', valueColumn: 'net_revenue', dimensionColumn: 'month' }
    expect(checkResultSanity(result([{ net_revenue: 125 }]), shape)).toMatchObject({
      status: 'fail',
      severity: 'critical'
    })
    expect(checkResultSanity(result([{ month: '2025-01', net_revenue: 125 }], ['month', 'net_revenue']), shape).status).toBe('pass')
  })
})

describe('deriveTrustReport', () => {
  it('derives the disclosed verdict behavior', () => {
    expect(deriveTrustReport([]).verdict).toBe('verified_with_caveats')
    expect(deriveTrustReport([check('not_applicable')]).verdict).toBe('verified_with_caveats')
    expect(deriveTrustReport([check('pass')]).verdict).toBe('verified')
    expect(deriveTrustReport([check('caveat', 'warning')]).verdict).toBe('verified_with_caveats')
    expect(deriveTrustReport([check('fail', 'critical')]).verdict).toBe('do_not_trust')
  })

  it('preserves checks in report order', () => {
    const checks = [check('pass'), check('not_applicable')]
    expect(deriveTrustReport(checks).checks).toBe(checks)
  })
})
