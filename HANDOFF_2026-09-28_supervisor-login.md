# Handoff, 28 Sep 2026: supervisor login (main PC)

**Two sessions worked on this repo on 28 Sep, on two machines, without seeing each other.**
- Main PC (this file): supervisor login, branch `goodday-migration`, uncommitted.
- ASUS laptop: GoodDay cutover checks, `links_admin` key form, selftest GoodDay block.
  Merged to origin/main as PR #1 and #2 (incl. its own `HANDOFF_2026-09-28.md` and
  `goodday_migration_runbook.html`); fix branch `claude/goodday-embed-and-fixes`
  (commit a9841fc) is still ONLY on the laptop until pushed from there.
**MERGED 28 Sep, evening (main PC):** `goodday-migration` now contains origin/main
(d172f80) and `claude/goodday-embed-and-fixes` (ff26c4e). One conflict, links_admin.html,
resolved by taking the laptop's embed-safe key form whole. After the merge: `npm run check`
passes, `npm test` 89/89, 22/22 route checks against the real Worker. Not pushed. Next:
push the branch and open a PR so CI runs, then the deploy steps below. Read the laptop's
`HANDOFF_2026-09-28.md` and its cutover page too: it found that "Eduardus Kent Sutanza"
(roster) vs "Kent Sutanza" (GoodDay) and Rafli Ibrahim (no GoodDay account) would file
unassigned, and that only GOODDAY_BOT_USER_ID is missing from the Worker secrets.

Written at the end of a long session that ran from the Planaria Plugin folder.
Read this, then CLAUDE.md. Nothing below is committed or deployed yet.

## Where the code is

- Branch **`goodday-migration`**, created from `reconcile-staging` (local commits fb3f47b,
  754095c; origin/main has since moved to d172f80, see above). Uncommitted changes on it:
  `worker/auth.js` (new), `tests/auth.test.mjs` (new), `worker/index.js`,
  `kpi_scorecard.html`, `kpi_result_card.html`, `pip.html`, `system_check.html`.
- `npm test` 89/89 (81 existing + 8 new), `npm run check` all pass.
- Line endings: the repo stores LF and `core.autocrlf=true`. Write files with LF or
  `git diff --stat` explodes (it did once on worker/index.js, fixed).

## Why: the system had no real supervisor security (found 28 Sep)

- The supervisor password was a constant in `kpi_scorecard.html` (public page source).
  Treat the current value as public. Do not repeat it anywhere.
- `?kpi=<id>` links skipped the password screen entirely.
- `GET /kpi/:id`, `/kpi/open`, `/kpi/next-id`, `POST /kpi/editor`, `POST /kpi/finalize`,
  `GET /pip/:id`, `/pip/open`, `/pip/next-id`, `POST /pip/:id/update` answered anyone.
  Case ids are guessable (KPI-2026-Q3-<Name>-01). PIPs could be overwritten.
- `pip.html` had no gate at all.
- Code comments say `PEER_ADMIN_KEY` once had a value that was published in the pages,
  so it must be rotated too (the new check accepts it as a supervisor credential).

## What was built

- `worker/auth.js`: pure rules. `x-spv-key` header checked against new secret
  **`SPV_KEY`** (admin key also accepted); `x-editor-token` (roster.peer_token) opens
  only that editor's own case. Fails closed when no secret is set.
- Worker: `GET /spv/check`; gates on every route above; CORS allows the two headers;
  `SPV_KEY` added to `/selftest` required secrets.
- `kpi_scorecard.html`: server-checked password screen, key kept in sessionStorage
  (`kpiSpvKey`) for the tab; case links gated; every `/kpi/` call via `authFetch`;
  editor token sent from `?e=`.
- `kpi_result_card.html`: sends supervisor key or `?e=` token; shows "private" on 401.
- `pip.html`: new password overlay; every `/pip/` call waits for it (`pipFetch`).
- `system_check.html`: sends the admin key as `x-spv-key` too.

Verified: real `worker/index.js` loaded in Node with a fake Supabase, 22/22 route
checks; pages served locally against that worker, all flows correct (harness lived in
the old session's scratchpad, not in this repo).

## Deploy steps (Joshua does these; secrets and deploys are his)

Only AFTER Rashy has filed Davin's Q3 KPI (KPI-2026-Q3-Davin-Edbert-01, locked by Davin
30 Jul, waiting for supervisor; ClickUp task 86eyfdd8t exists, so filing works).

1. `npx wrangler secret put SPV_KEY` (a NEW password)
2. `npx wrangler secret put PEER_ADMIN_KEY` (a NEW admin key)
3. `npm run deploy`
4. Commit + push the pages to GitHub Pages immediately after (supervisor form is broken
   between 3 and 4). Ask Joshua before committing or pushing.
5. Joshua tells Rashy and other supervisors the new password.

## Then: the GoodDay switch

Already built (commit 2e935ed): `GOODDAY_ENABLED=1` routes every task operation through
`worker/goodday.js` + `goodday_bridge.js`. GoodDay side exists (Performance Records
folder, one project per person, KPI/Peer/PIP task types and statuses, rules P1-P5; see
GOODDAY_AUTOMATIONS.md). Remaining:
- Secrets: `GOODDAY_TOKEN`, `GOODDAY_BOT_USER_ID` (suggest a dedicated "People System"
  GoodDay user), optionally `GOODDAY_TEAM_ID`. Joshua sets them; never ask him to paste
  a token into chat.
- Plan: file open Q3 cases in ClickUp, flip the flag for Q4 (quarter starts 1 Oct),
  then copy Davin's filed Q3 result + PDF into his GoodDay project as the first record.
- Afterwards: links_admin "Add task in ClickUp" wording, supervisor/editor guide
  updates, retire the ClickUp People space after one clean quarter.

## Open decisions Joshua already made elsewhere

- Monthly attendance summary on the 25th: parked.
- GoodDay job board (not this repo) is finished and tested; unrelated to this work.
