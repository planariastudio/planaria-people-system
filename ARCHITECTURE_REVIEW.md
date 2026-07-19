# Architecture Review — Planaria People System

*Senior-architect audit, 2026-07-19. Reverse-engineered from source; no prior context assumed. Companion to `HANDOFF.md` (which describes what the system does — this describes how well it's built and what to change).*

> **Status update (post-audit work, same day):** Phase 0 optimizations (§5) shipped. **Phase 1 shipped** as `wrangler.toml` + `package.json` + `scripts/check.mjs` + `.github/workflows/ci.yml` + `tests/` — *without* the module split / puppeteer removal (deliberately deferred; see below). **Phase 2 correctness** — the P2 case-ID race **and** KPI-create idempotency — shipped (`sbInsertMinted`, idempotency guard in `handleCreateKpiLinkTask`), each with committed regression tests. What remains of each phase is annotated inline.

---

## 0. Right-sizing disclaimer (read first)

This is an internal HR tool for a ~10-person studio, running on a serverless substrate (Cloudflare Workers + Supabase + static GitHub Pages). That substrate is *already* massively scalable in the infrastructure sense — Cloudflare will happily serve 10,000× this traffic without an architecture change. **The real scalability risks here are not machines; they are process, correctness-under-concurrency, and maintainability.** This review ranks accordingly and deliberately avoids prescribing microservices/K8s/queues-everywhere theater that would make a 1,700-line codebase worse.

Codebase census (hand-counted):

| Layer | Size | Notes |
|---|---|---|
| Worker app logic | ~1,730 lines | single file, bottom of `worker/index.js` |
| Vendored `@cloudflare/puppeteer` | ~19,880 lines | same file, top — 92% of the file is a dependency |
| Front end | ~2,900 lines | 8 static pages + 2 shared render modules |
| Apps Script | ~480 lines | lives in the Google Sheet; repo copies are for history |

## 1. Clean architecture breakdown (as reverse-engineered)

```
┌────────────────┐   menu-driven sync    ┌─────────────────────────────┐
│  Google Sheet  │◄─────────────────────►│      Cloudflare Worker      │
│ (config master)│  POST /config/sync    │  ~30 routes, one dispatcher │
└────────────────┘                       │  ┌───────────────────────┐  │
        ▲ raw-row webhook (pushToSheet)  │  │ Handlers (per route)  │  │
        └────────────────────────────────│  ├───────────────────────┤  │
                                         │  │ Integration helpers   │  │
┌────────────────┐   PostgREST/REST      │  │ sb* (Supabase)        │  │
│    Supabase    │◄──────────────────────│  │ clickup* (ClickUp)    │  │
│ (data of record│                       │  │ renderPdf (browser)   │  │
│  12 tables)    │                       │  ├───────────────────────┤  │
└────────────────┘                       │  │ Render templates      │  │
                                         │  │ kpiResultCardHtml,    │  │
┌────────────────┐   REST v2             │  │ peerScorecardHtml,    │  │
│    ClickUp     │◄──────────────────────│  │ pipReportHtml         │  │
│ (tasks + PDFs) │                       │  └───────────────────────┘  │
└────────────────┘                       └──────────────▲──────────────┘
                                                        │ fetch, JSON
                     ┌──────────────────────────────────┴───────────┐
                     │  GitHub Pages (static, no build)             │
                     │  4 forms · 2 result views · 1 admin · 1 ref  │
                     │  shared modules: kpi_card.js, peer_card.js   │
                     └──────────────────────────────────────────────┘
```

The implicit layering inside the worker is actually clean — handlers → integration helpers → templates, with no leakage of ClickUp/Supabase specifics into templates. It is layered *by convention only* (one file, no module boundaries), which is the core maintainability finding below.

**Trust model:** all secrets live server-side; the two client-side "keys" (`Planaria-admin` in `links_admin.html` and the supervisor password in `kpi_scorecard.html`) are deliberate *speed bumps*, not security — the worker re-checks `PEER_ADMIN_KEY` on every admin route. Personal tokens (`peer_token`) are capability URLs: possession = identity. This is a coherent model for an internal, unlisted tool; it is the first thing to replace at growth (see §4, Phase 3).

**Data flow invariants worth preserving** (these are the system's real design assets):
1. Forms never touch Supabase/ClickUp directly — the worker is the single choke point.
2. One KPI task per quarter that evolves in place; PDFs attach only at meaning-changing snapshots (ClickUp can't replace attachments).
3. Peer anonymity floor (`MIN_N=2`) enforced server-side, score arrays sorted so rows can't be re-aligned.
4. One self-review per editor per quarter, enforced client **and** server.
5. Render templates duplicated browser/worker are kept in sync by convention + comments (forced by the no-build-step constraint).

## 2. Critical problem areas (ranked by expected damage)

### P1 — Process, not code: manual paste-deploy with no CI gate
The worker deploys by pasting 21k lines into a dashboard textarea. This already caused a production outage (the 2026-07-17 `.join()` corruption — a syntax error that `node --check` falsely passed because the file is ESM). There is no remote, no CI, no reviewable diff at deploy time. **This is the single highest-risk item in the system** — every other finding is bounded; this one multiplies them.

### P2 — Correctness under concurrency: case-ID minting race
`nextKpiId`/`nextPipId` do read-max-then-write. Two simultaneous "Add task" clicks for the same editor+quarter can mint the same id, and because `sbUpsert` uses merge-duplicates on the PK, the second write **silently merges onto the first row** instead of failing. Probability today: low (one admin). Damage if hit: silent data merge, no error anywhere. Fix is cheap (unique-violation-on-insert + retry loop, or a Postgres sequence); do it before more than one person holds the admin URL.

### P3 — Duplicated render templates (browser module vs worker copy)
`kpi_card.js`/`peer_card.js` each have a hand-synced twin inside the worker (`kpiResultCardHtml`, `peerScorecardHtml`). This *already bit once* (PDF and web card drifted into different band thresholds — same score, different color, in an HR document). The current comment-discipline mitigation works but is a treadmill. The real fix is a 20-line build step that inlines the module into the worker source (§4 Phase 1).

### P4 — Duplicated front-end plumbing (drift farm)
Census: `fetchWithRetry` ×4 pages, `bootBanner` ×3, quarter-picker widget ×3, level-label maps ×2 pages + 2 modules + worker, clipboard-copy wiring duplicated *twice inside links_admin.html alone*. None is individually dangerous; collectively they guarantee inconsistent behavior over time (three subtly different retry/backoff behaviors already exist).

### P5 — Performance: request-path waste (fixed in this pass — see §5)
- `handleListAssignments` was a textbook N+1: one `peer_response` query **per assignment row**, sequential, on every admin page load (~30 round trips/cycle, linear in headcount). **Fixed: 1 batched query.**
- `handleKpiFinalize` serialized a multi-second headless-browser PDF render *before* two independent API lookups. **Fixed: parallelized.**
- PIP action-subtask sync did one sequential ClickUp round trip per action row. **Fixed: concurrent, order-preserving.**
- Remaining (deliberately not done, see §6): `/config` fans out 6 Supabase queries per page load with zero caching. Cheap fix (60s edge cache purged by `/config/sync`) but it changes visible staleness semantics — needs a product decision, not a refactor.

### P6 — Scalability cliffs (with the headcount at which each bites)
| Cliff | Bites at | Why |
|---|---|---|
| No pagination on any list endpoint (`roster`, `/kpi/cases`, `/pip/cases`, `peer_response` scans) | ~500–1,000 rows | PostgREST default caps + payload bloat; fine for years at studio scale |
| ClickUp API rate limit (100 req/min) | ~15+ simultaneous saves/filings | Parallelized subtask sync makes bursts spikier; a Cloudflare Queue absorbs this when it matters |
| Sheet as config master | 2–3 concurrent editors | Apps Script sync is last-writer-wins, no locking |
| Shared admin key, no audit trail | first HR dispute | No record of *who* filed/removed/created — `updated_at` is the only forensic |
| `detail` JSON blobs as scan targets (`detail->>target=eq.`) | ~10k responses | Needs expression indexes or promoted columns |

### P7 — Maintainability
- **No tests.** Every regression to date was caught by hand-rolled simulation scripts written after the fact (they live only in chat history). The simulation harness pattern works — it should be committed (`/tests`) and run by CI.
- **One 21k-line file** where 92% is a vendored dependency: diffs are unreviewable, editor tooling chokes, and any accidental keystroke in the puppeteer region is invisible.
- **Magic strings** shared across files by retyping (`'Planaria-admin'` ×2 files, worker URL ×8 files, level-key maps ×5 places).
- Repo `.gs` files vs the live Apps Script can drift silently (deploy is copy-paste in the other direction).

## 3. Bad architecture decisions vs. good-decisions-with-bad-defaults

Honest split — several things that look wrong were rational under the constraint "no build step, no CI, one maintainer":

| Decision | Verdict |
|---|---|
| Worker as single choke point; static pages | **Good.** Keep forever. |
| ClickUp status via task-name suffix | **Good under constraint** (workspace statuses unknowable) — revisit when DM automations arrive; automations key off real statuses. |
| Sheet as config master | **Good** for non-technical rubric editing; wrong the day two people edit at once. |
| Capability-URL identity (`peer_token`) | **Acceptable** internally; document that link = identity, rotate on leak. |
| Vendored puppeteer in-source | **Bad** — artifact of paste-deploy. Falls out for free with Phase 1. |
| Hand-synced template twins | **Bad but consciously mitigated**; kill with build step. |
| PostgREST filters built by string concat | **Fragile but safe as used** (`encodeURIComponent` everywhere, service key server-side only). A tiny query-builder helper would remove the foot-gun without changing behavior. |
| No idempotency keys on task-creating POSTs | **Bad**: a double-click or client retry on `/kpi/create-link-task` mid-flight creates duplicate ClickUp tasks (UI disables buttons, but the API is the contract). |

## 4. Refactoring strategy (phased; each phase independently shippable)

**Phase 0 — shipped in this pass (zero functional change):** N+1 batch, PDF-render parallelization, subtask-sync parallelization. See §5.

**Phase 1 — kill the deploy risk (highest ROI). — SHIPPED (partial, by design):**
1. ✅ Repo already had `git remote`; added `wrangler.toml` so `wrangler deploy` replaces dashboard paste (bindings + compat declared; secrets untouched).
2. ✅ CI (`.github/workflows/ci.yml`) runs `scripts/check.mjs` — the ESM syntax check that would have caught the 07-17 outage (verified it fails on an injected break; plain `node --check` misses it) — plus `node --test`.
3. ✅ `package.json` with `check` / `test` / `verify`, and `predeploy` wired so `npm run deploy` gates on both first.
4. **DEFERRED, on purpose:** the `worker/src/` module split + making `@cloudflare/puppeteer` an npm dep (deletes ~19,880 vendored lines) + build-step inlining of the card modules. Rationale: introducing the toolchain and doing risky surgery in the same step, while paste-deploy is still the live path, compounds risk. Do this as **Phase 1b** *after* `wrangler deploy` is proven on the current single-file worker. Until then paste-deploy remains a working fallback and the twin-template mitigation stays comment-based.

**Phase 2 — correctness hardening. — SHIPPED (the two that mattered):**
1. ✅ Case-ID minting: `sbInsertMinted` does plain INSERT + catch-unique-violation + re-mint retry, replacing the silent-merge upsert on both KPI and PIP create paths.
2. ✅ Idempotency: `handleCreateKpiLinkTask` reuses an existing open case+task for the editor+quarter instead of minting a duplicate (server-side backstop to the client button-disable). Both covered by `tests/correctness.test.mjs`.
3. ✅ Simulation harness committed under `/tests` as `node:test` specification tests (idempotency, race, batch-equivalence).
4. **Still open:** broader `Idempotency-Key` header on *all* task-creating routes (Peer/PIP link tasks), and the front-end `common.js` extraction (fetchWithRetry/bootBanner/level maps/quarter widget/clipboard) — mechanical, best done in Phase 1b with CI already guarding it.

**Phase 3 — growth-triggered only (do NOT build early):**
- Cloudflare Access (or any SSO) replacing the shared admin key + supervisor password; per-user audit log table.
- `/config` edge caching with purge-on-sync.
- Cloudflare Queue between worker and ClickUp for burst absorption + retry-with-backoff.
- Pagination + promoted columns/expression indexes on `peer_response(detail->>target)`.
- Real ClickUp statuses once DM automations are specified.

## 5. Production-grade code shipped in this pass

Three surgical optimizations, all proven output-identical before/after (simulation scripts + full ESM syntax gate; no functional change):

1. **`handleListAssignments`** — replaced the per-row `peer_response` query with one batched cycle query + Set lookup. Admin page cost: `3 + N` queries → `4` queries, latency now flat in assignment count. Equivalence proven across edge cases (missing token, non-roster rater, mixed completion).
2. **`handleKpiFinalize`** — `renderPdf` (headless browser, dominates request latency) now runs concurrently with the two independent lookups (`resolveEditorList`, `clickupResolveUserId`) via `Promise.all`. Failure semantics unchanged.
3. **`handlePipUpdate`** — action-row subtask sync converted from sequential loop to order-preserving `Promise.all`; per-row error fallbacks (`null` slot) byte-identical; the index-matched `_action_subtask_ids` contract explicitly preserved.

## 6. Deliberately not changed (and why)

- **`/config` caching** — visible-staleness tradeoff is a product decision (admins expect sync-then-refresh to show new rubric instantly).
- **Dispatcher if-chain → route table** — pure churn at 30 routes; zero measured cost; would bloat the paste-deploy diff.
- **Front-end `common.js` extraction** — right change, wrong moment: touching 4 working pages for zero behavior change belongs in Phase 2 with CI in place, not in the same batch as feature work awaiting deploy.
- **Auth replacement, queues, pagination** — Phase 3 triggers haven't fired; building them now is negative-value complexity for a 10-person tool.
