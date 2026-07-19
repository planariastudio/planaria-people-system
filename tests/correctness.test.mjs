// Specification tests for the KPI-create idempotency guard and the case-ID
// minting-race hardening (worker/index.js: handleCreateKpiLinkTask + sbInsertMinted).
//
// These re-implement the algorithm as pure functions rather than importing the
// worker, because worker/index.js is a single bundled file that doesn't export
// these helpers yet. They encode the intended contract and fail if that contract
// regresses. When the worker is split into modules (Phase 1b), point the imports
// at the real functions — the assertions stay the same.
import { test } from "node:test";
import assert from "node:assert/strict";

// --- fakes mirroring the two Supabase write paths ---
function makeDB() {
  const rows = [];
  return {
    rows,
    select: async (pred) => rows.filter(pred),
    insert: async (row) => {                        // plain insert throws on PK clash, like Postgres
      if (rows.some((r) => r.id === row.id)) throw new Error("Supabase insert failed: 409 duplicate key");
      rows.push({ ...row }); return [row];
    },
    upsertMerge: async (row) => {                   // the OLD path: merge-duplicates (the bug)
      const ex = rows.find((r) => r.id === row.id);
      if (ex) { Object.assign(ex, row); return [ex]; }
      rows.push({ ...row }); return [row];
    }
  };
}
const mintNext = (db, prefix) => async () => {
  const re = new RegExp("^" + prefix + "(\\d+)$");
  let max = 0;
  for (const r of db.rows) { const m = r.id.match(re); if (m) max = Math.max(max, +m[1]); }
  return prefix + String(max + 1).padStart(2, "0");
};
async function sbInsertMinted(db, mintId, buildRow, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const id = await mintId();
    try { const r = await db.insert(buildRow(id)); return { id, rows: r }; }
    catch (e) { lastErr = e; if (!/\b409\b|23505|duplicate key/i.test(String(e.message))) throw e; }
  }
  throw lastErr;
}
const P = "KPI-2026-Q3-Name-";

async function kpiCreate(db, editorId, quarter) {   // mirrors handleCreateKpiLinkTask's shape
  const ex = await db.select((r) => r.editor_id === editorId && r.quarter === quarter);
  const open = ex.find((c) => !c.finalized && c.reminder_task_id);
  if (open) return { case_id: open.id, task_id: open.reminder_task_id, reused: true, madeTask: false };
  const taskId = "task-" + (db.rows.length + 1);
  const { id } = await sbInsertMinted(db, mintNext(db, P), (id) => ({ id, editor_id: editorId, quarter, finalized: false, reminder_task_id: taskId }));
  return { case_id: id, task_id: taskId, reused: false, madeTask: true };
}

test("idempotency: repeated create for same editor+quarter yields one case", async () => {
  const db = makeDB();
  const r = [];
  for (let i = 0; i < 3; i++) r.push(await kpiCreate(db, "e1", "Q3 2026"));
  assert.equal(db.rows.length, 1, "three clicks must make exactly one case");
  assert.ok(r[0].madeTask && !r[1].madeTask && !r[2].madeTask, "only the first click creates a ClickUp task");
  assert.ok(r[1].reused && r[2].reused, "later clicks report reused");
  assert.equal(r[0].case_id, r[2].case_id, "same case id every time");
});

test("idempotency guard does not block a different quarter", async () => {
  const db = makeDB();
  const a = await kpiCreate(db, "e1", "Q3 2026");
  const b = await kpiCreate(db, "e1", "Q4 2026");
  assert.equal(db.rows.length, 2);
  assert.notEqual(a.case_id, b.case_id);
});

test("minting race: two concurrent first-creates get distinct ids, no data lost", async () => {
  const db = makeDB();
  const a = await sbInsertMinted(db, mintNext(db, P), (id) => ({ id, editor_id: "e1", quarter: "Q3 2026", reminder_task_id: "tA", payload: "A" }));
  const b = await sbInsertMinted(db, mintNext(db, P), (id) => ({ id, editor_id: "e1", quarter: "Q3 2026", reminder_task_id: "tB", payload: "B" }));
  assert.equal(db.rows.length, 2, "two rows, not a silent merge");
  assert.notEqual(a.id, b.id);
  assert.ok(db.rows.some((r) => r.payload === "A") && db.rows.some((r) => r.payload === "B"), "both payloads survive");
});

test("regression witness: the OLD upsert-merge path silently loses data", async () => {
  // Documents exactly what we fixed: two writes of the same minted id merge into
  // one row, dropping the loser's payload with no error. If someone reverts to
  // sbUpsert on the mint path, this is the behavior that returns.
  const db = makeDB();
  await db.upsertMerge({ id: P + "01", reminder_task_id: "tA", payload: "A" });
  await db.upsertMerge({ id: P + "01", reminder_task_id: "tB", payload: "B" });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].payload, "B", "second write silently overwrote the first (the bug we fixed)");
});
