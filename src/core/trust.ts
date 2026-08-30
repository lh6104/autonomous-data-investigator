import type {
  ExpectedResultShape,
  QueryResult,
  TrustCheck,
  TrustReport
} from './contracts'

const PASS_THRESHOLD = 0.005
const CAVEAT_THRESHOLD = 0.03
const RECONCILIATION_EVIDENCE_ID = 'verification:net_revenue'

function check(
  id: string,
  status: TrustCheck['status'],
  severity: TrustCheck['severity'],
  message: string,
  evidenceIds: readonly string[] = [],
  details?: Readonly<Record<string, unknown>>
): TrustCheck {
  return {
    id,
    status,
    severity,
    message,
    evidenceIds,
    ...(details === undefined ? {} : { details })
  }
}

function toCents(value: number): number | undefined {
  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) ? cents : undefined
}

export function reconcileNetRevenue(orderRevenue: number, itemRevenue: number): TrustCheck {
  const evidenceIds = Object.freeze([RECONCILIATION_EVIDENCE_ID])
  const details: Record<string, unknown> = {
    orderRevenue,
    itemRevenue,
    absoluteDifference: null,
    relativeDifference: null,
    threshold: PASS_THRESHOLD,
    caveatThreshold: CAVEAT_THRESHOLD,
    evidenceReference: RECONCILIATION_EVIDENCE_ID
  }

  if (!Number.isFinite(orderRevenue) || !Number.isFinite(itemRevenue)) {
    return check(
      'net_revenue_reconciliation',
      'fail',
      'critical',
      'Net Revenue reconciliation requires finite revenue values.',
      evidenceIds,
      details
    )
  }

  const orderCents = toCents(orderRevenue)
  const itemCents = toCents(itemRevenue)
  const useCents = orderCents !== undefined && itemCents !== undefined
  const absoluteDifference = useCents
    ? Math.abs(orderCents - itemCents) / 100
    : Math.abs(orderRevenue - itemRevenue)
  const comparisonOrderRevenue = useCents ? orderCents / 100 : orderRevenue
  const comparisonItemRevenue = useCents ? itemCents / 100 : itemRevenue
  const relativeDifference = comparisonOrderRevenue === 0
    ? comparisonItemRevenue === 0 ? 0 : Number.POSITIVE_INFINITY
    : absoluteDifference / Math.abs(comparisonOrderRevenue)

  details.absoluteDifference = absoluteDifference
  details.relativeDifference = relativeDifference
  details.comparisonUnit = useCents ? 'cents' : 'currency'
  if (useCents) {
    details.orderCents = orderCents
    details.itemCents = itemCents
  }

  if (relativeDifference <= PASS_THRESHOLD) {
    return check(
      'net_revenue_reconciliation',
      'pass',
      'info',
      'Net Revenue reconciliation matches within the 0.5% threshold.',
      evidenceIds,
      details
    )
  }
  if (relativeDifference <= CAVEAT_THRESHOLD) {
    return check(
      'net_revenue_reconciliation',
      'caveat',
      'warning',
      'Net Revenue reconciliation differs by more than 0.5% but not more than 3%.',
      evidenceIds,
      details
    )
  }
  return check(
    'net_revenue_reconciliation',
    'fail',
    'critical',
    'Net Revenue reconciliation exceeds the 3% threshold.',
    evidenceIds,
    details
  )
}

export function checkResultSanity(result: QueryResult, expectedShape: ExpectedResultShape): TrustCheck {
  const expectedColumns = [
    expectedShape.valueColumn,
    ...(expectedShape.kind === 'time_series' && expectedShape.dimensionColumn !== undefined
      ? [expectedShape.dimensionColumn]
      : [])
  ]
  const missingColumns = expectedColumns.filter((column) => !result.columns.includes(column))
  if (missingColumns.length > 0) {
    return check(
      'result_sanity',
      'fail',
      'critical',
      `Result is missing expected column${missingColumns.length === 1 ? '' : 's'}: ${missingColumns.join(', ')}.`,
      [],
      { missingColumns }
    )
  }

  if (result.rows.length === 0 || result.rowCount === 0) {
    return check(
      'result_sanity',
      'caveat',
      'warning',
      'Result contains no rows.',
      [],
      { rowCount: result.rowCount }
    )
  }

  if (expectedShape.kind === 'single_value' && (result.rows.length !== 1 || result.rowCount !== 1)) {
    return check(
      'result_sanity',
      'fail',
      'critical',
      'KPI result contains duplicate rows; exactly one row is required.',
      [],
      { rowCount: result.rowCount, returnedRows: result.rows.length }
    )
  }

  const invalidValues: unknown[] = []
  const negativeRows: number[] = []
  for (const [index, row] of result.rows.entries()) {
    const value = row[expectedShape.valueColumn]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      invalidValues.push(value)
      continue
    }
    if (expectedShape.valueColumn === 'net_revenue' && value < 0) negativeRows.push(index)
  }

  if (invalidValues.length > 0) {
    return check(
      'result_sanity',
      'fail',
      'critical',
      'Result contains a missing or non-finite numeric value.',
      [],
      { invalidValueCount: invalidValues.length }
    )
  }

  if (negativeRows.length > 0) {
    return check(
      'result_sanity',
      'caveat',
      'warning',
      'Net Revenue contains unexpected negative values.',
      [],
      { negativeRows }
    )
  }

  return check('result_sanity', 'pass', 'info', 'Result shape and values are sane.')
}

export function deriveTrustReport(checks: readonly TrustCheck[]): TrustReport {
  const applicableChecks = checks.filter((check) => check.status !== 'not_applicable')
  const verdict = checks.some((check) => check.status === 'fail' && check.severity === 'critical')
    ? 'do_not_trust'
    : applicableChecks.length === 0
      ? 'verified_with_caveats'
      : applicableChecks.some((check) => check.status !== 'pass')
        ? 'verified_with_caveats'
        : 'verified'
  return { verdict, checks }
}
