import { z } from 'zod'

export type ColumnType = 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'string' | 'unknown'
export type PiiClass = 'none' | 'direct' | 'quasi' | 'identifier'
export type RelationshipStatus = 'suggested' | 'confirmed' | 'rejected'
export type TrustCheckStatus = 'pass' | 'caveat' | 'fail' | 'not_applicable'
export type TrustSeverity = 'info' | 'warning' | 'critical'
export type TrustVerdict = 'verified' | 'verified_with_caveats' | 'do_not_trust'

export interface ColumnProfile {
  readonly name: string
  readonly type: ColumnType
  readonly pii: PiiClass
  readonly nullable: boolean
  readonly nullCount: number
  readonly nullRate: number
  readonly distinctCount: number
  readonly min?: string | number | boolean
  readonly max?: string | number | boolean
  readonly topValues: readonly { readonly value: string; readonly count: number }[]
}

export interface TableSchema {
  readonly name: string
  readonly rowCount: number
  readonly columns: readonly ColumnProfile[]
}

export interface Relationship {
  readonly fromTable: string
  readonly fromColumn: string
  readonly toTable: string
  readonly toColumn: string
  readonly status: RelationshipStatus
  readonly matchRate?: number
}

export interface Catalog {
  readonly tables: readonly TableSchema[]
  readonly relationships: readonly Relationship[]
}

export interface MetricDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly source: string
  readonly grain: string
  readonly expression: string
  readonly requiredFilter: string
  readonly status: 'certified' | 'inferred'
  readonly dimensions: readonly string[]
}

export type QueryIntent = 'kpi' | 'trend'

export interface ExpectedResultShape {
  readonly kind: 'single_value' | 'time_series'
  readonly valueColumn: string
  readonly dimensionColumn?: string | undefined
}

export interface QueryPlan {
  readonly intent: QueryIntent
  readonly metricId: string
  readonly sql: string
  readonly verificationSql: string
  readonly expectedShape: ExpectedResultShape
  readonly assumptions: readonly string[]
}

export interface QueryResult {
  readonly columns: readonly string[]
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly rowCount: number
  readonly durationMs: number
  readonly truncated: boolean
}

export interface Evidence {
  readonly id: string
  readonly kind: 'query_result' | 'verification'
  readonly sql: string
  readonly columns: readonly string[]
  readonly rowCount: number
  readonly rows: readonly Readonly<Record<string, unknown>>[]
}

export interface TrustCheck {
  readonly id: string
  readonly status: TrustCheckStatus
  readonly severity: TrustSeverity
  readonly message: string
  readonly evidenceIds: readonly string[]
  readonly details?: Readonly<Record<string, unknown>> | undefined
}

export interface TrustReport {
  readonly verdict: TrustVerdict
  readonly checks: readonly TrustCheck[]
}

export interface AnalysisRequest {
  readonly question: string
  readonly plan: QueryPlan
  readonly signal?: AbortSignal
}

export interface AnalysisResult {
  readonly question: string
  readonly sql: string
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly evidence: readonly Evidence[]
  readonly checks: readonly TrustCheck[]
  readonly trust: TrustReport
  readonly warnings: readonly string[]
}

export interface SqlSource {
  readonly name: string
  readonly format: 'csv' | 'parquet'
  readonly bytes: ArrayBuffer
}

export interface SqlExecutor {
  registerSource(source: SqlSource): Promise<void>
  explain(sql: string): Promise<void>
  query(sql: string, signal?: AbortSignal): Promise<QueryResult>
  cancel(requestId: string): void
  close(): Promise<void>
}

const expectedResultShapeSchema = z.object({
  kind: z.enum(['single_value', 'time_series']),
  valueColumn: z.string().min(1),
  dimensionColumn: z.string().min(1).optional()
})

const queryPlanSchema = z.object({
  intent: z.enum(['kpi', 'trend']),
  metricId: z.string().min(1),
  sql: z.string().min(1),
  verificationSql: z.string().min(1),
  expectedShape: expectedResultShapeSchema,
  assumptions: z.array(z.string())
})

const analysisResultSchema = z.object({
  question: z.string(),
  sql: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  evidence: z.array(z.object({
    id: z.string(),
    kind: z.enum(['query_result', 'verification']),
    sql: z.string(),
    columns: z.array(z.string()),
    rowCount: z.number().int().nonnegative(),
    rows: z.array(z.record(z.string(), z.unknown()))
  })),
  checks: z.array(z.object({
    id: z.string(),
    status: z.enum(['pass', 'caveat', 'fail', 'not_applicable']),
    severity: z.enum(['info', 'warning', 'critical']),
    message: z.string(),
    evidenceIds: z.array(z.string()),
    details: z.record(z.string(), z.unknown()).optional()
  })),
  trust: z.object({
    verdict: z.enum(['verified', 'verified_with_caveats', 'do_not_trust']),
    checks: z.array(z.object({
      id: z.string(),
      status: z.enum(['pass', 'caveat', 'fail', 'not_applicable']),
      severity: z.enum(['info', 'warning', 'critical']),
      message: z.string(),
      evidenceIds: z.array(z.string()),
      details: z.record(z.string(), z.unknown()).optional()
    }))
  }),
  warnings: z.array(z.string())
})

export class ContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractError'
  }
}

export function validateQueryPlan(plan: unknown): QueryPlan {
  const result = queryPlanSchema.safeParse(plan)
  if (!result.success) throw new ContractError(result.error.message)
  return result.data
}

export function validateAnalysisResult(result: unknown): AnalysisResult {
  const parsed = analysisResultSchema.safeParse(result)
  if (!parsed.success) throw new ContractError(parsed.error.message)
  return parsed.data
}
