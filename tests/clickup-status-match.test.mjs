// Guards clickupSetStatus's case-insensitive substring match against the
// workspace's actual configured status names -- we can't know these exactly
// ahead of time (they vary by list/space), so the match must be forgiving
// about casing and small label differences, and must safely no-op rather than
// throw when nothing matches (a workspace with a custom status flow).
import { test } from "node:test";
import assert from "node:assert/strict";

function findStatus(statuses, desiredSubstring) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  return statuses.find((s) => norm(s).includes(norm(desiredSubstring))) || null;
}

test("matches ClickUp's default status set regardless of casing", () => {
  const statuses = ["to do", "in progress", "complete"];
  assert.equal(findStatus(statuses, "in progress"), "in progress");
  assert.equal(findStatus(statuses, "complete"), "complete");
});

test("matches uppercase-displayed statuses (ClickUp UI convention)", () => {
  const statuses = ["TO DO", "IN PROGRESS", "COMPLETE"];
  assert.equal(findStatus(statuses, "in progress"), "IN PROGRESS");
});

test("matches a longer label containing the desired word", () => {
  const statuses = ["Open", "Work In Progress", "Done / Complete"];
  assert.equal(findStatus(statuses, "in progress"), "Work In Progress");
  assert.equal(findStatus(statuses, "complete"), "Done / Complete");
});

test("returns null (safe no-op) when the workspace uses an unrelated flow", () => {
  const statuses = ["Backlog", "Blocked", "Review", "Shipped"];
  assert.equal(findStatus(statuses, "in progress"), null);
  assert.equal(findStatus(statuses, "complete"), null);
});

test("returns null on an empty status list (e.g. the ClickUp lookup call failed)", () => {
  assert.equal(findStatus([], "complete"), null);
});
