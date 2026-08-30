# Gemini Analyst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a privacy-bounded Gemini analyst application layer that plans certified Net Revenue queries, executes them through the deterministic analyzer, repairs rejected SQL once, and synthesizes verified evidence with safe fallbacks.

**Architecture:** Add src/ai as an application layer above src/core. AnalystProvider is a replaceable port; the Codex phase supplies fake and HTTP adapters for future AI Studio server routes, but no browser Gemini key or Google SDK. AnalysisOrchestrator builds a redacted request, validates every response, delegates execution and trust to DeterministicAnalyzer, and preserves verified results when AI or persistence fails.

**Tech Stack:** TypeScript 5.9, Zod 4, existing DuckDB-Wasm deterministic core, Vitest 4, browser Fetch API

**Spec:** docs/superpowers/specs/2026-08-30-gemini-google-stack-design.md

## Global Constraints

- Gemini supports only certified Net Revenue with KPI and trend intents in this slice.
- Questions are limited to 2,000 characters.
- Safe schema is limited to 20 tables and 80 columns per table.
- Synthesis receives at most 100 aggregate evidence rows and 128 KiB serialized input.
- Every provider stage has at most two calls total and never retries caller cancellation.
- SQL repair is attempted at most once and restarts the complete SQL Guard/analyzer path.
- Gemini never executes SQL, changes governed metrics, or overrides the Trust Engine.
- No GEMINI_API_KEY, Google Gen AI SDK, Firebase Admin SDK, or VITE_GEMINI variable enters browser code.
- AI Studio Node routes, Gemini SDK wiring, Firestore, Storage, and Cloud Run remain deferred.

---

### Task 1: Strict AI transport contracts

**Files:**
- Create: src/ai/contracts.ts
- Create: tests/unit/ai-contracts.test.ts

**Interfaces:**
- Produces: AnalysisPlanRequest/Response, SqlRepairRequest/Response, SynthesisRequest/Response, ChartSpec, Recommendation, ProviderCallOptions
- Produces: parseAnalysisPlanResponse, parseSqlRepairResponse, parseSynthesisResponse

- [ ] **Step 1: Write failing contract tests**

Test strict unknown-field rejection, 2,000-character question maximum, Net Revenue-only metric, KPI/trend intents, safe chart taxonomy, SQL length bounds, exactly three recommendations, evidence reference grammar, and 128 KiB payload rejection.

~~~ts
expect(() => parseSynthesisResponse({
  summary: 'Verified result',
  recommendations: [{ priority: 1, action: 'Review refunds', evidenceIds: ['query:primary'] }]
})).toThrow()
~~~

- [ ] **Step 2: Run the focused test and verify it fails**

Run: npm run test:unit -- --run tests/unit/ai-contracts.test.ts

Expected: FAIL because src/ai/contracts.ts does not exist.

- [ ] **Step 3: Implement Zod-first contracts**

The planning response maps completely to the existing QueryPlan:

~~~ts
export const analysisPlanResponseSchema = z.object({
  interpretedQuestion: z.string().min(1).max(2_000),
  intent: z.enum(['kpi', 'trend']),
  metricId: z.literal('net_revenue'),
  sql: z.string().min(1).max(20_000),
  verificationSql: z.string().min(1).max(20_000),
  expectedShape: z.object({
    kind: z.enum(['single_value', 'time_series']),
    valueColumn: z.string().min(1).max(63),
    dimensionColumn: z.string().min(1).max(63).optional()
  }).strict(),
  assumptions: z.array(z.string().max(500)).max(10),
  chart: z.object({
    kind: z.enum(['kpi', 'line', 'bar', 'table']),
    x: z.string().max(63).optional(),
    y: z.string().max(63)
  }).strict()
}).strict()
~~~

Define response types with z.infer so runtime and compile-time contracts cannot drift.

- [ ] **Step 4: Run contract tests**

Run: npm run test:unit -- --run tests/unit/ai-contracts.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/ai/contracts.ts tests/unit/ai-contracts.test.ts
git commit -m "feat: define strict Gemini analyst contracts"
~~~

---

### Task 2: Privacy bounds and evidence projection

**Files:**
- Create: src/ai/safe-schema.ts
- Create: src/ai/privacy.ts
- Create: tests/unit/safe-schema.test.ts
- Create: tests/unit/ai-privacy.test.ts

**Interfaces:**
- Consumes: Catalog, MetricDefinition, AnalysisResult
- Produces: createSafeSchemaContext, createAnalysisPlanRequest, createSynthesisRequest, serializedPayloadBytes

- [ ] **Step 1: Write failing privacy tests**

Use a catalog containing email, name, address, identifiers, top values, min/max, and raw preview-like values. Assert direct/quasi/identifier examples do not appear in serialized plan input. Assert only confirmed relationships remain and table/column/payload limits are enforced.

Use an AnalysisResult with more than 100 rows and assert synthesis receives only the first bounded aggregate rows, trust checks, and evidence IDs. Reject object/array cell values and payloads over 128 KiB.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: npm run test:unit -- --run tests/unit/safe-schema.test.ts tests/unit/ai-privacy.test.ts

Expected: FAIL because privacy projections are missing.

- [ ] **Step 3: Implement explicit allow-list projections**

Never serialize Catalog or AnalysisResult directly. Construct new objects field by field. createSafeSchemaContext includes type/null/cardinality/PII labels and confirmed relationships, but excludes raw uploaded bytes, File, Blob, ArrayBuffer, preview rows, topValues, min/max, and PII example values. createAnalysisPlanRequest adds only the certified metric definition and bounded question.

~~~ts
export const AI_LIMITS = {
  maxQuestionChars: 2_000,
  maxTables: 20,
  maxColumnsPerTable: 80,
  maxEvidenceRows: 100,
  maxPayloadBytes: 128 * 1024
} as const
~~~

- [ ] **Step 4: Run privacy tests**

Run: npm run test:unit -- --run tests/unit/safe-schema.test.ts tests/unit/ai-privacy.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/ai/safe-schema.ts src/ai/privacy.ts tests/unit/safe-schema.test.ts tests/unit/ai-privacy.test.ts
git commit -m "feat: bound and redact Gemini evidence"
~~~

---

### Task 3: Replaceable provider adapters

**Files:**
- Create: src/ai/provider.ts
- Create: src/ai/fake-provider.ts
- Create: src/ai/http-provider.ts
- Create: tests/unit/fake-provider.test.ts
- Create: tests/unit/http-provider.test.ts

**Interfaces:**
- Produces: AnalystProvider
- Produces: ProviderUnavailableError, ProviderTimeoutError, ProviderContractError
- Produces: createFakeAnalystProvider and createHttpAnalystProvider

~~~ts
export interface AnalystProvider {
  plan(input: AnalysisPlanRequest, options?: ProviderCallOptions): Promise<AnalysisPlanResponse>
  repairSql(input: SqlRepairRequest, options?: ProviderCallOptions): Promise<SqlRepairResponse>
  synthesize(input: SynthesisRequest, options?: ProviderCallOptions): Promise<SynthesisResponse>
}
~~~

- [ ] **Step 1: Write fake-provider and HTTP tests**

Fake tests assert deterministic scripted queues and captured calls. HTTP tests inject a fake fetch and assert POST routes /api/analyze, /api/repair-sql, /api/synthesize, credentials same-origin, JSON headers/body, timeout cancellation, caller cancellation, non-2xx mapping, network failure mapping, and malformed structured response rejection.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: npm run test:unit -- --run tests/unit/fake-provider.test.ts tests/unit/http-provider.test.ts

Expected: FAIL because provider adapters are missing.

- [ ] **Step 3: Implement provider port and fake**

The fake exposes captured calls but never mutates inputs. It returns parsed structured values so tests exercise the same runtime validation as HTTP.

- [ ] **Step 4: Implement browser-safe HTTP adapter**

Use AbortController with a default 20-second timeout, combine caller abort without retry semantics, set credentials to same-origin, and validate both request and response. Never read API keys or import a Gemini SDK.

- [ ] **Step 5: Run provider tests and typecheck**

Run: npm run test:unit -- --run tests/unit/fake-provider.test.ts tests/unit/http-provider.test.ts

Run: npm run typecheck

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/ai/provider.ts src/ai/fake-provider.ts src/ai/http-provider.ts tests/unit/fake-provider.test.ts tests/unit/http-provider.test.ts
git commit -m "feat: add replaceable Gemini provider facade"
~~~

---

### Task 4: Verified analyst orchestration and fallbacks

**Files:**
- Create: src/ai/fallbacks.ts
- Create: src/ai/orchestrator.ts
- Create: tests/unit/orchestrator.test.ts
- Create: tests/integration/gemini-orchestration.test.ts

**Interfaces:**
- Consumes: AnalystProvider, DeterministicAnalyzer, Catalog, MetricDefinition
- Produces: AnalysisOrchestrator and InvestigationResult

~~~ts
export interface AnalysisOrchestrator {
  run(input: InvestigationRequest): Promise<InvestigationResult>
}

export type InvestigationStatus = 'completed' | 'fallback' | 'rejected' | 'failed'
~~~

- [ ] **Step 1: Write failing orchestration tests**

Cover:

- plan -> deterministic analyzer -> trust -> synthesis happy path;
- first plan timeout or invalid output -> exactly one retry;
- caller abort -> zero retries;
- unsafe primary SQL -> exactly one repair -> full analyzer rerun;
- second rejected SQL -> no executor query and rejected status;
- synthesis fails twice -> computed result plus deterministic synthesis;
- executor failure -> no fabricated KPI;
- synthesis input contains only bounded evidence;
- Trust Engine verdict is unchanged by provider output.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: npm run test:unit -- --run tests/unit/orchestrator.test.ts tests/integration/gemini-orchestration.test.ts

Expected: FAIL because orchestrator and fallbacks are missing.

- [ ] **Step 3: Implement deterministic fallbacks**

Fallback planning only recognizes certified Net Revenue KPI/trend requests and compiles through existing metric functions. Unknown metrics return an explicit unavailable result. Fallback synthesis copies existing evidence/trust values without arithmetic and always emits exactly three clearly caveated actions.

- [ ] **Step 4: Implement the fixed orchestration sequence**

~~~text
validate question
-> build safe plan request
-> provider plan, max two calls
-> validate and map complete QueryPlan
-> deterministic analyzer
-> if SQL Guard rejection, one provider repair and full analyzer rerun
-> project bounded verified evidence
-> provider synthesis, max two calls
-> deterministic synthesis fallback if needed
-> return InvestigationResult without mutating AnalysisResult
~~~

Detect guard rejection from TrustCheck IDs, never from provider prose. Do not invoke repair for DuckDB execution failures.

- [ ] **Step 5: Run orchestration and regression tests**

Run: npm run test:unit -- --run tests/unit/orchestrator.test.ts tests/integration/gemini-orchestration.test.ts

Run: npm run test:unit

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/ai/fallbacks.ts src/ai/orchestrator.ts tests/unit/orchestrator.test.ts tests/integration/gemini-orchestration.test.ts
git commit -m "feat: orchestrate verified Gemini analysis"
~~~

---

### Task 5: Local persistence and report ports

**Files:**
- Create: src/persistence/contracts.ts
- Create: src/persistence/local-history.ts
- Create: src/persistence/local-reports.ts
- Create: tests/unit/local-history.test.ts
- Create: tests/unit/local-reports.test.ts

**Interfaces:**
- Produces: AnalysisHistoryRepository and ReportRepository
- Produces: createInMemoryAnalysisHistoryRepository and createLocalReportRepository

~~~ts
export interface AnalysisHistoryRepository {
  save(record: AnalysisHistoryRecord): Promise<void>
  list(sessionHash: string): Promise<readonly AnalysisHistoryRecord[]>
}

export interface ReportRepository {
  save(upload: ReportUpload): Promise<StoredReport>
  getDownload(reportId: string, sessionToken: string): Promise<ReportDownload>
}
~~~

- [ ] **Step 1: Write failing persistence tests**

Assert history stores a session hash, question fingerprint, redacted interpretation, and SQL with string literals redacted; it rejects original question/raw rows. Assert reports accept only application/pdf up to 10 MiB, create local object URLs through an injected adapter, and return local download when remote storage is unavailable.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: npm run test:unit -- --run tests/unit/local-history.test.ts tests/unit/local-reports.test.ts

Expected: FAIL because repository ports are missing.

- [ ] **Step 3: Implement validated persistence ports**

Use Zod for metadata boundaries. Keep Blob only in ReportUpload and never in analysis history. The in-memory adapter copies values defensively. Inject URL creation/revocation so Node tests do not depend on browser globals.

- [ ] **Step 4: Run persistence and full gates**

Run: npm run test:unit -- --run tests/unit/local-history.test.ts tests/unit/local-reports.test.ts

Run: npm run typecheck

Run: npm run test:unit

Run: npm run build

Run: rg -n "GEMINI_API_KEY|VITE_GEMINI|@google/genai|firebase-admin" src dist

Expected: tests/typecheck/build pass and the secret/SDK scan returns no browser integration.

- [ ] **Step 5: Commit**

~~~bash
git add src/persistence tests/unit/local-history.test.ts tests/unit/local-reports.test.ts
git commit -m "feat: add local history and report ports"
~~~

---

### Task 6: Ask/Investigate application integration

**Files:**
- Create: src/App.tsx
- Create: src/app.css
- Create: src/features/analysis/AnalysisPanel.tsx
- Modify: src/main.tsx
- Create: tests/browser/analysis-panel.spec.ts

**Interfaces:**
- Consumes: imported Catalog, DeterministicAnalyzer, AnalystProvider, AnalysisOrchestrator
- Produces: question input, timeline, SQL disclosure, Trust Report, chart/table result, synthesis, recommendations, fallback and error states

- [ ] **Step 1: Write a browser test using the fake provider**

Load demo data, ask a Net Revenue question, and assert visible plan, guarded SQL, verified/caveated verdict, evidence summary, and exactly three recommendations. Add provider-unavailable mode and assert computed fallback remains visible.

- [ ] **Step 2: Run the browser test and verify it fails**

Run: npm run test:browser -- --project=chromium tests/browser/analysis-panel.spec.ts

Expected: FAIL because the application integration does not exist.

- [ ] **Step 3: Implement minimal competition UI**

Compose ImportPanel and AnalysisPanel in App. Default to createFakeAnalystProvider for local deterministic demo; select createHttpAnalystProvider only through a non-secret runtime flag that indicates the future same-origin AI Studio server is present.

Show this privacy notice before sending:

~~~text
Raw files stay in this browser. Synapse sends only schema metadata and bounded aggregate evidence to Gemini.
~~~

Do not render chain-of-thought. Timeline labels are factual system events: Preparing safe schema, Planning analysis, Checking SQL, Running locally, Verifying result, Writing recommendations.

- [ ] **Step 4: Run complete gates**

Run: npm run typecheck

Run: npm run test:unit

Run: npm run build

Run: npm run test:browser -- --project=chromium

Expected: all gates pass.

- [ ] **Step 5: Commit**

~~~bash
git add src/App.tsx src/app.css src/features/analysis/AnalysisPanel.tsx src/main.tsx tests/browser/analysis-panel.spec.ts
git commit -m "feat: deliver verified Synapse analyst flow"
~~~
