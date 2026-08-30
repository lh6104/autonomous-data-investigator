# Local Dataset Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add browser-local multi-file CSV, XLSX, and Parquet import where every CSV/Parquet file or selected XLSX worksheet becomes a safe, queryable DuckDB table with schema preview.

**Architecture:** Keep DuckDB registration limited to CSV and Parquet. Parse XLSX in a feature adapter and convert selected sheets to UTF-8 CSV before registration. A LocalImportService owns validation, safe names, registration, profiling, rollback, and catalog assembly; React only coordinates user selection and renders state.

**Tech Stack:** TypeScript 5.9, React 18, DuckDB-Wasm 1.32, ExcelJS 4.4.0, Zod 4, Vitest 4, Playwright 1.52

**Spec:** docs/superpowers/specs/2026-08-30-gemini-google-stack-design.md

## Global Constraints

- Raw CSV, XLSX, and Parquet bytes never leave the browser.
- Support at most 10 physical files, 10 resulting tables, and 250 MiB total source bytes.
- Limit each XLSX file to 25 MiB, each table to 2,000,000 rows, and each preview to 1,000 rows.
- Reject XLS, XLSM, encrypted workbooks, external workbook links, embedded HTML, macros, and formulas without cached scalar values.
- Table names must match /^[A-Za-z_][A-Za-z0-9_]{0,62}$/ and be unique case-insensitively.
- No AI, Firebase, HTTP, or persistence import may appear in src/features/import.
- Existing CSV behavior and deterministic core tests must remain green.

---

### Task 1: Import contracts, validation, and safe names

**Files:**
- Create: src/features/import/contracts.ts
- Create: src/features/import/file-validation.ts
- Create: tests/unit/file-validation.test.ts

**Interfaces:**
- Produces: ImportFormat, ImportLimits, ImportIssue, ImportCandidate, ImportSelection, ImportedTable, LocalImportResult
- Produces: detectImportFormat(file), validateImportCandidates(files, limits), allocateSafeTableNames(inputs, existing)

- [ ] **Step 1: Write failing validation tests**

Cover blank browser MIME, accepted CSV/XLSX/Parquet extensions and MIME types, misleading double extensions, unsupported XLS/XLSM/JSON, empty files, 10-file limit, 250 MiB total limit, 25 MiB XLSX limit, and deterministic collision handling.

~~~ts
expect(detectImportFormat({ name: 'orders.csv', type: '' })).toBe('csv')
expect(detectImportFormat({ name: 'orders.csv.exe', type: 'text/csv' })).toBeNull()
expect(allocateSafeTableNames([
  { fileName: 'Sales FY24.xlsx', sheetName: 'Q1 sales' },
  { fileName: 'Sales FY24.xlsx', sheetName: 'Q1 sales' }
])).toEqual(['sales_fy24_q1_sales', 'sales_fy24_q1_sales_2'])
~~~

- [ ] **Step 2: Run the focused test and verify it fails**

Run: npm run test:unit -- --run tests/unit/file-validation.test.ts

Expected: FAIL because src/features/import/file-validation.ts does not exist.

- [ ] **Step 3: Implement contracts and pure validation**

Define these exact defaults:

~~~ts
export const DEFAULT_IMPORT_LIMITS = {
  maxFiles: 10,
  maxTables: 10,
  maxTotalBytes: 250 * 1024 ** 2,
  maxXlsxBytes: 25 * 1024 ** 2,
  maxPreviewRows: 1_000,
  maxRows: 2_000_000
} as const satisfies ImportLimits
~~~

Normalize with NFKD, remove combining marks, lowercase, and replace non-alphanumerics with underscores. Preserve valid base names such as orders; prefix data_ only when the normalized name is empty or begins with a digit. Trim to 63 characters and append numeric suffixes while retaining the length bound.

- [ ] **Step 4: Run validation tests**

Run: npm run test:unit -- --run tests/unit/file-validation.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/features/import/contracts.ts src/features/import/file-validation.ts tests/unit/file-validation.test.ts
git commit -m "feat: validate local dataset imports"
~~~

---

### Task 2: Safe XLSX worksheet adapter

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Create: src/features/import/xlsx-reader.ts
- Create: tests/unit/xlsx-reader.test.ts

**Interfaces:**
- Consumes: ImportLimits from src/features/import/contracts.ts
- Produces: XlsxSheet and XlsxWorkbookReader
- Produces: createXlsxWorkbookReader(): XlsxWorkbookReader

~~~ts
export interface XlsxSheet {
  readonly name: string
  readonly rowCount: number
  readonly columnCount: number
}

export interface XlsxWorkbookReader {
  listSheets(file: File): Promise<readonly XlsxSheet[]>
  toCsv(file: File, sheetName: string, maxRows: number): Promise<Uint8Array>
}
~~~

- [ ] **Step 1: Install the exact browser XLSX dependency**

Run: npm install --save-exact exceljs@4.4.0

Expected: package.json and package-lock.json pin 4.4.0 exactly.

- [ ] **Step 2: Write failing workbook tests**

Build a small workbook in test memory with two worksheets. Assert selected-sheet listing, RFC-4180 escaping for comma/newline/quotes, deterministic blank and duplicate headers, scalar date/number/string conversion, missing sheet rejection, and max-row rejection.

~~~ts
const sheets = await reader.listSheets(file)
expect(sheets.map((sheet) => sheet.name)).toEqual(['Orders', 'Customers'])
const csv = new TextDecoder().decode(await reader.toCsv(file, 'Orders', 100))
expect(csv).toContain('"customer, name"')
~~~

- [ ] **Step 3: Run the focused test and verify it fails**

Run: npm run test:unit -- --run tests/unit/xlsx-reader.test.ts

Expected: FAIL because createXlsxWorkbookReader is missing.

- [ ] **Step 4: Implement the narrow ExcelJS adapter**

Load only from ArrayBuffer, never render HTML, never evaluate formulas, hyperlinks, macros, or external links. Accept cached scalar formula results; map formulas without cached values to blank. Treat row one as headers, generate column_1 for blanks, and suffix duplicate headers.

The adapter returns UTF-8 CSV bytes and never receives fetch, an AI provider, or a server dependency.

- [ ] **Step 5: Verify XLSX tests, typecheck, build, and audit**

Run: npm run test:unit -- --run tests/unit/xlsx-reader.test.ts

Run: npm run typecheck

Run: npm run build

Run: npm audit --omit=dev

Expected: tests, typecheck, and build pass; review any production audit finding before continuing.

- [ ] **Step 6: Commit**

~~~bash
git add package.json package-lock.json src/features/import/xlsx-reader.ts tests/unit/xlsx-reader.test.ts
git commit -m "feat: parse selected xlsx worksheets locally"
~~~

---

### Task 3: Transactional DuckDB source lifecycle

**Files:**
- Create: src/workers/duckdb-protocol.ts
- Modify: src/core/contracts.ts
- Modify: src/workers/duckdb-client.ts
- Modify: src/workers/duckdb.worker.ts
- Modify: tests/unit/duckdb-client.test.ts

**Interfaces:**
- Consumes: existing SqlSource and QueryResult
- Produces: SqlExecutor.dropSource(name: string): Promise<void>
- Produces: shared DuckDbRequest and DuckDbResponse protocol types

- [ ] **Step 1: Write a failing drop-source client test**

~~~ts
const pending = client.dropSource('orders')
expect(worker.messages.at(-1)).toMatchObject({
  type: 'drop',
  requestId: expect.any(String),
  name: 'orders'
})
worker.respondSuccess(worker.messages.at(-1).requestId)
await expect(pending).resolves.toBeUndefined()
await expect(client.dropSource('orders;DROP')).rejects.toThrow('unsafe source name')
~~~

- [ ] **Step 2: Run the focused test and verify it fails**

Run: npm run test:unit -- --run tests/unit/duckdb-client.test.ts

Expected: FAIL because dropSource does not exist.

- [ ] **Step 3: Extract shared protocol and implement drop**

Move duplicated worker messages to src/workers/duckdb-protocol.ts. Add a drop message, validate the safe name in the client and worker, execute DROP TABLE IF EXISTS with an escaped identifier, and return a correlated success/error response.

- [ ] **Step 4: Run worker/client gates**

Run: npm run test:unit -- --run tests/unit/duckdb-client.test.ts

Run: npm run typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/core/contracts.ts src/workers/duckdb-protocol.ts src/workers/duckdb-client.ts src/workers/duckdb.worker.ts tests/unit/duckdb-client.test.ts
git commit -m "feat: add transactional DuckDB source cleanup"
~~~

---

### Task 4: Local import orchestration and relationship suggestions

**Files:**
- Create: src/features/import/local-import-service.ts
- Create: src/features/import/relationship-suggestions.ts
- Create: tests/unit/local-import-service.test.ts
- Create: tests/unit/relationship-suggestions.test.ts

**Interfaces:**
- Consumes: SqlExecutor, XlsxWorkbookReader, profileTable, validation utilities
- Produces: LocalImportService.inspect(files) and LocalImportService.import(selection, signal)
- Produces: suggestRelationships(catalog) and confirmRelationships(catalog, decisions)

~~~ts
export interface LocalImportService {
  inspect(files: readonly File[]): Promise<ImportInspection>
  import(selection: readonly ImportSelection[], signal?: AbortSignal): Promise<LocalImportResult>
}
~~~

- [ ] **Step 1: Write failing service and relationship tests**

Test multiple CSV and Parquet files, two selected sheets from one XLSX file, safe quoted preview/count SQL, 2,000,000-row rejection, rollback through dropSource on any registration/profile failure, and no partial worksheet registration.

Test that identical identifier columns across tables produce suggested relationships, never confirmed relationships; user decisions are the only operation that can mark a relationship confirmed or rejected.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: npm run test:unit -- --run tests/unit/local-import-service.test.ts tests/unit/relationship-suggestions.test.ts

Expected: FAIL because service and safe schema adapter are missing.

- [ ] **Step 3: Implement inspect and import**

The fixed sequence is:

~~~text
validate every physical file
-> list XLSX sheets
-> validate complete selection
-> allocate all safe unique table names
-> convert selected XLSX sheets to CSV bytes
-> register each source
-> query COUNT(*) and bounded preview
-> profile locally
-> assemble Catalog with suggested identifier relationships only
-> rollback newly registered tables on failure
~~~

Use only generated safe identifiers in SQL. Return precise ImportIssue values without exposing cell data in error messages.

Relationship suggestions require the same column name ending in _id or exactly id, compatible inferred types, and distinct tables. They carry status suggested and no fabricated match rate.

- [ ] **Step 4: Run focused and regression tests**

Run: npm run test:unit -- --run tests/unit/local-import-service.test.ts tests/unit/relationship-suggestions.test.ts

Run: npm run test:unit

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/features/import/local-import-service.ts src/features/import/relationship-suggestions.ts tests/unit/local-import-service.test.ts tests/unit/relationship-suggestions.test.ts
git commit -m "feat: orchestrate private multi-file imports"
~~~

---

### Task 5: Import panel and real browser coverage

**Files:**
- Create: src/features/import/ImportPanel.tsx
- Create: src/features/import/import-panel.css
- Modify: src/main.tsx
- Modify: tests/browser/duckdb.smoke.spec.ts
- Create: tests/browser/import-panel.spec.ts

**Interfaces:**
- Consumes: LocalImportService and DuckDbClient
- Produces: accessible file selection, XLSX sheet selection, progress, issues, table cards, and onImported callback

- [ ] **Step 1: Write browser tests for the user flow**

Assert that the file input accepts multiple .csv, .xlsx, and .parquet files; XLSX exposes sheet checkboxes; import displays safe table names, row count, columns, inferred types, and PII labels; suggested relationships require explicit confirm/reject actions; invalid files appear in an aria-live error region.

- [ ] **Step 2: Extend the DuckDB browser smoke for Parquet**

Use a deterministic embedded base64 Parquet fixture or a committed minimal fixture produced outside runtime. Abort non-local browser requests and assert a registered Parquet table returns the expected SUM.

- [ ] **Step 3: Run browser tests and verify they fail**

Run: npm run test:browser -- --project=chromium tests/browser/duckdb.smoke.spec.ts tests/browser/import-panel.spec.ts

Expected: FAIL because ImportPanel is missing and Parquet smoke is absent.

- [ ] **Step 4: Implement the accessible import panel**

Use an actual labelled input type=file with multiple and:

~~~text
.csv,text/csv,
.parquet,application/vnd.apache.parquet,
.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
~~~

Render explicit privacy copy: raw files and previews stay in this browser. Provide selection, inspect, table-name editing, worksheet selection, relationship confirmation, importing, success, and failure states. Close DuckDbClient on unmount.

- [ ] **Step 5: Run all import gates**

Run: npm run typecheck

Run: npm run test:unit

Run: npm run build

Run: npm run test:browser -- --project=chromium tests/browser/duckdb.smoke.spec.ts tests/browser/import-panel.spec.ts

Run: rg -n "fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|https?://" src/features/import

Expected: all tests/build pass and the network primitive scan returns no importer call site.

- [ ] **Step 6: Commit**

~~~bash
git add src/features/import src/main.tsx tests/browser/duckdb.smoke.spec.ts tests/browser/import-panel.spec.ts
git commit -m "feat: add local multi-format import workspace"
~~~
