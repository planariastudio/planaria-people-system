# Handoff — People System → GoodDay

**Written** 2026-09-18, from the session that built the ClickUp automations (end of July)
and then fixed two bugs in the KPI forms.
**For** the existing Planaria People System chat, to start the GoodDay migration.
**Repo this describes** `C:\Users\joshu\planaria-people-system` — not `C:\Claude\Planaria Plugin`,
which holds the GoodDay guides.

---

## Read this first: the People System has not been migrated at all

The GoodDay work done so far is the **Production job board** (`/p/NmWwcc`) and
**Attendance** (`/p/VBUuHJ`). Those replace the **Project 2.0** ClickUp board — the video
production pipeline.

The **People System is a different thing entirely**: KPI Scorecard, Peer Appraisal and PIP.
It still runs on ClickUp, untouched by the GoodDay migration. Your memory keeps these apart
deliberately — see `project-2-0-clickup-audit` ("separate from the People System in
[[clickup-automations-live]]").

So this is a new workstream, not a continuation of the Production migration.

**Suggested read order**

1. This file — what exists and what is blocked.
2. `CLAUDE.md` in this repo — the People System architecture. §2 (Model A), §6 (routes), §9 (flows).
3. `CLICKUP_AUTOMATIONS.md` in this repo — the 43-rule runbook, §J tracker and §K troubleshooting.
4. Memory `goodday-phase1-scope` — the GoodDay constraints already proven. Do not re-test those.

---

## Blocking fact: nothing from the last two sessions is deployed

`git log` still ends at `e34f599`. Everything below is sitting uncommitted in the working
tree and is **not live** for anyone.

| File | What's in it | Risk if it stays unshipped |
|---|---|---|
| `worker/index.js` | supervisor-assessment section in the PDF card | — |
| `kpi_scorecard.html` | `spv_summary` now actually sent; draft save/restore | **Real data loss, see below** |
| `kpi_card.js` | assessment section on the web card | — |
| `peer_appraisal.html` | draft save/restore | Raters lose a sitting on refresh |
| `pip.html` | `beforeunload` unsaved-edit guard | Silent loss of edits since last Save |
| `draft.js` | **new file** — the localStorage draft store | Must be added to the Pages push |
| `scripts/check.mjs` | adds `draft.js` to the syntax gate | — |
| `CLAUDE.md` | documents both changes | — |

Also untracked from earlier sessions: `CLICKUP_AUTOMATIONS.md`, `system_check.html`,
`tests/honest-delete.test.mjs`, `tests/sheet-mirror-migration.test.mjs`.
Also modified by earlier sessions, not by these two: `links_admin.html`,
`scripts/sheet_mirror_v2_Code.gs`.

`npm run verify` passes (29/29) on the tree as it stands.

### The bug that matters

The supervisor's written assessment — a **required** three-box step in the form (Strengths /
Areas of improvement / Trajectory & recommendation) — was never included in the `fileFinal()`
payload. Supervisors typed three mandatory paragraphs per review and the data was discarded:
never sent, never stored in `kpi_case.detail`, never in the Sheet, never on the PDF.

It hid because `buildPreviewPayload()` omitted it too, so the pre-file preview matched the
filed PDF perfectly — both equally missing it.

Fixed by adding `buildFinalSummary()` and wiring it into **both** payloads, plus a render
section in both copies of the card. Persistence needed no change, since `handleKpiFinalize`
spreads the request body into `detail`.

**Reviews filed before this ships cannot be backfilled** — those words were never
transmitted. If any KPI reviews were filed between end of July and now, their assessments
are gone and would have to be re-entered by hand.

### Deploy order when you ship it

1. `npm run deploy` (Worker, via wrangler).
2. Push static files to GitHub Pages — **include the new `draft.js`**.
3. Hard-refresh the forms.

Worker first, so there is no window where the form sends the assessment and the old worker
silently drops it from the PDF. If `draft.js` is missed in the push the forms degrade to old
behaviour rather than breaking, because every call is guarded with `window.DRAFT ? … : noop`.

---

## What the People System actually is

Four moving parts. **Only one of them is ClickUp.** This is the key thing to understand
before scoping a GoodDay migration.

```
Static forms (GitHub Pages)  →  Cloudflare Worker  →  Supabase (source of truth)
                                        ↓
                              ClickUp (tasks, DMs, PDF attachments)
                                        ↓
                              Google Sheet (mirror)
```

- **Forms** — `kpi_scorecard.html`, `peer_appraisal.html`, `pip.html`, `links_admin.html`,
  plus read-only `kpi_result_card.html` and `peer_growth_view.html`.
- **Worker** — 23 routes, PDF rendering via the Cloudflare browser binding (`MYBROWSER`).
- **Supabase** — `kpi_case`, `peer_response`, `peer_assignment`, `peer_rubric`, `pip_case`,
  `pip_rubric`, `clickup_map`.
- **ClickUp** — where a person *sees* the work: a task per cycle, a DM when something needs
  them, the result PDF attached, focus areas as subtasks.

A GoodDay migration replaces **only the fourth box**. The forms, Worker, Supabase and Sheet
all stay as they are. That is a much smaller job than "migrate the People System" — but it
touches a lot of call sites.

### The ClickUp surface to re-point

15 helper functions in `worker/index.js`, all hitting `https://api.clickup.com/api/v2/`
with `env.CLICKUP_TOKEN`.

| Function | Call sites | GoodDay equivalent needed |
|---|---|---|
| `clickupUpdateTask` | 9 | rename / describe / priority / dates |
| `clickupCreateTaskInList` | 8 | create task in project |
| `clickupSetStatus` | 7 | status change |
| `clickupResolveUserId` | 6 | name → user id |
| `clickupComment` | 5 | task comment |
| `clickupDeleteTask` | 5 | delete |
| `clickupAttachPdf` | 4 | **file attachment — verify GoodDay supports this** |
| `clickupAddTaskToList` / `clickupRemoveTaskFromList` | 2 / 2 | the To-do → KPI move; may have no equivalent |
| `clickupCreateFolder`, `clickupCreateList`, `clickupGetOrCreateFolder`, `clickupFindFolderByName`, `clickupListsInFolder`, `clickupListStatuses`, `clickupCreateTask` | provisioning | per-person structure |

Plus `clickup_map` in Supabase, which caches folder and list ids per roster person. That
table's shape is ClickUp-specific and needs a GoodDay analogue.

Env vars to replace: `CLICKUP_TOKEN`, `CLICKUP_LIST_ID`, `CLICKUP_SPACE_ID`.

### Worker routes — unchanged by a migration, listed for orientation

```
/config  /config/sync  /whoami  /selftest
/kpi/next-id  /kpi/open  /kpi/cases  /kpi/editor  /kpi/finalize  /kpi/create-link-task
/peer/rater-link  /peer/rater-links  /peer/assignments  /peer/my-assignments
/peer/create-assignment-task  /peer/aggregate  /peer/scorecard  /peer/scorecards  /submit/peer
/pip/next-id  /pip/open  /pip/cases  /pip/create-link-task
```

---

## The ClickUp automation layer being replaced

43 rules, built 2026-07-30, all active as of that date. Full recipes in
`CLICKUP_AUTOMATIONS.md`.

- **40 per-person**, across 10 editor folders in the `People Performance & Development` space:
  - `1.1` self-review opened → assign + DM the editor
  - `1.3` filed → DM the editor + comment on the task
  - `2.1`, `2.2` peer appraisal, on the person's lists
- **3 Space-level**, all DMing Rashy: `1.2` locked / awaiting supervisor, `3.1` PIP opened,
  `3.2` PIP closed.

**Caveat.** That state was verified end of July. It is now mid-September and nobody has
re-audited it. Treat the counts as a starting inventory, not current truth — open the Manage
list per folder before relying on it. The Project 2.0 audit in August found several rules
that looked fine in the summary list and were broken when opened individually.

### Why the per-person folder model exists

`Send direct message` in ClickUp has a **fixed recipient per rule**. It cannot resolve "the
assignee". So each rule's scope had to match its recipient, which forced one rule per person
per event — 40 rules instead of 4.

**This is the first thing to check in GoodDay.** Memory constraint #14 says GoodDay
notifications also cannot target the project owner, and offer only *Action required user,
Assigned to user, Current user* and named people. But **"Assigned to user" is exactly what
ClickUp lacked.** If a GoodDay notification can fire on a status change and go to the
assignee, 40 rules collapse to roughly 4 and the per-person folder structure stops being
necessary at all.

That one question decides whether this is a week of work or an afternoon. Answer it before
designing anything.

---

## Things proven in the ClickUp build that still apply

Carried over because they cost real time, and several have direct GoodDay parallels already
recorded in `goodday-phase1-scope`.

1. **No automation API.** ClickUp v2 has no automation endpoints, so all 43 rules were built
   by driving the UI. GoodDay appears to be the same. Budget for a manual rebuild either way.
2. **Never press Escape in an automation builder.** In ClickUp it closes the dialog and
   discards the rule. Memory constraint #16 says the same of GoodDay. Dismiss dropdowns by
   clicking empty modal space instead.
3. **Always read the existing rule list before building.** Two pre-existing rules from
   July 28 nearly became duplicates that would have DM'd people twice on every event.
4. **Search the action dropdown, never scroll it.** A mis-landed click created a "Do anything
   with AI" action that looked plausible in the summary list.
5. **Verify after every save.** ClickUp leaves the dialog open on success, so it reads as
   failure — and it does sometimes genuinely fail. Re-open the list and confirm.
6. **Hover the recipient avatar to confirm who it is** before saving. The picker clears
   itself on click surprisingly often.

---

## Open questions before you start

1. **Can a GoodDay notification target the assignee on a status change?** Decides the whole
   shape — see above.
2. **Can the GoodDay API attach a file to a task?** `clickupAttachPdf` has 4 call sites and
   the result PDF is the core artefact of both KPI and Peer. If not, the PDF needs another home.
3. **Is there a GoodDay equivalent of tasks-in-multiple-lists?** Used for the To-do → KPI move
   at filing. If not, the task simply stays put — cosmetic, not blocking.
4. **Per-person structure.** 10 folders × 4 lists in ClickUp. Does that become 10 GoodDay
   projects, or one project with a person field? Memory constraint #18 says a view can only
   group by *Assigned to* and *Action required* — a Users-type custom field is **not**
   groupable, which rules out one obvious design.
5. **Do the undeployed fixes ship before, during or after the migration?** Recommend before,
   so you are not migrating a system that is actively losing data.
6. **Does the People System move at all?** Running KPI/Peer/PIP on ClickUp while Production
   lives on GoodDay means paying for both. That may be the real driver — worth confirming with
   Joshua rather than assuming.

---

## Session log — what changed, in one place

**Session A, 2026-07-29/30 — built the ClickUp automations.**
Completed the ten `1.3` rules, repaired two pre-existing `1.3`s that were missing their
comment action, added the missing condition to Rafli's `1.1` and the missing action to Ifan's
`1.1`. Ended with all 43 matching spec. Wrote `CLICKUP_AUTOMATIONS.md` §J (tracker) and §K
(troubleshooting).

One finding worth keeping: **ClickUp's assignee picker lags on membership.** Ifan did not
resolve at folder scope on 29 July and did on 30 July with no sharing change in between. If
someone is missing from a picker, wait a day and re-check before changing anyone's access.

**Session B, same thread — two code fixes.**

- Supervisor written assessment was being dropped entirely. Fixed end to end, verified by
  rendering both copies of the card and asserting content, ordering, back-compat for
  already-filed cases, and escaping.
- Added `draft.js` so a refresh no longer costs a sitting. KPI (both stages) and Peer get a
  localStorage draft, keyed per case **and** per stage so two people on one machine cannot
  inherit each other's work. Restores are offered with a banner and a discard link, never
  applied silently, and clear on successful submit.
- **PIP deliberately did not get a draft.** It already persists to `/pip/:id/update` and reads
  back via `loadCase()`, so a local draft would race the server record and could replay an
  older sitting over a newer save. It got a `beforeunload` dirty-guard instead. This is written
  into `CLAUDE.md` §7 as a "do not do this" so it does not get "fixed" later.
