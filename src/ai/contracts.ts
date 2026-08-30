import { z } from 'zod'

export const AI_LIMITS = {
  maxQuestionChars: 2_000,
  maxTables: 20,
  maxColumnsPerTable: 80,
  maxEvidenceRows: 100,
  maxPayloadBytes: 128 * 1024
} as const

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const evidenceIdSchema = z.string().regex(/^(query:primary|verification:[A-Za-z0-9_-]+)$/)

export const safeColumnSchema = z.object({
  name: z.string().min(1).max(63), type: z.enum(['integer', 'decimal', 'boolean', 'date', 'timestamp', 'string', 'unknown']),
  pii: z.enum(['none', 'direct', 'quasi', 'identifier']), nullable: z.boolean(), nullCount: z.number().int().nonnegative(),
  nullRate: z.number().min(0).max(1), distinctCount: z.number().int().nonnegative()
}).strict()
export const safeSchemaContextSchema = z.object({
  tables: z.array(z.object({ name: z.string().min(1).max(63), rowCount: z.number().int().nonnegative(), columns: z.array(safeColumnSchema).max(AI_LIMITS.maxColumnsPerTable) }).strict()).max(AI_LIMITS.maxTables),
  relationships: z.array(z.object({ fromTable: z.string().max(63), fromColumn: z.string().max(63), toTable: z.string().max(63), toColumn: z.string().max(63), matchRate: z.number().min(0).max(1).optional() }).strict())
}).strict()
export const metricSchema = z.object({ id: z.literal('net_revenue'), name: z.string().min(1).max(200), description: z.string().max(500), source: z.string().max(63), grain: z.string().max(100), expression: z.string().max(500), requiredFilter: z.string().max(500), status: z.literal('certified'), dimensions: z.array(z.string().max(63)).max(10) }).strict()
export const analysisPlanRequestSchema = z.object({ question: z.string().min(1).max(AI_LIMITS.maxQuestionChars), schema: safeSchemaContextSchema, metrics: z.array(metricSchema).min(1).max(10), currentDate: z.string().max(32).optional(), datasetDateRange: z.object({ start: z.string().max(64), end: z.string().max(64) }).strict().optional() }).strict()
export const chartSpecSchema = z.object({ kind: z.enum(['kpi', 'line', 'bar', 'table']), x: z.string().min(1).max(63).optional(), y: z.string().min(1).max(63) }).strict()
export const analysisPlanResponseSchema = z.object({
  interpretedQuestion: z.string().min(1).max(AI_LIMITS.maxQuestionChars), intent: z.enum(['kpi', 'trend']), metricId: z.literal('net_revenue'),
  sql: z.string().min(1).max(20_000), verificationSql: z.string().min(1).max(20_000),
  expectedShape: z.object({ kind: z.enum(['single_value', 'time_series']), valueColumn: z.string().min(1).max(63), dimensionColumn: z.string().min(1).max(63).optional() }).strict(),
  assumptions: z.array(z.string().max(500)).max(10), chart: chartSpecSchema
}).strict()
export const sqlRepairRequestSchema = z.object({ question: z.string().min(1).max(AI_LIMITS.maxQuestionChars), rejectedSql: z.string().min(1).max(20_000), rejection: z.array(z.object({ code: z.string().max(100), message: z.string().max(1_000) }).strict()).min(1).max(20), schema: safeSchemaContextSchema }).strict()
export const sqlRepairResponseSchema = z.object({ sql: z.string().min(1).max(20_000), verificationSql: z.string().min(1).max(20_000), expectedShape: z.object({ kind: z.enum(['single_value', 'time_series']), valueColumn: z.string().min(1).max(63), dimensionColumn: z.string().min(1).max(63).optional() }).strict() }).strict()
export const evidenceReferenceSchema = evidenceIdSchema
export const synthesisRequestSchema = z.object({ question: z.string().min(1).max(AI_LIMITS.maxQuestionChars), interpretedQuestion: z.string().min(1).max(AI_LIMITS.maxQuestionChars), evidence: z.array(z.object({ id: evidenceIdSchema, columns: z.array(z.string().max(63)).max(80), rows: z.array(z.record(z.string(), scalarSchema)).max(AI_LIMITS.maxEvidenceRows) }).strict()).max(10), trust: z.object({ verdict: z.enum(['verified', 'verified_with_caveats', 'do_not_trust']), checks: z.array(z.object({ id: z.string().max(100), status: z.enum(['pass', 'caveat', 'fail', 'not_applicable']), severity: z.enum(['info', 'warning', 'critical']), message: z.string().max(1_000), evidenceIds: z.array(evidenceIdSchema).max(10) }).strict()).max(100) }).strict(), chart: chartSpecSchema }).strict()
export const recommendationSchema = z.object({ priority: z.union([z.literal(1), z.literal(2), z.literal(3)]), action: z.string().min(1).max(1_000), evidenceIds: z.array(evidenceIdSchema).min(1).max(10) }).strict()
export const synthesisResponseSchema = z.object({ summary: z.string().min(1).max(4_000), recommendations: z.array(recommendationSchema).length(3) }).strict().superRefine((value, context) => {
  if (new Set(value.recommendations.map((item) => item.priority)).size !== 3) context.addIssue({ code: 'custom', message: 'recommendation priorities must be unique' })
})

export type AnalysisPlanRequest = z.infer<typeof analysisPlanRequestSchema>
export type AnalysisPlanResponse = z.infer<typeof analysisPlanResponseSchema>
export type SqlRepairRequest = z.infer<typeof sqlRepairRequestSchema>
export type SqlRepairResponse = z.infer<typeof sqlRepairResponseSchema>
export type SynthesisRequest = z.infer<typeof synthesisRequestSchema>
export type SynthesisResponse = z.infer<typeof synthesisResponseSchema>
export type ChartSpec = z.infer<typeof chartSpecSchema>
export type Recommendation = z.infer<typeof recommendationSchema>
export interface ProviderCallOptions { readonly signal?: AbortSignal; readonly schemaFeedback?: string | undefined }
export class AiContractError extends Error { constructor(message: string) { super(message); this.name = 'AiContractError' } }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new AiContractError(parsed.error.message); return parsed.data }
export const parseAnalysisPlanRequest = (value: unknown): AnalysisPlanRequest => parse(analysisPlanRequestSchema, value)
export const parseAnalysisPlanResponse = (value: unknown): AnalysisPlanResponse => parse(analysisPlanResponseSchema, value)
export const parseSqlRepairRequest = (value: unknown): SqlRepairRequest => parse(sqlRepairRequestSchema, value)
export const parseSqlRepairResponse = (value: unknown): SqlRepairResponse => parse(sqlRepairResponseSchema, value)
export const parseSynthesisRequest = (value: unknown): SynthesisRequest => parse(synthesisRequestSchema, value)
export const parseSynthesisResponse = (value: unknown): SynthesisResponse => parse(synthesisResponseSchema, value)
