// ClickUp -> GoodDay translation.
//
// Pure functions only: no network, no env, no state. They exist as their own
// module for one reason, which is that they are the part of the migration most
// likely to be silently wrong, and worker/index.js is an 828KB bundle that no
// test can import. Here they are testable, and tests/goodday-bridge.test.mjs
// covers every one of them.
//
// Why translation is needed at all, rather than just renaming the calls:
//
//   Containers. ClickUp gave each person a Folder holding four Lists, and every
//   call site addressed one by list id. GoodDay gives each person ONE project and
//   tells KPI / Peer / PIP apart by task TYPE. So a container is now a pair, not
//   an id, and gdRef/gdParseRef carry the pair through code that still thinks it
//   is passing a list id.
//
//   Fields. GoodDay answers 200 to field names it does not recognise and changes
//   nothing. Forwarding ClickUp field names would therefore look like a series of
//   successful saves that silently did nothing at all, which is the failure mode
//   worth spending a module to avoid.

import { gdDate, gdText } from "./goodday.js";

// A container reference. Deliberately not a bare id: a bare GoodDay project id
// would be indistinguishable from a ClickUp list id, and getting those two mixed
// up is exactly the bug this prefix exists to make impossible.
function gdRef(projectId, type) {
  return "gd:" + projectId + ":" + (type || "");
}
function gdParseRef(ref) {
  const raw = String(ref || "");
  if (!raw.startsWith("gd:")) return null;
  const rest = raw.slice(3);
  const i = rest.lastIndexOf(":");
  if (i < 0) return { projectId: rest, type: null };
  return { projectId: rest.slice(0, i), type: rest.slice(i + 1) || null };
}

// Throwing here rather than returning null is the point. A create that silently
// files to the wrong place looks like a success to the person who pressed the
// button, and is only discovered weeks later when the quarter is being reviewed.
function gdNeedRef(ref, where) {
  const r = gdParseRef(ref);
  if (!r) throw new Error(
    `GOODDAY_ENABLED is on but ${where} was given a ClickUp list id (${ref}). ` +
    `Container ids must come from resolveEditorList.`
  );
  return r;
}

// GoodDay SILENTLY DROPS startDate unless endDate travels with it -- verified
// against the live API: startDate alone, and startDate + deadline, both come back
// null. ClickUp took start_date on its own, so the PIP and KPI call sites that set
// a whole quarter range would lose their start date without any error at all.
//
// Where a call site sends both ends of a range, the due date is therefore sent as
// endDate as well as deadline. That keeps the range intact and matches what the
// dates mean here: the quarter ends then, and the work is due then.
function gdDatesFrom(src, out) {
  const hasStart = src.start_date !== undefined && src.start_date !== null;
  const hasDue = src.due_date !== undefined && src.due_date !== null;
  if (hasDue) out.deadline = gdDate(src.due_date);
  if (hasStart && hasDue) {
    out.startDate = gdDate(src.start_date);
    out.endDate = gdDate(src.due_date);
  }
  return out;
}

// ClickUp create opts -> GoodDay create opts.
//
// `tags` is dropped, and that is not an oversight: GoodDay has no tags, and the
// job tags were doing here (marking a task as KPI / Peer / PIP) is done better by
// the task TYPE set alongside this. The quarter tag is already in the task name,
// which is where anyone actually reads it.
function gdCreateOpts(opts, taskTypeId) {
  const o = opts || {};
  const out = {};
  if (o.markdown_description) out.markdown_description = o.markdown_description;
  if (o.message) out.message = o.message;
  if (o.priority) out.priority = o.priority;
  if (o.parent) out.parentTaskId = o.parent;
  if (Array.isArray(o.assignees) && o.assignees.length && o.assignees[0]) out.toUserId = o.assignees[0];
  if (taskTypeId) out.taskTypeId = taskTypeId;
  gdDatesFrom(o, out);
  return out;
}

// ClickUp update fields -> GoodDay update fields.
//
// Unmapped keys are dropped rather than forwarded. GoodDay answers 200 to fields
// it does not recognise and changes nothing, so forwarding an unknown key buys a
// silent no-op that reads as a success in the logs.
//
// `title`, `deadline`, `priority`, `startDate` and `endDate` were each confirmed
// against the live API to actually take effect. Nothing is in this list on the
// strength of the documentation alone.
function gdUpdateFields(fields) {
  const f = fields || {};
  const out = {};
  if (f.name !== undefined) out.title = f.name;
  if (f.priority !== undefined) out.priority = f.priority;
  gdDatesFrom(f, out);
  // `status` is intentionally absent. GoodDay moves status through its own
  // endpoint with a status id, not through update, so status is routed via
  // clickupSetStatus -> goodDaySetStatus before it can ever reach here.
  //
  // The description is absent for a harder reason: see gdUpdateBody.
  return out;
}

// The description is NOT part of an update, and cannot be.
//
// A GoodDay task's description is its FIRST MESSAGE, not a field. Sending
// `message` to PUT /task/:id/update returns 200 "OK" and changes nothing at all,
// and there is no endpoint that edits an existing message: PUT on
// /task/:id/message/:id, /task/:id/messages/:id and /message/:id are all 404.
// All four were tried against the live API.
//
// That matters because replacing the body is exactly what filing a KPI does. The
// prompt says "fill this in", and when the supervisor files, ClickUp's
// markdown_description was overwritten with the result. If that update silently
// did nothing, a filed scorecard would go on telling its owner to fill it in.
//
// The only way to put new text on a GoodDay task is to append a message. So the
// new body is posted as a comment instead, which means one real change in
// behaviour, worth stating plainly: under ClickUp the filed result REPLACED the
// prompt, and under GoodDay it is added underneath it. The task reads as a
// history rather than a final state. Arguably better, but different, and not
// something to discover by accident.
function gdUpdateBody(fields) {
  const f = fields || {};
  const md = f.markdown_description !== undefined ? f.markdown_description
    : f.description !== undefined ? f.description
    : null;
  return md === null || md === undefined || md === "" ? null : gdText(md);
}

// GoodDay's create response carries no task url, and the UI reports one back to
// whoever pressed the button ("Task created -> ..."). Building it from the id
// keeps that link working instead of degrading to a dead "null".
function gdTaskUrl(id) {
  return id ? "https://www.goodday.work/t/" + id : null;
}

export {
  gdRef,
  gdParseRef,
  gdNeedRef,
  gdDatesFrom,
  gdCreateOpts,
  gdUpdateFields,
  gdUpdateBody,
  gdTaskUrl
};
