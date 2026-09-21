// Time in stage, for every job on the Projects board.
//
// GoodDay has no "how long was this job at each status" report and no history
// endpoint: /task/:id/history and /task/:id/activity are both 404. But every
// status change is written into the task's MESSAGE stream as a message carrying
// `taskStatusId` and `dateCreated`, so the whole journey is recoverable to the
// second -- retroactively, for jobs that ran before anyone thought to measure.
// That is what this reads.
//
// Discovered 2026-09-21. The custom date fields (Sent to client on, Back from
// client on, Date Done) are date-only and stamped by automations D1, R1/R4 and
// D3; they are good for "which day" and useless for "how long". This is the
// answer to "how long".
//
//   node scripts/goodday_stage_times.mjs            human readable
//   node scripts/goodday_stage_times.mjs --csv      one row per spell
//
// Needs GOODDAY_TOKEN in .dev.vars (or the environment).

import { readFileSync } from "node:fs";

const PROJECT = process.env.GOODDAY_PROJECT_ID || "NmWwcc";     // Projects board
const API = "https://api.goodday.work/2.0";

// The order a job is meant to travel in. Anything outside this list still gets
// timed, it just does not get a column in the averages.
const JOURNEY = [
  "TO DO", "EDITING", "SENT TO SPV", "INTERNAL REVISION",
  "FINAL REVIEW", "SENT TO CLIENT", "CLIENT REVISION", "APPROVED",
];

// Revision tickets are subtasks and have their own tiny lifecycle. They are not
// jobs, so they are excluded from job timings.
const NOT_A_JOB = /^(TEST|AUTOTEST|Internal revision|Client revision)\b/i;

function loadToken() {
  if (process.env.GOODDAY_TOKEN) return process.env.GOODDAY_TOKEN;
  for (const p of ["./.dev.vars", "../.dev.vars"]) {
    try {
      for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = /^\s*GOODDAY_TOKEN\s*=\s*(.+)$/.exec(line);
        if (m) return m[1].trim();
      }
    } catch { /* try the next path */ }
  }
  throw new Error("No GOODDAY_TOKEN in the environment or .dev.vars");
}

const H = { "gd-api-token": loadToken() };
const get = async (p) => {
  const r = await fetch(API + p, { headers: H });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
};

const hours = (ms) => ms / 3600000;
const fmt = (h) => (h >= 48 ? (h / 24).toFixed(1) + " d" : h.toFixed(1) + " h");

// One job's status history, oldest first, with repeats collapsed.
// A cascading rule can stamp the same status twice in the same second; that is
// one arrival, not two.
async function journeyOf(taskId, statusName) {
  const messages = (await get(`/task/${taskId}/messages`)) || [];
  const stamps = messages
    .filter((m) => m.taskStatusId)
    .map((m) => ({ at: new Date(m.dateCreated), status: statusName(m.taskStatusId) }))
    .sort((a, b) => a.at - b.at);
  const out = [];
  for (const s of stamps) if (!out.length || out[out.length - 1].status !== s.status) out.push(s);
  return out;
}

const statuses = (await get("/statuses")) || [];
const nameOf = Object.fromEntries(statuses.map((s) => [s.id, s.name]));
const statusName = (id) => nameOf[id] || id;

const tasks = ((await get(`/project/${PROJECT}/tasks?closed=true`)) || [])
  .filter((t) => !NOT_A_JOB.test(t.name || ""));

const csv = process.argv.includes("--csv");
const totals = {}, spells = {};
const rows = [];

for (const task of tasks) {
  const seq = await journeyOf(task.id, statusName);
  if (seq.length < 2) continue;            // never moved, nothing to measure

  const perStage = {};
  for (let i = 0; i < seq.length - 1; i++) {
    const held = hours(seq[i + 1].at - seq[i].at);
    const s = seq[i].status;
    perStage[s] = (perStage[s] || 0) + held;
    totals[s] = (totals[s] || 0) + held;
    spells[s] = (spells[s] || 0) + 1;
    rows.push([task.id, JSON.stringify(task.name), s, seq[i].at.toISOString(), held.toFixed(3)].join(","));
  }

  if (!csv) {
    const lead = hours(seq[seq.length - 1].at - seq[0].at);
    console.log(
      "\n  " + String(task.name).slice(0, 44).padEnd(46) +
      "opened " + seq[0].at.toISOString().slice(0, 10) +
      "   now " + String(seq[seq.length - 1].status).padEnd(18) +
      "   lead " + fmt(lead).padStart(8)
    );
    for (const s of JOURNEY) {
      if (perStage[s] === undefined) continue;
      console.log("      " + s.padEnd(20) + fmt(perStage[s]).padStart(9));
    }
  }
}

if (csv) {
  console.log("task_id,task_name,stage,entered_at,hours_held");
  for (const r of rows) console.log(r);
} else {
  console.log("\n\nAVERAGE TIME IN STAGE  across " + tasks.length + " jobs");
  for (const s of JOURNEY) {
    if (!spells[s]) continue;
    console.log("  " + s.padEnd(20) + fmt(totals[s] / spells[s]).padStart(9) +
      "   over " + String(spells[s]).padStart(3) + " spells");
  }
  console.log("\n  Timestamps come back in the server timezone, which is UTC and so seven");
  console.log("  hours behind Jakarta. Durations are unaffected; only wall-clock times shift.");
}
