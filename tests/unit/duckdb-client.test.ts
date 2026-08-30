import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { QueryResult } from '@/core/contracts'
import {
  DuckDbClient,
  QueryExecutionError,
  QueryTimeoutError,
  type WorkerLike
} from '@/workers/duckdb-client'

type PostedMessage = { readonly message: unknown; readonly transfer: readonly Transferable[] }

class FakeWorker implements WorkerLike {
  readonly messages: PostedMessage[] = []
  terminated = false
  private readonly messageListeners: EventListener[] = []
  private readonly errorListeners: EventListener[] = []

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.messages.push({ message, transfer })
  }

  addEventListener(type: 'message' | 'error', listener: EventListener): void {
    ;(type === 'message' ? this.messageListeners : this.errorListeners).push(listener)
  }

  removeEventListener(type: 'message' | 'error', listener: EventListener): void {
    const listeners = type === 'message' ? this.messageListeners : this.errorListeners
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(response: unknown): void {
    const event = { data: response } as MessageEvent
    for (const listener of [...this.messageListeners]) listener(event)
  }

  fail(message: string): void {
    const event = { message, error: new Error(message) } as ErrorEvent
    for (const listener of [...this.errorListeners]) listener(event)
  }
}

const result: QueryResult = {
  columns: ['net_revenue'],
  rows: [{ net_revenue: 125 }],
  rowCount: 1,
  durationMs: 1,
  truncated: false
}

describe('DuckDbClient', () => {
  it('has the pinned local DuckDB runtime assets installed', () => {
    expect(existsSync('node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm')).toBe(true)
    expect(existsSync('node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js')).toBe(true)
  })

  it('registers a safe source and transfers its bytes', async () => {
    const worker = new FakeWorker()
    const client = new DuckDbClient({ workerFactory: () => worker, timeoutMs: 100 })
    const bytes = new TextEncoder().encode('id,value\n1,ok\n').buffer
    const pending = client.registerSource({ name: 'orders', format: 'csv', bytes })
    const message = worker.messages[0]?.message as { type: string; name: string; bytes: ArrayBuffer; format: string }
    expect(message).toMatchObject({ type: 'register', name: 'orders', format: 'csv' })
    expect(message.bytes).toBe(bytes)
    expect(worker.messages[0]?.transfer).toContain(bytes)
    worker.respond({ type: 'success', requestId: 'orders' })
    await pending
    const closing = client.close()
    worker.respond({ type: 'success', requestId: 'close' })
    await closing
  })

  it('rejects unsafe source names before sending', async () => {
    const worker = new FakeWorker()
    const client = new DuckDbClient({ workerFactory: () => worker })
    await expect(client.registerSource({ name: 'orders;DROP', format: 'csv', bytes: new ArrayBuffer(1) })).rejects.toThrow("unsafe source name 'orders;DROP'")
    expect(worker.messages).toHaveLength(0)
  })

  it('resolves normalized query rows', async () => {
    const worker = new FakeWorker()
    const client = new DuckDbClient({ workerFactory: () => worker, timeoutMs: 100 })
    const pending = client.query('SELECT 125 AS net_revenue;')
    const message = worker.messages[0]?.message as { requestId: string }
    worker.respond({ type: 'success', requestId: message.requestId, result })
    await expect(pending).resolves.toEqual(result)
    const closing = client.close()
    worker.respond({ type: 'success', requestId: 'close' })
    await closing
  })

  it('maps timeout to QueryTimeoutError and sends cancellation', async () => {
    const worker = new FakeWorker()
    const client = new DuckDbClient({ workerFactory: () => worker, timeoutMs: 10 })
    const pending = client.query('SELECT 1')
    await expect(pending).rejects.toBeInstanceOf(QueryTimeoutError)
    expect(worker.messages.map(({ message }) => (message as { type: string }).type)).toEqual(['query', 'cancel'])
    const closing = client.close()
    worker.respond({ type: 'success', requestId: 'close' })
    await closing
  })

  it('maps worker errors to QueryExecutionError', async () => {
    const worker = new FakeWorker()
    const client = new DuckDbClient({ workerFactory: () => worker, timeoutMs: 100 })
    const pending = client.query('SELECT 1')
    worker.respond({ type: 'error', requestId: 'query-1', error: { message: 'syntax error' } })
    await expect(pending).rejects.toBeInstanceOf(QueryExecutionError)
    const closing = client.close()
    worker.respond({ type: 'success', requestId: 'close' })
    await closing
  })

  it('terminates the worker on close', async () => {
    const worker = new FakeWorker()
    const client = new DuckDbClient({ workerFactory: () => worker, timeoutMs: 100 })
    const pending = client.close()
    expect(worker.messages).toEqual([{ message: { type: 'close' }, transfer: [] }])
    worker.respond({ type: 'success', requestId: 'close' })
    await pending
    expect(worker.terminated).toBe(true)
  })
})
