# Synapse — AI Riser Vietnam Competition MVP Design

Date: 2026-08-30

Status: Approved competition-MVP design

## 1. Objective

Build Synapse as a local-first AI business analyst for small businesses, optimized for the published AI Riser Vietnam criteria.

A non-technical business owner must be able to:

1. Open a ready demo or import business files.
2. Ask questions in plain language.
3. Receive computed answers, SQL, evidence, and suitable charts.
4. Ask Synapse to investigate a material business change.
5. See independent AI critique and deterministic verification.
6. Receive evidence-backed next actions.

The MVP is a complete focused product: broader than a fixed revenue dashboard, narrower than a general AI operating system.

## 2. Competition Requirements

### 2.1 Judging

Published AI Riser guidance assigns:

- Feasibility: 40% — working, professional, easy to use, and accessible.
- Impact: 30% — solves a real problem for a credible user group and can scale.
- Creativity: 30% — original approach and a clear wow moment using AI and Google technology.
- Google technology bonus: up to 10 points for effective, substantial integration.
- Deployment bonus: 10 points for a public web app on Google Cloud Run.

Reliability and UX therefore matter more than infrastructure breadth.

### 2.2 Submission

The safe submission package is:

- Public Google AI Studio project link.
- Public Cloud Run URL.
- Public YouTube demo no longer than 1 minute 55 seconds.
- Public Facebook or LinkedIn post containing or linking to the demo.
- Hashtags #AIRiserVietnam and #BuildwithGoogleAI.
- Completed submission form.

Published pages disagree about video format: one requests public YouTube at most two minutes; another describes a 2–3 minute LinkedIn demo. A 1:55 YouTube master shared through the social post satisfies the stricter reading. The current form remains final authority and must be checked before submission.

### 2.3 Category

Synapse enters Business Utility / Micro-SaaS.

Problem statement:

> Small businesses have sales and operational data in spreadsheets and exports, but rarely have a data analyst who can investigate problems and verify whether the numbers are trustworthy.

## 3. Score Strategy

### 3.1 Feasibility

Synapse must provide:

- One-click demo workspace with no login.
- Stable hero workflow.
- Clear loading, empty, caveat, success, and failure states.
- Browser-local SQL execution.
- Graceful degradation when Groq is unavailable.
- Preserved computed results when Gemini narrative generation fails.
- Keyboard navigation, visible focus, readable contrast, and non-color status indicators.
- A public URL tested in an incognito window.

### 3.2 Impact

Target users:

- E-commerce owners.
- Small-business sales and operations managers.
- Teams using spreadsheet and marketplace exports.
- Business users who do not know SQL.

Demonstrated outcomes:

- First useful answer within two minutes.
- One request replaces joins, pivots, and manual charting.
- Every conclusion exposes metric, SQL, evidence, and trust status.
- Investigations distinguish facts, likely drivers, and hypotheses.

### 3.3 Creativity

The differentiator is not NL2SQL alone:

> Synapse does not merely answer. It investigates the problem and proves whether the answer can be trusted.

The wow sequence:

1. Gemini interprets and plans.
2. Gemini produces SQL.
3. Groq independently critiques the SQL.
4. DuckDB executes locally.
5. Deterministic verifiers reproduce and audit the result.
6. Synapse creates a mini-dashboard.
7. Gemini converts verified evidence into next actions.

### 3.4 Google Technology

Gemini is the primary intelligence layer and owns:

- Intent classification.
- Schema linking.
- Metric resolution.
- Query planning.
- SQL generation and repair.
- Investigation decomposition.
- Explanation and recommendation synthesis.

Google AI Studio is the build environment, GitHub synchronization point, secret manager, and route to Cloud Run. Groq is limited to independent SQL critique.

## 4. Positioning

Product name: Synapse

Tagline:

> The AI business analyst for small businesses.

Supporting message:

> Your business data tells a story. Synapse investigates it, verifies it, and tells you what to do next.

Differentiator:

> Most analytics tools show what happened. Synapse investigates why it happened and checks its own work before the user acts.

Unimplemented live databases and external actions must be labeled roadmap, not implied as working.

## 5. MVP Scope

### Included

- Preloaded e-commerce demo workspace.
- CSV and Parquet import.
- Multiple related files per workspace.
- Local schema profiling and PII classification.
- Suggested table relationships.
- One certified demo metric: Net Revenue.
- Explicitly labeled inferred metrics.
- Read-only NL2SQL.
- Ask and Investigate modes.
- Automatic chart selection.
- Investigation mini-dashboard.
- Groq independent SQL critique.
- Deterministic Trust Report.
- Evidence viewer.
- Evidence-backed recommendations.
- Local workspace persistence.
- Downloadable report.
- Public Cloud Run deployment.

### Excluded

- MySQL, PostgreSQL, and SQLite import.
- Database credentials and write SQL.
- Gmail, Drive, Docs, Sheets, and Slack actions.
- Document RAG and web research.
- Qdrant, BM25, cross-encoder reranking.
- Redis and background queues.
- LangGraph.
- Long-term memory, accounts, and collaboration.
- Scheduled refresh and alerts.
- Dashboard Studio and 3D charts.
- External autonomous actions.
- Generic provider pools and multi-provider failover.
- AWS, Amplify, and Cloudflare Tunnel.

## 6. Demo Dataset

Use the synthetic Kaggle E-commerce Dataset by Abhay Ayare:

https://www.kaggle.com/datasets/abhayayare/e-commerce-dataset

It contains users, products, orders, order items, reviews, and events CSV files. Credit the source in the app and submission.

The public app contains an optimized demo copy, so judges do not need to upload files.

## 7. User Experience

### 7.1 Entry

Offer:

- Try Demo Workspace.
- Upload Your Data.

The demo opens immediately with six sources, a schema summary, and sample questions.

### 7.2 Ask Mode

Supported intents:

- KPI.
- Trend.
- Period comparison.
- Ranking.
- Breakdown.
- Funnel.
- Simple correlation.

Each answer contains:

- Direct answer.
- Metric and period interpretation.
- Generated SQL.
- Chart.
- Evidence table.
- Trust Report.
- Suggested follow-ups.

### 7.3 Investigation Mode

Hero request:

> Revenue changed in the latest complete month. Investigate why, verify the result, and recommend what to do next.

Workflow:

1. Resolve Net Revenue and period.
2. Establish baseline.
3. Decompose by category, product, city, and relevant segments.
4. Inspect completed, cancelled, and returned orders.
5. Inspect view-to-cart-to-purchase funnel.
6. Review relevant ratings or reviews.
7. Identify the largest supported drivers.
8. Verify independently.
9. Build mini-dashboard.
10. Produce three next actions.

Budget:

- Eight analytical steps.
- Ten SQL queries.
- One SQL repair.
- Three primary findings.
- Three recommendations.
- Two-minute execution ceiling.

Stop early when evidence is sufficient, required data is absent, verification fails critically, or budget is exhausted.

### 7.4 Claim Types

- Fact: directly supported by a reproducible query.
- Likely driver: quantitatively contributes but does not prove causality.
- Hypothesis: plausible but requires missing data.

The UI and narrative must preserve these distinctions.

## 8. Governed Metric

The demo includes:

    Name: Net Revenue
    Description: Revenue from completed orders
    Source: orders
    Grain: order
    Expression: SUM(total_amount)
    Required filter: order_status = 'Completed'
    Status: certified

Primary query:

    SELECT SUM(total_amount) AS net_revenue
    FROM orders
    WHERE order_status = 'Completed';

Independent reconciliation:

    SELECT SUM(oi.quantity * oi.item_price) AS item_level_revenue
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    WHERE o.order_status = 'Completed';

Inferred metrics must display status, expression, grain, filters, join path, and assumptions.

## 9. Architecture

    Browser data plane
      Demo/Files
        → Workspace Manager
        → Schema Profiler
        → Catalog and Metric Registry
        → Planner and SQL Guard
        → DuckDB-Wasm
        → Trust Engine and Chart Compiler
        → Dashboard, Evidence, Report

    Approved metadata and aggregates only
        ↓

    Google AI Studio Node control plane
      Context Firewall
        → Gemini Planner and Composer
        → Groq Critic

Raw files and SQL execution remain in the browser. The server receives approved schema context, metric definitions, bounded aggregates, and verification summaries.

## 10. Frontend and Local Data

Stack:

- React 18, TypeScript, Vite.
- Material UI.
- ECharts.
- TanStack Query.
- Zustand.
- Dexie/IndexedDB.
- OPFS when available.
- DuckDB-Wasm in a Web Worker.
- Apache Arrow.
- Zod.

Zustand owns active workspace, catalog, metrics, investigation, evidence selection, dashboard view, and privacy settings.

TanStack Query owns Gemini and Groq requests and remote request status. Large query results must not enter its cache.

Dexie stores workspace metadata, relationships, metrics, query history, investigation summaries, and report definitions.

OPFS stores imported files and optional DuckDB persistence.

## 11. Workspace and Profiler

Workspace Manager:

- Opens demo.
- Imports CSV/Parquet.
- Validates type and size.
- Assigns safe table names.
- Detects duplicate sources.
- Registers files with DuckDB.
- Restores and deletes local workspaces.

Limits:

- Ten sources.
- 250 MB total.
- Two million combined rows.
- Ten thousand displayed rows.
- Thirty-second interactive query timeout.

Profiler computes locally:

- Physical and logical types.
- Null rate.
- Approximate distinct count.
- Min/max and date ranges.
- Top low-cardinality values.
- Candidate keys and relationship match rates.
- PII classification.
- Data-quality warnings.

Relationships are suggested, confirmed, or rejected. Using an unconfirmed relationship adds a caveat. Demo relationships ship confirmed.

## 12. Privacy

Exact public promise:

> Raw files stay in your browser. Only approved schema metadata and bounded query results are sent to Gemini or Groq.

Context Firewall:

- Removes PII examples.
- Omits raw rows by default.
- Limits table, column, enum, and aggregate context.
- Applies workspace privacy policy.
- Records context categories sent.

The UI exposes an AI Context view. Provider keys remain server-side.

## 13. Gemini Planner

Structured QueryPlan contains:

- Intent.
- Resolved metrics and dimensions.
- Tables and joins.
- Filters and period.
- SQL.
- Verification plan.
- Expected result shape.
- Assumptions.

Gemini selects relevant schema, resolves metrics and dates, chooses join paths, generates one read-only query, and proposes verification. It never executes SQL.

## 14. Groq Independent AI Review

Groq receives question, safe schema context, metric definition, planned joins, and Gemini SQL.

Structured SqlCritique contains:

- Decision: approve, approve with caveats, or reject.
- Whether SQL answers the question.
- Whether metric definition is respected.
- Whether grain is preserved.
- Whether joins are safe.
- Whether filters are complete.
- Issues and optional suggested SQL.

It is labeled Independent AI Review, not verification.

Groq cannot execute SQL, alter certified metrics, determine the final verdict, trigger actions, or silently replace Gemini.

If unavailable, the app continues and states that deterministic verification completed without independent AI review.

Use Groq strict structured output as a one-shot request without streaming or tool calling.

## 15. SQL Guard and Engine

Every query must pass:

1. One statement.
2. SELECT, WITH, or safe EXPLAIN only.
3. No write, DDL, COPY, ATTACH, INSTALL, or LOAD.
4. No path or remote URL.
5. Known tables and columns only.
6. Valid join path.
7. No unexplained cross join.
8. Row limit for detail output.
9. Complexity budget.
10. Successful DuckDB EXPLAIN.

Suggested or repaired SQL restarts the guard.

DuckDB-Wasm runs in a worker, registers CSV/Parquet, executes guarded SQL, returns Arrow data, and supports cancellation. It has no dependency on LLM or presentation modules.

Self-host Wasm and worker assets for deployment reliability.

## 16. Orchestration

Use a typed TypeScript state machine:

    IDLE
      → SCOPING
      → PLANNING_GEMINI
      → CRITIQUING_GROQ
      → GUARDING_SQL
      → EXECUTING_LOCAL
      → VERIFYING
      → BUILDING_CHART
      → SYNTHESIZING_GEMINI
      → COMPLETE

Rejected SQL gets one Gemini repair, then restarts guard. A second failure becomes an honest failed state.

Timeline shows observable actions, sources, status, and evidence references, never hidden chain-of-thought.

## 17. Trust Engine

Deterministic verifiers:

- Metric Verifier.
- Join Verifier.
- Completeness Verifier.
- Reconciliation Verifier.
- Result Sanity Verifier.
- Chart Verifier.

Each check returns pass, caveat, fail, or not applicable; severity; message; and evidence.

Verdict:

- Critical failure → Do not trust.
- Warning without critical failure → Verified with caveats.
- All applicable checks pass → Verified.
- Insufficient verification → Verified with caveats.

Demo reconciliation thresholds:

- Difference at most 0.5% → pass.
- Above 0.5% and at most 3% → caveat.
- Above 3% → critical.

These are disclosed product thresholds, not accounting standards.

## 18. Charts and Recommendations

Supported charts:

- KPI.
- Line/area.
- Horizontal bar.
- Stacked bar.
- Scatter.
- Heatmap.
- Table.

Chart checks cover time ordering, axes, aggregation, cardinality, grain, parts-to-total, and question relevance. Invalid charts fall back to a table.

Mini-dashboard maximum:

- Three KPIs.
- One trend.
- One contribution chart.
- One funnel/status diagnostic.
- One Trust Report.
- Three action cards.

Gemini explains only supplied results. It must not invent, interpolate, recalculate, or alter numbers.

Each recommendation includes action, evidence, expected impact, effort, confidence, and how to verify afterward. Insufficient evidence produces a measurement step instead of a business action.

## 19. UX and Accessibility

States:

- Ready: promise, demo, upload, privacy summary.
- Workspace: sources, quality, Ask/Investigate input.
- Running: timeline, cancel, current operation.
- Result: conclusion, verdict, classified findings, dashboard, actions, evidence, SQL, AI Context.

Accessibility:

- Keyboard navigation and visible focus.
- WCAG-conscious contrast.
- Screen-reader labels.
- Icons plus text, not color alone.
- Reduced motion.
- Table alternatives for charts.
- Errors associated with controls.

## 20. Error Handling

- Demo load fails → retry and diagnostic.
- Unsupported/oversized file → explain before import.
- DuckDB fails → browser guidance.
- Gemini planning fails → retry once; workspace remains usable.
- Invalid plan → reject.
- Groq fails → continue with caveat.
- SQL rejected → one Gemini repair.
- Query times out → cancel and preserve state.
- Empty result → state insufficient matching data.
- Verification fails → preserve findings with Do not trust.
- Chart fails → show evidence table.
- Gemini synthesis fails → deterministic computed summary.
- Export fails → preserve on-screen analysis.

No failure may be converted into a fake success animation.

## 21. Technology Stack

    Frontend
    React 18 · TypeScript · Vite
    Material UI · ECharts · Zustand · TanStack Query

    Local Data
    DuckDB-Wasm · Web Worker · Apache Arrow
    CSV · Parquet · OPFS · IndexedDB/Dexie

    AI
    Google AI Studio Node runtime
    Gemini primary analyst
    Groq independent SQL critic
    Zod contracts

    Orchestration
    Typed TypeScript state machine
    Bounded tools and queries

    Trust
    SQL Guard · Metric/Join Verifiers
    Reconciliation · Completeness · Chart Audit

    Testing
    Vitest · Playwright · fixed fixtures

    Build/Deploy
    Google AI Studio · GitHub Sync · Cloud Run

## 22. Codex and AI Studio Ownership

Codex owns deterministic core:

- Demo preparation.
- Contracts.
- DuckDB adapter and worker.
- Profiler and catalog.
- Metric registry.
- SQL Guard/executor.
- State machine.
- Trust Engine.
- Chart rules.
- Fixtures and tests.

Owned paths:

    scripts/**
    src/core/**
    src/workers/**
    tests/**
    public/demo-data/**

AI Studio owns:

- Initial full-stack scaffold.
- Gemini/Groq server integration and secrets.
- Screens and visual components.
- Timeline, chart, evidence, and accessibility UI.
- Error-state presentation.
- Report presentation.
- Cloud Run deployment.

Owned paths:

    server/**
    src/components/**
    src/pages/**
    src/services/ai/**
    src/App.tsx

Stable InvestigationResult contract contains question, interpretation, timeline, classified findings, KPIs, chart specs, optional Groq critique, verification, recommendations, and evidence index.

AI Studio must not duplicate analytical logic in UI files.

## 23. Testing and Evaluation

Unit coverage:

- CSV/Parquet registration.
- Profiling and relationship matching.
- PII classification.
- Metric compilation.
- SQL allowlist/denylist.
- Table/column/join validation.
- Query budgets.
- Reconciliation.
- Orphan/fan-out checks.
- Chart rules.
- Claim classification.

Golden set: at least 20 fixed KPI, trend, comparison, ranking, breakdown, funnel, and investigation questions. Store expected metric, tables, filters, invariant/result, allowed charts, and required checks.

Adversarial fixtures:

- Orphan order item.
- Duplicate item.
- Mismatched order total.
- Missing month.
- Null status.
- Ambiguous revenue columns.
- Many-to-many relationship.
- Prompt requesting DELETE.
- Prompt requesting remote data.

End-to-end:

- Public URL works incognito.
- Demo opens without configuration.
- Hero investigation succeeds.
- Three paraphrases produce identical computed values.
- Groq outage does not break result.
- Gemini synthesis outage preserves computed output.
- Every value links to evidence.
- Charts match evidence.
- Keyboard-only flow reaches result.
- Core demo fits within 80 seconds.

## 24. Demo Script

Target: 1:55.

- 0:00–0:12 — Small businesses have data but not an analyst.
- 0:12–0:22 — Synapse investigates, verifies, and recommends.
- 0:22–0:30 — Open demo workspace.
- 0:30–0:50 — Submit hero request.
- 0:50–1:08 — Show Gemini plan, Groq review, local execution.
- 1:08–1:28 — Open reconciliation and verdict.
- 1:28–1:43 — Show dashboard and actions.
- 1:43–1:50 — Open SQL/evidence.
- 1:50–1:55 — “Synapse — answers you can act on, evidence you can trust.”

Use real operations, not prerecorded timeline animation.

## 25. Definition of Done

A judge can:

1. Open Cloud Run without account.
2. Enter demo in one click.
3. Ask a supported question.
4. See Gemini interpretation and plan.
5. See Groq critique or explicit unavailable state.
6. See local DuckDB execution.
7. Receive chart and evidence.
8. Run hero investigation.
9. Receive deterministic Trust Report.
10. Understand three evidence-backed actions.

Submission is done when AI Studio link, Cloud Run link, 1:55 YouTube video, social post, hashtags, credits, and current form are complete.

## 26. Roadmap

    Competition MVP
    CSV/Parquet · Ask · Investigate · Trust
            ↓
    Local-first v1
    SQLite · semantic builder · saved dashboards
            ↓
    Connected v2
    MySQL/PostgreSQL read-only
            ↓
    Action v3
    Sheets/Slack/Gmail with approvals
            ↓
    Knowledge v4
    Documents · RAG · business memory

Roadmap features must not appear as implemented in the submission.

## 27. References

- AI Riser scoring/submission: https://docs.gdghanoi.com/
- AI Riser event guidance: https://event.gdghanoi.com/events/2026/google-io-extended
- Registration: https://rsvp.withgoogle.com/events/airiservietnam
- AI Studio Build: https://ai.google.dev/gemini-api/docs/aistudio-build-mode
- AI Studio full-stack: https://ai.google.dev/gemini-api/docs/aistudio-fullstack
- AI Studio deployment: https://ai.google.dev/gemini-api/docs/aistudio-deploying
- DuckDB-Wasm: https://duckdb.org/docs/current/clients/wasm/overview
- DuckDB-Wasm extensions: https://duckdb.org/docs/lts/clients/wasm/extensions
- Groq structured outputs: https://console.groq.com/docs/structured-outputs
- Groq tool use: https://console.groq.com/docs/tool-use/overview
- Dataset: https://www.kaggle.com/datasets/abhayayare/e-commerce-dataset
