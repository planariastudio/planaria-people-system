# CLAUDE.md — Planaria People System

Read this before touching anything. It's the accumulated context from ~15 chat
sessions building this system — architecture decisions, locked conventions,
gotchas already hit once. Skipping it means re-discovering things the slow way.

## What this is

Self-serve HR performance system for Planaria Studio (Jakarta post-production
agency, ~10 editors). Three instruments: **KPI Scorecard** (quarterly,
multi-stage editor→supervisor), **Peer Appraisal** (anonymous, pooled),
**PIP** (Performance Improvement Plan, single continuous document).

## Architecture (Model A — locked, don't re-litigate)

```
Google Sheet (config master, human-edited)
      │  Apps Script menu → POST /config/sync
      ▼
Supabase Postgres (roster, rubrics, responses, cases)
      ▲  GET /config (cached read)          │  writes
      │                                      ▼
Cloudflare Worker (index.js — all business logic, PDF rendering)
      ▲                                      │
      │ fetch()                              ▼
GitHub Pages (static HTML forms)      ClickUp (filed reports, PDF attach,
kpi_scorecard.html                     per-editor auto Folder/Lists,
peer_appraisal.html                    subtasks for focus/action items)
peer_growth_view.html
pip.html
```

Why this stack (don't re-propose Typeform/Airtable): Cloudflare gives
always-on reliability + native server-side PDF rendering via `@cloudflare/puppeteer`
(`renderPdf()` in index.js). Google Sheet as config master because Joshua/Rashy
edit rubrics without touching code. Supabase because Sheets can't be a
concurrent-write response store.

## Repo layout (target, once migrated)

```
/worker/index.js              — Cloudflare Worker, all routes + PDF templates
/forms/kpi_scorecard.html
/forms/peer_appraisal.html
/forms/peer_growth_view.html
/forms/pip.html
/scripts/generate_rater_tokens.py   — assigns peer_token to roster, run manually
/scripts/config_editor_Code.gs      — Apps Script, lives IN the Google Sheet
/scripts/sheet_mirror_v2_Code.gs    — Apps Script, lives IN the Google Sheet
/Planaria_People_System_MASTER.xlsx — reference copy of sheet structure (13 tabs)
/PEOPLE_SYSTEM_HANDOFF.md           — older handoff doc, superseded by this file
```

The two `.gs` files are NOT deployed via this repo — they live inside the
Google Sheet's Apps Script editor. Keep copies here for version history only.

## Shared visual contract — identical CSS vars across all 4 HTML forms

```css
--canvas:#f7f7f8; --card:#fff; --ink:#17191d; --muted:#6b7280; --line:#e6e8eb;
--kpi:#4f46e5; --peer:#0d9488; --pip:#b45309;
--lo:#e0603b; --mid:#e3a008; --mid-ink:#b45309; --hi:#2f9e7e;
```
Each file aliases `--accent`/`--accent-soft`/`--accent-line` onto its own
color (kpi=indigo, peer=teal, pip=amber). If you change one file's palette,
change the alias mapping, never the base tokens — all four forms must stay
visually related.

Score bands (used everywhere — KPI, peer, PIP, growth view): **<2.5 = low/red,
2.5–3.49 = mid/amber, ≥3.5 = high/green**. Pass bar is 3.0 unless
`config.lists.pass_bar` overrides per-instrument.

## Config shapes (from `GET /config`, backed by Google Sheet)

```jsonc
{
  "roster": [{ "id": "fitra", "name": "Fitra Pratama", "level": "senior", "active": true }],
  "kpi_rubric":  [{ "category": "...", "metric": "...", "levels": { "intern":[...], "jr":[...], "assoc":[...], "senior":[...], "supervisor":[...], "principal":[...] } }],
  "peer_rubric": [{ "cluster": "...", "value": "...", "levels": {...same 6 keys...} }],
  "pip_rubric":  [{ "competency": "...", "levels": {...same 6 keys...} }],
  "lists": [
    { "key": "supervisors", "value": ["Joshua","Rashy"] },
    { "key": "severity_duration", "value": { "Minor":30, "Moderate":60, "Severe":90 } },
    { "key": "pass_bar", "value": { "kpi":3, "pip":3, "peer":null } },
    { "key": "scale", "value": { "1":"Unsatisfactory", ..., "5":"Excellent" } },
    { "key": "version", "value": "<config_version_string>" }
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

## Worker routes (index.js)

| Route | Method | Purpose |
|---|---|---|
| `/config` | GET | Full config bundle above |
| `/config/sync` | POST | Called by Apps Script menu; requires `CONFIG_SYNC_TOKEN` |
| `/kpi/next-id` | GET | `?quarter=&editor=` → next `KPI-{quarter}-{slug}-{NN}` |
| `/kpi/open` | GET | `?editor=&quarter=` → finds unfinalized case (added for supervisor lookup, mirrors `/pip/open`) |
| `/kpi/{id}` | GET | Full case row |
| `/kpi/editor` | POST | Editor locks self-scores |
| `/kpi/supervisor` | POST | One supervisor submits (max 3, dup-name blocked) |
| `/kpi/finalize` | POST | Files to ClickUp, creates focus-area subtasks |
| `/submit/peer` | POST | Anonymous rating; requires `_token`; create-once-update-after task |
| `/peer/aggregate` | GET | `?target=&cycle=&key=` → live pooled data for growth view |
| `/pip/next-id` | GET | Same pattern as KPI |
| `/pip/open` | GET | `?editor=` → open (unfiled) case |
| `/pip/{id}` | GET | Full case row |
| `/pip/{id}/update` | POST | Save progress or `_finalize:true` to file verdict |

## Locked conventions (do not silently change)

- **Rubric naming:** unified "Rubric" term across KPI/Peer/PIP, not
  "criteria"/"framework"/etc — Joshua's term, used in Sheet tab names too.
- **1–5 scale:** Unsatisfactory/Needs Work/Fair/Good/Excellent, everywhere.
- **Per-editor ClickUp auto-folders:** `resolveEditorList(env, editorId, editorName, type)`
  creates Folder + KPI/Peer/PIP Lists on first use, caches IDs in
  `clickup_map` table. Falls back to flat `CLICKUP_LIST_ID` if
  `CLICKUP_SPACE_ID` isn't set — don't remove this fallback, it's the
  no-Space-configured safety net.
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
  (e.g. "Ude" vs "Fitriani Utami Dewi"). No alias map exists yet — add one
  (roster column `clickup_username` or a hardcoded dict in the Worker) the
  first time this is confirmed broken for a real editor.

## Env vars (Cloudflare Worker secrets)

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CLICKUP_TOKEN`, `CLICKUP_LIST_ID`,
`CLICKUP_SPACE_ID`, `CONFIG_SYNC_TOKEN`, `SHEET_WEBHOOK_URL`, `MYBROWSER`
(puppeteer binding), `DEBUG`. **Not yet added but referenced in latest
patch:** `PEER_VIEW_KEY` (optional — gates `/peer/aggregate`; unset = open
endpoint, which is the current live state).

## Known open items (as of last session)

1. **Assignee alias gap** — see above, needs a real editor test to confirm
   before building a fix.
2. **ClickUp tag auto-creation** varies by plan tier — Worker retries once
   without tags on failure, but this hasn't been live-verified.
3. **Live smoke-test backlog** (never verified against real infra, only
   syntax-checked): assignee landing on a filed KPI, `/kpi/open` and
   `/peer/aggregate` returning correct JSON, tags appearing on created
   tasks, PIP severity dropdown populating from the live sheet, growth view
   loading a real cycle end-to-end.
4. **PIP form** previously had 3 hardcoded values that silently ignored
   Sheet edits (managers list, severity/duration map, pass bar) — fixed in
   last session, but re-verify the Sheet round-trip actually reaches the
   live form after deploy.

## Working style (Joshua's standing preferences — carry these into Claude Code)

- Concrete numbers always (LUFS, dBTP, px, frame counts, score thresholds)
  — never vague ranges.
- Surface contradictions explicitly, never silently "fix" them (e.g. PIP
  verdict PASS vs Result "Exit" → confirm dialog, not auto-resolve).
- Re-uploaded/re-pasted files are new source of truth over memory.
- Numbered tradeoffs for decisions, not prose paragraphs.
- Interactive HTML preferred over static docs for anything the team touches.
- No preamble, no restating the request, no filler closers.

## Deploy steps (manual — no CI yet)

1. **Worker:** paste full `index.js` into Cloudflare dashboard Worker editor
   → Save & Deploy. No build step; it's a bundled single file (includes
   vendored `@cloudflare/puppeteer` — that's why it's 700KB+).
2. **Forms:** commit to GitHub Pages repo `planariastudio/planaria-people-system`,
   push to the branch Pages serves from. Hard-refresh to bust cache.
3. **Sheet config changes:** edit the Sheet → Apps Script custom menu →
   "Sync to Worker" → hits `/config/sync` with `CONFIG_SYNC_TOKEN`.
4. **New rater tokens:** run `generate_rater_tokens.py` locally with
   `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` env vars set, safe to re-run
   (idempotent — existing tokens untouched).

## First things to do once this repo exists

1. Set up the actual git repo with this file at root.
2. Move the 3 remaining fixes/decisions still open (assignee alias map,
   live smoke tests, PEER_VIEW_KEY) into a TODO or issue tracker of your
   choice — they're real, not hypothetical.
3. Consider a minimal CI check: `node --check index.js` and an HTML/JS
   extraction lint on the 4 forms, so a syntax error can't reach
   Cloudflare/GitHub Pages silently the way it could in chat-based editing.
