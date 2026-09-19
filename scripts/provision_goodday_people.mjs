#!/usr/bin/env node
//
// Provision the per-person structure for the People System in GoodDay.
//
// Builds, under the People workspace:
//
//   People                       (GOODDAY_PEOPLE_ID, must already exist)
//     Performance Records         created if missing
//       <person>                 one project per roster entry
//       <person>
//       ...
//
// One project per person rather than a folder of four lists. That is what makes
// per-person access work: grant someone their project and they see their own
// record and nobody else's. It is also what makes the embedded KPI form safe,
// because the embed on their project carries their token and only they and the
// leads can open it.
//
// The roster is read from the LIVE worker config, not from a hardcoded list, so
// this cannot drift from what the forms use.
//
//   node scripts/provision_goodday_people.mjs --dry-run
//   node scripts/provision_goodday_people.mjs --apply
//
// Env:
//   GOODDAY_TOKEN         required   (never pass this on the command line)
//   GOODDAY_BOT_USER_ID   required
//   GOODDAY_PEOPLE_ID     required   the People workspace id
//   GOODDAY_PROJECT_TEMPLATE_ID  optional, passed straight through
//   WORKER_BASE           optional   defaults to the live worker
//
// Safe to re-run. Every create goes through goodDayGetOrCreateProject, which
// looks the name up under its parent first. GoodDay will happily create a second
// project with the same name, so a blind create is NOT idempotent -- that lookup
// is what stops a half-failed run leaving duplicates behind.

import { readFileSync, existsSync } from "node:fs";
import {
  goodDayGetOrCreateProject,
  goodDayFindProjectByName,
  goodDaySubProjects,
  goodDayEnvReport
} from "../worker/goodday.js";

const WORKER_BASE = process.env.WORKER_BASE
  || "https://planaria-people-worker.planariastudio.workers.dev";

const APPLY = process.argv.includes("--apply");
const DRY = !APPLY;

// .dev.vars is where these live, per .dev.vars.example: "the scripts in this repo
// read it too so there is one place to look". preflight, structure and smoke all
// did. This one read process.env alone, so it reported every variable missing on
// a machine that was correctly set up, right after preflight had passed on the
// same shell. Shell env still wins, for a one-off override.
function loadDevVars() {
  const out = {};
  if (!existsSync(".dev.vars")) return out;
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2] !== "") out[m[1]] = m[2].trim();
  }
  return out;
}

const env = { ...loadDevVars(), ...Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith("GOODDAY_") && process.env[k])
) };

function die(msg) {
  console.error("\n  " + msg + "\n");
  process.exit(1);
}

async function fetchRoster() {
  const res = await fetch(`${WORKER_BASE}/config`);
  if (!res.ok) die(`Could not read ${WORKER_BASE}/config (${res.status})`);
  const cfg = await res.json();
  const roster = Array.isArray(cfg.roster) ? cfg.roster : [];
  if (!roster.length) die("The live config returned an empty roster. Refusing to provision nothing.");
  return { roster, version: cfg.version };
}

// The roster's `name`, not its `id`. The id is a short slug ("Eduardus Kent",
// "Richo Darma") that exists to be a stable key, and naming projects after it
// meant the sidebar disagreed with the roster everywhere else in the system.
// The full name is what people are called in the forms, the PDFs and the Sheet,
// so it is what their project should say.
//
// Changing this renames what goodDayGetOrCreateProject looks up, so the existing
// short-named projects were renamed to match in the same change. If you ever
// change it again, rename the live projects too, or the next run creates a
// second set alongside the first rather than reusing them.
const projectNameFor = (p) => String(p.name || p.id || "").trim();

async function main() {
  console.log("\nGoodDay People provisioning");
  console.log("  mode        " + (DRY ? "DRY RUN (nothing will be created)" : "APPLY"));
  console.log("  worker      " + WORKER_BASE);

  const report = goodDayEnvReport(env);
  const missing = report.required.filter((r) => !r.present).map((r) => r.name);
  if (!env.GOODDAY_PEOPLE_ID) missing.push("GOODDAY_PEOPLE_ID");
  if (missing.length) {
    die("Missing env: " + missing.join(", ")
      + "\n  Set them in your shell for this run. Do not commit them."
      + "\n  The worker's own copy belongs in `wrangler secret put`.");
  }

  const { roster, version } = await fetchRoster();
  console.log("  roster      " + roster.length + " people (config " + version + ")");

  // Everyone in the roster gets a project, supervisors included. The filter that
  // used to skip them is gone, on its own instruction: "if that changes, drop this
  // filter rather than editing the roster."
  //
  // Two reasons it changed. The KPI rubric carries a fully written `supervisor`
  // column -- real targets, not placeholders -- so the instrument was always meant
  // to assess them; skipping them here was the outlier. And being in the roster
  // without a project is a silent hole: the case is created, the task has nowhere
  // to live, and nobody finds out until someone opens an empty record.
  //
  // Being scored and doing the scoring are separate things. Scoring rights come
  // from the `supervisors` list in Config_Lists, not from this level, so a
  // supervisor with a project of their own keeps every right they had.
  const people = roster;
  console.log("  provisioning " + people.length + " (everyone in the roster)");

  if (DRY) {
    console.log("\n  Would ensure:");
    console.log("    People (" + env.GOODDAY_PEOPLE_ID + ")");
    console.log("      Performance Records");
    for (const p of people) console.log("        " + projectNameFor(p) + "   [" + (p.level || "?") + "]");
    console.log("\n  Nothing was created. Re-run with --apply to make these.\n");
    return;
  }

  // --- Performance Records folder ------------------------------------------
  const team = await goodDayGetOrCreateProject(env, "Performance Records", env.GOODDAY_PEOPLE_ID);
  if (!team || !team.id) die("Could not create or find the Performance Records folder under People.");
  console.log("\n  Performance Records -> " + team.id);

  // --- one project per person ---------------------------------------------
  const existing = await goodDaySubProjects(env, team.id);
  const had = new Set(existing.map((p) => String(p.name).trim().toLowerCase()));

  let made = 0, reused = 0, failed = 0;
  for (const p of people) {
    const name = projectNameFor(p);
    if (!name) { console.log("    SKIP  roster row with no id or name"); failed++; continue; }
    try {
      const proj = await goodDayGetOrCreateProject(env, name, team.id);
      const wasThere = had.has(name.toLowerCase());
      if (wasThere) { reused++; console.log("    reuse " + name + "  -> " + proj.id); }
      else { made++; console.log("    NEW   " + name + "  -> " + proj.id); }
    } catch (e) {
      failed++;
      console.log("    FAIL  " + name + "  -> " + e.message);
    }
  }

  console.log("\n  created " + made + ", reused " + reused + ", failed " + failed);

  // Re-read and compare, rather than trusting the loop's own bookkeeping. This is
  // the check that catches a duplicate created by a racing or retried run.
  const after = await goodDaySubProjects(env, team.id);
  const counts = new Map();
  for (const p of after) {
    const k = String(p.name).trim().toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    console.log("\n  WARNING duplicate projects under Performance Records, delete the extras by hand:");
    for (const [name, n] of dupes) console.log("    " + name + " x" + n);
  } else {
    console.log("  verified  " + after.length + " projects under Performance Records, no duplicates");
  }

  console.log("\n  Next, by hand (there is no Views endpoint in the API):");
  console.log("    - add an Embed View on each person's project pointing at their KPI link");
  console.log("    - grant each person access to their own project only");
  console.log("    - check People stays on Project-based access, never All Projects\n");
}

main().catch((e) => die(e.stack || e.message));
