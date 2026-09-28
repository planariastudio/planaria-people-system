# Handoff: cutover session, 28 Sep 2026 (later)

**Supersedes** the RESUME HERE block of `HANDOFF_2026-09-28.md`. Everything else in
that file is still good. Read this first.

Interactive version of this, with tick boxes:
https://claude.ai/artifact/EHD81LGvrGJNFAcVp8NFyL

This session ran on the **ASUS machine** (`D:\Claude\planaria-people-system\...`),
which has no Node, no wrangler, and no `.dev.vars`. So nothing here was executed
against live infra except read-only HTTP and the Cloudflare/GoodDay web UIs. All
findings below were verified; none of the fixes were applied to production.

---

## Two corrections to the previous handoff

**1. Only ONE secret is missing, not three.** The Cloudflare dashboard on 28 Sep
shows **11** secrets, not 9:

```
CLICKUP_SPACE_ID   CONFIG_SYNC_TOKEN   GOODDAY_PEOPLE_ID   GOODDAY_TOKEN
CLICKUP_TOKEN      GOODDAY_ENABLED     GOODDAY_TEAM_ID     PEER_ADMIN_KEY
SHEET_WEBHOOK_URL  SUPABASE_SERVICE_KEY  SUPABASE_URL
```

`GOODDAY_PEOPLE_ID` and `GOODDAY_TEAM_ID` are already set. Only
`GOODDAY_BOT_USER_ID` is absent. `GOODDAY_ENABLED` still reads "Value encrypted"
in the dashboard too, so its value is still unconfirmed.

**2. "All 12 roster people are in GoodDay" is wrong.** See below. This is the
blocker, and it is new.

---

## THE BLOCKER: two editors resolve to nobody

Read from GoodDay Settings -> Company Users (13 accounts) and checked against the
live `GET /config` roster (12 entries) by hand-running `goodDayResolveUserId`:
exact email, then exact name, then a bidirectional prefix that must hit exactly
one user.

| Roster name (live /config) | GoodDay account | Result |
|---|---|---|
| Eduardus Kent Sutanza | `Kent Sutanza` | **NULL** — neither string is a prefix of the other |
| Rafli Ibrahim | *no account* | **NULL** — never invited |
| Joshua Ervin Novaldi | `Joshua Ervin` | ok, prefix (want starts with have) |
| Ifan Ahmad | `Ifan Ahmad Maulana` | ok, prefix (have starts with want) |
| Michelle Firdaus | `Michelle Firdaus` | ok, exact |
| Davin Edbert | `Davin Edbert` | ok, exact |
| Evander Arther Lesnussa | `Evander Arther Lesnussa` | ok, exact |
| Fitra Pratama | `Fitra Pratama` | ok, exact |
| Nabil Fadillah Adipraja | `Nabil Fadillah Adipraja` | ok, exact |
| Reza Ali Akbar | `Reza Ali Akbar` | ok, exact |
| Richo Darma Agi | `Richo Darma Agi` | ok, exact |
| Test Josh | *no account* | test entry, ignore |

A NULL means the task is created **unassigned** and nobody is notified. It does
not throw. This is exactly the "assignee alias gap" CLAUDE.md lists as an open
item needing a real editor to confirm — now confirmed, with two.

**Fix before flipping:** rename the GoodDay user `Kent Sutanza` to
`Eduardus Kent Sutanza`, and invite `Rafli Ibrahim`. Then re-run
`npm run provision -- --apply` (idempotent; creates only Rafli's project).

Rename in GoodDay rather than editing the Sheet: the roster *name* is what KPI,
Peer and PIP all pass to the resolver, and it is already stored in filed rows.

Caveat: the GoodDay column was read off a screenshot, not the API. Confirm with
`node scripts/goodday_preflight.mjs --whoami` before acting.

---

## Correction: "Rashy" was never broken

An earlier claim in this session — that `supervisors = ["Joshua","Rashy"]` would
half-fail — was **wrong**. GoodDay's display names are exactly `Rashy` and
`Julius` (not `Rashy Azhardwian` / `Julius Pandu`, which appear only in
`CLICKUP_AUTOMATIONS.md`). So `"Rashy"` hits the exact-name branch and `"Joshua"`
resolves by prefix. The live list works today.

Still worth editing, to add Julius and stop relying on the prefix fallback.
Sheet tab `Config_Lists`, row `supervisors`:

```
["Joshua Ervin","Rashy","Julius"]
```

Then Sheet -> custom menu -> Sync to Worker. Note this branch's offline fallbacks
in `pip.html` / `kpi_scorecard.html` say `Rashy Azhardwian` / `Julius Pandu`;
those still resolve by prefix, and the Sheet value is what is actually used.

GoodDay also holds `Maura Carla` as a Manager, not in the roster and not in the
supervisors list.

---

## What is on this branch

`claude/goodday-embed-and-fixes`, branched from `d172f80`. Never run through
`npm run check` or the tests — the machine it was written on has no Node. **Open
a PR so CI gates it**; a branch push alone runs nothing (`ci.yml` triggers on
`pull_request` and pushes to `main`).

1. `links_admin.html` — the key gate used `window.prompt()`, which Chrome blocks
   inside a cross-origin iframe. As a GoodDay Embed View no dialog appeared, KEY
   stayed empty, every `api()` call 401'd. Replaced with an in-page form; the
   three callers were all already `async` so each took one `await`.
2. `pip.html` — `syncMgr()` ran before the checkboxes were ticked, wiping the
   restored list; reopening a saved PIP lost its managers. Lines swapped. This
   was broken on ClickUp too.
3. `worker/index.js` — `handleSelfTest` never looked at a single `GOODDAY_*`
   variable. Added a block that reads live `GD_ON(env)`, hard-fails the half-live
   state, and names what is missing otherwise.
4. Supervisor fallbacks in both forms now carry full names.

---

## Remaining steps, in order

1. `node scripts/goodday_preflight.mjs --whoami` — confirm names + bot id.
2. Fix the two editors above. **Blocks the flip.**
3. Push this branch **from the ASUS machine** — commit `a9841fc` exists only
   there and was never pushed, so no other machine can fetch it. Automated shells
   there could not push (no stored credential, terminal prompts disabled). Then
   PR, CI, merge.
4. `npx wrangler secret put GOODDAY_BOT_USER_ID` (value in `.dev.vars`), then
   `npx wrangler secret list` — expect 12.
5. `npx wrangler secret put GOODDAY_ENABLED` — `1`.
6. File one real KPI case; confirm the assignee is notified.

Rollback: set `GOODDAY_ENABLED` to `0`. Instant, no redeploy.

---

## Also verified

- Runtime config matches `wrangler.toml` exactly: compatibility date
  `2026-07-09`, `nodejs_compat`, `MYBROWSER` Browser Run binding. A real
  `wrangler deploy` will not roll the runtime back or drop PDF rendering.
- GitHub Pages serves `links_admin.html` with **no** `X-Frame-Options` and no CSP
  `frame-ancestors`, so GoodDay can frame it. The iframe was never the problem.
- GoodDay API v2 has **no Views endpoint group** (checked against their docs: 16
  groups — Projects, Tasks, Expenses, Events, Documents, Users, Time Reports,
  Attendance, Snapshots, Custom Fields, Dependencies, CRM, Attachments, System,
  Webhooks, Api Connection). Embed Views stay click-work, as
  `provision_goodday_people.mjs:180` already said.

## Before building the Embed View, decide one thing

`links_admin.html` needs `PEER_ADMIN_KEY`, which opens `/peer/rater-links` and
returns every person's `peer_token`. Tokens are identities: whoever holds them
can map any peer appraisal back to its author, and peer appraisal is promised to
the team as anonymous and pooled. Giving Rashy the embed gives Rashy that key,
resident on their machine. That is an access decision, not a convenience one.
