# Synapse Gemini and Google Stack Design

**Date:** 2026-08-30  
**Status:** Approved architecture, pending written-spec review

## 1. Objective

Replace the planned Groq-first AI path with Gemini as Synapse's only primary LLM and prepare the MVP for meaningful Google technology integration without adding a visible authentication flow.

The implementation must preserve Synapse's local-first promise: uploaded CSV data and DuckDB execution remain in the browser. Only explicitly bounded schema metadata, governed metric definitions, aggregate query results, and generated reports may leave the browser.

## 2. Competition Outcome

The finished MVP demonstrates five Google services with distinct product roles:

1. Gemini API — analytical planning, SQL generation and repair, evidence-grounded explanation, and recommendations.
2. Google AI Studio — full-stack project, server-side secret configuration, preview, sharing, and later GitHub synchronization.
3. Google Cloud Run — public production deployment.
4. Cloud Firestore — temporary analysis history and report metadata.
5. Cloud Storage — generated PDF report storage.

The Google Gen AI SDK is an implementation dependency for Gemini, not a separate service claim. Google Sheets and Firebase Authentication are outside this MVP.

## 3. Scope

### Included in the Codex phase

- Ask and Investigate user flows.
- Multi-file browser-local import for CSV, XLSX, and Parquet.
- One DuckDB table per CSV/Parquet file or selected XLSX sheet.
- Import validation, safe table naming, schema preview, and explicit relationship confirmation.
- Typed Gemini request and response contracts.
- Zod validation at every AI boundary.
- A replaceable `AnalystProvider` interface.
- Server-route contracts without exposing an API key to browser code.
- Gemini analysis-plan, SQL-repair, and synthesis prompts.
- DuckDB-Wasm execution through the existing deterministic analyzer.
- SQL Guard and Trust Engine preservation.
- Evidence-grounded charts, explanations, and three recommendations.
- PDF generation in the browser.
- Firestore and report-storage repository interfaces.
- Local/in-memory implementations for development and tests.
- Loading, retry, timeout, unavailable, and deterministic fallback states.
- Unit and integration tests.

### Deferred to the Google AI Studio phase

- Import or synchronize the repository with AI Studio.
- Provision the AI Studio Node server runtime.
- Configure `GEMINI_API_KEY` as a server-side secret.
- Connect the server routes to the Google Gen AI SDK.
- Provision and connect Firestore.
- Create and connect the Cloud Storage bucket.
- Publish the application to Cloud Run.
- Share the public AI Studio project link.

### Excluded

- Firebase Authentication and any sign-in screen.
- Direct browser access to Firestore or Cloud Storage.
- Uploading raw CSV or raw business rows to Google services.
- Google Sheets or other Workspace integrations.
- JSON/JSONL, ZIP archives, SQL dumps, SQLite files, and remote database connectors.
- Groq fallback, multi-model routing, or provider failover.
- RAG, vector databases, queues, database federation, and external action tools.

## 4. Architecture

```text
React browser application
  -> local CSV/XLSX/Parquet workspace
       -> file validation and safe table naming
       -> XLSX sheet selection
       -> schema preview and relationship confirmation
  -> schema profiler and governed metrics
  -> Gemini API facade
       -> POST /api/analyze
       -> POST /api/repair-sql
       -> POST /api/synthesize
  -> deterministic SQL Guard
  -> DuckDB-Wasm worker
  -> deterministic Trust Engine
  -> charts and recommendations
  -> client-side PDF renderer
       -> POST /api/reports

AI Studio Node server, added later
  -> Gemini API through Google Gen AI SDK
  -> Firestore analysis repository
  -> Cloud Storage report repository
  -> deployed as a Cloud Run service
```

The deterministic core must never import an LLM SDK, Firebase SDK, React, or server runtime. Provider and persistence adapters depend on core contracts, never the reverse.

## 5. Dataset Import

Synapse accepts multiple local files in one workspace:

- Each CSV file becomes one table.
- Each Parquet file becomes one table.
- Each selected XLSX worksheet becomes one table.

Import is explicit and previewed before analysis. The importer detects the format from both extension and file signature where available, rejects mismatches, empty files, unsupported formats, unsafe table names, duplicate final table names, and configured size-limit violations.

The MVP limits one import to 10 physical files, 10 resulting tables, and 250 MiB total compressed/source bytes. Each XLSX file is limited to 25 MiB, each table to 2,000,000 rows, and each local preview to 1,000 rows. XLS, XLSM, encrypted workbooks, formulas without cached scalar values, embedded HTML, macros, and external workbook links are unsupported.

Table names are derived from file and worksheet names, normalized to the existing safe SQL identifier policy, and made unique deterministically. Users may edit proposed names before registration. Registration happens only after all selected sources pass validation.

CSV and Parquet bytes are registered directly with the DuckDB worker. XLSX is parsed in the browser by a maintained library, with each selected worksheet converted to an in-memory tabular representation before DuckDB registration. No uploaded bytes or raw rows are sent to Gemini, Firestore, Cloud Storage, or the server runtime.

After registration, Synapse shows table name, source file, row count, column names, inferred types, null rates, PII classifications, and a bounded local preview. Relationships are suggestions until the user confirms them; Gemini cannot declare a relationship authoritative.

## 6. Gemini Responsibilities

Gemini is an analyst and composer, not the source of truth.

The first competition slice supports the certified Net Revenue metric with KPI and trend intents. Gemini may interpret novel natural-language phrasing within that governed domain, but it may not invent unsupported metrics or verification logic. Additional certified metrics are a roadmap extension.

### Analysis planning

Input:

- User question.
- Safe schema metadata and bounded example enum values.
- Confirmed relationships.
- Certified metric definitions.
- Current date and dataset date range.

Structured output:

- Interpreted business question.
- Required metrics and dimensions.
- Date comparison.
- Join path.
- One read-only DuckDB SQL statement.
- Proposed verification checks.
- Recommended chart family.

### SQL repair

Gemini receives the rejected SQL, deterministic rejection reason, safe schema context, and original question. It gets one repair attempt. The repaired query restarts the full SQL Guard and execution pipeline. A second rejection ends honestly without executing unsafe SQL.

### Synthesis

Gemini receives only verified evidence: bounded aggregate rows, KPI values, trust findings, caveats, and chart metadata. It returns:

- A concise evidence-grounded explanation.
- Exactly three prioritized business recommendations.
- Evidence references for every material claim.

Gemini may not invent, interpolate, silently recalculate, or override the Trust Engine verdict.

## 7. API Contracts

### `POST /api/analyze`

Accepts a validated analysis request and returns a structured analysis plan. It does not execute SQL.

### `POST /api/repair-sql`

Accepts one rejected query plus the deterministic rejection and returns one replacement query.

### `POST /api/synthesize`

Accepts verified, bounded evidence and returns the explanation and three recommendations.

### `POST /api/reports`

Accepts a generated PDF with report metadata, validates type and size, stores it, and returns a time-limited download URL.

### `POST /api/session`

In the future AI Studio runtime, issues an opaque random session capability in an HttpOnly, Secure, SameSite cookie. It creates no account and shows no login UI.

No browser bundle may contain `GEMINI_API_KEY`, Firebase Admin credentials, Cloud Storage credentials, or a server service-account key.

AI requests are limited to a 2,000-character question, 20 tables, 80 columns per table, 5 allow-listed enum values per column, 100 aggregate evidence rows, and 128 KiB serialized payload per stage. PDF uploads are limited to 10 MiB. Every provider stage has at most two calls total, never retries a caller abort, and gets one retry only for timeout, transport failure, or invalid structured output.

## 8. Session and Persistence Model

There is no user authentication. During local development, the browser creates a cryptographically random opaque session identifier and stores it locally. The future AI Studio server replaces this with an HttpOnly session capability issued by `POST /api/session`.

Firestore stores only:

- Session identifier hash.
- Redacted interpretation and a one-way question fingerprint; never the original question.
- Analysis status and timestamps.
- Generated SQL only after string literals are redacted.
- Aggregate KPIs and bounded evidence.
- Trust verdict and caveats.
- Chart configuration.
- Recommendations.
- Report object reference.

The server never treats the session identifier as strong identity. History is a demo convenience, not an account or security boundary. Records receive a short retention period. Sensitive raw rows and uploaded files are never persisted.

Until AI Studio provisioning is complete, an in-memory or browser-local repository implements the same interface.

## 9. Cloud Storage Model

Only generated outputs may be stored:

```text
reports/{sessionHash}/{reportId}.pdf
```

The server validates PDF content type, configured size limit, generated report identifier, and session ownership token. Downloads use short-lived signed URLs. Report objects receive an expiry or cleanup policy.

Raw CSV, Parquet, DuckDB databases, credentials, prompts containing raw rows, and arbitrary user file types are prohibited.

Until the Google infrastructure phase, report download remains local in the browser.

## 10. Privacy Boundary

Allowed to leave the browser:

- Table and column names after PII filtering.
- Data types and bounded cardinality/profile statistics.
- Allow-listed enum examples.
- Certified metric definitions.
- Aggregate query results with strict row and byte limits.
- Trust findings and report PDFs explicitly generated by the user.

Must remain local:

- Original uploaded files.
- Full tables or raw row samples.
- Names, email addresses, phone numbers, addresses, and detected identifiers.
- DuckDB database state.
- Original CSV, XLSX, and Parquet bytes.

The UI must state this boundary before an AI request is sent.

## 11. Failure Handling

- Gemini planning timeout: retry once, then offer deterministic demo questions.
- Invalid Gemini JSON: reject it, retry once with schema feedback, then fail safely.
- Unsafe SQL: one Gemini repair, followed by permanent rejection on a second failure.
- DuckDB failure: preserve the workspace and show the query error without fabricating an answer.
- Gemini synthesis failure: preserve computed KPIs, charts, evidence, and Trust Report; generate a deterministic summary.
- Firestore unavailable: analysis still completes and history remains local.
- Cloud Storage unavailable: PDF still downloads locally.
- Cloud Run/API unavailable: local deterministic demo flow remains usable.
- One invalid import: reject that source with a precise error and leave previously registered tables intact.
- Duplicate table names: propose deterministic suffixed names and require confirmation before registration.
- XLSX worksheet parse failure: reject only the affected workbook and do not partially register its sheets.
- Parquet runtime incompatibility: report the browser/runtime limitation and preserve the workspace.

## 12. Testing Strategy

### Unit tests

- Gemini request redacts disallowed fields and enforces payload limits.
- Every structured Gemini response is Zod-validated.
- Invalid and malicious SQL never reaches DuckDB.
- SQL repair is attempted at most once.
- Synthesis receives only verified evidence.
- Recommendation count is exactly three.
- Deterministic fallback preserves calculated values.
- Firestore and Storage interfaces work with local fake adapters.
- Import format detection rejects extension/signature mismatches.
- Table-name normalization is safe, deterministic, and collision-free.
- XLSX worksheet selection produces one source per selected sheet.
- Multi-file validation is atomic per file and never leaks raw rows.

### Integration tests

- Question -> plan -> guard -> DuckDB -> trust -> synthesis.
- Gemini invalid JSON -> repair retry -> valid result.
- Gemini outage -> deterministic fallback.
- Unsafe query -> one repair -> safe execution.
- Failed verification -> caveated result, never a false verified verdict.
- Report upload failure -> local PDF download.
- Multiple CSV/XLSX/Parquet sources -> registered tables -> cross-table DuckDB query.
- Invalid workbook -> no partial worksheet registration.
- Parquet import and query execute in a real browser worker.

### Production smoke test

- Public Cloud Run URL opens without login.
- Gemini calls succeed while the key is absent from client assets.
- Raw CSV is never present in network requests.
- Analysis metadata appears in Firestore.
- A generated PDF is stored and downloadable through an expiring URL.
- Multiple CSV/XLSX/Parquet files import without any file bytes appearing in network requests.

## 13. Delivery Sequence

1. Add validated multi-file CSV/XLSX/Parquet import and schema preview.
2. Complete the browser Ask/Investigate workflow over the deterministic core.
3. Add AI contracts, provider interface, fake provider, and validation.
4. Add Gemini orchestration, repair, synthesis, and fallbacks.
5. Add local persistence and report repository interfaces.
6. Generate and download PDF locally.
7. Import/sync the finished repository into Google AI Studio.
8. Replace fake/server adapters with Gemini, Firestore, and Cloud Storage adapters.
9. Publish to Cloud Run and run privacy/security smoke tests.

## 14. Definition of Done

- Users can import multiple CSV, XLSX, and Parquet sources locally.
- Selected XLSX sheets become independently named queryable tables.
- Source validation and schema preview complete before analysis.
- A novel business question produces a Gemini plan and guarded SQL.
- DuckDB executes only approved read-only SQL locally.
- Trust Engine independently verifies the computed result.
- Gemini explains verified evidence and gives exactly three recommendations.
- The app remains useful when Gemini or Google persistence is unavailable.
- No API key or Google service credential exists in browser code.
- Raw uploaded data never leaves the browser.
- No visible login flow exists.
- Firestore and Cloud Storage remain server-only integrations.
- AI Studio project link and public Cloud Run URL are available for submission.
