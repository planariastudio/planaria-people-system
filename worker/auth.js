// Who is allowed to read or write a KPI / PIP case.
//
// Before this module, the Worker trusted whoever called it. The supervisor
// password lived in kpi_scorecard.html itself (so anyone reading the page source
// had it), a ?kpi=<id> link skipped even that, and GET /kpi/:id, GET /pip/:id and
// POST /pip/:id/update answered anyone who knew or guessed a case id. Case ids
// follow a readable pattern (KPI-2026-Q3-<Name>-01), so "knew or guessed" was
// most of the team.
//
// Two kinds of caller, told apart by request header, never by query string (a
// query string ends up in browser history, server logs and screenshots):
//
//   x-spv-key       the supervisor password. Checked against the SPV_KEY secret.
//                   The admin key (PEER_ADMIN_KEY) is accepted too, so an admin
//                   is never locked out of a case they can already delete.
//   x-editor-token  an editor's personal token (roster.peer_token), the same one
//                   their personal link already carries. It only ever opens that
//                   editor's own case.
//
// Pure functions only. The Supabase lookup that turns a token into a person
// happens in index.js; everything that decides yes or no is here, where
// tests/auth.test.mjs can reach it.

// Compares two secrets without stopping at the first differing character, so the
// time a wrong guess takes does not reveal how much of it was right.
export function safeEqual(a, b) {
  const x = String(a == null ? "" : a);
  const y = String(b == null ? "" : b);
  if (!x || !y) return false;
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i % x.length) ^ y.charCodeAt(i % y.length));
  }
  return diff === 0;
}

export function readAuth(request) {
  const h = request && request.headers;
  const get = (k) => (h && typeof h.get === "function" ? h.get(k) : null) || "";
  return { spvKey: get("x-spv-key").trim(), editorToken: get("x-editor-token").trim() };
}

// Fails closed: with neither secret set, nobody is a supervisor.
export function isSupervisorKey(env, key) {
  if (!key) return false;
  if (env && env.SPV_KEY && safeEqual(key, env.SPV_KEY)) return true;
  if (env && env.PEER_ADMIN_KEY && safeEqual(key, env.PEER_ADMIN_KEY)) return true;
  return false;
}

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

// person: a roster row {id, name} resolved from the editor's token.
// Matches on the roster id first (what kpi_case.editor_id stores) and falls back
// to the display name, because older cases were written before editor_id was
// always filled in.
export function ownsCase(person, kase) {
  if (!person || !kase) return false;
  if (kase.editor_id && person.id && norm(kase.editor_id) === norm(person.id)) return true;
  if (kase.editor_name && person.name && norm(kase.editor_name) === norm(person.name)) return true;
  return false;
}

// For routes that name the editor in the request (?editor= or body.editor)
// rather than by case id: the token holder may only ask about themselves.
export function isSelf(person, editorName) {
  if (!person || !editorName) return false;
  return norm(editorName) === norm(person.name) || norm(editorName) === norm(person.id);
}

export const DENIED = { status: 401, message: "Supervisor password or personal link required." };
