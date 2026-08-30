import type { QueryResult } from '@/core/contracts'

export type DuckDbRequest =
  | { readonly type: 'register'; readonly name: string; readonly bytes: ArrayBuffer; readonly format: 'csv' | 'parquet' }
  | { readonly type: 'drop'; readonly requestId: string; readonly name: string }
  | { readonly type: 'explain'; readonly requestId: string; readonly sql: string }
  | { readonly type: 'query'; readonly requestId: string; readonly sql: string }
  | { readonly type: 'cancel'; readonly requestId: string }
  | { readonly type: 'close' }

export type DuckDbResponse =
  | { readonly type: 'success'; readonly requestId: string; readonly result?: QueryResult }
  | { readonly type: 'error'; readonly requestId: string; readonly error: { readonly message: string; readonly name?: string } }
