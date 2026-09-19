#!/usr/bin/env node
//
// Build the folder structure inside GoodDay workspaces, from a declarative spec.
//
//   node scripts/goodday_structure.mjs                 show the plan
//   node scripts/goodday_structure.mjs --apply         create anything missing
//   node scripts/goodday_structure.mjs --only People   just one workspace
//
// Scope, deliberately: this creates PROJECTS inside workspaces that already
// exist. It does NOT create workspaces, because there is no API for that, and it
// never converts anything, because converting a project that holds tasks destroys
// them. Workspaces are made by hand: rail `+` -> Space -> **Create empty space**.
// Taking a template instead is how the PMO and HR demo workspaces got onto the
// rail with 271 tasks of sample data between them.
//
// Safe to re-run. Every create goes through goodDayGetOrCreateProject, which
// looks the name up under its parent first. GoodDay will happily create a second
// project with the same name, so that lookup is not an optimisation, it is the
// only thing stopping a retried run leaving duplicates.
//
// The per-person projects under People/Team are NOT here. They come from the
// roster and live in scripts/provision_goodday_people.mjs, so the two cannot
// drift apart.

import { readFileSync, existsSync } from "node:fs";
import {
  goodDayGetOrCreateProject,
  goodDaySubProjects,
  goodDayEnvReport
} from "../worker/goodday.js";

// --- the spec --------------------------------------------------------------
//
// Workspace ids as of 19 September 2026. Verify before applying: these move when
// somebody renames or rebuilds one.
//
// `children` nest. Anything already present is reused, never duplicated.

const SPEC = {
  "People": {
    id: "6kRwYR",
    note: "Project-based access, leads only. Never All Projects: this holds identity numbers and pay.",
    children: [
      { name: "Staff records", note: "the database, contracts, identity documents" },
      { name: "Admin", note: "leads only. Embed links_admin.html here as a view." },
      { name: "Team", note: "one project per person underneath, built by provision_goodday_people.mjs" }
    ]
  },
  "Hiring": {
    id: "r7sNsK",
    note: "Project-based. The one workspace that will need non-lead members.",
    children: [
      { name: "Applicants", note: "public form points here; one task per applicant" },
      { name: "Roles", note: "one per open position" }
    ]
  },
  "Leadership": {
    id: "tL8QO9",
    children: [
      { name: "Weekly monitoring", note: "the meeting board; Monitoring Q3 2026 moves in here" },
      { name: "Milestones" }
    ]
  },
  "Workbench": {
    id: null,
    note: "CREATE THIS WORKSPACE BY HAND FIRST, then put its id here.",
    children: [
      { name: "Templates" },
      { name: "Automations", note: "the register: one task per rule, mirroring GOODDAY_AUTOMATIONS.md" },
      { name: "Migration" },
      { name: "Sandbox", note: "throwaway projects. Test any structural change here first." }
    ]
  },
  "Business": {
    id: null,
    note: "CREATE THIS WORKSPACE BY HAND FIRST, then put its id here.",
    children: [
      { name: "Pipeline" },
      { name: "Rate card" },
      { name: "Invoices" },
      { name: "Contracts" }
    ]
  }
};

// --- plumbing --------------------------------------------------------------

const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

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

function die(msg) { console.error("\n  " + msg + "\n"); process.exit(1); }

async function main() {
  console.log("\nGoodDay structure");
  console.log("  mode   " + (APPLY ? "APPLY" : "PLAN (nothing will be created)"));

  const report = goodDayEnvReport(env);
  if (!report.ready) {
    die("Missing env: " + report.required.filter((r) => !r.present).map((r) => r.name).join(", ")
      + "\n  Copy .dev.vars.example to .dev.vars and fill it in.");
  }

  const names = Object.keys(SPEC).filter((n) => !ONLY || n.toLowerCase() === ONLY.toLowerCase());
  if (!names.length) die("No workspace in the spec matches --only " + ONLY);

  let created = 0, reused = 0, blocked = 0;

  for (const wsName of names) {
    const ws = SPEC[wsName];
    console.log("\n  " + wsName + (ws.id ? "  (" + ws.id + ")" : ""));
    if (ws.note) console.log("    " + ws.note);

    if (!ws.id) {
      console.log("    SKIPPED, no workspace id. Create the workspace by hand, then set its id in SPEC.");
      blocked += ws.children.length;
      continue;
    }

    let existing = [];
    if (APPLY) {
      existing = await goodDaySubProjects(env, ws.id);
    }
    const had = new Set(existing.map((p) => String(p.name).trim().toLowerCase()));

    for (const child of ws.children) {
      if (!APPLY) {
        console.log("      would ensure  " + child.name + (child.note ? "   " + child.note : ""));
        continue;
      }
      try {
        const proj = await goodDayGetOrCreateProject(env, child.name, ws.id);
        if (had.has(child.name.trim().toLowerCase())) {
          reused++; console.log("      reuse  " + child.name.padEnd(18) + proj.id);
        } else {
          created++; console.log("      NEW    " + child.name.padEnd(18) + proj.id);
        }
      } catch (e) {
        blocked++; console.log("      FAIL   " + child.name.padEnd(18) + e.message);
      }
    }

    // Re-read and prove no duplicates, rather than trusting the loop above.
    if (APPLY) {
      const after = await goodDaySubProjects(env, ws.id);
      const counts = new Map();
      for (const p of after) {
        const k = String(p.name).trim().toLowerCase();
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const dupes = [...counts.entries()].filter(([, n]) => n > 1);
      if (dupes.length) {
        console.log("      WARNING duplicates, delete the extras by hand:");
        for (const [n, c] of dupes) console.log("        " + n + " x" + c);
      }
    }
  }

  if (!APPLY) {
    console.log("\n  Nothing was created. Re-run with --apply.\n");
    return;
  }

  console.log("\n  created " + created + ", reused " + reused + ", blocked " + blocked);
  console.log("\n  Then, by hand:");
  console.log("    - People and Hiring stay on Project-based access. Never All Projects.");
  console.log("    - Staff Hub and Projects go to All Projects.");
  console.log("    - node scripts/provision_goodday_people.mjs --apply   for the per-person projects");
  console.log("    - GOODDAY_AUTOMATIONS.md for the five rules (no automation API exists)\n");
}

main().catch((e) => die(e.stack || e.message));
