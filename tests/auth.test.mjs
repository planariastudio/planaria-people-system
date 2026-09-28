// Tests for worker/auth.js: who may read or write a KPI / PIP case.
//
// Every failure here is a privacy failure, not a crash. A check that wrongly says
// yes shows one editor another editor's self-scores, or lets anyone overwrite a
// PIP. So the tests lean on the "no" cases.

import { test } from "node:test";
import assert from "node:assert/strict";

import { safeEqual, readAuth, isSupervisorKey, ownsCase, isSelf } from "../worker/auth.js";

const req = (headers) => ({ headers: new Map(Object.entries(headers)) });

test("safeEqual: equal strings match, anything else does not", () => {
  assert.equal(safeEqual("abc123", "abc123"), true);
  assert.equal(safeEqual("abc123", "abc124"), false);
  assert.equal(safeEqual("abc", "abc123"), false, "a prefix is not a match");
  assert.equal(safeEqual("abc123", "abc"), false);
  assert.equal(safeEqual("", ""), false, "two empty values never match");
  assert.equal(safeEqual(null, undefined), false);
});

test("readAuth reads headers and trims them", () => {
  const a = readAuth(req({ "x-spv-key": "  pw ", "x-editor-token": "tok" }));
  assert.deepEqual(a, { spvKey: "pw", editorToken: "tok" });
  assert.deepEqual(readAuth(req({})), { spvKey: "", editorToken: "" });
  assert.deepEqual(readAuth(null), { spvKey: "", editorToken: "" });
});

test("supervisor key: the SPV_KEY or the admin key, nothing else", () => {
  const env = { SPV_KEY: "spv-secret", PEER_ADMIN_KEY: "admin-secret" };
  assert.equal(isSupervisorKey(env, "spv-secret"), true);
  assert.equal(isSupervisorKey(env, "admin-secret"), true, "an admin is never locked out");
  assert.equal(isSupervisorKey(env, "wrong"), false);
  assert.equal(isSupervisorKey(env, ""), false);
});

test("supervisor key fails closed when no secret is set", () => {
  assert.equal(isSupervisorKey({}, "anything"), false);
  assert.equal(isSupervisorKey({ SPV_KEY: "" }, ""), false);
  assert.equal(isSupervisorKey(undefined, "x"), false);
});

test("an editor owns only their own case", () => {
  const davin = { id: "Davin Edbert", name: "Davin Edbert" };
  const fitra = { id: "Fitra Pratama", name: "Fitra Pratama" };
  const kase = { id: "KPI-2026-Q3-Davin-Edbert-01", editor_id: "Davin Edbert", editor_name: "Davin Edbert" };
  assert.equal(ownsCase(davin, kase), true);
  assert.equal(ownsCase(fitra, kase), false, "another editor cannot open it");
  assert.equal(ownsCase(null, kase), false, "no token, no case");
  assert.equal(ownsCase(davin, null), false);
});

test("older cases without editor_id still match by name, case-insensitively", () => {
  const kent = { id: "Eduardus Kent", name: "Eduardus Kent Sutanza" };
  assert.equal(ownsCase(kent, { editor_name: "eduardus kent sutanza" }), true);
  assert.equal(ownsCase(kent, { editor_name: "Eduardus Kent" }), false, "a partial name is not the same person");
});

test("an empty case never matches an editor", () => {
  const p = { id: "Reza Ali Akbar", name: "Reza Ali Akbar" };
  assert.equal(ownsCase(p, {}), false);
  assert.equal(ownsCase({}, { editor_id: "", editor_name: "" }), false);
});

test("isSelf: a token holder may only ask about themselves", () => {
  const nabil = { id: "Nabil Fadillah", name: "Nabil Fadillah Adipraja" };
  assert.equal(isSelf(nabil, "Nabil Fadillah Adipraja"), true);
  assert.equal(isSelf(nabil, "Nabil Fadillah"), true, "roster id works too");
  assert.equal(isSelf(nabil, "Reza Ali Akbar"), false);
  assert.equal(isSelf(nabil, ""), false);
  assert.equal(isSelf(null, "Nabil Fadillah Adipraja"), false);
});
