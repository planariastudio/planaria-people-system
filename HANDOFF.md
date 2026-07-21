# Planaria People System — Handoff

**Purpose of this file:** everything a fresh Claude (chat) session needs to write the two guidebooks — one for **editors** (the people being reviewed) and one for **supervisors/admins** (the people running reviews). It is self-contained: no access to the codebase or prior conversations is assumed. Facts below describe the system as of 2026-07-19, including changes that are finished locally but may not be deployed yet (see "Deploy state" at the bottom).

---

## 1. What this system is

Planaria Studio's performance-management system for its video editors. Three instruments:

| Instrument | What it is | Cadence |
|---|---|---|
| **KPI Scorecard** | Editor self-review + supervisor scoring against a per-level rubric. Supervisor score is the official KPI; self-score is calibration only. | Quarterly |
| **Peer Appraisal** | Anonymous 1–5 ratings of assigned peers across 15 company values in 5 clusters. Pooled; never attributable to a rater. | Quarterly |
| **PIP** | Performance Improvement Plan — gaps, targets, support actions with deadlines, checkpoints, final verdict. | As needed |

## 2. Architecture (5 pieces)

```
Google Sheet (config master: roster, rubrics, lists — human-edited)
     ↕ Apps Script custom menu ("Sync to Worker" / "Pull live config")
Cloudflare Worker (ALL business logic, single bundled worker/index.js)
     ↕                                    ↕
Supabase Postgres (data of record)   ClickUp (tasks + PDF filing)
     ↑
GitHub Pages: planariastudio.github.io/planaria-people-system (static HTML forms)
```

- Worker URL: `https://planaria-people-worker.planariastudio.workers.dev`
- Forms talk **only** to the Worker. The Worker talks to Supabase, ClickUp, and the Sheet webhook.
- PDFs are rendered by the Worker itself via Cloudflare browser rendering (`renderPdf`, vendored puppeteer).
- Raw form submissions are also mirrored to the Google Sheet (`KPI_Raw` / `Peer_Raw` / `PIP_Raw` tabs) via `pushToSheet` → Apps Script webhook.

## 3. The personal-link model (important for both guidebooks)

Each roster member has **one reusable token** (`roster.peer_token`). It powers both of their personal links:

- Peer form: `peer_appraisal.html?t=<token>`
- KPI form: `kpi_scorecard.html?e=<token>`

Opening a personal link resolves identity via `GET /whoami?t=` — the form locks to that person; they can never fill in anyone else's review. Links are **not** rotated per quarter; instead, submissions are limited server-side (one KPI self-review per editor per quarter; one peer rating per rater/target/cycle). People are meant to discover their link by clicking through from a ClickUp task assigned to them, not by receiving raw URLs.

There is **no personal link for PIP** — a PIP is opened and driven by a supervisor.

## 4. ClickUp structure

Space (`CLICKUP_SPACE_ID`) → **one folder per person** → four lists:

| List | Contains |
|---|---|
| **To-do** | Prompts — everything this person must fill in. Both their Peer "rate your peers" task **and** their pending KPI self-review task are *created here* (this is their home list, not a mirror), so To-do is a complete "what I owe" view with no ClickApp dependency |
| **KPI** | One task per quarter that **evolves in place**: created as `KPI self-review · Name · Q3 2026` (with personal link, assigned to them) → renamed `… · Awaiting supervisor` when they lock → renamed `KPI · Name · Q3 2026 · Filed ✓` with the result PDF attached and focus areas as subtasks when the supervisor files. Never two tasks per quarter. |
| **Peer** | Scorecards **about** this person: `Peer Scorecard · Name · cycle` task, updated in place as raters submit, PDF snapshots attached (max 2: when the pool opens at 2 raters, and a `_final` one when all assigned raters are in) |
| **PIP** | PIP case task — created only on the **first real save** of case data (not when the case is reserved), support actions as subtasks with "by when" due dates, PDF at first save and at checkpoint/filing only |

Conventions:
- **Status lives in two places, deliberately redundant.** The task name suffix (`· Awaiting supervisor`, `· Filed ✓`, `· 1 of 2 done`, `· All done ✓`) is the always-present source of truth. Real ClickUp status transitions (`to do`/`in progress`/`complete`) are ALSO set, best-effort, against whichever list the task actually lives in — matched case-insensitively against that list's real statuses, silently no-op if unmatched. If status-setting ever fails, the name suffix still communicates state.
- **Tags:** exactly two per task — the instrument (`KPI` / `Peer Appraisal` / `PIP`) and the quarter (`Q3-2026` format). Requires the **Tags** and **Priority** ClickApps to be enabled workspace-wide, or both get silently rejected by the API.
- Assignee is auto-resolved by matching ClickUp username/email-prefix to roster name (known gap: silently unassigned on mismatch — see §9).
- Moving the KPI task from To-do → KPI at filing uses ClickUp's "Tasks in Multiple Lists" ClickApp. If it's not enabled, the task safely **stays in To-do** marked `Filed ✓`/Complete — it is never removed from To-do unless the add to KPI succeeded first, so it can't end up in no list at all.
- **Removing a case cascades across all three systems:** the Remove buttons in `links_admin.html` delete the Supabase row, the ClickUp task, and (if one exists) the matching Sheet row — everything stays in sync. ClickUp deletes land in workspace trash (restorable ~30 days); Sheet deletes do not have an equivalent undo. Removing a peer *assignment* additionally deletes that rater's submitted rating from `Peer_Raw` if they'd already rated the target — the client warns specifically when this is the case, since it's meaningfully different from removing an unused pairing.
- **Sheet delete-by-key** (`scripts/sheet_mirror_v2_Code.gs`) is keyed differently per tab: KPI_Raw by a trailing "Case ID" column (added at the *end* of the header row on purpose, so an already-live sheet's existing columns/formulas never shift — the header self-migrates on first use, no manual sheet edit needed); PIP_Raw by its existing first-column PIP ID; Peer_Raw has no single-column key, so delete matches the composite (Rater Token, Target, Cycle), which is already unique server-side.
- ClickUp's API cannot replace/delete attachments, which is why PDFs attach only at meaningful snapshots, with comments in between.

## 5. Flows, step by step (source material for the guidebooks)

### KPI (quarterly)
1. **Admin** (links_admin.html): pick quarter in Case tracker → "Add task in ClickUp" next to the editor's personal link. Creates the ClickUp task (assigned, link inside) + a `kpi_case` row. Button shows "✓ Task added" and stays disabled for that quarter.
2. **Editor**: opens link from ClickUp → identity auto-resolved, level auto-set, quarter/year auto-default to "now" (editable) → scores each metric 1–5 with "actual" evidence + notes → names 2 focus areas ("you spot it first") → written reflection → **Lock** (final for their side; one submission per quarter, enforced client + server; reopening the link shows "Already submitted").
3. **Supervisor**: opens `kpi_scorecard.html` directly (no link) → password gate (`Planaria-admin`) → picks editor+quarter → sees editor's answers read-only beside their own scoring panels → responds to focus areas (action/measure/priority) → written assessment → last step shows the **actual result card preview** ("Not filed yet" banner) → **File to ClickUp**.
4. Filing: renders PDF, renames the one ClickUp task to `Filed ✓`, attaches PDF, creates focus subtasks with next-quarter due dates, removes the To-do mirror, marks `kpi_case.finalized`, pushes a row to the Sheet, then browser lands on `kpi_result_card.html?kpi=<id>` (Save as PDF button).
5. Result card shows: official KPI + band, calibration gap (self vs official), per-metric blocks with **what was expected (level target) → self actual/notes → supervisor note**, focus areas. Same layout in web and PDF (shared module `kpi_card.js`; worker keeps a synced copy).

### Peer Appraisal (quarterly)
1. **Admin**: set cycle → add assignments (who rates whom) → "Add task" per rater (one task per rater per cycle, listing all their targets). Button persists as "✓ Task added".
2. **Rater**: opens their link from ClickUp → form shows **only their assigned targets** (already-rated ones disabled; single outstanding target auto-selected; falls back to full roster if the Worker can't answer) → rates 15 values 1–5 with level-specific anchors → key strength + constructive text → anonymity checkbox → submit. Can repeat for each assigned target ("Rate another peer" reloads assignments).
3. Their ClickUp prompt renames with progress (`· 1 of 2 done` → `· All done ✓`).
4. Once **2+ raters** have rated the same target (MIN_N=2 confidentiality floor), a `Peer Scorecard` task appears in the **target's** Peer list, updated in place per submission, PDF attached at pool-open and once all assigned raters are in.
5. **Anyone with the link** (optionally gated by `PEER_VIEW_KEY`): `peer_growth_view.html` — live pooled view: overall medal, cluster means, per-value means + shuffled 1–5 distribution bars, track-fit read for seniors (Management vs IC), pooled strengths/constructive text. The ClickUp PDF is the same design (shared module `peer_card.js`).
6. For **senior** targets only: raters answer a track question (Management → Supervisor / IC → Principal / too early).

### PIP (as needed)
1. **Admin**: pick editor → **Create case** — reserves a case id and opens `pip.html?pip=<id>` directly. **Nothing appears in ClickUp yet.**
2. **Supervisor** fills the form: severity/duration (from Sheet config), start date (defaults to today), gaps & targets per competency, support actions with "editor does / company does / by when", checkpoints. First **save** with real content creates the ClickUp task + PDF; later saves update subtasks in place (by row position) and leave comments instead of stacking PDFs.
3. Checkpoints and final filing attach fresh PDF snapshots. Filing sets verdict (PASS / NOT MET), renames/comments the task, adjusts priority.
4. Case stays editable until `_finalize`; the tracker shows Open vs verdict pill.

### Admin portal (links_admin.html — unlisted URL, key `Planaria-admin` must match Worker's `PEER_ADMIN_KEY`)
- KPI personal links table (copy link / add ClickUp task, persistent done-state)
- KPI case tracker per quarter (lock/file status, official score, open case, **Remove** row)
- Peer rater assignments (add/remove pairings, per-rater status, link, add task)
- PIP tracker (all cases newest-first, **Create case**, open & fill, **Remove** row)
- Remove buttons delete the Supabase row only — they never touch ClickUp.

## 6. Data (Supabase tables)

`roster` (id/slug, name, level, track, active, peer_token, — level keys in DB: intern/jr/assoc/senior/supervisor/principal) · `levels` · `kpi_rubric` (category/metric/levels{6}) · `peer_rubric` (cluster/value/levels{6}) · `pip_rubric` · `lists` (key/value config incl. supervisors) · `kpi_case` (id, editor_id, editor_name, level, quarter, editor_locked, editor_data, self_overall, official_kpi, finalized, clickup_task_id, reminder_task_id, detail, config_version) · `peer_assignment` (cycle, rater_name, target_name, unique) · `peer_response` (target_id, cycle, rater=token, ratings, key_strength, constructive, overall, track_reco, detail) · `peer_reminder` (cycle, rater_name, task_id, unique(cycle,rater_name)) · `pip_case` (id, editor_id, level, managers, severity, duration_d, dates, result, verdict, detail) · `clickup_map` (editor_id, folder_id, kpi/peer/pip/todo_list_id).

**Case id format:** `KPI-2026-Q3-First-Last-01` / `PIP-…` (quarterToken + nameToken + 2-digit counter).

**Band thresholds (uniform everywhere):** `< 2.5` low/red · `< 3.5` fair/amber · else good/green · null = neutral gray.

## 7. Config pipeline

Rubrics/roster live in the Google Sheet (13 tabs; `Planaria_People_System_MASTER.xlsx` is a reference copy). Apps Script (`config_editor_Code.gs`) menu: **Sync to Worker** (`POST /config/sync` with `CONFIG_SYNC_TOKEN`) and **Pull live config**. Forms fetch `GET /config` at load. `sheet_mirror_v2_Code.gs` receives raw-submission webhooks into `*_Raw` tabs.

## 8. Deploy process (manual, no CI)

1. **Worker:** paste the entire `worker/index.js` into the Cloudflare dashboard editor → Save & Deploy. Verify with `node --input-type=module --check < worker/index.js` first — plain `node --check` FALSELY PASSES on this ESM file and once let a syntax error reach a deploy.
2. **Forms:** push to the GitHub Pages repo (`planariastudio/planaria-people-system`). `kpi_card.js` and `peer_card.js` are load-bearing shared modules — pages break without them.
3. Worker secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CLICKUP_TOKEN`, `CLICKUP_LIST_ID` (flat fallback), `CLICKUP_SPACE_ID`, `CONFIG_SYNC_TOKEN`, `SHEET_WEBHOOK_URL`, `MYBROWSER` (browser binding), `PEER_ADMIN_KEY`, optional `PEER_VIEW_KEY`.

## 9. Known gaps & deliberate decisions (be honest about these in the guidebooks)

1. **Assignee mismatch is silent** — if someone's ClickUp display name/email-prefix doesn't match their roster name, their tasks are created unassigned. Planned fix: `roster.clickup_username` override column (not built).
2. **Peer ratings aren't restricted to assignments server-side** — the form guides raters to assigned targets, but the API accepts a rating for anyone (except self). Deliberate so far.
3. **Status = task-name suffix**, not real ClickUp statuses. Native ClickUp automations (e.g. "DM assignee when filed") trigger better off real statuses — if DM automations are wanted (they are, per Joshua), consider migrating to a status field then.
4. **Duplicate legacy tasks in ClickUp** — before the button-persistence fix, "Add task" could be clicked twice; e.g. Davin Edbert has two identical Peer Appraisal tasks. `peer_reminder` points at the newer one; older ones must be deleted by hand in ClickUp.
5. **Moving the filed KPI task out of To-do needs the "Tasks in Multiple Lists" ClickApp**; without it, filed KPI tasks stay in To-do (marked `Filed ✓` + Complete) instead of moving to the KPI list. Functional either way, just less tidy.
6. **MIN_N = 2** raters before any pooled peer data is visible (confidentiality floor).
7. Supervisor password (`Planaria-admin`) and admin key are client-side constants by design — the URLs are unlisted; the Worker enforces the real gate.
8. `generate_rater_tokens.py` backfills tokens manually; `/peer/rater-links` also auto-generates missing tokens on load.

## 10. Guidebook briefs (what Joshua asked for)

Two documents, matching the visual style of the existing pages (Inter font, shared color contract: KPI indigo `#4f46e5`, Peer teal `#0d9488`, PIP amber `#b45309`):

- **Editor guide:** how to find your link (ClickUp task assigned to you), fill the KPI self-review (be concrete in "actual", one submission per quarter, what locking means), rate peers (anonymity guarantees, assigned targets pre-filled), read your result card (official vs self, calibration gap, focus areas become ClickUp subtasks). Tone: reassuring, emphasizes development over surveillance; peer data is pooled and can never be traced to a rater.
- **Supervisor/admin guide:** links_admin.html walkthrough (every section/button incl. Remove and persistent task buttons), scoring flow (password, picking a locked case, result-card preview before filing), peer cycle setup (assignments before tasks), PIP lifecycle (Create case → fill → save creates the task), the SQL/deploy runbook, and the known gaps above.

An earlier `people_system_guide.html` + `Planaria_People_System_Guide.pdf` exist in the repo as a starting point but predate most of the current behavior — treat them as outdated.

## 11. Deploy state at handoff (2026-07-21)

Everything above is implemented and verified locally. Three things need redeploying/running, in this order:

1. **Supabase SQL** — two migrations. `kpi_case.reminder_task_id` and the `peer_reminder` table are already run. Still pending or newly added:
```sql
-- lets To-do list ids be cached (degrades gracefully if skipped)
alter table clickup_map add column if not exists todo_list_id text;
-- peer_reminder was created with only a composite UNIQUE constraint, no real
-- primary key -- Supabase's table-editor UI can't delete/edit rows without one.
alter table peer_reminder add column id bigserial;
alter table peer_reminder add primary key (id);
```
2. **Worker** — paste `worker/index.js` into the Cloudflare dashboard as usual. Verify with `node --input-type=module --check < worker/index.js` first (`npm run check` does this plus every page).
3. **Apps Script** (`scripts/sheet_mirror_v2_Code.gs`) — must also be re-pasted into the Sheet's Extensions → Apps Script editor and **re-deployed** (Deploy → Manage deployments → edit → new version) for the Remove-buttons' Sheet cascade to work. This is a separate deploy target from the Worker and is easy to forget.

Also run `npm run check` (or just open `links_admin.html` → **Run system check**) after all three land — it verifies Supabase tables/migrations, ClickUp token/space/statuses, and Sheet webhook config in one pass.

`ARCHITECTURE_REVIEW.md` covers code-quality/scalability findings separately; `tests/` (run via `npm test`) has committed regression coverage for the trickier pieces — the KPI idempotency guard, the case-ID minting race, the peer final-PDF re-fire logic, and the Sheet mirror's header self-migration.
