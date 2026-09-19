#!/usr/bin/env node
//
// Drive the ClickUp -> GoodDay translation against the LIVE API, end to end.
//
//   node scripts/goodday_bridge_smoke.mjs --person "Joshua Ervin"
//   node scripts/goodday_bridge_smoke.mjs --person "Joshua Ervin" --keep
//
// Why this exists on top of tests/goodday-bridge.test.mjs: those tests prove the
// translation produces the shapes it is supposed to produce. They cannot prove
// GoodDay AGREES. Every trap found in this migration so far has been of the
// second kind -- a documented POST that answers 405, a documented attachment
// array that wants objects, a startDate that comes back null with a 200 -- and
// none of them would have failed a unit test.
//
// So this runs the real sequence a KPI filing runs (create, update, status,
// comment, delete) and READS BACK what GoodDay actually stored, rather than
// trusting the response codes. It cleans up after itself unless --keep.
//
// Reads .dev.vars for the token. Never pass the token on the command line.

import { readFileSync, existsSync } from "node:fs";
import {
  goodDayCreateTask,
  goodDayUpdateTask,
  goodDayDeleteTask,
  goodDayComment,
  goodDayAttachPdf,
  goodDaySetStatus,
  goodDayListStatuses,
  goodDayListTaskTypes,
  goodDayGetOrCreateProject,
  goodDayResolveUserId,
  goodDayEnvReport
} from "../worker/goodday.js";
import {
  gdRef,
  gdParseRef,
  gdCreateOpts,
  gdUpdateFields,
  gdUpdateBody,
  gdTaskUrl
} from "../worker/goodday_bridge.js";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; };
const PERSON = arg("--person", "Joshua Ervin");
const KEEP = argv.includes("--keep");

function loadDevVars() {
  const out = {};
  if (!existsSync(".dev.vars")) return out;
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2] !== "") out[m[1]] = m[2].trim();
  }
  return out;
}
const env = {
  ...loadDevVars(),
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("GOODDAY_")))
};

let failures = 0;
const ok = (label, cond, detail) => {
  console.log(`    ${cond ? "ok  " : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
  if (!cond) failures++;
};

// Read-back uses DIFFERENT field names than the write. POST /tasks takes
// `title`, `taskTypeId` and `toUserId`; GET /task/:id gives them back as `name`,
// `taskType.id` and `assignedToUserId`. Anything that assumes the write shape
// comes back verifies nothing, so both readers are spelled out here.
const getTask = async (id) => (await fetch(`https://api.goodday.work/2.0/task/${id}`,
  { headers: { "gd-api-token": env.GOODDAY_TOKEN } })).json();
// The description is not a field. It is the first entry in the message feed.
const getMessages = async (id) => (await fetch(`https://api.goodday.work/2.0/task/${id}/messages`,
  { headers: { "gd-api-token": env.GOODDAY_TOKEN } })).json();

// The KPI call site sends a whole quarter. Same numbers, so the dates exercise
// the same path the real thing does.
function quarterRange(y, q) {
  return { start: Date.UTC(y, (q - 1) * 3, 1), end: Date.UTC(y, q * 3, 0, 23, 59, 0) };
}

async function main() {
  const report = goodDayEnvReport(env);
  if (!report.ready) {
    console.error("\n  Missing env: " +
      report.required.filter((r) => !r.present).map((r) => r.name).join(", ") + "\n");
    process.exit(1);
  }

  console.log("\nGoodDay bridge smoke test");
  console.log("  person   " + PERSON);
  console.log("  cleanup  " + (KEEP ? "NO (--keep)" : "yes"));

  // --- 1. container resolution ---------------------------------------------
  console.log("\n  1. resolve the person's project");
  const teamId = env.GOODDAY_TEAM_ID
    || (await goodDayGetOrCreateProject(env, "Performance Records", env.GOODDAY_PEOPLE_ID)).id;
  const proj = await goodDayGetOrCreateProject(env, PERSON, teamId);
  ok("project found under People > Team", !!proj && !!proj.id, proj && proj.id);
  const ref = gdRef(proj.id, "kpi");
  ok("reference round-trips", gdParseRef(ref).projectId === proj.id, ref);

  // --- 2. task type ---------------------------------------------------------
  console.log("\n  2. task type");
  const types = await goodDayListTaskTypes(env);
  const kpiType = types.find((t) => String(t.name).trim().toLowerCase() === "kpi scorecard");
  ok("KPI Scorecard task type exists", !!kpiType, kpiType && kpiType.id);

  // --- 3. create, exactly as handleCreateKpiLinkTask does -------------------
  console.log("\n  3. create");
  const qr = quarterRange(2026, 3);
  const link = "https://planariastudio.github.io/planaria-people-system/kpi_scorecard.html?e=SMOKE";
  const assignee = await goodDayResolveUserId(env, PERSON);
  console.log("    assignee lookup: " + (assignee || "none (person not invited to GoodDay yet)"));

  const clickupOpts = {
    assignees: assignee ? [assignee] : null,
    tags: ["KPI", "Q3-2026"],
    markdown_description:
      `Fill in your KPI self-review for **Q3 2026**: [Open my scorecard](${link})\n\n` +
      `This is your personal link.`,
    due_date: qr.end,
    start_date: qr.start
  };
  const task = await goodDayCreateTask(
    env, proj.id, "SMOKE TEST · bridge · safe to delete",
    gdCreateOpts(clickupOpts, kpiType ? kpiType.id : null)
  );
  ok("task created", !!task && !!task.id, task && task.id);
  const url = gdTaskUrl(task.id);
  console.log("    " + url);

  // --- 4. read back what was actually stored -------------------------------
  console.log("\n  4. read back (this is the half a unit test cannot do)");
  const got = await getTask(task.id);
  const body = (await getMessages(task.id))[0];

  ok("landed in the right project", got.projectId === proj.id, got.projectId);
  ok("task type stuck", !kpiType || (got.taskType && got.taskType.id) === kpiType.id,
    got.taskType && got.taskType.id);
  ok("the link is bare, so GoodDay makes it clickable",
    String(body && body.message).includes(link) && !String(body && body.message).includes("]("),
    JSON.stringify(String(body && body.message || "").slice(0, 55)));
  ok("markdown asterisks were flattened", !String(body && body.message).includes("**"));
  ok("deadline stored", !!got.deadline, got.deadline);
  ok("START DATE SURVIVED (the silent-drop trap)", !!got.startDate, got.startDate || "NULL");
  ok("end date stored", !!got.endDate, got.endDate);
  if (assignee) ok("assigned", got.assignedToUserId === assignee, got.assignedToUserId);

  // --- 5. update, as handleKpiFinalize does --------------------------------
  console.log("\n  5. update");
  const clickupFields = {
    name: "SMOKE TEST · bridge · renamed · safe to delete",
    markdown_description: "Filed. **Score** 3.9",
    priority: 4,
    due_date: qr.end,
    start_date: qr.start
  };
  const updated = await goodDayUpdateTask(env, task.id, gdUpdateFields(clickupFields));
  ok("update accepted", updated !== null);
  // The body goes somewhere else entirely. A GoodDay description is the task's
  // first message and no endpoint can edit it, so a new one is appended. This is
  // the one real behaviour change in the whole migration.
  const newBody = gdUpdateBody(clickupFields);
  ok("new body appended as a comment", await goodDayComment(env, task.id, newBody) === true);

  const after = await getTask(task.id);
  const feed = await getMessages(task.id);
  ok("TITLE ACTUALLY CHANGED", String(after.name || "").includes("renamed"), after.name);
  ok("priority applied", after.priority === 4, String(after.priority));
  ok("body reached the task", feed.some((m) => String(m.message).includes("Score 3.9")),
    feed.length + " messages");
  ok("the original prompt is still there above it", feed.length >= 2,
    "history, not overwrite");

  // --- 6. status ------------------------------------------------------------
  console.log("\n  6. status");
  const statuses = await goodDayListStatuses(env, proj.id);
  console.log("    workflow: " + statuses.map((x) => x.name).join(", "));
  const moved = await goodDaySetStatus(env, task.id, proj.id, "progress");
  ok("status moved, or cleanly no-oped if the workflow has no match", moved === true || moved === false,
    String(moved));

  // --- 7. comment -----------------------------------------------------------
  console.log("\n  7. comment");
  ok("comment posted", await goodDayComment(env, task.id, "Smoke test comment. " + url) === true);

  // --- 8. PDF attachment ----------------------------------------------------
  //
  // Every filed KPI, peer scorecard and PIP verdict carries a rendered PDF, so
  // this is not an optional path. Uploading is two steps in GoodDay -- ask for a
  // slot, PUT the bytes to it -- and the attachment then has to be referenced as
  // an OBJECT on a comment, not as a bare file id. A real (tiny) PDF is used
  // rather than random bytes so nothing can pass on a technicality.
  console.log("\n  8. PDF attachment");
  const pdf = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n"
  );
  let attached = null;
  try {
    attached = await goodDayAttachPdf(env, task.id, "smoke-test.pdf", pdf, "Smoke test PDF");
    ok("uploaded and attached", !!attached && !!attached.fileId, attached && attached.fileId);
  } catch (e) {
    ok("uploaded and attached", false, e.message);
  }
  if (attached) {
    const feed2 = await getMessages(task.id);
    const withFile = feed2.find((m) => Array.isArray(m.attachments) && m.attachments.length);
    ok("the attachment is actually ON the task, not just uploaded somewhere",
      !!withFile, withFile ? JSON.stringify(withFile.attachments).slice(0, 90) : "no message carries it");
  }

  // --- 9. cleanup -----------------------------------------------------------
  console.log("\n  9. cleanup");
  if (KEEP) {
    console.log("    kept: " + url);
  } else {
    ok("deleted", await goodDayDeleteTask(env, task.id) === true);
  }

  console.log("\n  " + (failures ? failures + " FAILED" : "all checks passed") + "\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("\n  " + (e.stack || e.message) + "\n"); process.exit(1); });
