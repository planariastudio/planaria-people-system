# Handoff: People System to GoodDay

**Repo this describes** `C:\Users\joshu\planaria-people-system`.
Not `C:\Claude\Planaria Plugin`, which holds the GoodDay guides.

**Last updated** 2026-09-19.
**Branch** `reconcile-staging`.

Read the CURRENT STATE section, then go to whichever section your task needs. Everything
below the session log is reference material that has not changed in a while.

---

## CURRENT STATE

The Worker can file to GoodDay instead of ClickUp. It is **deployed** as of 19 September 2026,
pushed to `main`, and the switch is **off**, so every task operation still goes to ClickUp.

Flipping `GOODDAY_ENABLED` is still gated on invites, not on code. See "Before flipping the
flag" below, which has not changed.

### The switch

One secret: `GOODDAY_ENABLED`.

- Unset or `0`, every task operation goes to ClickUp exactly as it always has.
- Set to `1`, they all go to GoodDay. Same call sites, same behaviour, different destination.
- Unsetting it rolls back without a redeploy. That is the whole reason it is a flag.

It is wired **inside the `clickup*` helper functions** in `worker/index.js`, not at the ~49
places that call them. Those call sites hold behaviour that was expensive to get right: which
list a KPI prompt lands in and why, the task-name suffix that stays readable when a status
lookup misses, the best-effort saves that must never break a filing. Rewriting them puts all
of that back in play. Rewriting the six helpers underneath them puts none of it in play.

159 lines added to `worker/index.js`, nothing removed, all of it behind `GD_ON(env)`.

### Where the new code lives

| File | What it is |
|---|---|
| `worker/goodday.js` | The GoodDay API layer. Mirrors each `clickup*` helper with the same error contract. Native GoodDay shapes only. |
| `worker/goodday_bridge.js` | Pure ClickUp to GoodDay translation. No network, no env, no state. Its own file so it can be unit tested, since `worker/index.js` is an 826KB bundle no test can import. |
| `tests/goodday-bridge.test.mjs` | 16 tests on the translation. |
| `tests/goodday-helpers.test.mjs` | Tests on the API layer, with fetch injected. |
| `scripts/goodday_bridge_smoke.mjs` | `npm run smoke`. Runs the real KPI sequence against the LIVE API and reads back what was stored. |
| `scripts/goodday_preflight.mjs` | `npm run preflight`. API reachability checks. |
| `scripts/goodday_structure.mjs` | `npm run structure`. Builds the workspace folder structure from a spec. |
| `scripts/provision_goodday_people.mjs` | `npm run provision`. One project per roster person. |
| `GOODDAY_AUTOMATIONS.md` | The 5-rule runbook. There is no automation API, so these are built by hand. |

### Deploy state

`wrangler login` is done, as the Planaria admin account. Run `npx wrangler whoami`
to see which login and account id are active. (Not written down here: this repo is
public, and whoever picks this up has dashboard access anyway.)

The live worker `planaria-people-worker` was deployed **19 September 2026** with
`npm run deploy`, and `main` now matches. The month of accumulated work that used to sit
ahead of production has shipped.

**Anything the worker reads from `env` must be a secret or declared in `[vars]`.** There is no
third option that survives a deploy. `wrangler secret list` is the authority on which is
which; the comments are not, and were wrong until today. `SUPABASE_URL` and
`CLICKUP_SPACE_ID` are secrets now. See the outage below for what happens otherwise.

Verified before deploying:

- Dry run bundles clean at 804 KiB, 160 KiB gzipped. The new imports build fine under Wrangler.
- Bindings: `MYBROWSER` only, matching what is live. PDF rendering keeps working.
- The forms call `https://planaria-people-worker.planariastudio.workers.dev`. That was
  surviving on a Wrangler default, so `workers_dev = true` is now declared explicitly in
  `wrangler.toml`. A deploy replaces settings, and a setting that lives on a default is one
  nobody notices when the default changes.
- Secrets are not touched by a deploy, so `GOODDAY_ENABLED` stays unset through it.

**That list had a hole in it, and the deploy on 2026-09-19 fell straight through it.**

Secrets survive a deploy. **Plaintext environment variables do not.** `wrangler deploy`
replaces the worker's variables with whatever `wrangler.toml` declares, and it declared none.
`SUPABASE_URL` and `CLICKUP_SPACE_ID` were dashboard variables, not secrets, despite a comment
in `wrangler.toml` saying otherwise. Both were wiped.

`SUPABASE_URL` going undefined turned every Supabase call into
`Invalid URL: undefined/rest/v1/...`. `/config` is the route every form calls on load, so KPI,
Peer, PIP and the admin portal were all down until the two values were re-set as secrets.

Recovered from Cloudflare's own version history, which keeps the bindings of every past
version:

```
npx wrangler versions view 26224d88-700d-4ecf-8e21-03ab7fd3f37d
```

That is the last known-good version, 2026-08-11. Use the same trick if it happens again
rather than hunting through dashboards.

**Before any future deploy, check that every `env.X` the worker reads is either a secret or
declared in `[vars]`.** `wrangler secret list` is the authority on which is which, not the
comments. The comment block in `wrangler.toml` is now correct and explains why.

To ship:

```
npm run deploy
```

That runs the syntax gate and all 72 tests first (`predeploy`), then uploads.

### Before flipping the flag

**Invites are the real blocker, not code.** `goodDayResolveUserId` matches on name and
returns null for anyone without a GoodDay account. Ten roster people have none. Their tasks
would be created unassigned, which means nobody is told to fill anything in, which is the
entire point of the system.

Order that works:

1. Deploy with the flag off. Confirm nothing changed.
2. Invite the editors to GoodDay.
3. Run `npm run provision` so every person has a project under People > Team.
4. Set `GOODDAY_TOKEN`, `GOODDAY_BOT_USER_ID`, `GOODDAY_TEAM_ID` as secrets.
5. Run `npm run smoke` against a real person.
6. Only then set `GOODDAY_ENABLED=1`.

### The one behaviour change to warn people about

A GoodDay task's description is its **first message**, not a field, and no API can edit it.
Filing used to overwrite the ClickUp task body with the result. Now the result is appended
below the original prompt. Tasks read as a history rather than a final state.

Arguably better, but different, and not something anyone should discover by accident. Both
guide sites still describe the ClickUp behaviour.

---

## Four things the live GoodDay API does that its docs do not say

Each of these was found by reading back what was actually stored. **A 200 from this API
proves nothing.** That is why `npm run smoke` exists and why it should be run after any
GoodDay change.

1. **A description cannot be updated.** Sending `message` to `PUT /task/:id/update` returns
   `200 "OK"` and changes nothing. No endpoint edits an existing message: `PUT` on
   `/task/:id/message/:id`, `/task/:id/messages/:id` and `/message/:id` are all 404. This one
   mattered most, because without catching it every filed scorecard would have gone on
   telling its owner to fill it in.
2. **Reads use different field names than writes.** `POST /tasks` takes `title`, `taskTypeId`
   and `toUserId`. `GET /task/:id` returns them as `name`, `taskType.id` and
   `assignedToUserId`. Any check that assumes the write shape comes back is verifying nothing.
3. **`startDate` is silently dropped unless `endDate` travels with it.** Not with `deadline`,
   with `endDate` specifically. So a date range sends the due date as both `endDate` and
   `deadline`.
4. **Status ids are accepted on any task without checking the project uses them.** Setting
   `HIRED` on a KPI task returns 200 and sticks. The substring match was scanning an org-wide
   list of 53 statuses in API order, so it now takes an exact match first and the shortest
   containing name otherwise.

Carried from earlier sessions, still true:

- Task status is `PUT /task/:id/status`, not `POST`. The docs say POST. POST returns 405.
- Comment attachments must be **objects**, not bare file id strings. Bare ids return a 400
  reading "dictionary update sequence element #0 has length 1; 2 is required".
- Descriptions and comments are **plain text**. Markdown renders literally, HTML shows as
  source, `messageRTF` 400s. Only a bare URL is auto-linked. `gdText()` flattens markdown for
  this reason, turning `[label](url)` into `label: url`, because the personal link IS the
  delivery mechanism and a markdown link renders as unclickable punctuation.
- `actionRequiredUserId` is readable but not writable directly. An automation sets it.
- Automations DO fire on API-driven status changes, in about three seconds.
- No API exists for: creating workspaces, statuses (`POST /statuses` is 405), task types
  (405), deleting projects (405), or views.

---

## How the two systems differ in shape

Two things needed real translation rather than a rename. Both live in `worker/goodday_bridge.js`.

**Containers.** ClickUp gave each person a Folder holding four Lists (KPI, Peer, PIP, To-do)
and every call site addressed one by list id. GoodDay gives each person **one project** and
tells KPI / Peer / PIP apart by **task type**. So `resolveEditorList` returns
`gd:<projectId>:<type>` instead of a bare id, and the helpers unpack it. The prefix is
deliberate: a bare GoodDay project id is indistinguishable from a ClickUp list id, and
anything handed a real ClickUp list id while the flag is on throws by name rather than
quietly filing to nowhere.

`type === "todo"` returns null on purpose. My Work is native in GoodDay: an assigned task is
already in the person's list, so the To-do list that existed only to make ClickUp behave that
way has no counterpart. Every call site reads `todoListId || <other>`, so null routes them to
the person's project, which is correct.

**Fields.** GoodDay answers 200 to field names it does not recognise and changes nothing, so
every field is mapped explicitly and unmapped keys are dropped on purpose. `tags` is dropped
because GoodDay has none, and the job tags were doing (marking a task KPI / Peer / PIP) is
done better by the task type.

Task type ids, live: `GA1PXC` KPI Scorecard, `6ImHbH` Peer Appraisal, `iyETVe` PIP. The
bridge resolves them by name with a per-isolate cache, so a rename does not break it.

GoodDay ids in use: People workspace `6kRwYR`, **Performance Records** `JORtmi` (renamed
from "Team" on 2026-09-19), Hiring `r7sNsK`, Leadership `tL8QO9`, Workbench `P1jWSq`,
Business `A9VqHe`, People System Admin `ZsX0ML`.

### The admin portal is embedded in GoodDay

`Leadership > People System Admin > Admin portal`, at
`https://www.goodday.work/p/ZsX0ML/embed/4wpf`. A Link/Embed View pointing at
`links_admin.html` on Pages, so the leads reach it from inside GoodDay rather than a
bookmark. Access is "Public", which here means everyone with access to that project, and
Leadership has three users. There is no Views API, so it was built in the UI.

**Before widening access to it any further, read this.** `links_admin.html` carries its
admin key in the page source:

```
const KEY='Planaria-admin'
```

and that page is served publicly from GitHub Pages (HTTP 200, no auth) out of a **public**
repo, so the key is readable at `raw.githubusercontent.com` too. `CLAUDE.md` records this
as a deliberate speed bump whose real protection is that the URL is unlisted. That premise
no longer holds: a public repo lists it.

What it opens is not cosmetic. `/peer/rater-links` returns every person's `peer_token`, and
those tokens are identity, so holding one lets someone open that person's KPI form or
submit peer ratings as them. Roster edits and case deletes are behind the same key.

The embed does not make this worse, it is equally exposed today. The smallest real fix is
to have the page prompt for the key once and keep it in `localStorage`, then rotate
`PEER_ADMIN_KEY`. That takes the secret out of a public file without changing the Worker's
auth model or breaking Pages.

---

## What the People System actually is

Four moving parts. **Only one of them is ClickUp.**

```
Static forms (GitHub Pages)  ->  Cloudflare Worker  ->  Supabase (source of truth)
                                        |
                                 ClickUp or GoodDay (tasks, notifications, PDFs)
                                        |
                                 Google Sheet (mirror)
```

- **Forms** `kpi_scorecard.html`, `peer_appraisal.html`, `pip.html`, `links_admin.html`, plus
  read-only `kpi_result_card.html` and `peer_growth_view.html`.
- **Worker** 23 routes, PDF rendering via the Cloudflare browser binding (`MYBROWSER`).
- **Supabase** `kpi_case`, `peer_response`, `peer_assignment`, `peer_rubric`, `pip_case`,
  `pip_rubric`, `clickup_map`.
- **Task tool** where a person SEES the work: a task per cycle, a notification when something
  needs them, the result PDF attached, focus areas as subtasks.

The migration replaces only the third box. Forms, Worker, Supabase and Sheet all stay.

The forms no longer name ClickUp anywhere a person can read. Buttons say `File result`,
`File this verdict`, `Check your task list`, `Add task`. Code comments still name ClickUp
where they explain why a past decision was made, because those are true statements about
history.

### Worker routes, unchanged by the migration

```
/config  /config/sync  /whoami  /selftest
/kpi/next-id  /kpi/open  /kpi/cases  /kpi/editor  /kpi/finalize  /kpi/create-link-task
/peer/rater-link  /peer/rater-links  /peer/assignments  /peer/my-assignments
/peer/create-assignment-task  /peer/aggregate  /peer/scorecard  /peer/scorecards  /submit/peer
/pip/next-id  /pip/open  /pip/cases  /pip/create-link-task
```

---

## Questions this migration has now answered

The previous version of this file listed these as open. They are settled.

1. **Can a notification target the assignee on a status change?** Yes. This is the big win.
   ClickUp's `Send direct message` had a fixed recipient per rule, which forced one rule per
   person per event, 40 rules instead of 4. GoodDay resolves the assignee, so the per-person
   folder model is no longer forced by the notification system. Five rules replace forty.
2. **Can the API attach a file to a task?** Yes, proven live. Two steps: ask for an upload
   slot, PUT the bytes. The result must then be referenced as an object on a comment.
   `npm run smoke` uploads a real PDF and confirms it is ON the task, not merely uploaded.
3. **Is there an equivalent of tasks-in-multiple-lists?** Not needed. My Work is native, so
   the To-do mirror has nothing to correspond to.
4. **One project per person, or one project with a person field?** One project per person,
   under People > Team. A Users-type custom field is not groupable in GoodDay views, which
   ruled out the alternative.

Still open:

- **Do supervisors get KPIs and their own per-person projects?** Unanswered.
- **Does `clickup_map` need a GoodDay analogue?** Currently bypassed: the bridge uses a
  per-isolate cache and resolves projects by name each cold start. Fine at this size, but it
  is one extra API call per cold worker.
- **Both guide sites still describe ClickUp.** They need rewriting for GoodDay wording, My
  Work rather than To-do list, and the history-not-overwrite change above.

---

## Things proven the hard way, still true

1. **No automation API**, in either tool. All rules are built by driving the UI.
2. **Never press Escape in an automation builder.** It discards the rule. Dismiss dropdowns
   by clicking empty modal space.
3. **Screenshot between stages when building a rule.** Blind-chaining builder steps discarded
   a rule silently.
4. **Read the existing rule list before building.** Two pre-existing rules nearly became
   duplicates that would have messaged people twice on every event.
5. **Search the action dropdown, never scroll it.** A mis-landed click created a "Do anything
   with AI" action that looked plausible in the summary list.
6. **Verify after every save.** The dialog staying open reads as failure and sometimes is one.
7. **Creating a GoodDay workspace requires an icon.** "Create empty space" fails silently with
   a name alone, and the error only appears after submit.
8. **GoodDay rename dialogs use a Save button.** Enter does not commit. Sidebar project
   renames are inline and Enter DOES commit. They differ.
9. **Converting a GoodDay project that holds tasks destroys them.** Conversion is one way.
10. **Never edit or delete org-shared statuses.** Other projects use them. Always create new.

---

## Standing rules for whoever picks this up

- **Never enter GoodDay credentials.** Signing in is Joshua's to do.
- **Never paste an API token into chat, a commit, or a file.** `.dev.vars` is gitignored and
  Joshua fills it himself. A token that has been pasted anywhere should be Reset.
- **Never invite users without explicit permission.**
- **ClickUp's `Staff Hub > Accounts` list holds plaintext passwords, and the Staff Database
  holds KTP national ID numbers, dates of birth and home addresses.** Do not copy, reproduce
  or migrate any of it.
- **Do not send emails.** Draft only. No Zapier.
- **Public guides carry no client names and no staff names**, except Julius and Rashy where
  the process requires them.
- **No em dashes**, in files or in chat.

---

## Session log

**2026-09-19, later. Shipped it, and broke production twice on the way.**

Both outages were self-inflicted and both are worth knowing about, because the mechanisms
are still there.

**One: a deploy wiped the environment variables.** `wrangler deploy` replaces the worker's
config with what `wrangler.toml` declares, and it declared no `[vars]`. `SUPABASE_URL` and
`CLICKUP_SPACE_ID` were dashboard variables, not secrets, despite a comment here saying
otherwise. Both vanished, every Supabase call became `Invalid URL: undefined/rest/v1/...`,
and `/config` died, which takes every form with it. Recovered by reading the old values out
of Cloudflare's version history, which keeps the bindings of every past version:

```
npx wrangler versions view 26224d88-700d-4ecf-8e21-03ab7fd3f37d
```

Both are secrets now, so a deploy cannot reach them.

**Two: a config sync emptied the roster table.** `sbReplaceAll` deletes every row and then
inserts, in two separate calls with nothing transactional between them. A change to preserve
`peer_token` across syncs added that key only to people who already had one, so the batch
held two object shapes, and PostgREST refuses those whole with `PGRST102 "All object keys
must match"`. The delete had already run. Roster: empty.

Fixed at both levels: the key is always present and null when absent, and `sbReplaceAll` now
squares ragged rows against the union of their keys **before** deleting, so a caller's
mistake costs an error instead of a table.

**The peer tokens did not survive it.** They were the thing the change existed to protect.
Every `?e=` and `?t=` link already sitting in a task description is dead, and the replacements
are different tokens, so the links have to be re-issued from `links_admin.html`. Preservation
works correctly from here.

**Also fixed, and the reason the sync could run at all:** `Config_Levels` had `Senior`, `Jr`,
`Associate` in its key column where everything else uses `senior`, `jr`, `assoc`. The
validator took its vocabulary from that tab, so every roster row reported an invalid level,
and because `LEVEL_LABELS` is rebuilt from the same column, every row of all three rubrics
reported "no bullet text in ANY level column" while the bullets sat right there. Thirty-plus
errors, none of them true, from one cosmetic cell in a tab nothing reads.

`scripts/config_editor_Code.gs` now normalises instead of refusing: casing and the usual
aliases resolve to the canonical key, validation checks `LEVEL_KEYS` rather than the
spreadsheet, and `readRubric_` finds a level column by label, then key, then any header that
names that level however it is spelled. It normalises on the way out too, so the live
`levels` table repaired itself on the next sync. Both `.gs` files are in the syntax gate now;
they never were, and a broken one silently kills the whole Planaria menu.

**Lesson worth keeping.** Both outages came from shipping a change to a destructive path
without being able to exercise it first. The order should have been: make `sbReplaceAll`
safe, then add token preservation on top. Doing it the other way round is what turned a
six-line improvement into an outage.

**2026-09-19, earlier. Built the GoodDay dispatch layer.**

Joshua's report was that the form still said "File to ClickUp" and still went through
ClickUp. Both halves were true and both are fixed.

First the wording, so labels say what happens rather than where it lands and never need
re-editing again. Then the backend, as described in CURRENT STATE.

Written, then corrected by testing: the first live smoke run failed five checks. Three were
my assertions reading fields that do not exist on a read (`title`, `taskTypeId`, `toUserId`),
which meant they were verifying nothing. The other two were real and are items 1 and 4 in the
API section above. Worth remembering that the unit tests passed the whole time.

Commits: `cbf88b5` wording, `2e935ed` the dispatch layer, `a60b3fd` live proof of the PDF
attachment path. 72 tests green. Nothing pushed.

**Earlier sessions, condensed.**

- Built the ClickUp automations, 43 rules, end of July. Full recipes in
  `CLICKUP_AUTOMATIONS.md`. Being replaced by the 5 GoodDay rules in `GOODDAY_AUTOMATIONS.md`.
- Fixed the supervisor written assessment being dropped entirely from the filing payload.
  Supervisors typed three mandatory paragraphs per review and the data was discarded. It hid
  because the preview omitted it too, so preview and PDF matched perfectly, both equally
  missing it. **Reviews filed before that fix shipped cannot be backfilled.**
- Added `draft.js` so a refresh no longer costs a sitting. PIP deliberately did not get one:
  it already persists server-side, so a local draft could replay an older sitting over a newer
  save. It got a `beforeunload` guard instead. This is written into `CLAUDE.md` §7 as a "do
  not do this" so it does not get "fixed" later.
- **A correction worth keeping.** An earlier session claimed nothing was deployed and the
  system was losing data, based on local `git log` alone. Joshua asked whether Supabase,
  Cloudflare and GitHub had been checked. They had not. `origin/main` was 14 commits ahead,
  the static half had been live since August, and the supervisor assessment was being stored.
  Check the live systems before describing them.

---

## Suggested read order for a fresh chat

1. This file.
2. `CLAUDE.md` in this repo, the People System architecture. §2 (Model A), §6 (routes), §9 (flows).
3. `GOODDAY_AUTOMATIONS.md`, the 5 rules and the 9 traps.
4. Memory `goodday-phase1-scope`, CURRENT STATE section first.
5. `worker/goodday_bridge.js`, which is short and explains the two shape differences in its
   own comments.
