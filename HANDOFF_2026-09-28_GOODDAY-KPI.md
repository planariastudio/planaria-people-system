# Handoff: KPI → GoodDay verification, 28 Sep 2026 (evening, main PC)

Follows the supervisor-login and cutover handoffs. Read those first. Branch
`goodday-migration`, PR #3. Nothing here is deployed.

## What was proved live today

- **The GoodDay KPI filing path works end to end.** `node scripts/goodday_preflight.mjs --run`
  passed **7/7** against live GoodDay: auth + GET /users (13 accounts), create sub-project,
  create task with assignee + deadline, status + message in one call, custom-field write,
  PDF upload + attach to a comment, and 12 serial calls with no 429. The throwaway
  `ZZ PREFLIGHT` project it created was deleted afterwards (GoodDay has no project-delete
  API, so it was removed in the UI; `9ra7J9` now 404s).
- These are the exact endpoints `handleKpiFinalize` uses when `GOODDAY_ENABLED=1`.
  `renderPdf` (Cloudflare browser binding) cannot run in Node, so the PDF step was proved
  with a minimal PDF instead — the GoodDay upload/attach is what was in doubt, and it works.

## Editor name resolution — fixed one, one remains

Ran the real `goodDayResolveUserId` against every `/config` roster name:

- **Fixed in code:** "Eduardus Kent Sutanza" now resolves to the existing "Kent Sutanza"
  account (`Hi7M9e`) via a non-destructive alias in `worker/goodday.js` (commit 4ef0334).
  No live profile was renamed. Override at runtime with the `GOODDAY_NAME_ALIASES` secret
  (JSON) if an account is ever renamed.
- **Still unresolved — needs Joshua:** **Rafli Ibrahim** has no GoodDay account at all.
  Decide: invite him (then he resolves by name, no code change), or drop him from the
  active roster if he is no longer editing. Until then his tasks would file unassigned.
- "Test Josh" is a test roster entry with no account — ignore.
- 10 of 11 real editors resolve now.

## Still needs Joshua (secrets + deploy — cannot be done from here)

1. Rafli decision above.
2. In Cloudflare: `wrangler secret put GOODDAY_BOT_USER_ID` (value `tJJs1d`, already in
   `.dev.vars`; dashboard showed it missing). Then `GOODDAY_ENABLED` = `1` to cut over.
   Rollback is `GOODDAY_ENABLED` = `0`, instant, no redeploy.
3. Deploy the merged branch (PR #3) so the new resolver + selftest GoodDay block ship.
   Note: `tJJs1d` is both the bot user and Joshua's own account — every task will be
   attributed to Joshua, and GoodDay may suppress his self-notifications. Consider a
   dedicated "People System" GoodDay user before cutover.

## Two platform questions the preflight flags (need a human to eyeball once)

1. **Do API-driven status changes fire GoodDay automations?** Effectively yes — this
   session's job-board work (Production project) drove every status change via the API and
   the automation logs showed rules firing (guard + journey tests, 23/23 and 9/9), and
   commit 3ac0186 already recorded "automations fire on API-created tasks". Confirm once on
   a Performance Records rule (P1–P5) to be sure, since those are a different project.
2. **Does an assigned task reach a person's My Work without project membership?** Each
   editor has their own project under Performance Records, so this likely never bites, but
   have one editor confirm they see a filed KPI in My Work.

## Not done yet (post-cutover)

- Davin's Q3 KPI is still `finalized=false`; the ClickUp file step failed (task renamed
  "Filed ✓" but no PDF). Once GOODDAY_ENABLED is on, re-filing routes to GoodDay and should
  succeed. Rashy's scoring is backed up as `KPI Scorecard_Davin.md` (Downloads).
- Peer and PIP flows have not had a live GoodDay pass; only KPI's shared endpoints were
  exercised. They use the same helpers, so risk is low, but run one of each after cutover.
