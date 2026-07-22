# CLAUDE.md — Planaria People System

Read this before touching anything. This is the single consolidated reference for
this project — it replaces the old `CLAUDE.md` + `ARCHITECTURE_REVIEW.md` +
`HANDOFF.md` split (merged 2026-07-22; those three files are gone, this is all of
them). It's the accumulated context from ~15+ chat sessions building this system —
architecture decisions, locked conventions, gotchas already hit once, and an
honest audit of what's good/bad about how it's built. Skipping it means
re-discovering things the slow way. If you're starting a **new** project and
just want the reusable lessons, jump to §14 (Working style) and §13
(Architecture review) — those generalize past this specific codebase.

---

## 1. What this is

Self-serve HR performance system for Planaria Studio (Jakarta post-production
agency, ~10 editors). Three instruments:

| Instrument | What it is | Cadence |
|---|---|---|
| **KPI Scorecard** | Editor self-review + supervisor scoring against a per-level rubric. Supervisor score is the official KPI; self-score is calibration only. | Quarterly |
| **Peer Appraisal** | Anonymous 1–5 ratings of assigned peers across 15 company values in 5 clusters. Pooled; never attributable to a rater. | Quarterly |
| **PIP** | Performance Improvement Plan — gaps, targets, support actions with deadlines, checkpoints, final verdict. | As needed |

## 2. Architecture (Model A — locked, don't re-litigate)

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
│ (data of record,│                      │  │ renderPdf (browser)   │  │
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
                      └───────────────────────────────────────────────┘
```

- Worker URL: `https://planaria-people-worker.planariastudio.workers.dev`
- Forms talk **only** to the Worker. The Worker talks to Supabase, ClickUp, and the Sheet webhook — forms never touch Supabase/ClickUp directly. This is the single most important invariant in the system; preserve it.
- PDFs are rendered by the Worker itself via Cloudflare browser rendering (`renderPdf`, vendored puppeteer).
- Raw form submissions are also mirrored to the Google Sheet (`KPI_Raw` / `Peer_Raw` / `PIP_Raw` tabs) via `pushToSheet` → Apps Script webhook.

**Why this stack** (don't re-propose Typeform/Airtable): Cloudflare gives
always-on reliability + native server-side PDF rendering via `@cloudflare/puppeteer`.
Google Sheet as config master because Joshua/Rashy edit rubrics without touching
code. Supabase because Sheets can't be a concurrent-write response store.

**Trust model:** all secrets live server-side; the two client-side "keys"
(`Planaria-admin` in `links_admin.html` and the supervisor password in
`kpi_scorecard.html`) are deliberate *speed bumps*, not security — the worker
re-checks `PEER_ADMIN_KEY` on every admin route. Personal tokens (`peer_token`)
are capability URLs: possession = identity. Coherent for an internal, unlisted
tool; first thing to replace at growth (see §13, Phase 3).

**Data flow invariants worth preserving** (the system's real design assets):
1. Forms never touch Supabase/ClickUp directly — the worker is the single choke point.
2. One KPI task per quarter that evolves in place; PDFs attach only at meaning-changing snapshots (ClickUp can't replace attachments).
3. One Peer Appraisal task per (rater, target, cycle) assignment, with a link pre-scoped to that exact pairing — mirrors the KPI pattern (see §8).
4. Peer anonymity floor (`MIN_N=2`) enforced server-side, score arrays sorted so rows can't be re-aligned.
5. One self-review per editor per quarter, enforced client **and** server.
6. Render templates duplicated browser/worker are kept in sync by convention + comments (forced by the no-build-step constraint) — see §13 P3 for why this is a known weak point.

## 3. Repo layout

```
/worker/index.js                    — Cloudflare Worker, all routes + PDF templates
/links_admin.html                   — admin portal (unlisted URL)
/kpi_scorecard.html                 — editor + supervisor KPI form
/kpi_result_card.html               — filed KPI result (standalone view)
/peer_appraisal.html                — peer rating form
/peer_growth_view.html              — live pooled peer result view
/pip.html                           — PIP working document
/kpi_card.js, /peer_card.js         — shared render+CSS modules (browser + worker keep synced copies)
/people_system_guide.html           — early text-only "team guide" draft, superseded by the two guide repos in §15
/people_system_reference.html       — auto-rendered rubric reference (all 3 instruments, all 6 levels)
/scripts/generate_rater_tokens.py   — assigns peer_token to roster, run manually
/scripts/config_editor_Code.gs      — Apps Script, lives IN the Google Sheet
/scripts/sheet_mirror_v2_Code.gs    — Apps Script, lives IN the Google Sheet
/scripts/check.mjs                  — repo-wide syntax gate (correct ESM check for the worker)
/tests/                             — node:test regression coverage (run via `npm test`)
/wrangler.toml, /package.json       — Phase 1 scaffolding (see §13); wrangler deploy not yet used for a real deploy
/Planaria_People_System_MASTER.xlsx — reference copy of sheet structure (13 tabs)
```

The two `.gs` files are NOT deployed via this repo — they live inside the
Google Sheet's Apps Script editor. Keep copies here for version history only.

## 4. Shared visual contract — identical CSS vars across every HTML page

```css
--canvas:#f7f7f8; --card:#fff; --ink:#17191d; --muted:#6b7280; --line:#e6e8eb;
--kpi:#4f46e5; --peer:#0d9488; --pip:#b45309;
--lo:#e0603b; --mid:#e3a008; --mid-ink:#b45309; --hi:#2f9e7e;
```
Each file aliases `--accent`/`--accent-soft`/`--accent-line` onto its own
color (kpi=indigo, peer=teal, pip=amber). If you change one file's palette,
change the alias mapping, never the base tokens — every page must stay
visually related. The two guide sites in §15 reuse this exact token set.

**Score bands (used everywhere — KPI, peer, PIP, growth view, both guide
sites):** `< 2.5` = low/red, `2.5–3.49` = mid/amber, `≥ 3.5` = high/green.
Pass bar is 3.0 unless `config.lists.pass_bar` overrides per-instrument.

## 5. Config pipeline & shape

Rubrics/roster live in the Google Sheet (13 tabs; `Planaria_People_System_MASTER.xlsx`
is a reference copy). Apps Script (`config_editor_Code.gs`) menu: **Sync to
Worker** (`POST /config/sync` with `CONFIG_SYNC_TOKEN`) and **Pull live
config**. Forms fetch `GET /config` at load, uncached.

```jsonc
{
  "roster": [{ "id": "Fitra Pratama", "name": "Fitra Pratama", "level": "senior", "track": null }],
  "kpi_rubric":  [{ "category": "...", "metric": "...", "levels": { "intern":[...], "jr":[...], "assoc":[...], "senior":[...], "supervisor":[...], "principal":[...] } }],
  "peer_rubric": [{ "cluster": "...", "value": "...", "levels": {...same 6 keys...} }],
  "pip_rubric":  [{ "competency": "...", "kind": "craft"|"value", "levels": {...same 6 keys...} }],
  "lists": [
    { "key": "supervisors", "value": ["Joshua","Rashy"] },
    { "key": "severity_duration", "value": { "Minor":30, "Moderate":60, "Severe":90 } },
    { "key": "pass_bar", "value": { "kpi":3, "pip":3, "peer":null } },
    { "key": "scale", "value": { "1":"Unsatisfactory", ..., "5":"Excellent" } }
  ]
}
```

**Level key mismatch — this bites every time:** DB/config uses
`intern|jr|assoc|senior|supervisor|principal`. Forms display
`intern|jr|ve|senior|spv|principal` (ve=Video Editor, spv=Supervisor,
shorter for UI). Always map through `LVL_FROM_DB` — never compare raw level
strings from config directly against form-side level codes.

Senior is the **only** level that forks (IC→Principal or Management→Supervisor).
Peer form's `track_reco` field only applies at senior level — required field
via config, not hardcoded.

## 6. Worker routes (index.js)

| Route | Method | Purpose |
|---|---|---|
| `/config` | GET | Full config bundle above |
| `/config/sync` | POST | Called by Apps Script menu; requires `CONFIG_SYNC_TOKEN` |
| `/whoami` | GET | `?t=<token>` → resolves a personal link to `{id,name,level}` |
| `/selftest` | GET | Read-only end-to-end health check (Supabase, ClickUp, Sheet config) |
| `/kpi/next-id` | GET | `?quarter=&editor=` → next `KPI-{quarter}-{slug}-{NN}` |
| `/kpi/open` | GET | `?editor=&quarter=` → finds unfinalized case |
| `/kpi/{id}` | GET | Full case row |
| `/kpi/editor` | POST | Editor locks self-scores |
| `/kpi/supervisor` | POST | One supervisor submits (max 3, dup-name blocked) |
| `/kpi/finalize` | POST | Files to ClickUp, creates focus-area subtasks |
| `/kpi/create-link-task` | POST | Admin: creates/reuses the one KPI task for editor+quarter |
| `/kpi/cases` | GET | Admin tracker, `?cycle=&key=` |
| `/kpi/cases/{id}` | DELETE | Cascade-delete (Supabase + ClickUp + Sheet), honest row-count check |
| `/submit/peer` | POST | Anonymous rating; requires `_token`; create-once-update-after task |
| `/peer/aggregate` | GET | `?target=&cycle=&key=` → live pooled data for growth view |
| `/peer/rater-links`, `/peer/rater-link` | GET | Admin: personal-link lookups |
| `/peer/assignments` | GET/POST | Admin: list/add rater→target pairings for a cycle |
| `/peer/assignments/{id}` | DELETE | Cascade-delete (Supabase + that pairing's ClickUp task + Sheet row) |
| `/peer/create-assignment-task` | POST | Admin: one ClickUp task per (rater,target,cycle) — **replaced `/peer/create-link-task` 2026-07-22, see §8** |
| `/peer/my-assignments` | GET | `?t=&cycle=` → a rater's assigned targets + done state |
| `/pip/next-id`, `/pip/open` | GET | Same pattern as KPI |
| `/pip/{id}` | GET | Full case row |
| `/pip/{id}/update` | POST | Save progress or `_finalize:true` to file verdict |
| `/pip/create-link-task` | POST | Admin: reserves a case id, no ClickUp task yet |
| `/pip/cases`, `/pip/cases/{id}` | GET/DELETE | Admin tracker + cascade delete |

## 7. Locked conventions (do not silently change)

- **Rubric naming:** unified "Rubric" term across KPI/Peer/PIP, not
  "criteria"/"framework"/etc — Joshua's term, used in Sheet tab names too.
- **1–5 scale:** Unsatisfactory/Needs Work/Fair/Good/Excellent, everywhere.
- **Per-editor ClickUp auto-folders:** `resolveEditorList(env, editorId, editorName, type)`
  creates Folder + KPI/Peer/PIP/To-do Lists on first use, caches IDs in
  `clickup_map`. Falls back to flat `CLICKUP_LIST_ID` if `CLICKUP_SPACE_ID`
  isn't set — don't remove this fallback, it's the no-Space-configured safety net.
  There is **no bulk "provision all editors" admin action** — this was built and
  then deliberately removed in the same session (2026-07-22) once the portal's
  purpose was clarified as "create tasks one at a time as work happens," not a
  batch setup step. Don't re-add it without being asked; if you do, remember a
  single Worker invocation has a subrequest cap that a full-roster loop blew
  past in testing (~10 editors × 8-10 subrequests each) — do it one editor per
  request if it comes back.
- **`config_version`** echoed from client into case rows — lets you tell
  which config snapshot a case was scored against if rubric changes mid-cycle.
- **`_filed` flag (PIP):** case stays editable until `_finalize:true` is
  sent; that flips `_filed` permanently. No un-filing.
- **Case IDs are the reopen mechanism:** `?kpi=<id>` / `?pip=<id>` query
  param deep-links a form straight into that case. This is how supervisors
  get sent the right case, and how "Save progress" is resumed.
- **Assignee resolution:** editor's own name only (Joshua's explicit call,
  not editor+supervisors) via `clickupResolveUserId()` — matches ClickUp
  username or email-prefix against roster name, case-insensitive. **Known
  gap:** breaks silently if ClickUp display name diverges from roster name
  (e.g. "Ude" vs "Fitriani Utami Dewi"). No alias map exists yet.
- **Deletes are honest, not silent.** `sbDelete()` uses `Prefer:
  return=representation` and every delete handler checks the actual returned
  row count before claiming success — fixed 2026-07-22 after a real bug where
  `return=minimal` made a genuine delete and a zero-match delete (e.g. blocked
  by RLS) produce byte-identical HTTP responses. If you touch delete logic
  again, keep this: check the row count, don't trust `res.ok` alone.

## 8. ClickUp structure & the personal-link model

Each roster member has **one reusable token** (`roster.peer_token`). It powers
both of their personal links:

- KPI form: `kpi_scorecard.html?e=<token>`
- Peer form: `peer_appraisal.html?t=<token>` (optionally also carrying `&target=&cycle=`, see below)

Opening a personal link resolves identity via `GET /whoami?t=` — the form
locks to that person; they can never fill in anyone else's review. Links are
**not** rotated per quarter; submissions are limited server-side instead (one
KPI self-review per editor per quarter; one peer rating per rater/target/cycle).
People discover their link by clicking through from a ClickUp task assigned to
them, never by receiving a raw URL. There is **no personal link for PIP** — a
PIP is opened and driven by a supervisor.

Space (`CLICKUP_SPACE_ID`) → **one folder per person** → four lists:

| List | Contains |
|---|---|
| **To-do** | Prompts — everything this person must fill in. Their pending KPI self-review task **and** every individual Peer Appraisal task assigned to them are created here directly (their home list, not a mirror) — a complete "what I owe" view with no ClickApp dependency. |
| **KPI** | One task per quarter that **evolves in place**: created as `KPI self-review · Name · Q3 2026` → renamed `… · Awaiting supervisor` when locked → renamed `… · Filed ✓` with the result PDF attached and focus areas as subtasks when filed. Never two tasks per quarter. |
| **Peer** | Scorecards **about** this person: `Peer Scorecard · Name · cycle` task, updated in place as raters submit, PDF snapshots attached (at pool-open ≥2 raters, and a final one when all assigned raters are in). |
| **PIP** | PIP case task — created only on the **first real save** of case data (not when the case is reserved), support actions as subtasks with due dates, PDF at first save and at checkpoint/filing. |

### Peer Appraisal task model — redesigned 2026-07-22, mirrors KPI exactly

**Old design (gone):** one shared ClickUp task per (rater, cycle), listing
every assigned target in the description. The rater picked who to rate from a
dropdown inside `peer_appraisal.html`.

**Current design:** one ClickUp task per **(rater, target, cycle)**
assignment — created via a per-row "Add task" button in `links_admin.html`'s
Rater assignments tracker, same UX as KPI's "Add task in ClickUp." Each task's
link is pre-scoped: `peer_appraisal.html?t=<token>&target=<name>&cycle=<cycle>`.
`peer_appraisal.html` reads those params and skips its picker entirely
(`applyDeepLinkTarget()` / `TARGET_PARAM` / `CYCLE_PARAM`) — the rater opens
the link and lands straight in the rating questions, never choosing a name. If
they're assigned 3 people in one cycle, that's 3 separate tasks, not one
combined reminder.

`task_id` now lives directly on the `peer_assignment` row (`POST
/peer/create-assignment-task` with `{id}`; reuses the existing task if one is
already there). Removing an assignment (`DELETE /peer/assignments/{id}`) now
cascades to delete that specific ClickUp task too — previously assignment
deletes never touched ClickUp at all. `syncPeerPromptTask`, `peerPromptMd`, and
the old `handleCreatePeerLinkTask`/`/peer/create-link-task` were removed from
the worker entirely — no longer needed since each task is independent of its
siblings. **`peer_reminder` table is now legacy/unused** (left in place, no
`DROP TABLE` issued — nothing reads or writes it anymore).

**Pending SQL for this to work** (degrades gracefully if skipped — task
creation still works, just can't detect "already has a task"):
```sql
alter table peer_assignment add column if not exists task_id text;
```

**Regression fixed 2026-07-22 (same day, found via a real bug report):**
`handleSubmitPeer` still looked up the *old* per-rater `peer_reminder` task to
mark progress after a rating was submitted — that table stopped being written
to the moment the redesign above shipped, so the lookup always found nothing
and silently no-op'd (wrapped in try/catch). Net effect: a rater's individual
assignment task never got renamed/marked complete after they actually
submitted — "the form isn't updating in ClickUp." Fixed to look up and update
the correct `peer_assignment.task_id` for that specific (rater, target, cycle)
instead.

### PIP: no live-form link, PDF re-attached on every save (fixed 2026-07-22)

Two related bugs, both found via the same real bug report:
1. `pip.html?pip=<id>` — the same editable form used by supervisors, with **no
   role gate** unlike `kpi_scorecard.html` — was being posted as a "Live case"
   link in the ClickUp task description and in every save/creation comment.
   Anyone with that link could open and edit the live case, including an
   editor who should only ever see the filed record. **Removed entirely** —
   `pipTaskDescription()` and every `clickupComment()` call in
   `handlePipUpdate` no longer reference it.
2. The PDF used to attach only on the *first* save and on final filing;
   every save in between (including checkpoints) only left a text comment
   saying the attached PDF was stale ("from the last checkpoint... not this
   save"). Since the live link is now gone, the PDF is the *only* thing an
   editor or supervisor sees — so it now **re-attaches on every single save**,
   trading a growing attachment list (ClickUp can't replace attachments, ~4-8
   snapshots over a typical case's life) for the PDF always being current.

### Other ClickUp conventions
- **Status lives in two places, deliberately redundant.** The task name suffix (`· Awaiting supervisor`, `· Filed ✓`, `· 1 of 2 done`, `· All done ✓`) is the always-present source of truth. Real ClickUp status transitions are ALSO set, best-effort, matched case-insensitively against whichever list's real statuses — silent no-op if unmatched.
- **Tags:** exactly two per task — the instrument (`KPI` / `Peer Appraisal` / `PIP`) and the quarter (`Q3-2026` format). Requires the **Tags** and **Priority** ClickApps enabled workspace-wide, or both get silently rejected.
- Moving the filed KPI task from To-do → KPI uses ClickUp's "Tasks in Multiple Lists" ClickApp. If disabled, the task safely **stays in To-do** marked `Filed ✓`/Complete — never removed from To-do unless the add to KPI succeeded first.
- **Removing a case cascades across all three systems** (KPI, PIP, and now Peer assignments too): the Remove buttons in `links_admin.html` delete the Supabase row, the ClickUp task, and (if one exists) the matching Sheet row. ClickUp deletes land in workspace trash (restorable ~30 days); Sheet deletes do not have an equivalent undo.
- **Sheet delete-by-key** (`scripts/sheet_mirror_v2_Code.gs`) is keyed differently per tab: KPI_Raw by a trailing "Case ID" column (added at the *end* of the header row on purpose so a live sheet's existing columns/formulas never shift — header self-migrates on first use); PIP_Raw by its first-column PIP ID; Peer_Raw has no single-column key, so delete matches the composite (Rater Token, Target, Cycle).
- ClickUp's API cannot replace/delete attachments, which is why PDFs attach only at meaningful snapshots, with comments in between.

## 9. Flows, step by step

### KPI (quarterly)
1. **Admin** (`links_admin.html`): pick quarter in Case tracker → "Add task in ClickUp" next to the editor's personal link. Creates the ClickUp task (assigned, link inside) + a `kpi_case` row. Button shows "✓ Task added" and stays disabled for that quarter.
2. **Editor**: opens link from ClickUp → identity auto-resolved, level auto-set, quarter/year auto-default to "now" (editable) → scores each metric 1–5 with "actual" evidence + notes → names a focus area → written reflection → **Lock** (final for their side; one submission per quarter, enforced client + server).
3. **Supervisor**: opens `kpi_scorecard.html` directly (no link — a bare visit always means supervisor, editors only ever arrive via their own link) → password gate → picks editor+quarter (case only loads once the editor's self-review is locked) → sees editor's answers read-only beside their own scoring panels → responds to focus areas → written assessment → last step shows the **actual result card preview** → **File to ClickUp**. Up to 3 supervisors can score independently; official score is the mean.
4. Filing: renders PDF, renames the task to `Filed ✓`, attaches PDF, creates focus subtasks, marks `kpi_case.finalized`, pushes a row to the Sheet, lands on `kpi_result_card.html?kpi=<id>`.
5. Result card shows: official KPI + band, calibration gap (self vs official), per-metric blocks with **what was expected (level target) → self actual/notes → supervisor note**, focus areas. Same layout web + PDF (shared module `kpi_card.js`; worker keeps a synced copy `kpiResultCardHtml`).

### Peer Appraisal (quarterly) — see §8 for the 2026-07-22 redesign
1. **Admin**: set cycle → add assignments (who rates whom) → per-row **"Add task"** — one ClickUp task per pairing, pre-scoped link, no dropdown for the rater.
2. **Rater**: opens the task-specific link → drops straight into the rating clusters (no picker) → rates 15 values 1–5 with level-specific "now vs next level" anchors → key strength + constructive text → anonymity checkbox → submit.
3. Once **2+ raters** have rated the same target (`MIN_N=2` confidentiality floor), a `Peer Scorecard` task appears in the **target's** Peer list, updated in place per submission, PDF attached at pool-open and once all assigned raters are in.
4. **Anyone with the link** (optionally gated by `PEER_VIEW_KEY`): `peer_growth_view.html` — live pooled view: overall medal, cluster means, per-value means + shuffled 1–5 distribution bars, track-fit read for seniors. ClickUp PDF is the same design (shared module `peer_card.js`).
5. For **senior** targets only: raters answer a track question (Management → Supervisor / IC → Principal / too early).

### PIP (as needed)
1. **Admin**: pick editor → **Create case** — reserves a case id and opens `pip.html?pip=<id>` directly. **Nothing appears in ClickUp yet.**
2. **Supervisor** fills the form: severity/duration (from Sheet config), start date, gaps & targets per competency, support actions with "editor does / company does / by when", checkpoints. First **save** with real content creates the ClickUp task + PDF; later saves update subtasks in place and comment instead of stacking PDFs.
3. Checkpoints and final filing attach fresh PDF snapshots (`pipReportHtml` — table-based layout: Gaps & targets / Support actions / Checkpoints, each its own section, verdict banner at top). Filing sets verdict (PASS / NOT MET).
4. Case stays editable until `_finalize`; the tracker shows Open vs verdict pill.

### Admin portal (`links_admin.html` — unlisted URL, key `Planaria-admin` must match Worker's `PEER_ADMIN_KEY`)
- KPI personal links table (copy link / add ClickUp task, persistent done-state)
- KPI case tracker per quarter (lock/file status, official score, open case, **Remove** row — full 3-way cascade)
- Peer rater assignments (add/remove pairings, per-pairing status, link, **per-row Add task**, **Remove** row — full 3-way cascade)
- PIP tracker (all cases newest-first, **Create case**, open & fill, **Remove** row — full 3-way cascade)

## 10. Data (Supabase tables)

`roster` (id/slug, name, level, track, active, peer_token — level keys:
intern/jr/assoc/senior/supervisor/principal) · `levels` · `kpi_rubric`
(category/metric/levels{6}) · `peer_rubric` (cluster/value/levels{6}) ·
`pip_rubric` (competency/kind/levels{6}) · `lists` (key/value config incl.
supervisors) · `kpi_case` (id, editor_id, editor_name, level, quarter,
editor_locked, editor_data, self_overall, official_kpi, finalized,
clickup_task_id, reminder_task_id, detail, config_version) ·
`peer_assignment` (cycle, rater_name, target_name, **task_id** — new column,
see §8, unique on cycle+rater+target) · `peer_response` (target_id, cycle,
rater=token, ratings, key_strength, constructive, overall, track_reco, detail)
· `peer_reminder` (**legacy, unused as of 2026-07-22** — see §8) · `pip_case`
(id, editor_id, level, managers, severity, duration_d, dates, result, verdict,
detail) · `clickup_map` (editor_id, folder_id, kpi/peer/pip/todo_list_id).

**Case id format:** `KPI-2026-Q3-First-Last-01` / `PIP-…` (quarterToken +
nameToken + 2-digit counter). Minted via `sbInsertMinted` (insert +
catch-unique-violation + re-mint retry) — never `sbUpsert` on a minted id,
that silently merges two concurrent creates into one row.

**Band thresholds (uniform everywhere):** `< 2.5` low/red · `< 3.5` fair/amber
· else good/green · null = neutral gray.

## 11. Env vars (Cloudflare Worker secrets)

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CLICKUP_TOKEN`, `CLICKUP_LIST_ID`
(flat fallback), `CLICKUP_SPACE_ID`, `CONFIG_SYNC_TOKEN`, `SHEET_WEBHOOK_URL`,
`MYBROWSER` (puppeteer binding), `PEER_ADMIN_KEY`, optional `PEER_VIEW_KEY`
(gates `/peer/aggregate`; unset = open endpoint).

## 12. Known gaps & deliberate decisions (be honest about these)

1. **Assignee mismatch is silent** — if someone's ClickUp display name/email-prefix doesn't match their roster name, their tasks are created unassigned. Planned fix: `roster.clickup_username` override column (not built).
2. **Peer ratings aren't restricted to assignments server-side** — the form guides raters to assigned targets, but the API accepts a rating for anyone (except self). Deliberate so far.
3. **Status = task-name suffix**, not real ClickUp statuses (real statuses are also set best-effort, but the suffix is the guaranteed source of truth). If DM automations are wanted, they key off real statuses — revisit then.
4. **Duplicate legacy tasks** may still exist in ClickUp from before the button-persistence fix (pre-2026-07-19) — clean up by hand if found.
5. **`MIN_N = 2`** raters before any pooled peer data is visible (confidentiality floor, deliberate).
6. Supervisor password (`Planaria-admin`) and admin key are client-side constants by design — URLs are unlisted; the Worker enforces the real gate.
7. `generate_rater_tokens.py` backfills tokens manually; `/peer/rater-links` also auto-generates missing tokens on load.
8. **RLS on Supabase tables is unconfirmed** — the honest-delete fix (§7) will now surface a clear "0 rows matched, check RLS" error the next time a delete silently fails, instead of pretending to succeed. If that error appears, check whether `SUPABASE_SERVICE_KEY` is genuinely the `service_role` key (which bypasses RLS) vs. an `anon` key.

## 13. Architecture review (senior-architect audit, 2026-07-19; status updated 2026-07-22)

### Right-sizing disclaimer (read first)
This is an internal HR tool for a ~10-person studio, running on a serverless
substrate (Cloudflare Workers + Supabase + static GitHub Pages) that's already
massively scalable in the infrastructure sense. **The real scalability risks
here are not machines; they are process, correctness-under-concurrency, and
maintainability.** This review deliberately avoids prescribing
microservices/K8s/queues-everywhere theater that would make a ~1,700-line
codebase worse.

Codebase census (hand-counted, 2026-07-19): worker app logic ~1,730 lines;
vendored `@cloudflare/puppeteer` ~19,880 lines (same file, 92% of it); front
end ~2,900 lines across 8 static pages + 2 shared render modules; Apps Script
~480 lines (lives in the Sheet, repo copies are for history).

The implicit layering inside the worker is clean — handlers → integration
helpers (`sb*`, `clickup*`) → render templates, with no leakage of
ClickUp/Supabase specifics into templates. It's layered *by convention only*
(one file, no module boundaries), which is the core maintainability finding.

### Critical problem areas (ranked by expected damage)

| # | Finding | Status |
|---|---|---|
| **P1** | Manual paste-deploy, no CI gate on the worker. Already caused a real outage (2026-07-17 `.join()` corruption — `node --check` falsely passed because the file is ESM). Highest-risk item; every other finding is bounded, this one multiplies them. | Mitigated: `scripts/check.mjs` + CI (`.github/workflows/ci.yml`) run the correct ESM check. `wrangler.toml` exists but `wrangler deploy` is not yet the live deploy path — paste-deploy is still how this actually ships. |
| **P2** | Case-ID minting race: two simultaneous "Add task" clicks could mint the same id and silently merge via `sbUpsert`. | **Fixed.** `sbInsertMinted` (insert + catch-unique-violation + retry) on both KPI and PIP. Regression-tested. |
| **P2b** | Silent-success deletes: `sbDelete` used `return=minimal`, indistinguishable between a real delete and a zero-match (e.g. RLS-blocked) delete. | **Fixed 2026-07-22.** `return=representation` + row-count check on every delete handler (KPI, PIP, Peer assignment). Regression-tested (`tests/honest-delete.test.mjs`). |
| **P3** | Duplicated render templates (`kpi_card.js`/`peer_card.js` vs. worker's `kpiResultCardHtml`/`peerScorecardHtml` twins). Already caused one real bug (PDF/web card drifted to different band colors for the same score). | Open. Comment-discipline mitigation holds; real fix is a build step that inlines the modules into the worker source (Phase 1b, deferred on purpose — see below). |
| **P4** | Duplicated front-end plumbing: `fetchWithRetry` ×4 pages, `bootBanner` ×3, quarter-picker widget ×3, level-label maps ×2 pages + 2 modules + worker. Not individually dangerous, collectively a drift farm. | Open, Phase 1b. |
| **P5** | Request-path waste: `handleListAssignments` N+1 (one query per assignment row), `handleKpiFinalize` serialized PDF render before independent lookups, PIP subtask sync sequential. | **Fixed** — batched query, `Promise.all` parallelization on both. Proven output-identical before/after. |
| **P6** | Scalability cliffs: no pagination past ~500-1,000 rows; ClickUp's 100 req/min rate limit bites past ~15 simultaneous saves; Sheet-as-config-master breaks past 2-3 concurrent editors; shared admin key has no audit trail; `detail` JSON blob scans need indexes past ~10k responses. | None of these have fired yet at current headcount — don't build ahead of them. |
| **P7** | Maintainability: no tests existed before this pass; one 21k-line file (92% vendored dependency) makes diffs unreviewable; magic strings retyped across files (`'Planaria-admin'` ×2, worker URL ×8+, level-key maps ×5). | Tests: **fixed** — `tests/` committed, run via `npm test`/CI. The 21k-line file and magic strings: open, Phase 1b. |

### Bad decisions vs. good-decisions-with-bad-defaults

Several things that look wrong were rational under the original constraint
("no build step, no CI, one maintainer"):

| Decision | Verdict |
|---|---|
| Worker as single choke point; static pages | **Good.** Keep forever. |
| ClickUp status via task-name suffix | **Good under constraint** — revisit when DM automations are specified. |
| Sheet as config master | **Good** for non-technical rubric editing; wrong the day two people edit at once. |
| Capability-URL identity (`peer_token`) | **Acceptable** internally; document that link = identity, rotate on leak. |
| Vendored puppeteer in-source | **Bad** — artifact of paste-deploy, falls out for free with Phase 1b. |
| Hand-synced template twins | **Bad but consciously mitigated**; kill with a build step. |
| PostgREST filters built by string concat | **Fragile but safe as used** (`encodeURIComponent` everywhere, service key server-side only). |
| No idempotency keys on task-creating POSTs | **Bad**: a double-click or client retry could create duplicate ClickUp tasks (UI disables buttons, but the API is the contract). KPI's create-link-task got a server-side idempotency guard; Peer/PIP link tasks did not. |

### Phased refactor plan

- **Phase 0 (shipped):** the three P5 performance fixes — zero functional change, proven output-identical.
- **Phase 1 (shipped, partial by design):** `wrangler.toml`, CI (`scripts/check.mjs` + `node --test`), `package.json` with `check`/`test`/`verify`/`predeploy`. **Deliberately deferred:** the `worker/src/` module split + making `@cloudflare/puppeteer` an npm dep (deletes ~19,880 vendored lines) + build-step template inlining — this is **Phase 1b**, intentionally not done in the same pass as risky surgery while paste-deploy is still the live path.
- **Phase 2 (shipped, the two that mattered):** case-ID minting race fix, KPI create-link-task idempotency guard, both regression-tested. **Still open:** broader idempotency keys on all task-creating routes, and the front-end `common.js` extraction (mechanical, best done in Phase 1b once CI is already guarding it).
- **Phase 2b (shipped 2026-07-22):** the honest-delete fix (P2b above).
- **Phase 3 (growth-triggered only — do NOT build early):** Cloudflare Access/SSO replacing the shared admin key + supervisor password with a per-user audit log; `/config` edge caching with purge-on-sync; a Cloudflare Queue between worker and ClickUp for burst absorption; pagination + indexes on `peer_response(detail->>target)`; real ClickUp statuses once DM automations are specified.

### Deliberately not changed (and why)
- `/config` caching — visible-staleness tradeoff is a product decision (admins expect sync-then-refresh to show new rubric instantly).
- Dispatcher if-chain → route table — pure churn at ~30 routes, zero measured cost, would bloat the paste-deploy diff.
- Front-end `common.js` extraction — right change, wrong moment; belongs in Phase 1b with CI in place, not mixed into feature-work batches awaiting deploy.
- Auth replacement, queues, pagination — Phase 3 triggers haven't fired.

## 14. Working style (Joshua's standing preferences — carry these into any project)

- Concrete numbers always (LUFS, dBTP, px, frame counts, score thresholds) — never vague ranges.
- Surface contradictions explicitly, never silently "fix" them (e.g. PIP verdict PASS vs. Result "Exit" → confirm dialog, not auto-resolve).
- Re-uploaded/re-pasted files are new source of truth over memory.
- Numbered tradeoffs for decisions, not prose paragraphs.
- Interactive HTML preferred over static docs for anything the team touches.
- No preamble, no restating the request, no filler closers.
- Guide/documentation wording should read as plain human writing, not AI-toned marketing prose — short direct sentences, no "seamless/leverage/unlock/dive in," match the tone of concrete step-by-step instructions over abstract summaries.
- When something is described as a real system behavior in a request (not just "make the docs say X"), verify against the actual code and fix the code too if it's wrong — don't just document a fiction. (This came up directly: a guide-writing pass surfaced that Peer Appraisal's actual task flow was inconsistent with KPI's, and got fixed in the app itself, not just described differently in the guide.)

## 15. Companion guide sites

Two documentation sites exist as **separate git repos**, styled to match this
system's visual contract, built 2026-07-22:

- **`C:\Users\joshu\planaria-supervisor-guide`** — audience: supervisors/managers. Covers using `links_admin.html` to create/track/remove KPI, Peer, and PIP tasks, plus a text-only section on what happens inside ClickUp. Includes three fabricated (clearly labeled "SAMPLE DATA") filled-example documents: a KPI result, a pooled Peer result, and a filed PIP report — the PIP sample is a byte-faithful reproduction of `pipReportHtml()`'s actual table-based layout, not a stylized re-imagining.
- **`C:\Users\joshu\planaria-people-editor-guide`** — audience: video editors. Covers filling the KPI self-review, rating a peer (now correctly describing the no-picking deep-link flow from §8), seeing results, and a short note on PIPs from the receiving side.

Both reuse the real `kpi_card.js`/`peer_card.js` renderers for their sample
docs (not screenshots — this environment has no way to save a browser
screenshot to a file, so UI walkthroughs are faithful live HTML rebuilds of
the real forms' CSS/markup instead, annotated with numbered red pins, disclosed
in a note on each page).

**Deploy status:** both are git-initialized locally with commits but have
**no GitHub remote yet** — repo creation via the GitHub API using an extracted
git credential was attempted and blocked by the environment's safety
classifier (reasonable: broader use of a stored credential than a plain `git
push`). Needs either the user creating the empty repos via the GitHub web UI
(then a normal `git push` works fine, credentials are already configured for
`github.com`), or explicit re-authorization for the API-based path.

## 16. Deploy runbook

Three independent deploy targets — all manual, no CI/CD wiring the three
together yet:

1. **Worker:** paste the entire `worker/index.js` into the Cloudflare
   dashboard editor → Save & Deploy. No build step; it's a bundled single file
   (700KB+, includes vendored `@cloudflare/puppeteer`). **Always verify first**
   with `node --input-type=module --check < worker/index.js` — plain `node
   --check` FALSELY PASSES on this ESM file (this is exactly how the
   2026-07-17 outage reached production). `npm run check` runs this plus every
   page's extracted `<script>` block in one pass.
2. **Forms:** push to the GitHub Pages repo (`planariastudio/planaria-people-system`).
   `kpi_card.js` and `peer_card.js` are load-bearing shared modules — pages
   break without them.
3. **Apps Script** (`scripts/sheet_mirror_v2_Code.gs` / `config_editor_Code.gs`):
   re-paste into the Sheet's Extensions → Apps Script editor and
   **re-deploy** (Deploy → Manage deployments → edit → new version). This is a
   separate deploy target from the Worker and is easy to forget — the Remove
   buttons' Sheet cascade silently keeps using the old deployment otherwise.

Also run `npm run check` (or open `links_admin.html` and check `/selftest`)
after all three land — it verifies Supabase tables/migrations, ClickUp
token/space/statuses, and Sheet webhook config in one pass.

Worker secrets (set once in the Cloudflare dashboard, persist across deploys):
see §11.

## 17. Current deploy state (as of 2026-07-22 — read this, not §16 alone)

Everything described in this file as current behavior is implemented and
verified locally (`npm run verify` — 29/29 tests, full syntax check) but
**not yet deployed**. In order:

1. **Supabase SQL** — three migrations. `kpi_case.reminder_task_id` and the
   `peer_reminder` table's primary key are already run and confirmed. Still
   pending:
   ```sql
   -- lets To-do list ids be cached (degrades gracefully if skipped)
   alter table clickup_map add column if not exists todo_list_id text;
   -- backs the redesigned per-assignment Peer Appraisal task model, §8
   alter table peer_assignment add column if not exists task_id text;
   ```
2. **Worker** — paste `worker/index.js` per §16 step 1. This carries the
   honest-delete fix, the ClickUp-provisioning-panel removal, and the full
   Peer Appraisal task-model redesign (§8).
3. **Forms** — push `links_admin.html` and `peer_appraisal.html` (both
   changed this session) per §16 step 2.
4. **Apps Script** — only needed if `scripts/sheet_mirror_v2_Code.gs` changed
   since the last Apps Script deploy; check before assuming it's current.

Two new local-only guide repos also exist and are ready to push once GitHub
remotes exist for them — see §15.

## 18. First things to do next session

1. Confirm the SQL above has run, then walk through the three deploy steps in §16/§17 in order.
2. Re-run `/selftest` from `links_admin.html` after deploy to confirm green across the board.
3. If the user wants the two guide sites live: help them create the two empty GitHub repos (or get explicit sign-off to do it via the API path that got blocked), then push.
4. Phase 1b (module split, `common.js` extraction, template-inlining build step) is the next real architecture investment when there's appetite for it — see §13. Not urgent at current scale.
