#!/usr/bin/env node
//
// Preflight for the GoodDay migration.
//
// Runs the seven checks the migration assessment says must pass before any code
// depends on them. Every endpoint in worker/goodday.js came from GoodDay's
// published docs and has never actually been called; this is what turns that
// from a plan into a test report.
//
//   node scripts/goodday_preflight.mjs --whoami    list users, find your bot id
//   node scripts/goodday_preflight.mjs             show what it would do
//   node scripts/goodday_preflight.mjs --run       actually run the checks
//
// Reads `.dev.vars` (gitignored). Secrets are never printed, only whether they
// are present.
//
// SAFETY
//   --run creates real things in the live GoodDay: one project and one task,
//   both named `ZZ PREFLIGHT <timestamp>` so they are unmistakable. It deletes
//   the task afterwards, and tells you plainly about anything it could not clean
//   up rather than pretending it did. It never touches an existing project, and
//   it never converts anything.

import { readFileSync, existsSync } from "node:fs";
import {
  goodDayResolveUserId,
  goodDayCreateTask,
  goodDayDeleteTask,
  goodDayComment,
  goodDayListStatuses,
  goodDaySetStatus,
  goodDayUploadFile,
  goodDayAttachPdf,
  goodDayCreateProject,
  goodDayListProjects,
  goodDaySetCustomFields,
  goodDayListCustomFields,
  goodDayEnvReport,
  GD_BASE
} from "../worker/goodday.js";

const RUN = process.argv.includes("--run");
const WHOAMI = process.argv.includes("--whoami");

// --- env -------------------------------------------------------------------

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
  Object.entries(process.env).filter(([k]) => k.startsWith("GOODDAY_"))
) };

const results = [];
const pass = (n, detail) => { results.push({ n, ok: true, detail }); console.log("  PASS  " + n + (detail ? "  " + detail : "")); };
const fail = (n, detail) => { results.push({ n, ok: false, detail }); console.log("  FAIL  " + n + (detail ? "  " + detail : "")); };
const skip = (n, why) => { results.push({ n, ok: null, detail: why }); console.log("  SKIP  " + n + "  " + why); };

function die(msg) { console.error("\n  " + msg + "\n"); process.exit(1); }

// --- whoami ----------------------------------------------------------------

async function whoami() {
  if (!env.GOODDAY_TOKEN) die("GOODDAY_TOKEN is not set. Copy .dev.vars.example to .dev.vars first.");
  const res = await fetch(`${GD_BASE}/users`, { headers: { "gd-api-token": env.GOODDAY_TOKEN } });
  if (!res.ok) die(`GET /users failed: ${res.status}. The token is probably wrong or lacks scope.`);
  const users = await res.json();
  console.log("\n  " + users.length + " users. Pick one for GOODDAY_BOT_USER_ID:\n");
  for (const u of users) {
    console.log("    " + String(u.id).padEnd(24) + String(u.name || "").padEnd(28) + (u.primaryEmail || ""));
  }
  console.log("");
}

// --- the checks ------------------------------------------------------------

async function main() {
  console.log("\nGoodDay preflight");
  console.log("  base   " + GD_BASE);

  const report = goodDayEnvReport(env);
  for (const r of [...report.required, ...report.optional]) {
    console.log("  env    " + r.name.padEnd(30) + (r.present ? "set" : "MISSING"));
  }
  if (!report.ready) die("Required env missing. Copy .dev.vars.example to .dev.vars and fill it in.");
  if (WHOAMI) return whoami();

  if (!RUN) {
    console.log("\n  Dry run. With --run this would:");
    console.log("    - create one project  ZZ PREFLIGHT <timestamp>  under " + (env.GOODDAY_PEOPLE_ID || "(no parent)"));
    console.log("    - create one task in it, set a status, attach a small PDF");
    console.log("    - delete the task, then report anything it could not clean up");
    console.log("\n  Nothing was touched. Re-run with --run.\n");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tag = `ZZ PREFLIGHT ${stamp}`;
  let projectId = null, taskId = null;

  console.log("\n  Running as " + tag + "\n");

  // 1 --- auth + user resolution ------------------------------------------
  try {
    const id = await goodDayResolveUserId(env, env.GOODDAY_BOT_USER_ID);
    // The bot id is an id, not a name, so resolution by id will miss; what we
    // actually want to know is that GET /users works at all.
    const res = await fetch(`${GD_BASE}/users`, { headers: { "gd-api-token": env.GOODDAY_TOKEN } });
    const users = res.ok ? await res.json() : [];
    if (!users.length) fail("1 auth + GET /users", "no users returned");
    else pass("1 auth + GET /users", users.length + " users");
  } catch (e) { fail("1 auth + GET /users", e.message); }

  // 2 --- create a sub project -------------------------------------------
  try {
    const p = await goodDayCreateProject(env, tag, env.GOODDAY_PEOPLE_ID || undefined);
    projectId = p && (p.id || p.projectId);
    if (!projectId) throw new Error("create returned no id: " + JSON.stringify(p).slice(0, 160));
    pass("2 create sub project", projectId);
  } catch (e) {
    fail("2 create sub project", e.message);
    console.log("\n  Cannot continue without a project to work in.\n");
    return summarise([]);
  }

  // 3 --- create a task, assigned ----------------------------------------
  try {
    const t = await goodDayCreateTask(env, projectId, tag + " task", {
      markdown_description: "Created by scripts/goodday_preflight.mjs. Safe to delete.",
      toUserId: env.GOODDAY_BOT_USER_ID,
      due_date: Date.now() + 86400000
    });
    taskId = t && (t.id || t.taskId);
    if (!taskId) throw new Error("create returned no id: " + JSON.stringify(t).slice(0, 160));
    pass("3 create task with toUserId + deadline", taskId);
  } catch (e) { fail("3 create task", e.message); }

  // 4 --- status with a message, in one call ------------------------------
  try {
    const statuses = await goodDayListStatuses(env);
    if (!statuses.length) { skip("4 status + message", "GET /statuses returned nothing"); }
    else if (!taskId) { skip("4 status + message", "no task"); }
    else {
      const target = statuses.find((s) => /progress|doing|active/i.test(s.name)) || statuses[1] || statuses[0];
      const ok = await goodDaySetStatus(env, taskId, projectId, target.name, "set by preflight");
      ok ? pass("4 status + message in one call", target.name)
         : fail("4 status + message", "POST /task/:id/status rejected");
    }
  } catch (e) { fail("4 status + message", e.message); }

  // 5 --- custom fields ---------------------------------------------------
  try {
    const fields = await goodDayListCustomFields(env);
    if (!fields.length) skip("5 custom field write", "no custom fields exist yet");
    else if (!taskId) skip("5 custom field write", "no task");
    else {
      const text = fields.find((f) => /text/i.test(f.type || "")) || fields[0];
      const ok = await goodDaySetCustomFields(env, taskId, { [text.id]: "preflight" });
      ok ? pass("5 custom field write", text.name || text.id)
         : fail("5 custom field write", "PUT rejected (field may not be attached to this project)");
    }
  } catch (e) { fail("5 custom field write", e.message); }

  // 6 --- PDF upload + attach to a comment --------------------------------
  // The smallest valid PDF, so this proves the three-step flow without needing
  // the browser binding.
  const MINI_PDF = Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n", "utf8");
  try {
    if (!taskId) skip("6 PDF upload + attach", "no task");
    else {
      const out = await goodDayAttachPdf(env, taskId, "preflight.pdf", MINI_PDF, "preflight attachment");
      pass("6 PDF upload + attach to comment", "fileId " + out.fileId);
    }
  } catch (e) { fail("6 PDF upload + attach", e.message); }

  // 7 --- rate limits ------------------------------------------------------
  try {
    const t0 = Date.now();
    const codes = [];
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${GD_BASE}/users`, { headers: { "gd-api-token": env.GOODDAY_TOKEN } });
      codes.push(r.status);
    }
    const limited = codes.filter((c) => c === 429).length;
    const ms = Date.now() - t0;
    limited
      ? fail("7 rate limits", limited + " of 12 were 429 in " + ms + "ms -- pace the provisioning loop")
      : pass("7 rate limits", "12 serial calls in " + ms + "ms, no 429");
  } catch (e) { fail("7 rate limits", e.message); }

  // --- cleanup ------------------------------------------------------------
  console.log("");
  const leftovers = [];
  if (taskId) {
    const gone = await goodDayDeleteTask(env, taskId);
    gone ? console.log("  cleaned  task " + taskId) : leftovers.push("task " + taskId);
  }
  if (projectId) {
    // There is no documented project delete in the API. Say so rather than
    // silently leaving something behind.
    leftovers.push("project " + projectId + " (" + tag + ") -- no API delete, remove by hand");
  }

  summarise(leftovers);
}

function summarise(leftovers) {
  const ok = results.filter((r) => r.ok === true).length;
  const bad = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log("\n  " + ok + " passed, " + bad + " failed, " + skipped + " skipped");

  if (leftovers.length) {
    console.log("\n  NOT CLEANED UP, delete these by hand:");
    for (const l of leftovers) console.log("    " + l);
  }

  // Two things a script cannot check for itself. Both are blocking.
  console.log("\n  Still needs a human, and both of these are blocking:\n");
  console.log("    1. Does a status change made THROUGH THE API fire an automation,");
  console.log("       or do automations only watch changes made in the UI?");
  console.log("       actionRequiredUserId is readable but NOT writable via the API, so");
  console.log("       Action Required can only be set by a rule. Every automation in");
  console.log("       GOODDAY_AUTOMATIONS.md assumes this works. If it does not, that");
  console.log("       whole design collapses. Build one trivial rule and watch it.\n");
  console.log("    2. Does an assigned task appear in that person's My Work when they are");
  console.log("       NOT a member of the project? That decides whether editors need");
  console.log("       membership of People. Ask someone to look, do not assume.\n");

  process.exit(bad ? 1 : 0);
}

main().catch((e) => die(e.stack || e.message));
