// Guards the handleListAssignments N+1 -> batched refactor: proves the batched
// completion lookup produces byte-identical rows to the old per-assignment query,
// across edge cases (missing token, non-roster rater, partial completion).
// Pure-function mirror; see the note in correctness.test.mjs about module split.
import { test } from "node:test";
import assert from "node:assert/strict";

const roster = [
  { id: "r1", name: "Davin Edbert", peer_token: "tokD" },
  { id: "r2", name: "Aqilla Fauzan", peer_token: "tokA" },
  { id: "r3", name: "No Token Yet", peer_token: null }
];
const assignments = [
  { id: 1, cycle: "Q3 2026", rater_name: "Davin Edbert", target_name: "Aqilla Fauzan" },
  { id: 2, cycle: "Q3 2026", rater_name: "Davin Edbert", target_name: "Rashy" },
  { id: 3, cycle: "Q3 2026", rater_name: "Aqilla Fauzan", target_name: "Davin Edbert" },
  { id: 4, cycle: "Q3 2026", rater_name: "No Token Yet", target_name: "Davin Edbert" },
  { id: 5, cycle: "Q3 2026", rater_name: "Ghost Person", target_name: "Davin Edbert" } // not in roster
];
const responses = [
  { rater: "tokD", target: "Aqilla Fauzan" },
  { rater: "tokA", target: "Davin Edbert" },
  { rater: "tokD", target: "Someone Else" }
];
const reminders = [{ rater_name: "Davin Edbert", task_id: "t1" }, { rater_name: "Aqilla Fauzan", task_id: null }];
const BASE = "https://x";

// ensureRaterLink: pure lookup, mints a token only when missing (one-time backfill)
function makeEnsure() {
  let counter = 0;
  return (rosterArr, name) => {
    const p = rosterArr.find((r) => r.name === name);
    if (!p) return null;
    if (!p.peer_token) p.peer_token = "gen" + ++counter;
    return { name: p.name, token: p.peer_token, link: BASE + "/peer_appraisal.html?t=" + p.peer_token };
  };
}

async function oldLogic() {                       // one response query PER assignment (N+1)
  const r = structuredClone(roster);
  const ensure = makeEnsure();
  const tasked = new Set(reminders.filter((x) => x.task_id).map((x) => x.rater_name));
  const out = [];
  for (const a of assignments) {
    const link = ensure(r, a.rater_name);
    const completed = link ? responses.some((x) => x.rater === link.token && x.target === a.target_name) : false;
    out.push({ id: a.id, rater_name: a.rater_name, target_name: a.target_name, completed, rater_link: link ? link.link : null, has_task: tasked.has(a.rater_name) });
  }
  return out;
}
async function newLogic() {                        // one batched response query + Set lookup
  const r = structuredClone(roster);
  const ensure = makeEnsure();
  const tasked = new Set(reminders.filter((x) => x.task_id).map((x) => x.rater_name));
  const doneKeys = new Set(responses.map((x) => `${x.rater} ${x.target}`));
  const out = [];
  for (const a of assignments) {
    const link = ensure(r, a.rater_name);
    const completed = link ? doneKeys.has(`${link.token} ${a.target_name}`) : false;
    out.push({ id: a.id, rater_name: a.rater_name, target_name: a.target_name, completed, rater_link: link ? link.link : null, has_task: tasked.has(a.rater_name) });
  }
  return out;
}

test("batched assignment completion is identical to the per-row version", async () => {
  const a = await oldLogic();
  const b = await newLogic();
  assert.deepEqual(b, a);
});

test("edge cases resolve as expected", async () => {
  const b = await newLogic();
  assert.equal(b.find((x) => x.id === 1).completed, true, "Davin->Aqilla submitted");
  assert.equal(b.find((x) => x.id === 2).completed, false, "Davin->Rashy not submitted");
  assert.equal(b.find((x) => x.id === 4).rater_link !== null, true, "missing-token rater gets a backfilled link");
  assert.equal(b.find((x) => x.id === 5).rater_link, null, "non-roster rater has no link");
});
