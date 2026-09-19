// Guards the level-key normalisation in scripts/config_editor_Code.gs.
//
// Why this test exists: on 2026-09-19 a roster sync was blocked by 30+ errors that
// were all false. Config_Levels had "Senior" where the system uses "senior", and
// because the validator took its vocabulary from that hand-edited tab, every roster
// row reported an invalid level AND every row of all three rubrics reported "no
// bullet text in ANY level column" -- while the bullets were sitting right there.
// Nothing in the live system reads Config_Levels, so a cosmetic cell was blocking
// real config from shipping.
//
// The fix normalises instead of refusing. These cases pin the mapping, because the
// non-obvious ones are exactly where a future edit would go wrong: "Associate" maps
// to "assoc" and not "associate", and the forms' own short codes ("ve", "spv") are
// accepted so a value copied from the form side still resolves.
//
// The .gs file cannot be imported (Apps Script, wrong extension), so the pure
// helpers are evaluated out of it. Nothing at its top level touches SpreadsheetApp,
// so this is safe: function declarations hoist and none of them run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../scripts/config_editor_Code.gs", import.meta.url), "utf8");
const { normLevel_, LEVEL_KEYS } = new Function(
  `${src}\nreturn { normLevel_, LEVEL_KEYS };`
)();

test("canonical keys pass through unchanged", () => {
  for (const k of LEVEL_KEYS) assert.equal(normLevel_(k), k, `${k} should map to itself`);
});

test("the six levels are the ones the worker and forms agree on", () => {
  assert.deepEqual(LEVEL_KEYS, ["intern", "jr", "assoc", "senior", "supervisor", "principal"]);
});

test("capitalisation drift from the Google Sheet resolves", () => {
  // These are the literal values that were in Config_Levels when the sync broke.
  assert.equal(normLevel_("Intern"), "intern");
  assert.equal(normLevel_("Jr"), "jr");
  assert.equal(normLevel_("Associate"), "assoc");
  assert.equal(normLevel_("Senior"), "senior");
  assert.equal(normLevel_("Principal"), "principal");
  assert.equal(normLevel_("Supervisor"), "supervisor");
});

test("Associate maps to assoc, not associate", () => {
  // The one that is not just a lowercase: the roster and all three rubrics key
  // this level "assoc", so a naive toLowerCase() would still fail to match.
  assert.equal(normLevel_("Associate"), "assoc");
  assert.equal(normLevel_("Associate (Video Editor)"), "assoc");
  assert.notEqual(normLevel_("Associate"), "associate");
});

test("the label written on the rubric column headers resolves", () => {
  assert.equal(normLevel_("Associate (Video Editor)"), "assoc");
  assert.equal(normLevel_("Junior"), "jr");
});

test("the forms' short codes resolve", () => {
  // LVL_FROM_DB in the forms maps assoc->ve and supervisor->spv. Someone reading
  // that map and typing the right-hand side into the sheet should not break a sync.
  assert.equal(normLevel_("ve"), "assoc");
  assert.equal(normLevel_("spv"), "supervisor");
});

test("whitespace and inner spacing are tolerated", () => {
  assert.equal(normLevel_("  senior "), "senior");
  assert.equal(normLevel_("Associate  (Video  Editor)"), "assoc");
});

test("empty and missing values return empty, not a wrong level", () => {
  for (const v of ["", "   ", null, undefined]) assert.equal(normLevel_(v), "");
});

test("a genuine typo returns empty so the validator still reports it", () => {
  // The point of normalising is to stop blocking on cosmetics, not to silently
  // accept anything. "Snr" is not a level and must not resolve to one.
  for (const v of ["Snr", "seni0r", "lead", "Manager", "assoc."]) {
    assert.equal(normLevel_(v), "", `${v} must not resolve to a level`);
  }
});
