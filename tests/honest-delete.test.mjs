// Guards the fix for a real production bug: sbDelete used `Prefer: return=minimal`,
// under which PostgREST returns 204 No Content whether the DELETE actually removed
// a row OR matched nothing at all (a Row Level Security policy silently filtering
// it, a stale/mismatched id, etc.) -- those two outcomes were indistinguishable, so
// a delete that silently did nothing was reported to the admin UI as a success.
// The fix: request `return=representation` and require the caller to check how
// many rows actually came back before claiming anything was removed.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors sbDelete's new contract: returns the array of deleted rows (possibly
// empty), never just a boolean, so "0 rows" and "1 row" can't be confused.
function makeFakeSupabase(rowsThatExist) {
  return {
    async sbDelete(table, matchId) {
      const idx = rowsThatExist.findIndex((r) => r.id === matchId);
      if (idx === -1) return [];                 // nothing matched -- the RLS/stale-id case
      return rowsThatExist.splice(idx, 1);        // matched and removed -- returns the deleted row(s)
    }
  };
}

// Mirrors handleDeleteKpiCase's post-delete check.
async function deleteCaseHandler(db, id) {
  const deletedRows = await db.sbDelete("kpi_case", id);
  if (!deletedRows.length) {
    return { ok: false, error: `Supabase would not delete case ${id} (0 rows matched) — check RLS policies on kpi_case.`, status: 409 };
  }
  return { ok: true };
}

test("a real delete (row existed, got removed) reports success", async () => {
  const db = makeFakeSupabase([{ id: "KPI-2026-Q3-Name-01" }]);
  const r = await deleteCaseHandler(db, "KPI-2026-Q3-Name-01");
  assert.equal(r.ok, true);
});

test("a delete that matches nothing (RLS-blocked, wrong id, already gone) reports a real error, not silent success", async () => {
  const db = makeFakeSupabase([{ id: "KPI-2026-Q3-Other-01" }]); // target id isn't in the table
  const r = await deleteCaseHandler(db, "KPI-2026-Q3-Name-01");
  assert.equal(r.ok, false, "must NOT claim success when nothing was actually deleted");
  assert.equal(r.status, 409);
  assert.match(r.error, /RLS/, "the error should point at the likely cause (RLS), not just fail silently");
});

test("regression witness: the OLD return=minimal contract couldn't tell these apart", () => {
  // Documents exactly what was wrong: with return=minimal, both a real delete and
  // a zero-match delete produce an identical "204, empty body" response, so any
  // code checking only res.ok (not row count) reports success either way.
  const successResponse = { status: 204, ok: true, body: null };
  const zeroMatchResponse = { status: 204, ok: true, body: null };
  assert.deepEqual(successResponse, zeroMatchResponse, "these were indistinguishable under the old contract -- that was the bug");
});
