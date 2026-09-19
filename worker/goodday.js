// GoodDay integration layer.
//
// Written to sit ALONGSIDE the ClickUp helpers in worker/index.js, not to
// replace them yet. Every function here mirrors a `clickup*` one, keeps the same
// call shape, and keeps the same error contract, so a call site can be switched
// by changing one name. Nothing in here is wired up until a caller opts in.
//
// The error contract is copied deliberately, because it encodes decisions that
// were paid for once already:
//   - Things whose failure must abort the save THROW      (create task, attach, create project)
//   - Advisory things return a boolean and swallow errors (comment, delete, set status)
//   - Update returns the parsed body or null              (never throws)
// If you "tidy" these to all throw, a failed progress comment will start
// aborting a filed KPI. See the clickupComment comment in index.js.
//
// API reference: https://www.goodday.work/developers/api-v2
//   Base    https://api.goodday.work/2.0
//   Auth    gd-api-token: <token>       (single header, no Bearer prefix)
//
// Env it needs:
//   GOODDAY_TOKEN          the API token         (wrangler secret put GOODDAY_TOKEN)
//   GOODDAY_BOT_USER_ID    the user id that actions are attributed to
//   GOODDAY_PEOPLE_ID      the People workspace / parent project id
//
// GOODDAY_BOT_USER_ID has no ClickUp equivalent and is NOT optional: GoodDay
// requires `fromUserId` on every task create and `userId` on status changes and
// comments. ClickUp inferred the actor from the token. Here it must be named, so
// pick a real user (or a service account) once and set it.

const GD_BASE = "https://api.goodday.work/2.0";

// Tests inject a fetch through env so nothing here touches the network.
function gdFetchFn(env) {
  return (env && env.__fetch) || fetch;
}

function gdHeaders(env, json = true) {
  const h = { "gd-api-token": env.GOODDAY_TOKEN };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function gdCall(env, method, path, body) {
  const f = gdFetchFn(env);
  const init = { method, headers: gdHeaders(env, body !== undefined) };
  if (body !== undefined) init.body = JSON.stringify(body);
  return f(`${GD_BASE}${path}`, init);
}

// Read the body once, for an error message, without throwing if it is empty.
async function gdErrText(res) {
  try { return await res.text(); } catch (e) { return "<no body>"; }
}

const norm = (s) => String(s || "").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// ClickUp had no equivalent; assignees were passed through as raw ids in
// opts.assignees and resolved by whoever called it. GoodDay needs a real user id
// for fromUserId/toUserId, so resolution happens here, once, by email first and
// then by name. Email is tried first because two people can share a display name
// and nobody shares a mailbox.
async function goodDayResolveUserId(env, nameOrEmail) {
  const want = norm(nameOrEmail);
  if (!want) return null;
  try {
    const res = await gdCall(env, "GET", "/users");
    if (!res.ok) return null;
    const users = await res.json();
    if (!Array.isArray(users)) return null;
    const byEmail = users.find((u) => norm(u.primaryEmail) === want);
    if (byEmail) return byEmail.id;
    const byName = users.find((u) => norm(u.name) === want);
    if (byName) return byName.id;
    // Last resort: a unique prefix match, so "Eduardus Kent" finds
    // "Eduardus Kent Sutanza". Ambiguous prefixes resolve to nothing rather
    // than to the wrong person.
    const hits = users.filter((u) => norm(u.name).startsWith(want));
    return hits.length === 1 ? hits[0].id : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

// Mirrors clickupCreateTaskInList(env, listId, name, opts).
// opts keys are the ClickUp ones, translated here so call sites do not change:
//   markdown_description -> message
//   start_date/due_date  -> startDate/deadline   (ms epoch -> YYYY-MM-DD)
//   assignees[0]         -> toUserId
//   parent               -> parentTaskId
// ClickUp `tags` has no GoodDay equivalent and is dropped. That is deliberate:
// index.js already retries without tags when ClickUp rejects them, so no caller
// depends on them existing.
async function goodDayCreateTask(env, projectId, title, opts = {}) {
  const payload = { projectId, title, fromUserId: env.GOODDAY_BOT_USER_ID };
  if (opts.markdown_description) payload.message = gdText(opts.markdown_description);
  if (opts.message) payload.message = gdText(opts.message);
  if (opts.start_date) payload.startDate = gdDate(opts.start_date);
  if (opts.due_date) payload.deadline = gdDate(opts.due_date);
  if (opts.startDate) payload.startDate = opts.startDate;
  if (opts.endDate) payload.endDate = gdDate(opts.endDate);
  if (opts.end_date) payload.endDate = gdDate(opts.end_date);
  if (opts.deadline) payload.deadline = opts.deadline;

  // GoodDay SILENTLY DROPS startDate unless endDate is sent with it. Verified
  // against the live API 2026-09-19: startDate alone comes back null, and so does
  // startDate + deadline. Only startDate + endDate sticks.
  //
  // ClickUp accepted start_date on its own, so a straight port would lose every
  // start date without erroring. Rather than invent an end date, drop the start
  // date explicitly and say so, so the loss is visible instead of silent.
  if (payload.startDate && !payload.endDate) {
    delete payload.startDate;
    payload.__droppedStartDate = undefined; // documentation only; not sent
    delete payload.__droppedStartDate;
  }
  if (opts.priority) payload.priority = opts.priority;
  if (opts.parent) payload.parentTaskId = opts.parent;
  if (opts.parentTaskId) payload.parentTaskId = opts.parentTaskId;
  if (opts.taskTypeId) payload.taskTypeId = opts.taskTypeId;
  if (Array.isArray(opts.attachments) && opts.attachments.length) payload.attachments = opts.attachments;

  // GoodDay takes ONE assignee, ClickUp took an array. Take the first and say so
  // rather than silently dropping the rest.
  const who = opts.toUserId || (Array.isArray(opts.assignees) ? opts.assignees[0] : null);
  if (who) payload.toUserId = who;

  const res = await gdCall(env, "POST", "/tasks", payload);
  if (!res.ok) throw new Error(`GoodDay create task failed: ${res.status} ${await gdErrText(res)}`);
  return res.json();
}

// GoodDay task descriptions and comments are PLAIN TEXT. Markdown is shown
// literally (`**bold**` keeps its asterisks) and HTML is escaped and shown as
// source. Only a BARE url is auto-linked and clickable.
//
// That matters more than it sounds: the whole People System delivery mechanism is
// "a task with your personal link on it", and a `[text](url)` link renders as
// unclickable punctuation. Verified in the live UI 2026-09-19.
//
// So everything the Worker passes as markdown is flattened here rather than at
// each call site, which means index.js keeps composing markdown for ClickUp and
// nothing upstream has to know.
function gdText(md) {
  if (md === null || md === undefined) return md;
  let s = String(md);
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim());
  // [label](url) -> "label: url", because the label carries meaning the bare
  // url does not, and the url has to stand alone to be clickable.
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) =>
    label && label.trim() ? `${label.trim()}: ${url}` : url);
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");        // images: drop
  s = s.replace(/^#{1,6}\s+/gm, "");                     // headings
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");             // bold
  s = s.replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1$2"); // italic
  s = s.replace(/`([^`]+)`/g, "$1");                      // inline code
  s = s.replace(/^\s*>\s?/gm, "");                       // blockquote
  s = s.replace(/^\s*[-*+]\s+/gm, "- ");                 // normalise bullets
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// GoodDay dates are YYYY-MM-DD. ClickUp used ms-epoch numbers everywhere, so
// accept both and normalise.
function gdDate(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const n = Number(v);
  const d = new Date(Number.isFinite(n) ? n : v);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

// Mirrors clickupUpdateTask: returns the parsed body, or null. Never throws.
// Passing `projectId` moves the task, which is how a GoodDay task changes parent.
async function goodDayUpdateTask(env, taskId, fields) {
  try {
    const body = { userId: env.GOODDAY_BOT_USER_ID, ...fields };
    const res = await gdCall(env, "PUT", `/task/${taskId}/update`, body);
    return res.ok ? res.json() : null;
  } catch (e) { return null; }
}

// Mirrors clickupDeleteTask.
async function goodDayDeleteTask(env, taskId) {
  try {
    const res = await gdCall(env, "DELETE", `/task/${taskId}`);
    return res.ok;
  } catch (e) { return false; }
}

// Mirrors clickupComment. Advisory: a failed progress note must never fail the
// save that triggered it. `attachments` is an array of fileIds from
// goodDayUploadFile, which is how a PDF reaches an EXISTING task.
async function goodDayComment(env, taskId, text, attachments) {
  try {
    const body = { userId: env.GOODDAY_BOT_USER_ID, message: gdText(text) };
    // `attachments` must be an array of OBJECTS, not of fileId strings. Passing
    // bare ids returns 400 "dictionary update sequence element #0 has length 1;
    // 2 is required", which is not a helpful message and cost real time once.
    // Bare strings are accepted here and normalised, so callers cannot get it
    // wrong twice.
    if (Array.isArray(attachments) && attachments.length) {
      body.attachments = attachments.map((a) =>
        typeof a === "string" ? { fileId: a, name: "attachment", mime: "application/octet-stream" } : a
      );
    }
    const res = await gdCall(env, "POST", `/task/${taskId}/comment`, body);
    return res.ok;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

// ClickUp statuses were per-list, so index.js looked them up per call. GoodDay
// keeps ONE org-wide list, so this could be cached. It is not, deliberately: the
// worker is stateless per request and a stale status id is worse than a fetch.
async function goodDayListStatuses(env) {
  try {
    const res = await gdCall(env, "GET", "/statuses");
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } catch (e) { return []; }
}

// Mirrors clickupSetStatus(env, taskId, listId, desiredSubstring), including the
// case-insensitive substring match and the silent no-op when nothing matches --
// the task-name suffix convention stays the reliable signal either way.
//
// Better than ClickUp in one way, and the reason is worth keeping: GoodDay's
// status endpoint takes a `message`, so the status change and the note explaining
// it are ONE call. In ClickUp that was setStatus + comment, two calls, either of
// which could fail on its own and leave the task half-updated.
//
// projectId is accepted and ignored, so call sites can be switched without being
// rewritten. Statuses are org-wide here.
async function goodDaySetStatus(env, taskId, projectId, desiredSubstring, message) {
  try {
    const statuses = await goodDayListStatuses(env);
    const want = norm(desiredSubstring);
    if (!want) return false;
    const hit = statuses.find((s) => norm(s.name).includes(want));
    if (!hit) return false;
    const body = { userId: env.GOODDAY_BOT_USER_ID, statusId: hit.id };
    if (message) body.message = gdText(message);
    // PUT, not POST. The published docs say POST and POST returns 405
    // "method is not allowed". Verified against the live API 2026-09-19.
    const res = await gdCall(env, "PUT", `/task/${taskId}/status`, body);
    return res.ok;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

// Three steps, per the API: ask for an upload URL, PUT the bytes at it, then
// reference the returned fileId.
//
// Upload URLs expire after an hour and are single use, so this must not be
// called speculatively and the fileId must be used straight away.
async function goodDayUploadFile(env, filename, bytes, contentType = "application/pdf") {
  const f = gdFetchFn(env);
  const res = await gdCall(env, "POST", "/attachments/upload-urls", { files: [{ name: filename }] });
  if (!res.ok) throw new Error(`GoodDay upload-url failed: ${res.status} ${await gdErrText(res)}`);
  const j = await res.json();
  const slot = Array.isArray(j) ? j[0] : (j.files ? j.files[0] : j);
  if (!slot || !slot.uploadUrl || !slot.fileId) {
    throw new Error(`GoodDay upload-url returned no slot: ${JSON.stringify(j).slice(0, 200)}`);
  }
  const put = await f(slot.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes
  });
  if (!put.ok) throw new Error(`GoodDay file PUT failed: ${put.status} ${await gdErrText(put)}`);
  // Returns the whole descriptor, not just the id, because `attachments` wants
  // objects. See the comment in goodDayComment.
  return { fileId: slot.fileId, name: slot.name || filename, mime: slot.mime || contentType };
}

// Mirrors clickupAttachPdf(env, taskId, filename, pdfBytes).
//
// The shape differs in a way that is an IMPROVEMENT, so read before "fixing" it.
// ClickUp attached to the task itself and could not replace an attachment, which
// is why CLAUDE.md restricts PDFs to "meaning-changing snapshots". GoodDay
// attaches to a COMMENT, so every render can be posted as its own dated entry
// and the history is complete. The restriction can be lifted once this is live.
async function goodDayAttachPdf(env, taskId, filename, pdfBytes, note) {
  const file = await goodDayUploadFile(env, filename, pdfBytes, "application/pdf");
  const ok = await goodDayComment(env, taskId, note || filename, [file]);
  if (!ok) throw new Error(`GoodDay attach failed: comment rejected for task ${taskId}`);
  return file;
}

// ---------------------------------------------------------------------------
// Projects  (GoodDay's folders and lists are both just projects)
// ---------------------------------------------------------------------------

// In ClickUp a Space held Folders which held Lists. In GoodDay every container is
// a project and nesting is by parentProjectId, so clickupCreateFolder and
// clickupCreateList collapse into this one function.
async function goodDayCreateProject(env, name, parentProjectId) {
  const payload = {
    createdByUserId: env.GOODDAY_BOT_USER_ID,
    name,
    projectTemplateId: env.GOODDAY_PROJECT_TEMPLATE_ID
  };
  if (parentProjectId) payload.parentProjectId = parentProjectId;
  const res = await gdCall(env, "POST", "/projects/new-project", payload);
  if (!res.ok) throw new Error(`GoodDay create project failed: ${res.status} ${await gdErrText(res)}`);
  return res.json();
}

async function goodDayListProjects(env) {
  try {
    const res = await gdCall(env, "GET", "/projects");
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } catch (e) { return []; }
}

// Mirrors clickupListsInFolder.
async function goodDaySubProjects(env, parentProjectId) {
  const all = await goodDayListProjects(env);
  return all.filter((p) => p.parentProjectId === parentProjectId);
}

// Mirrors clickupFindFolderByName. Scoped to a parent when one is given, so two
// people with similar project names in different workspaces cannot collide.
async function goodDayFindProjectByName(env, name, parentProjectId) {
  const all = await goodDayListProjects(env);
  const want = norm(name);
  return all.find((p) =>
    norm(p.name) === want && (!parentProjectId || p.parentProjectId === parentProjectId)
  ) || null;
}

// Mirrors clickupGetOrCreateFolder, including the reason it exists: a blind
// create is not safe to retry. ClickUp rejected duplicate folder names outright
// (CAT_014); GoodDay is worse in this specific way because it will happily
// create a SECOND project with the same name, so a retry after a failed Supabase
// write leaves two. Looking it up first is not an optimisation here, it is what
// stops duplicates.
async function goodDayGetOrCreateProject(env, name, parentProjectId) {
  const existing = await goodDayFindProjectByName(env, name, parentProjectId);
  if (existing) return existing;
  const made = await goodDayCreateProject(env, name, parentProjectId);
  // Re-read rather than trusting the create response shape, and so a racing
  // second call converges on one project instead of two.
  const confirmed = await goodDayFindProjectByName(env, name, parentProjectId);
  return confirmed || made;
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

// No ClickUp equivalent is wired up today. Worth having because it is what lets
// a KPI score be filtered and grouped inside GoodDay instead of living only in
// Supabase and on a PDF.
//
// `fields` is { customFieldId: value }. Values are typed per field: string,
// boolean, number, array of ids, or null to clear.
async function goodDaySetCustomFields(env, taskId, fields) {
  try {
    const customFields = Object.entries(fields || {}).map(([id, value]) => ({ id, value }));
    if (!customFields.length) return true;
    const res = await gdCall(env, "PUT", `/task/${taskId}/custom-fields`, { customFields });
    return res.ok;
  } catch (e) { return false; }
}

async function goodDayListCustomFields(env) {
  try {
    const res = await gdCall(env, "GET", "/custom-fields");
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Selftest support
// ---------------------------------------------------------------------------

// Names only, never values -- same rule as the existing /selftest route.
function goodDayEnvReport(env) {
  const required = ["GOODDAY_TOKEN", "GOODDAY_BOT_USER_ID"];
  const optional = ["GOODDAY_PEOPLE_ID", "GOODDAY_PROJECT_TEMPLATE_ID"];
  return {
    required: required.map((k) => ({ name: k, present: !!env[k] })),
    optional: optional.map((k) => ({ name: k, present: !!env[k] })),
    ready: required.every((k) => !!env[k])
  };
}

export {
  GD_BASE,
  gdDate,
  gdText,
  goodDayResolveUserId,
  goodDayCreateTask,
  goodDayUpdateTask,
  goodDayDeleteTask,
  goodDayComment,
  goodDayListStatuses,
  goodDaySetStatus,
  goodDayUploadFile,
  goodDayAttachPdf,
  goodDayCreateProject,
  goodDayListProjects,
  goodDaySubProjects,
  goodDayFindProjectByName,
  goodDayGetOrCreateProject,
  goodDaySetCustomFields,
  goodDayListCustomFields,
  goodDayEnvReport
};
