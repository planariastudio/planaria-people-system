// Guards handleSubmitPeer's "attach a final PDF snapshot once the assigned pool
// completes" logic. Two properties matter:
//   1. If the pool grows after it already completed once (a new rater gets
//      assigned), a fresh final snapshot must fire once the newly-expanded pool
//      completes again -- not stay frozen at the old population forever.
//   2. The already-fired check must be ORDER-INDEPENDENT: priorRows has no
//      guaranteed order (no ORDER BY on the underlying query), so an unordered
//      first-match lookup can latch onto a stale, smaller stored count and
//      refire on every subsequent submission. This was a real bug caught by
//      this test's reverse-order case before it shipped.
import { test } from "node:test";
import assert from "node:assert/strict";

function decide(priorRows, n, assignedCount) {
  const priorFinalCounts = priorRows.filter((r) => r.detail && r.detail._final_pdf).map((r) => r.detail._final_pdf_for_assigned);
  const finalAlreadyFiledForThisPoolSize = priorFinalCounts.length > 0 && Math.max(...priorFinalCounts) === assignedCount;
  const allRatersIn = assignedCount > 0 && n >= assignedCount;
  return { allRatersIn, finalAlreadyFiledForThisPoolSize, attachFinal: allRatersIn && !finalAlreadyFiledForThisPoolSize };
}

test("final PDF fires once a pool of 2 completes", () => {
  const r = decide([{ detail: {} }], 2, 2);
  assert.equal(r.attachFinal, true);
});

test("growing the pool after completion re-fires once the new pool completes", () => {
  const priorRows = [{ detail: {} }, { detail: { _final_pdf: true, _final_pdf_for_assigned: 2 } }];
  const notYet = decide(priorRows, 2, 3); // 3rd rater assigned, hasn't submitted
  assert.equal(notYet.attachFinal, false, "pool of 3 isn't complete until the 3rd person submits");
  const now = decide(priorRows, 3, 3); // 3rd rater submits
  assert.equal(now.attachFinal, true, "newly-expanded pool completing must fire a fresh final");
});

test("does not refire at a pool size already fired for, regardless of row order", () => {
  const flaggedRow = { detail: { _final_pdf: true, _final_pdf_for_assigned: 3 } };
  const forward = [{ detail: {} }, flaggedRow];
  const backward = [flaggedRow, { detail: {} }];
  assert.equal(decide(forward, 3, 3).attachFinal, false);
  assert.equal(decide(backward, 3, 3).attachFinal, false, "must not depend on row order (no ORDER BY on the real query)");
});

test("takes the max recorded pool size across multiple historical fires, not the first match", () => {
  // Two growth cycles happened: fired once at size 2, then again at size 4.
  // An unordered first-match lookup could pick the size-2 row and wrongly refire.
  const rows = [
    { detail: { _final_pdf: true, _final_pdf_for_assigned: 2 } },
    { detail: { _final_pdf: true, _final_pdf_for_assigned: 4 } }
  ];
  assert.equal(decide(rows, 4, 4).attachFinal, false, "already fired for the current size (4), must not refire");
  assert.equal(decide(rows, 5, 5).attachFinal, true, "pool grew again to 5 and completed -- must fire");
});
