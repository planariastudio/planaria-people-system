// Guards where the single per-quarter KPI task lives across its lifecycle.
//
// Design: while it's still something the person owes, its HOME is their To-do
// list (so To-do genuinely holds everything they must fill: KPI + Peer). At
// filing it moves to the KPI list. The move needs ClickUp's "Tasks in Multiple
// Lists" ClickApp; the critical safety property is that we never REMOVE it from
// To-do unless the ADD to KPI succeeded -- otherwise the task would be stranded
// in no list at all and effectively disappear.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors the placement logic in handleCreateKpiLinkTask + handleKpiFinalize.
function createPlacement({ todoListId, kpiListId }) {
  return todoListId || kpiListId;
}
function finalizePlacement({ todoListId, kpiListId, clickAppEnabled }) {
  const lists = new Set([todoListId || kpiListId]);
  let homeListId = todoListId || kpiListId;
  if (todoListId && kpiListId && todoListId !== kpiListId) {
    const added = clickAppEnabled;              // clickupAddTaskToList returns res.ok
    if (added) {
      lists.add(kpiListId);
      lists.delete(todoListId);
      homeListId = kpiListId;
    }
  }
  return { lists: [...lists], homeListId };
}

test("pending KPI task is created in the To-do list", () => {
  assert.equal(createPlacement({ todoListId: "todo1", kpiListId: "kpi1" }), "todo1");
});

test("falls back to the KPI list if no To-do list could be resolved", () => {
  assert.equal(createPlacement({ todoListId: null, kpiListId: "kpi1" }), "kpi1");
});

test("filing moves it To-do -> KPI when the ClickApp is on", () => {
  const r = finalizePlacement({ todoListId: "todo1", kpiListId: "kpi1", clickAppEnabled: true });
  assert.deepEqual(r.lists, ["kpi1"], "ends up only in the KPI list");
  assert.equal(r.homeListId, "kpi1", "status is set against the list it now lives in");
});

test("ClickApp off: stays in To-do rather than being stranded in no list", () => {
  const r = finalizePlacement({ todoListId: "todo1", kpiListId: "kpi1", clickAppEnabled: false });
  assert.deepEqual(r.lists, ["todo1"], "never removed from To-do without a successful add");
  assert.equal(r.homeListId, "todo1", "status is set against To-do, where it actually is");
});

test("no To-do list at all: filing is a no-op placement-wise", () => {
  const r = finalizePlacement({ todoListId: null, kpiListId: "kpi1", clickAppEnabled: true });
  assert.deepEqual(r.lists, ["kpi1"]);
  assert.equal(r.homeListId, "kpi1");
});
