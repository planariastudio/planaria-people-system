// Tests for the ClickUp -> GoodDay translation layer.
//
// These matter more than their size suggests. Every failure they guard against
// is SILENT: GoodDay returns 200 for an update whose field names it does not
// recognise, and returns a perfectly valid task for a create that landed in the
// wrong project. Nothing throws, nothing logs, and the first sign of trouble is
// a quarter's worth of reviews that are not where anyone expects them.
//
// No network. Pure functions only.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gdRef,
  gdParseRef,
  gdNeedRef,
  gdDatesFrom,
  gdCreateOpts,
  gdUpdateFields,
  gdUpdateBody,
  gdTaskUrl
} from "../worker/goodday_bridge.js";

// --- container references --------------------------------------------------

test("a reference survives a round trip", () => {
  const r = gdParseRef(gdRef("JORtmi", "kpi"));
  assert.equal(r.projectId, "JORtmi");
  assert.equal(r.type, "kpi");
});

test("a ClickUp list id is not mistaken for a GoodDay reference", () => {
  // This is the whole reason references carry a prefix. ClickUp list ids are bare
  // digit strings; so, near enough, are GoodDay project ids. Without the prefix
  // there would be no way to tell a stale id from a live one.
  assert.equal(gdParseRef("901234567890"), null);
  assert.equal(gdParseRef(""), null);
  assert.equal(gdParseRef(null), null);
  assert.equal(gdParseRef(undefined), null);
});

test("gdNeedRef throws by name rather than filing to nowhere", () => {
  assert.throws(
    () => gdNeedRef("901234567890", "clickupCreateTaskInList"),
    (e) => {
      assert.match(e.message, /clickupCreateTaskInList/, "the message must name the caller");
      assert.match(e.message, /901234567890/, "and the id it was given");
      return true;
    }
  );
  // A good reference passes straight through.
  assert.equal(gdNeedRef(gdRef("P1", "pip"), "x").projectId, "P1");
});

test("a project id containing a colon still parses, because type is taken from the end", () => {
  const r = gdParseRef("gd:A:B:peer");
  assert.equal(r.projectId, "A:B");
  assert.equal(r.type, "peer");
});

// --- dates -----------------------------------------------------------------
//
// GoodDay silently drops startDate unless endDate travels with it. Verified
// against the live API: startDate alone comes back null, and so does
// startDate + deadline. ClickUp accepted start_date on its own, so a plain rename
// would have lost every start date in the system without erroring once.

test("a start date is only sent when an end date can go with it", () => {
  const both = gdDatesFrom({ start_date: 1751328000000, due_date: 1759276740000 }, {});
  assert.ok(both.startDate, "a range must keep its start");
  assert.ok(both.endDate, "which is only possible if endDate is sent too");
  assert.equal(both.endDate, both.deadline, "the quarter ends when the work is due");

  const dueOnly = gdDatesFrom({ due_date: 1759276740000 }, {});
  assert.ok(dueOnly.deadline);
  assert.equal(dueOnly.startDate, undefined);
  assert.equal(dueOnly.endDate, undefined, "no invented end date");

  const startOnly = gdDatesFrom({ start_date: 1751328000000 }, {});
  assert.deepEqual(startOnly, {}, "a lone start date would be dropped by GoodDay anyway");
});

test("an explicit null date is left alone rather than sent as null", () => {
  // handleKpiFinalize sends `due_date: qr ? qr.end : null` for a quarter it could
  // not parse. Forwarding that null would clear a deadline somebody set by hand.
  assert.deepEqual(gdDatesFrom({ due_date: null, start_date: null }, {}), {});
});

// --- create ----------------------------------------------------------------

test("create opts are translated, not forwarded", () => {
  const out = gdCreateOpts({
    markdown_description: "Fill this in: https://x.test/k",
    assignees: ["GDUSER1"],
    tags: ["KPI", "Q3-2026"],
    priority: 2
  }, "GA1PXC");

  assert.equal(out.toUserId, "GDUSER1", "GoodDay takes one assignee, not an array");
  assert.equal(out.taskTypeId, "GA1PXC");
  assert.equal(out.priority, 2);
  assert.equal(out.assignees, undefined, "the ClickUp key must not survive");
  assert.equal(out.tags, undefined, "GoodDay has no tags; the task type carries this now");
});

test("an unassigned task is still a task", () => {
  // The live case for everyone not yet invited to GoodDay: the resolver returns
  // null, the call site passes `assignees: null`, and the prompt must still be
  // created rather than the save failing.
  assert.equal(gdCreateOpts({ assignees: null }, null).toUserId, undefined);
  assert.equal(gdCreateOpts({ assignees: [null] }, null).toUserId, undefined);
  assert.equal(gdCreateOpts({}, null).taskTypeId, undefined);
});

test("a subtask keeps its parent", () => {
  assert.equal(gdCreateOpts({ parent: "T9" }, null).parentTaskId, "T9");
});

// --- update ----------------------------------------------------------------

test("update fields are renamed, because GoodDay ignores ClickUp's names silently", () => {
  const out = gdUpdateFields({
    name: "KPI self-review \u00B7 Awaiting supervisor",
    priority: 4,
    due_date: 1759276740000,
    start_date: 1751328000000
  });
  assert.equal(out.title, "KPI self-review \u00B7 Awaiting supervisor");
  assert.equal(out.priority, 4);
  assert.ok(out.deadline && out.startDate && out.endDate);
  assert.equal(out.name, undefined);
  assert.equal(out.due_date, undefined);
});

test("the description is kept OUT of the update, because that update is a silent no-op", () => {
  // Verified against the live API: PUT /task/:id/update with `message` returns
  // 200 "OK" and the task's messages are unchanged. Including it would make
  // filing a KPI look like it worked while the task still said "fill this in".
  const out = gdUpdateFields({ markdown_description: "Filed. Score 3.9", description: "x" });
  assert.equal(out.message, undefined);
  assert.equal(out.markdown_description, undefined);
  assert.deepEqual(out, {});
});

test("the description is routed to a comment instead, flattened", () => {
  // A GoodDay task's description is its first message, and no endpoint edits an
  // existing message. Appending is the only way to get new text onto the task.
  assert.equal(gdUpdateBody({ markdown_description: "**Filed**" }), "Filed");
  assert.equal(
    gdUpdateBody({ markdown_description: "[Result](https://x.test/r)" }),
    "Result: https://x.test/r",
    "and the link has to end up bare, or it is not clickable"
  );
});

test("markdown_description wins over description when a call site sends both", () => {
  // handleKpiFinalize sends the same text under both keys. The markdown one is
  // what the PDF and the task body are generated from, so it must be the one kept.
  assert.equal(gdUpdateBody({ description: "old", markdown_description: "new" }), "new");
});

test("an update with no body posts no comment", () => {
  // Otherwise every rename would also append an empty message to the task.
  assert.equal(gdUpdateBody({ name: "renamed" }), null);
  assert.equal(gdUpdateBody({ markdown_description: "" }), null);
  assert.equal(gdUpdateBody({}), null);
  assert.equal(gdUpdateBody(null), null);
});

test("status never reaches update, and an empty map stays empty", () => {
  // GoodDay moves status through its own endpoint with a status id. A `status`
  // key here would be accepted with a 200 and do nothing at all, so it is dropped
  // and routed via clickupSetStatus -> goodDaySetStatus instead.
  assert.deepEqual(gdUpdateFields({ status: "Filed" }), {});
  assert.deepEqual(gdUpdateFields({}), {});
  assert.deepEqual(gdUpdateFields(null), {});
  assert.deepEqual(gdUpdateFields({ custom_fields: [], tags: ["x"] }), {},
    "unmapped keys are dropped, never forwarded on the off-chance");
});

// --- task url --------------------------------------------------------------

test("a created task gets a working link instead of a dead null", () => {
  assert.equal(gdTaskUrl("1FmOwW"), "https://www.goodday.work/t/1FmOwW");
  assert.equal(gdTaskUrl(null), null);
  assert.equal(gdTaskUrl(""), null);
});
