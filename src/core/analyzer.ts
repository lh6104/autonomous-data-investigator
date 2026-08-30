import type {
  AnalysisRequest,
  AnalysisResult,
  Catalog,
  Evidence,
  QueryResult,
  SqlExecutor,
  TrustCheck
} from './contracts'
import { validateAnalysisResult, validateQueryPlan } from './contracts'
import { guardSql } from './sql-guard'
import { checkResultSanity, deriveTrustReport, reconcileNetRevenue } from './trust'

export interface DeterministicAnalyzer {
  run(request: AnalysisRequest): Promise<AnalysisResult>
}

export interface DeterministicAnalyzerDependencies {
  readonly catalog: Catalog
  readonly executor: SqlExecutor
}

const PRIMARY_EVIDENCE_ID = 'query:primary'
const VERIFICATION_EVIDENCE_ID = 'verification:net_revenue'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function evidence(id: string, kind: Evidence['kind'], sql: string, result: QueryResult): Evidence {
  return {
    id,
    kind,
    sql,
    columns: [...result.columns],
    rowCount: result.rowCount,
    rows: result.rows.map((row) => ({ ...row }))
  }
}

function failedCheck(id: string, message: string, evidenceIds: readonly string[] = [], details?: Readonly<Record<string, unknown>>): TrustCheck {
  return {
    id,
    status: 'fail',
    severity: 'critical',
    message,
    evidenceIds,
    ...(details === undefined ? {} : { details })
  }
}

function caveatCheck(id: string, message: string, evidenceIds: readonly string[] = [], details?: Readonly<Record<string, unknown>>): TrustCheck {
  return {
    id,
    status: 'caveat',
    severity: 'warning',
    message,
    evidenceIds,
    ...(details === undefined ? {} : { details })
  }
}

function executionFailure(label: string, message: string): TrustCheck {
  return label === 'Verification'
    ? caveatCheck('verification_execution', `Verification ${message}`)
    : failedCheck('primary_execution', `Primary ${message}`)
}

function warningMessages(checks: readonly TrustCheck[]): string[] {
  return checks
    .filter((check) => check.status !== 'pass' && check.status !== 'not_applicable')
    .map((check) => check.message)
}

function numericValue(result: QueryResult, column: string): number | undefined {
  if (result.rowCount !== 1 || result.rows.length !== 1) return undefined
  const value = result.rows[0]?.[column]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function guardFailure(
  id: string,
  label: string,
  violations: readonly { readonly code: string; readonly message: string }[]
): TrustCheck {
  return failedCheck(
    id,
    `${label} SQL was rejected: ${violations.map((violation) => violation.message).join(' ')}`,
    [],
    { violations: violations.map((violation) => ({ ...violation })) }
  )
}

async function execute(
  executor: SqlExecutor,
  sql: string,
  signal: AbortSignal | undefined,
  label: string
): Promise<{ readonly result?: QueryResult; readonly failure?: TrustCheck }> {
  try {
    await executor.explain(sql)
  } catch (error) {
    return {
      failure: executionFailure(label, `EXPLAIN failed: ${errorMessage(error)}`)
    }
  }

  try {
    return { result: await executor.query(sql, signal) }
  } catch (error) {
    return {
      failure: executionFailure(label, `query failed: ${errorMessage(error)}`)
    }
  }
}

function unavailableReconciliation(message: string): TrustCheck {
  return caveatCheck('net_revenue_reconciliation', message, [VERIFICATION_EVIDENCE_ID])
}

function buildResult(
  request: AnalysisRequest,
  sql: string,
  rows: readonly Readonly<Record<string, unknown>>[],
  evidenceItems: readonly Evidence[],
  checks: readonly TrustCheck[]
): AnalysisResult {
  const trust = deriveTrustReport(checks)
  return validateAnalysisResult({
    question: request.question,
    sql,
    rows,
    evidence: evidenceItems,
    checks,
    trust,
    warnings: warningMessages(checks)
  })
}

export function createDeterministicAnalyzer(deps: DeterministicAnalyzerDependencies): DeterministicAnalyzer {
  return {
    async run(request: AnalysisRequest): Promise<AnalysisResult> {
      const plan = validateQueryPlan(request.plan)
      const primaryGuard = guardSql(plan.sql, deps.catalog)
      const verificationGuard = guardSql(plan.verificationSql, deps.catalog)
      const guardChecks: TrustCheck[] = []

      if (primaryGuard.violations.length > 0) {
        guardChecks.push(guardFailure('sql_guard_primary', 'Primary', primaryGuard.violations))
      }
      if (verificationGuard.violations.length > 0) {
        guardChecks.push(guardFailure('sql_guard_verification', 'Verification', verificationGuard.violations))
      }
      if (guardChecks.length > 0) {
        return buildResult(request, primaryGuard.sql, [], [], guardChecks)
      }

      const evidenceItems: Evidence[] = []
      const checks: TrustCheck[] = []
      const primaryExecution = await execute(deps.executor, primaryGuard.sql, request.signal, 'Primary')
      const primaryResult = primaryExecution.result
      if (primaryExecution.failure !== undefined) checks.push(primaryExecution.failure)
      if (primaryResult !== undefined) evidenceItems.push(evidence(PRIMARY_EVIDENCE_ID, 'query_result', primaryGuard.sql, primaryResult))

      const verificationExecution = await execute(deps.executor, verificationGuard.sql, request.signal, 'Verification')
      const verificationResult = verificationExecution.result
      if (verificationExecution.failure !== undefined) checks.push(verificationExecution.failure)
      if (verificationResult !== undefined) evidenceItems.push(evidence(VERIFICATION_EVIDENCE_ID, 'verification', verificationGuard.sql, verificationResult))

      if (primaryResult !== undefined) {
        checks.push(checkResultSanity(primaryResult, plan.expectedShape))
      }

      if (primaryResult === undefined || verificationResult === undefined) {
        checks.push(unavailableReconciliation(
          primaryResult === undefined
            ? 'Net Revenue reconciliation could not be completed because the primary result is unavailable.'
            : 'Net Revenue reconciliation could not be completed because the verification result is unavailable.'
        ))
      } else if (primaryResult.rowCount === 0 || primaryResult.rows.length === 0 || verificationResult.rowCount === 0 || verificationResult.rows.length === 0) {
        checks.push(unavailableReconciliation('Net Revenue reconciliation could not be completed because a result contains no rows.'))
      } else {
        const orderRevenue = numericValue(primaryResult, plan.expectedShape.valueColumn)
        const itemRevenue = numericValue(verificationResult, 'item_level_revenue')
        checks.push(reconcileNetRevenue(orderRevenue ?? Number.NaN, itemRevenue ?? Number.NaN))
      }

      return buildResult(
        request,
        primaryGuard.sql,
        primaryResult?.rows ?? [],
        evidenceItems,
        checks
      )
    }
  }
}
