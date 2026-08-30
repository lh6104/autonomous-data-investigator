/// <reference types="vite/client" />
import duckDbWorkerUrl from './duckdb.worker?worker&url'
import type { QueryResult, SqlExecutor, SqlSource } from '@/core/contracts'
import type { DuckDbRequest, DuckDbResponse } from './duckdb-protocol'

export interface WorkerLike {
  postMessage(message: DuckDbRequest, transfer?: Transferable[]): void
  addEventListener(type: 'message' | 'error', listener: EventListener): void
  removeEventListener(type: 'message' | 'error', listener: EventListener): void
  terminate(): void
}

export type WorkerFactory = (url: URL | string) => WorkerLike

export interface DuckDbClientOptions {
  readonly workerFactory?: WorkerFactory
  readonly workerUrl?: URL | string
  readonly timeoutMs?: number
}

export class QueryTimeoutError extends Error {
  readonly requestId: string

  constructor(requestId: string, timeoutMs: number) {
    super(`DuckDB query timed out after ${timeoutMs}ms: ${requestId}`)
    this.name = 'QueryTimeoutError'
    this.requestId = requestId
  }
}

export class QueryCancelledError extends Error {
  readonly requestId: string

  constructor(requestId: string) {
    super(`DuckDB query cancelled: ${requestId}`)
    this.name = 'QueryCancelledError'
    this.requestId = requestId
  }
}

export class QueryExecutionError extends Error {
  readonly requestId: string | undefined

  constructor(message: string, requestId?: string) {
    super(message)
    this.name = 'QueryExecutionError'
    this.requestId = requestId
  }
}

type Pending = {
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly signal: AbortSignal | undefined
  readonly abortHandler: (() => void) | undefined
}

const MAX_ROWS = 10_000
const DEFAULT_TIMEOUT_MS = 30_000
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
const DEFAULT_WORKER_URL = duckDbWorkerUrl

const defaultWorkerFactory: WorkerFactory = (url) => new Worker(url, { type: 'classic' })

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) throw new TypeError(`unsafe source name '${name}'`)
}

function responseErrorMessage(response: Extract<DuckDbResponse, { type: 'error' }>): string {
  return response.error.message || 'DuckDB worker error'
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value !== null && typeof value === 'object') {
    const candidate = value as { readonly toJSON?: () => unknown }
    if (typeof candidate.toJSON === 'function') return normalizeValue(candidate.toJSON())
  }
  return value
}

function normalizeResult(result: QueryResult): QueryResult {
  const rows = result.rows.slice(0, MAX_ROWS).map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const column of result.columns) normalized[column] = normalizeValue(row[column])
    return normalized
  })
  return {
    columns: [...result.columns],
    rows,
    rowCount: result.rowCount,
    durationMs: result.durationMs,
    truncated: result.truncated || result.rowCount > MAX_ROWS || result.rows.length > MAX_ROWS
  }
}

export class DuckDbClient implements SqlExecutor {
  private readonly worker: WorkerLike
  private readonly timeoutMs: number
  private readonly pending = new Map<string, Pending>()
  private nextRequestId = 0
  private closed = false
  private closePromise: Promise<void> | null = null
  private closeResolve: (() => void) | null = null
  private closeReject: ((reason: unknown) => void) | null = null

  constructor(options: DuckDbClientOptions = {}) {
    const factory = options.workerFactory ?? defaultWorkerFactory
    this.worker = factory(options.workerUrl ?? DEFAULT_WORKER_URL)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
  }

  registerSource(source: SqlSource): Promise<void> {
    try {
      assertSafeName(source.name)
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.closed) return Promise.reject(new QueryExecutionError('DuckDB worker is closed'))
    if (source.bytes.byteLength === 0) return Promise.reject(new TypeError('source bytes must not be empty'))
    const requestId = source.name
    const message: DuckDbRequest = { type: 'register', name: source.name, bytes: source.bytes, format: source.format }
    return this.send<void>(requestId, message, undefined, [source.bytes])
  }

  dropSource(name: string): Promise<void> {
    try { assertSafeName(name) } catch (error) { return Promise.reject(error) }
    const requestId = this.createRequestId('drop')
    return this.send<void>(requestId, { type: 'drop', requestId, name })
  }

  explain(sql: string): Promise<void> {
    const requestId = this.createRequestId('explain')
    return this.send<void>(requestId, { type: 'explain', requestId, sql })
  }

  query(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    const requestId = this.createRequestId('query')
    return this.send<QueryResult>(requestId, { type: 'query', requestId, sql }, signal).then(normalizeResult)
  }

  cancel(requestId: string): void {
    if (this.closed) return
    this.worker.postMessage({ type: 'cancel', requestId })
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    if (this.closed) return
    const closedError = new QueryExecutionError('DuckDB worker is closing')
    for (const requestId of this.pending.keys()) this.cancel(requestId)
    for (const pending of this.pending.values()) pending.reject(closedError)
    this.pending.clear()
    this.closePromise = new Promise<void>((resolve, reject) => {
      this.closeResolve = resolve
      this.closeReject = reject
      this.worker.postMessage({ type: 'close' })
    }).finally(() => {
      this.closed = true
      this.worker.removeEventListener('message', this.handleMessage)
      this.worker.removeEventListener('error', this.handleWorkerError)
      this.worker.terminate()
      this.closeResolve = null
      this.closeReject = null
    })
    return this.closePromise
  }

  private createRequestId(kind: string): string {
    this.nextRequestId += 1
    return `${kind}-${this.nextRequestId}`
  }

  private send<T>(requestId: string, message: DuckDbRequest, signal?: AbortSignal, transfer: Transferable[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new QueryExecutionError('DuckDB worker is closed', requestId))
    if (signal?.aborted) return Promise.reject(new QueryCancelledError(requestId))
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        this.pending.delete(requestId)
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
        clearTimeout(timer)
        callback()
      }
      const timer = setTimeout(() => {
        settle(() => {
          this.cancel(requestId)
          reject(new QueryTimeoutError(requestId, this.timeoutMs))
        })
      }, this.timeoutMs)
      const abortHandler = signal ? () => {
        settle(() => {
          this.cancel(requestId)
          reject(new QueryCancelledError(requestId))
        })
      } : undefined
      if (signal && abortHandler) signal.addEventListener('abort', abortHandler, { once: true })
      this.pending.set(requestId, { resolve: (value) => settle(() => resolve(value as T)), reject: (reason) => settle(() => reject(reason)), timer, signal, abortHandler })
      try {
        this.worker.postMessage(message, transfer)
      } catch (error) {
        settle(() => reject(new QueryExecutionError(error instanceof Error ? error.message : String(error), requestId)))
      }
    })
  }

  private readonly handleMessage = (event: Event): void => {
    const response = (event as MessageEvent<DuckDbResponse>).data
    if (!response || (response.type !== 'success' && response.type !== 'error')) return
    if (response.requestId === 'close') {
      if (response.type === 'error') this.closeReject?.(new QueryExecutionError(responseErrorMessage(response), response.requestId))
      else this.closeResolve?.()
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    if (response.type === 'error') {
      pending.reject(new QueryExecutionError(responseErrorMessage(response), response.requestId))
      return
    }
    pending.resolve(response.result)
  }

  private readonly handleWorkerError = (event: Event): void => {
    const error = (event as ErrorEvent).error
    const message = error instanceof Error ? error.message : (event as ErrorEvent).message || 'DuckDB worker failed'
    const failure = new QueryExecutionError(message)
    for (const pending of this.pending.values()) pending.reject(failure)
    this.pending.clear()
    this.closeReject?.(failure)
  }
}
