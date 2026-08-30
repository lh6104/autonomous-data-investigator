# Deterministic Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working Synapse slice: a browser-first deterministic analytics core that registers the Kaggle e-commerce demo data in DuckDB-Wasm, compiles the certified Net Revenue metric, rejects unsafe SQL, and emits reproducible evidence plus a Trust Report.

**Architecture:** `src/core` owns pure contracts, catalog/profiling, metric compilation, SQL policy, verification, and the small `DeterministicAnalyzer` facade. A single injected `SqlExecutor` interface is the external seam; the browser adapter in `src/workers` implements it with DuckDB-Wasm, while unit tests use an in-memory adapter. The core never imports React, Gemini, Groq, `window`, `Worker`, DuckDB, or Arrow.

**Tech Stack:** React 18, TypeScript, Vite 7, Vitest, Playwright, `@duckdb/duckdb-wasm@1.32.0`, `apache-arrow@17.0.0`, Zod 4, Node 22 scripts. No UI, AI transport, persistence, or additional analytics dependencies in this slice.

**Spec:** `docs/superpowers/specs/2026-08-30-synapse-ai-riser-design.md`

## Global Constraints

- Raw files stay in the browser; only approved metadata and bounded results can cross a future AI seam.
- Demo sources are `users`, `products`, `orders`, `order_items`, `reviews`, and `events`.
- Certified metric: `Net Revenue = SUM(total_amount)` from `orders` where `order_status = 'Completed'`, grain `order`.
- Independent reconciliation: `SUM(oi.quantity * oi.item_price)` joined to completed `orders`.
- Every SQL statement is read-only, single-statement, known-schema, bounded, and EXPLAIN-valid before execution.
- Browser-local SQL execution uses DuckDB-Wasm; no CDN bundle, remote URL, dynamic remote extension, or runtime Kaggle download.
- Tests use fixed local fixtures and never require network access.
- Demo-data attribution must identify Abhay Ayare, Kaggle dataset `abhayayare/e-commerce-dataset`, and license metadata returned by Kaggle.
- Deterministic outputs use explicit ordering, UTC date handling, normalized numeric values, and no Arrow metadata snapshots.
- Implement only deterministic core and local-data wiring; do not add UI, LLM orchestration, database connectors, accounts, or deployment.
- Limits: ten sources, 250 MB total, two million combined rows, 10,000 displayed rows, 30-second interactive query timeout.

## File Map

- Create `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`: minimal build/test shell.
- Create `src/core/contracts.ts`: public domain types and Zod validation for plans/results.
- Create `src/core/catalog.ts`: pure catalog/profiler and PII classification.
- Create `src/core/metrics.ts`: certified metric registry and bounded SQL compiler.
- Create `src/core/sql-guard.ts`: read-only SQL validation against catalog and query budgets.
- Create `src/core/trust.ts`: deterministic checks, reconciliation thresholds, and verdict derivation.
- Create `src/core/analyzer.ts`: deep facade combining guard, executor, metric verification, evidence, and trust.
- Create `src/workers/duckdb.worker.ts`: worker protocol and DuckDB-Wasm implementation.
- Create `src/workers/duckdb-client.ts`: browser `SqlExecutor` adapter with cancellation and timeout mapping.
- Create `scripts/copy-duckdb-assets.mjs`: copy pinned local Wasm/worker assets into `public/duckdb`.
- Create `scripts/fetch-demo-data.mjs`: one-time Kaggle download/normalization into `public/demo-data`.
- Create `scripts/verify-demo-data.mjs`: offline schema, row-count, and relationship checks.
- Create `public/demo-data/metadata.json`: attribution, source list, schema/relationship manifest, and privacy flags.
- Create `tests/fixtures/*.csv`: tiny fixed local fixtures including clean and adversarial revenue data.
- Create `tests/unit/*.test.ts`: interface-level catalog, metric, SQL Guard, trust, and analyzer tests.
- Create `tests/browser/duckdb.smoke.spec.ts`: local-asset CSV execution smoke test.

---

### Task 1: Bootstrap the TypeScript/Vite test shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `index.html`
- Create: `tests/fixtures/orders.csv`
- Create: `tests/fixtures/order_items.csv`
- Create: `tests/fixtures/users.csv`

**Interfaces:**
- Produces the scripts `typecheck`, `test:unit`, `build`, `test:browser`, `prepare:duckdb`, `prepare:demo-data`, and `verify:demo-data` used by all later tasks.
- Produces TypeScript path alias `@/*` → `src/*`.

- [ ] **Step 1: Write the package manifest with pinned versions**

```json
{
  "name": "synapse",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest",
    "build": "vite build",
    "prepare:duckdb": "node scripts/copy-duckdb-assets.mjs",
    "prepare:demo-data": "node scripts/fetch-demo-data.mjs",
    "verify:demo-data": "node scripts/verify-demo-data.mjs",
    "test:browser": "playwright test"
  },
  "dependencies": {
    "@duckdb/duckdb-wasm": "1.32.0",
    "apache-arrow": "17.0.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@playwright/test": "1.52.0",
    "@vitejs/plugin-react": "5.2.0",
    "typescript": "5.9.3",
    "vite": "7.3.6",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 2: Add strict compiler and test configuration**

`tsconfig.json` must enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmit`, ES2022 modules, DOM/WebWorker libs, and the `@/*` alias. Vite must use `@vitejs/plugin-react`; Vitest must use the Node environment, `tests/unit/**/*.test.ts`, and no network-dependent setup. Playwright must serve the built app through `npm run dev -- --host 127.0.0.1` and use Chromium.

- [ ] **Step 3: Add a minimal Vite entry and fixed CSV fixtures**

`index.html` must contain only a root element and `/src/main.tsx`; `src/main.tsx` can render a plain `div` with `Synapse core` so the build has an entry. The fixtures must include:

```csv
order_id,user_id,order_date,order_status,total_amount
O1,U1,2025-01-03T10:00:00Z,Completed,100.00
O2,U2,2025-01-04T10:00:00Z,Cancelled,50.00
O3,U1,2025-02-01T10:00:00Z,Completed,25.00
```

```csv
order_item_id,order_id,product_id,quantity,item_price
I1,O1,P1,2,50.00
I2,O3,P2,1,25.00
```

`users.csv` must contain one synthetic row with `user_id,name,email,city` and no real person.

- [ ] **Step 4: Install and verify the shell**

Run:

```bash
npm install
npm run typecheck
npm run test:unit -- --run
npm run build
```

Expected: typecheck/build pass; Vitest reports no test files yet without failing the command. If a pinned package is unavailable, stop and report the exact registry error instead of changing versions silently.

---

### Task 2: Define contracts and catalog/profiling

**Files:**
- Create: `src/core/contracts.ts`
- Create: `src/core/catalog.ts`
- Create: `tests/unit/catalog.test.ts`

**Interfaces:**
- `Catalog`, `TableSchema`, `ColumnProfile`, `Relationship`, `MetricDefinition`, `QueryPlan`, `QueryResult`, `Evidence`, `TrustCheck`, `TrustReport`, and `AnalysisResult` live in `contracts.ts`.
- `profileTable(tableName, columns, rows): TableSchema` is pure and computes types/nulls/distinct/min/max/top values/PII.
- `createDemoCatalog(): Catalog` returns the six-table manifest and confirmed relationships.
- `validateQueryPlan(plan): QueryPlan` and `validateAnalysisResult(result): AnalysisResult` parse with Zod and throw a stable `ContractError` on malformed input.

- [ ] **Step 1: Write interface-level failing tests**

Test that profiling detects integer, decimal, boolean, date, timestamp, and string logical types; null rate is `nulls / rowCount`; distinct count is exact for the supplied rows; top values are deterministic; `email`, `name`, and `*_id` are classified appropriately; demo relationships include confirmed `orders.order_id → order_items.order_id`, `users.user_id → orders.user_id`, and `products.product_id → order_items.product_id`.

- [ ] **Step 2: Implement the smallest contract model**

Use discriminated unions for `ColumnType` and `PiiClass`; use `status: 'suggested' | 'confirmed' | 'rejected'`; represent `QueryResult.rows` as `ReadonlyArray<Readonly<Record<string, unknown>>>`; carry `rowCount`, `columns`, `durationMs`, and `truncated` explicitly. `AnalysisResult` must preserve `query`, `sql`, `rows`, `evidence`, `checks`, `trust`, and `warnings` even when trust is failed.

- [ ] **Step 3: Implement deterministic profiling and demo catalog**

Profile values without external parsing libraries. Normalize dates to UTC ISO strings, sort top values by count descending then value ascending, and cap top values at five. PII rules: `email`/email-like names → `direct`; names/phone/address → `quasi`; identifier columns → `identifier`; otherwise `none`. Demo catalog must omit sample PII values from its metadata.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm run test:unit -- --run tests/unit/catalog.test.ts
npm run typecheck
```

Expected: all catalog tests pass.

---

### Task 3: Implement certified metrics and SQL Guard

**Files:**
- Create: `src/core/metrics.ts`
- Create: `src/core/sql-guard.ts`
- Create: `tests/unit/metrics.test.ts`
- Create: `tests/unit/sql-guard.test.ts`

**Interfaces:**
- `getMetric(id: string): MetricDefinition | undefined`.
- `compileMetricQuery(request: MetricQueryRequest, catalog: Catalog): CompiledMetricQuery`.
- `guardSql(sql: string, catalog: Catalog, options?: GuardOptions): GuardedSql`.
- `GuardedSql` returns normalized SQL or a list of `SqlViolation` values; it never executes SQL.

- [ ] **Step 1: Write failing metric tests**

Assert the registry contains exactly one certified metric initially:

```ts
expect(getMetric('net_revenue')).toMatchObject({
  name: 'Net Revenue',
  source: 'orders',
  grain: 'order',
  expression: 'SUM(total_amount)',
  requiredFilter: "order_status = 'Completed'",
  status: 'certified'
})
```

Assert the primary compiled query is:

```sql
SELECT SUM(total_amount) AS net_revenue
FROM orders
WHERE order_status = 'Completed';
```

Assert a month dimension emits UTC `date_trunc('month', order_date)` and explicit `ORDER BY`; reject unknown metric/table/dimension identifiers.

- [ ] **Step 2: Write failing SQL Guard tests**

Reject multiple statements, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `read_csv_auto`, `read_parquet`, `httpfs`, path/URL literals, unknown columns/tables, invalid joins, unexplained `CROSS JOIN`, missing `LIMIT` for detail queries, and complexity above configured joins/CTEs. Accept the primary Net Revenue query, a bounded aggregate, and `EXPLAIN SELECT ...`.

- [ ] **Step 3: Implement metric registry/compiler**

Keep metric definitions immutable. Quote only identifiers already present in the catalog; values are fixed or parameterized by a whitelist of supported enum values. Do not accept arbitrary SQL fragments through the metric interface. Compile only KPI and monthly trend for this slice; return an explicit unsupported error for other intents.

- [ ] **Step 4: Implement lexical SQL Guard**

Normalize comments/whitespace, count semicolon-separated statements while allowing one terminal semicolon, inspect the first keyword, deny dangerous tokens/functions, extract referenced identifiers, validate aliases and joins against catalog relationships, require `LIMIT` for non-aggregate detail output, and enforce max 8 joins, max 6 CTEs, and max 10,000 rows. Do not claim full SQL parsing; DuckDB `EXPLAIN` remains a separate execution-stage check.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run test:unit -- --run tests/unit/metrics.test.ts tests/unit/sql-guard.test.ts
npm run typecheck
```

Expected: all metric and SQL Guard tests pass.

---

### Task 4: Implement deterministic Trust Engine

**Files:**
- Create: `src/core/trust.ts`
- Create: `tests/unit/trust.test.ts`

**Interfaces:**
- `reconcileNetRevenue(orderRevenue: number, itemRevenue: number): TrustCheck`.
- `checkResultSanity(result: QueryResult, expectedShape: ExpectedResultShape): TrustCheck`.
- `deriveTrustReport(checks: readonly TrustCheck[]): TrustReport`.

- [ ] **Step 1: Write failing threshold and verdict tests**

Use the disclosed thresholds: absolute relative difference ≤ 0.5% → `pass`; > 0.5% and ≤ 3% → `caveat`; > 3% → `fail` with critical severity. Test verdicts: any critical fail → `do_not_trust`; warning-only → `verified_with_caveats`; all applicable pass → `verified`; no applicable checks → `verified_with_caveats`. Include zero-denominator handling, empty result, negative revenue, and non-finite values.

- [ ] **Step 2: Implement checks and evidence references**

Normalize currency comparisons to cents before computing the relative difference where possible; include both values, absolute difference, relative difference, threshold, and a reproducible evidence reference in every reconciliation check. Result sanity must detect missing expected columns, duplicate KPI rows, non-finite numbers, and unexpected negative Net Revenue.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm run test:unit -- --run tests/unit/trust.test.ts
npm run typecheck
```

Expected: all Trust Engine tests pass.

---

### Task 5: Add the browser-first DuckDB-Wasm adapter

**Files:**
- Create: `src/workers/duckdb.worker.ts`
- Create: `src/workers/duckdb-client.ts`
- Create: `scripts/copy-duckdb-assets.mjs`
- Create: `tests/unit/duckdb-client.test.ts`
- Create: `tests/browser/duckdb.smoke.spec.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- `SqlExecutor` is the only external seam used by `src/core`: `registerSource(source): Promise<void>`, `explain(sql): Promise<void>`, `query(sql, signal?): Promise<QueryResult>`, `cancel(requestId): void`, `close(): Promise<void>`.
- `DuckDbClient` implements `SqlExecutor` using a classic worker and local assets only.
- The worker accepts `{type:'register', name, bytes, format}`, `{type:'explain', requestId, sql}`, `{type:'query', requestId, sql}`, `{type:'cancel', requestId}`, and `{type:'close'}`; it returns structured success/error messages with request IDs.

- [ ] **Step 1: Inspect pinned package assets and write adapter protocol tests**

After `npm install`, inspect `node_modules/@duckdb/duckdb-wasm/dist` and assert the required `duckdb-mvp.wasm` and `duckdb-browser-mvp.worker.js` assets exist. Unit-test the client with a fake Worker factory: registration sends bytes and a safe table name; query resolves normalized rows; timeout aborts and maps to `QueryTimeoutError`; worker error maps to `QueryExecutionError`; close terminates the worker.

- [ ] **Step 2: Implement local asset copying**

`copy-duckdb-assets.mjs` must copy only the pinned package's `duckdb-mvp.wasm` and `duckdb-browser-mvp.worker.js` into `public/duckdb`; fail with a clear error if either file is absent. Never call `getJsDelivrBundles`, `registerFileURL`, or any remote URL.

- [ ] **Step 3: Implement the worker using DuckDB-Wasm**

Create `AsyncDuckDB` with the local `MVPBundle`, open one connection, register CSV bytes through `registerFileText`/`registerFileBuffer`, create safe tables from registered files, run `EXPLAIN` before query execution, convert Arrow results to normalized rows, and apply the 30-second timeout/cancellation contract. Keep all DuckDB imports in worker/adapter files.

- [ ] **Step 4: Implement the client adapter**

Use a request map keyed by `requestId`; transfer `ArrayBuffer` where supported; ensure every pending request settles on worker error/close. Reject non-safe table names before sending. Cap returned rows at 10,000 and set `truncated` rather than silently dropping data.

- [ ] **Step 5: Add the browser smoke test**

Copy assets, start Vite, register `tests/fixtures/orders.csv` and `order_items.csv`, run the guarded primary query plus reconciliation query, and assert `net_revenue = 125` and item revenue = `125`. The test must run with network disabled and local assets only. If Parquet extension is not packaged locally, do not add a fake Parquet execution test; retain registration contract coverage and report Parquet as a separate vendoring task.

- [ ] **Step 6: Run adapter verification**

Run:

```bash
npm run prepare:duckdb
npm run test:unit -- --run tests/unit/duckdb-client.test.ts
npm run build
npm run test:browser -- --project=chromium
```

Expected: local Wasm/worker files appear under `dist/duckdb`; unit and browser smoke tests pass without CDN/network access.

---

### Task 6: Build the deep `DeterministicAnalyzer` facade

**Files:**
- Create: `src/core/analyzer.ts`
- Create: `tests/unit/analyzer.test.ts`
- Modify: `src/core/contracts.ts` only if result validation needs the final fields

**Interfaces:**
- `createDeterministicAnalyzer(deps: { catalog: Catalog; executor: SqlExecutor }): DeterministicAnalyzer`.
- `DeterministicAnalyzer.run(request: AnalysisRequest): Promise<AnalysisResult>`.
- `AnalysisRequest` contains `question`, `plan`, and optional `signal`; `plan` contains metric, SQL, expected shape, and verification SQL.

- [ ] **Step 1: Write the end-to-end facade tests with a fake executor**

Test that `run` guards the planner SQL, EXPLAINs it, executes it, executes the verification SQL, creates evidence for both outputs, runs result sanity and reconciliation, and returns `verified` for matching fixture values. Test rejected SQL returns a failed result without execution; timeout preserves partial computed output and warning; reconciliation mismatch returns `do_not_trust` while retaining rows/evidence; empty results return an honest caveat.

- [ ] **Step 2: Implement orchestration behind the small facade**

The implementation order is fixed: validate plan → `guardSql` primary and verification SQL → `executor.explain` → primary `executor.query` → verification `executor.explain`/`query` → Trust Engine → `AnalysisResult`. It must not call an LLM, hide errors, mutate catalog, or recalculate supplied result numbers. Query results remain bounded.

- [ ] **Step 3: Run facade tests and full unit suite**

Run:

```bash
npm run test:unit -- --run tests/unit/analyzer.test.ts
npm run test:unit -- --run
npm run typecheck
```

Expected: all unit tests pass.

---

### Task 7: Fetch, normalize, and verify the Kaggle demo dataset

**Files:**
- Create: `scripts/fetch-demo-data.mjs`
- Create: `scripts/verify-demo-data.mjs`
- Create: `public/demo-data/metadata.json`
- Create: `public/demo-data/users.csv`
- Create: `public/demo-data/products.csv`
- Create: `public/demo-data/orders.csv`
- Create: `public/demo-data/order_items.csv`
- Create: `public/demo-data/reviews.csv`
- Create: `public/demo-data/events.csv`
- Create: `tests/unit/demo-data.test.ts`

**Interfaces:**
- `fetch-demo-data.mjs` is an explicit maintainer command, not imported by the app; it downloads the public dataset once from Kaggle's dataset download endpoint, extracts exactly six CSV files, normalizes filenames/line endings, and writes no archive into `public/`.
- `verify-demo-data.mjs` reads only local files, checks headers, duplicate IDs, relationship match rates, and row limits, then exits nonzero on failure.
- `metadata.json` contains source URL, dataset ref, creator, attribution text, license, retrieval date, table names, row counts, and PII classes; it contains no sample PII values.

- [ ] **Step 1: Implement one-time download and safe extraction**

Use Node built-ins (`fetch`, `fs`, `path`, `child_process` only if needed for archive extraction); require a successful HTTP response; reject path traversal during ZIP extraction; accept only the six expected basenames; normalize CSV output to UTF-8 LF; fail if any expected table is absent. Do not execute this script during `npm install`, app startup, tests, or build.

- [ ] **Step 2: Run the explicit data preparation command**

Run:

```bash
npm run prepare:demo-data
```

Expected: six CSV files and `metadata.json` under `public/demo-data`. If Kaggle changes the public endpoint or requires credentials, stop with the exact instruction to download the archive manually and rerun the normalization path; never commit credentials.

- [ ] **Step 3: Verify schema and relationships offline**

Run:

```bash
npm run verify:demo-data
```

The verifier must confirm required columns from the Kaggle data dictionary, unique primary IDs, valid foreign-key references where present, `orders.order_status` values, numeric revenue fields, and six sources under the 250 MB/2-million-row MVP limits.

- [ ] **Step 4: Add stable metadata assertions**

Test that metadata credits `Abhay Ayare`, identifies `abhayayare/e-commerce-dataset`, preserves `CC BY-SA 4.0`, marks `users.name` and `users.email` as PII, and does not contain an email-shaped or person-name sample value. Test only schema and invariants, not exact row counts that may change across dataset versions.

---

### Task 8: Integration verification and handoff

**Files:**
- Modify: `scripts/verify-demo-data.mjs` if integration checks expose a data issue
- Create: `tests/integration/demo-analysis.test.ts`
- Modify: `README` only if one already exists; otherwise do not create documentation in this slice

**Interfaces:**
- The integration test consumes `createDemoCatalog`, `compileMetricQuery`, `guardSql`, `createDeterministicAnalyzer`, and the browser DuckDB adapter contract.

- [x] **Step 1: Add a local integration invariant test**

With the fixed small fixture and fake executor, assert the certified metric, primary SQL, verification SQL, evidence references, and Trust Report all agree. With the prepared Kaggle files, assert the verifier passes and every catalog table has a matching local file.

- [x] **Step 2: Run the complete verification ladder**

Run:

```bash
npm run typecheck
npm run test:unit -- --run
npm run verify:demo-data
npm run prepare:duckdb
npm run build
npm run test:browser -- --project=chromium
```

Also run the offline policy scan:

```bash
rg -n 'getJsDelivrBundles|registerFileURL|extensions\.duckdb\.org|https?://' src tests public/duckdb
```

Expected: no forbidden runtime URL/CDN usage; the only allowed URL is attribution metadata/source text, not executable code or SQL.

- [x] **Step 3: Review the final diff and report limits**

Confirm no UI/LLM logic was added, no credentials or archive was committed, raw rows are not part of catalog metadata, and failed verification preserves computed output. Explicitly record Parquet actual execution as pending if a vendored local Parquet extension was not available.

---

## Plan Self-Review

- **Spec coverage:** This plan covers local demo/import foundations, catalog/profiling/PII, confirmed relationships, certified Net Revenue, read-only guarded SQL, DuckDB-Wasm execution, evidence, deterministic Trust Report, reconciliation thresholds, failure preservation, browser-first privacy posture, row/time limits, and fixed tests. Ask/Investigate UI, Gemini, Groq, persistence, report UI, and Cloud Run remain intentionally outside this first slice.
- **Placeholder scan:** No `TBD`, `TODO`, or unspecified implementation step is required. Unsupported Parquet execution is an explicit reported limit, not hidden scope.
- **Type consistency:** `SqlExecutor`, `Catalog`, `QueryPlan`, `QueryResult`, `TrustCheck`, `TrustReport`, and `AnalysisResult` are defined in Task 2 and consumed by later tasks. The analyzer is the only core facade exposed to later slices.
- **Deep-module check:** callers learn one analyzer interface; SQL policy, metric compilation, execution ordering, evidence construction, and verification remain inside the implementation. The executor seam has two adapters: real DuckDB-Wasm and test fake.
