// Tests for worker/goodday.js.
//
// No network. Every test injects a fake fetch through env.__fetch and asserts on
// the request that would have gone out, because the thing most likely to be wrong
// in an integration layer is the shape of the payload, not the plumbing.
//
// The error-contract tests matter most: they are what stops someone "tidying"
// the advisory helpers into throwing ones and turning a failed progress comment
// into a failed KPI filing.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gdDate,
  goodDayResolveUserId,
  goodDayCreateTask,
  goodDayUpdateTask,
  goodDayDeleteTask,
  goodDayComment,
  goodDaySetStatus,
  goodDayUploadFile,
  goodDayAttachPdf,
  goodDayGetOrCreateProject,
  goodDaySetCustomFields,
  goodDayEnvReport
} from "../worker/goodday.js";

// --- helpers ---------------------------------------------------------------

function mkEnv(routes, extra = {}) {
  const calls = [];
  const env = {
    GOODDAY_TOKEN: "tok",
    GOODDAY_BOT_USER_ID: "bot-1",
    ...extra,
    __fetch: async (url, init = {}) => {
      // Only JSON bodies are parsed. The file PUT sends raw bytes, and an
      // earlier version of this harness ran JSON.parse over a Uint8Array --
      // which silently "worked" for a one-byte array ("1" parses as 1) and
      // blew up for anything longer. Keep the typeof check.
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      calls.push({ url, method: init.method || "GET", body, headers: init.headers });
      for (const [pattern, reply] of routes) {
        if (url.includes(pattern)) {
          const r = typeof reply === "function" ? reply({ url, init, body }) : reply;
          return mkRes(r);
        }
      }
      return mkRes({ status: 404, json: { error: "no route" } });
    }
  };
  return { env, calls };
}

function mkRes({ status = 200, json = {}, text = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => text || JSON.stringify(json)
  };
}

const last = (calls, pattern) => [...calls].reverse().find((c) => c.url.includes(pattern));

// --- date normalisation ----------------------------------------------------

test("gdDate turns ClickUp ms-epoch into GoodDay YYYY-MM-DD", () => {
  assert.equal(gdDate(Date.UTC(2026, 8, 19)), "2026-09-19");
  assert.equal(gdDate("2026-09-19"), "2026-09-19", "already-correct strings pass through");
  assert.equal(gdDate(""), undefined);
  assert.equal(gdDate(null), undefined);
  assert.equal(gdDate("not a date"), undefined, "garbage yields undefined, not Invalid Date");
});

// --- create ----------------------------------------------------------------

test("create sends the required trio and translates ClickUp opts", async () => {
  const { env, calls } = mkEnv([["/tasks", { json: { id: "T1" } }]]);
  await goodDayCreateTask(env, "P1", "KPI Q3 2026", {
    markdown_description: "body text",
    due_date: Date.UTC(2026, 8, 30),
    assignees: ["u-7", "u-8"],
    parent: "T-parent"
  });
  const c = last(calls, "/tasks");
  assert.equal(c.method, "POST");
  assert.equal(c.body.projectId, "P1");
  assert.equal(c.body.title, "KPI Q3 2026");
  assert.equal(c.body.fromUserId, "bot-1", "fromUserId is required by GoodDay and has no ClickUp equivalent");
  assert.equal(c.body.message, "body text", "markdown_description maps to message");
  assert.equal(c.body.deadline, "2026-09-30", "due_date maps to deadline, normalised");
  assert.equal(c.body.toUserId, "u-7", "first assignee only; GoodDay takes one");
  assert.equal(c.body.parentTaskId, "T-parent");
  assert.equal(c.headers["gd-api-token"], "tok");
});

test("create drops ClickUp tags rather than sending something GoodDay rejects", async () => {
  const { env, calls } = mkEnv([["/tasks", { json: { id: "T1" } }]]);
  await goodDayCreateTask(env, "P1", "x", { tags: ["kpi", "q3"] });
  const c = last(calls, "/tasks");
  assert.equal(c.body.tags, undefined);
});

test("create THROWS on failure, because a lost task must abort the save", async () => {
  const { env } = mkEnv([["/tasks", { status: 400, text: "bad request" }]]);
  await assert.rejects(
    () => goodDayCreateTask(env, "P1", "x"),
    /GoodDay create task failed: 400/
  );
});

// --- update / delete / comment: advisory contract ---------------------------

test("update returns null instead of throwing, matching clickupUpdateTask", async () => {
  const { env } = mkEnv([["/update", { status: 500, text: "boom" }]]);
  assert.equal(await goodDayUpdateTask(env, "T1", { title: "x" }), null);
});

test("update passing projectId is how a task moves project", async () => {
  const { env, calls } = mkEnv([["/update", { json: { ok: true } }]]);
  await goodDayUpdateTask(env, "T1", { projectId: "P2" });
  const c = last(calls, "/update");
  assert.equal(c.method, "PUT");
  assert.equal(c.body.projectId, "P2");
  assert.equal(c.body.userId, "bot-1");
});

test("delete and comment return false on failure, never throw", async () => {
  const { env } = mkEnv([
    ["/task/T1", { status: 403, text: "nope" }],
    ["/comment", { status: 500, text: "nope" }]
  ]);
  assert.equal(await goodDayDeleteTask(env, "T1"), false);
  assert.equal(await goodDayComment(env, "T1", "note"), false);
});

test("a comment failure cannot abort its caller even if fetch itself explodes", async () => {
  const env = {
    GOODDAY_TOKEN: "t", GOODDAY_BOT_USER_ID: "bot-1",
    __fetch: async () => { throw new Error("network down"); }
  };
  assert.equal(await goodDayComment(env, "T1", "note"), false);
  assert.equal(await goodDayDeleteTask(env, "T1"), false);
});

// --- status: the one-call improvement --------------------------------------

test("set status matches case-insensitively by substring, like ClickUp did", async () => {
  const { env, calls } = mkEnv([
    ["/statuses", { json: [{ id: "s1", name: "To Do" }, { id: "s2", name: "IN PROGRESS" }] }],
    ["/status", { json: { ok: true } }]
  ]);
  assert.equal(await goodDaySetStatus(env, "T1", "P1", "in progress"), true);
  const c = last(calls, "/task/T1/status");
  assert.equal(c.body.statusId, "s2");
});

test("set status carries its message in ONE call, where ClickUp needed two", async () => {
  const { env, calls } = mkEnv([
    ["/statuses", { json: [{ id: "s9", name: "Filed" }] }],
    ["/status", { json: { ok: true } }]
  ]);
  await goodDaySetStatus(env, "T1", "P1", "filed", "Filed by supervisor");
  const c = last(calls, "/task/T1/status");
  assert.equal(c.body.statusId, "s9");
  assert.equal(c.body.message, "Filed by supervisor");
});

test("set status no-ops when nothing matches, leaving the name suffix as the signal", async () => {
  const { env, calls } = mkEnv([["/statuses", { json: [{ id: "s1", name: "To Do" }] }]]);
  assert.equal(await goodDaySetStatus(env, "T1", "P1", "archived"), false);
  assert.equal(last(calls, "/task/T1/status"), undefined, "must not POST a status it could not resolve");
});

// --- attachments -----------------------------------------------------------

test("upload is request-url then PUT the bytes, and returns the fileId", async () => {
  const { env, calls } = mkEnv([
    ["/attachments/upload-urls", { json: [{ fileId: "F1", uploadUrl: "https://upload.example/F1" }] }],
    ["upload.example", { json: {} }]
  ]);
  const id = await goodDayUploadFile(env, "kpi.pdf", new Uint8Array([1, 2, 3]));
  assert.equal(id, "F1");
  const put = last(calls, "upload.example");
  assert.equal(put.method, "PUT");
  assert.equal(put.headers["Content-Type"], "application/pdf");
});

test("attach posts the fileId as a comment, which is how an EXISTING task gets a PDF", async () => {
  const { env, calls } = mkEnv([
    ["/attachments/upload-urls", { json: [{ fileId: "F2", uploadUrl: "https://upload.example/F2" }] }],
    ["upload.example", { json: {} }],
    ["/comment", { json: { ok: true } }]
  ]);
  const out = await goodDayAttachPdf(env, "T1", "kpi.pdf", new Uint8Array([1]), "Q3 result");
  assert.equal(out.fileId, "F2");
  const c = last(calls, "/comment");
  assert.deepEqual(c.body.attachments, ["F2"]);
  assert.equal(c.body.message, "Q3 result");
});

test("attach throws if the upload slot comes back malformed", async () => {
  const { env } = mkEnv([["/attachments/upload-urls", { json: [{}] }]]);
  await assert.rejects(
    () => goodDayUploadFile(env, "x.pdf", new Uint8Array([1])),
    /returned no slot/
  );
});

// --- projects --------------------------------------------------------------

test("get-or-create reuses an existing project instead of making a duplicate", async () => {
  const { env, calls } = mkEnv([
    ["/projects", { json: [{ id: "P9", name: "Julius", parentProjectId: "TEAM" }] }]
  ]);
  const p = await goodDayGetOrCreateProject(env, "Julius", "TEAM");
  assert.equal(p.id, "P9");
  assert.equal(last(calls, "new-project"), undefined, "must not create when one already exists");
});

test("get-or-create scopes the name match to the parent", async () => {
  const { env, calls } = mkEnv([
    ["/projects/new-project", { json: { id: "NEW" } }],
    ["/projects", { json: [{ id: "P9", name: "Julius", parentProjectId: "SOMEWHERE-ELSE" }] }]
  ]);
  await goodDayGetOrCreateProject(env, "Julius", "TEAM");
  const c = last(calls, "new-project");
  assert.ok(c, "a same-named project under a different parent must not be reused");
  assert.equal(c.body.parentProjectId, "TEAM");
  assert.equal(c.body.createdByUserId, "bot-1");
});

// --- custom fields ---------------------------------------------------------

test("custom fields are sent in GoodDay's {id,value} array shape", async () => {
  const { env, calls } = mkEnv([["/custom-fields", { json: { ok: true } }]]);
  await goodDaySetCustomFields(env, "T1", { cf_score: 4.1, cf_cycle: "Q3 2026" });
  const c = last(calls, "/task/T1/custom-fields");
  assert.equal(c.method, "PUT");
  assert.deepEqual(c.body.customFields, [
    { id: "cf_score", value: 4.1 },
    { id: "cf_cycle", value: "Q3 2026" }
  ]);
});

test("setting no custom fields is a no-op, not an empty PUT", async () => {
  const { env, calls } = mkEnv([["/custom-fields", { json: {} }]]);
  assert.equal(await goodDaySetCustomFields(env, "T1", {}), true);
  assert.equal(last(calls, "custom-fields"), undefined);
});

// --- user resolution -------------------------------------------------------

test("user resolution prefers email, because display names are not unique", async () => {
  const users = [
    { id: "u1", name: "Joshua Ervin Novaldi", primaryEmail: "a@x.com" },
    { id: "u2", name: "Joshua Ervin Novaldi", primaryEmail: "b@x.com" }
  ];
  const { env } = mkEnv([["/users", { json: users }]]);
  assert.equal(await goodDayResolveUserId(env, "b@x.com"), "u2");
  assert.equal(await goodDayResolveUserId(env, "Joshua Ervin Novaldi"), "u1", "exact name match takes the first");
});

test("a unique name prefix resolves, an ambiguous one does not", async () => {
  const users = [
    { id: "u1", name: "Eduardus Kent Sutanza", primaryEmail: "e@x.com" },
    { id: "u2", name: "Aqilla Fauzan", primaryEmail: "a@x.com" },
    { id: "u3", name: "Aqilla Fauziah", primaryEmail: "f@x.com" }
  ];
  const { env } = mkEnv([["/users", { json: users }]]);
  assert.equal(await goodDayResolveUserId(env, "Eduardus Kent"), "u1", "roster ids are short names");
  assert.equal(await goodDayResolveUserId(env, "Aqilla Fau"), null, "ambiguous must resolve to nothing, never to a guess");
  assert.equal(await goodDayResolveUserId(env, ""), null);
});

// --- env report ------------------------------------------------------------

test("env report names keys and never echoes values", () => {
  const r = goodDayEnvReport({ GOODDAY_TOKEN: "super-secret", GOODDAY_BOT_USER_ID: "bot-1" });
  assert.equal(r.ready, true);
  const flat = JSON.stringify(r);
  assert.ok(!flat.includes("super-secret"), "a secret value must never appear in the report");
  assert.equal(goodDayEnvReport({}).ready, false);
});
