import { AsyncDuckDB, VoidLogger } from '@duckdb/duckdb-wasm'
import type { QueryResult } from '@/core/contracts'
import type { DuckDbRequest, DuckDbResponse } from './duckdb-protocol'

const MAX_ROWS = 10_000
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
const scope = self as unknown as DedicatedWorkerGlobalScope

let db: AsyncDuckDB | null = null
let connection: Awaited<ReturnType<AsyncDuckDB['connect']>> | null = null
let initialization: Promise<void> | null = null
let queue = Promise.resolve()
let activeRequestId: string | null = null
const cancelled = new Set<string>()

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe source name '${name}'`)
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function withoutTerminalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}

function explainSql(sql: string): string {
  const normalized = withoutTerminalSemicolon(sql)
  return /^EXPLAIN\b/i.test(normalized) ? normalized : `EXPLAIN ${normalized}`
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'object') {
    const candidate = value as { readonly toJSON?: () => unknown }
    if (typeof candidate.toJSON === 'function') return normalizeValue(candidate.toJSON())
    return String(value)
  }
  return String(value)
}

function rowToRecord(row: unknown, columns: readonly string[]): Readonly<Record<string, unknown>> {
  const source = row && typeof row === 'object' ? row as Record<string, unknown> : {}
  const result: Record<string, unknown> = {}
  for (const column of columns) result[column] = normalizeValue(source[column])
  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function ensureInitialized(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    const workerUrl = new URL('/duckdb/duckdb-browser-mvp.worker.js', scope.location.origin)
    const wasmUrl = new URL('/duckdb/duckdb-mvp.wasm', scope.location.origin).toString()
    const duckdbWorker = new Worker(workerUrl)
    const instance = new AsyncDuckDB(new VoidLogger(), duckdbWorker)
    await instance.instantiate(wasmUrl)
    await instance.open({ path: ':memory:' })
    db = instance
    connection = await instance.connect()
    const parquetExtensionUrl = new URL('/duckdb/extensions/duckdb-wasm/v1.4.3/wasm_mvp/parquet.duckdb_extension.wasm', scope.location.origin).toString()
    await connection.query("LOAD '" + parquetExtensionUrl.replaceAll("'", "''") + "';")
  })()
  try {
    await initialization
  } catch (error) {
    initialization = null
    throw error
  }
}

function checkCancelled(requestId: string): void {
  if (cancelled.has(requestId)) throw new Error('query cancelled')
}

async function register(request: Extract<DuckDbRequest, { type: 'register' }>): Promise<void> {
  assertSafeName(request.name)
  await ensureInitialized()
  if (!db || !connection) throw new Error('DuckDB is not initialized')
  const fileName = `${request.name}.${request.format}`
  await db.registerFileBuffer(fileName, new Uint8Array(request.bytes))
  const reader = request.format === 'csv'
    ? `read_csv_auto(${sqlString(fileName)}, HEADER=TRUE)`
    : `read_parquet(${sqlString(fileName)})`
  await connection.query(`CREATE OR REPLACE TABLE ${sqlIdentifier(request.name)} AS SELECT * FROM ${reader};`)
}

async function explain(requestId: string, sql: string): Promise<void> {
  await ensureInitialized()
  if (!connection) throw new Error('DuckDB is not initialized')
  checkCancelled(requestId)
  activeRequestId = requestId
  try {
    await connection.query(explainSql(sql))
    checkCancelled(requestId)
  } finally {
    activeRequestId = null
  }
}

async function drop(requestId: string, name: string): Promise<void> {
  assertSafeName(name)
  await ensureInitialized()
  if (!connection) throw new Error('DuckDB is not initialized')
  await connection.query(`DROP TABLE IF EXISTS ${sqlIdentifier(name)};`)
}

async function query(requestId: string, sql: string): Promise<QueryResult> {
  await ensureInitialized()
  if (!connection) throw new Error('DuckDB is not initialized')
  checkCancelled(requestId)
  activeRequestId = requestId
  const started = performance.now()
  try {
    await connection.query(explainSql(sql))
    checkCancelled(requestId)
    const table = await connection.query(sql)
    const columns = table.schema.fields.map((field) => field.name)
    const rows: Readonly<Record<string, unknown>>[] = []
    const sourceRows = table.toArray()
    const rowCount = sourceRows.length
    for (const row of sourceRows.slice(0, MAX_ROWS)) {
      checkCancelled(requestId)
      rows.push(rowToRecord(row, columns))
    }
    checkCancelled(requestId)
    const result = {
      columns,
      rows,
      rowCount,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      truncated: rowCount > MAX_ROWS
    }
    return result
  } finally {
    activeRequestId = null
    cancelled.delete(requestId)
  }
}

function respond(message: DuckDbResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

async function processRequest(request: DuckDbRequest): Promise<void> {
  if (request.type === 'register') {
    await register(request)
    respond({ type: 'success', requestId: request.name })
    return
  }
  if (request.type === 'explain') {
    await explain(request.requestId, request.sql)
    respond({ type: 'success', requestId: request.requestId })
    return
  }
  if (request.type === 'drop') {
    await drop(request.requestId, request.name)
    respond({ type: 'success', requestId: request.requestId })
    return
  }
  if (request.type === 'query') {
    const result = await query(request.requestId, request.sql)
    respond({ type: 'success', requestId: request.requestId, result })
    return
  }
  if (request.type === 'close') {
    if (connection) await connection.close()
    connection = null
    if (db) await db.terminate()
    db = null
    respond({ type: 'success', requestId: 'close' })
    setTimeout(() => scope.close(), 0)
  }
}

scope.onmessage = (event: MessageEvent<DuckDbRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelled.add(request.requestId)
    if (activeRequestId === request.requestId && connection) void connection.cancelSent()
    return
  }
  queue = queue.then(async () => {
    if (request.type !== 'close' && request.type !== 'register') checkCancelled(request.requestId)
    await processRequest(request)
  }).catch((error: unknown) => {
    const requestId = request.type === 'register' ? request.name : request.type === 'close' ? 'close' : request.requestId
    const workerError = { message: errorMessage(error) }
    if (error instanceof Error) respond({ type: 'error', requestId, error: { ...workerError, name: error.name } })
    else respond({ type: 'error', requestId, error: workerError })
  })
}

export {}
