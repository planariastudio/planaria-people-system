// Guards scripts/sheet_mirror_v2_Code.gs's header self-migration and the new
// delete-by-key logic that backs the "Remove also deletes the Sheet row"
// feature in links_admin.html. Ported from the .gs file since Apps Script
// isn't runnable under Node -- keep these two in step by hand if the .gs
// logic changes.
//
// The property that matters most: KPI_Raw's new "Case ID" column was added at
// the END of the header row, not inserted at the front, specifically so an
// already-live sheet with real historical data and hand-written formulas is
// never disturbed. The migration test below is the proof of that.
import { test } from "node:test";
import assert from "node:assert/strict";

class FakeSheet {
  constructor(rows) { this.rows = rows.map((r) => r.slice()); } // rows[0] = header row (or [] if empty)
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length ? Math.max(...this.rows.map((r) => r.length)) : 0; }
  getRange(row, col, numRows, numCols) {
    const self = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < (numRows || 1); r++) {
          const src = self.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < (numCols || 1); c++) line.push(src[col - 1 + c] ?? "");
          out.push(line);
        }
        return out;
      },
      setValues(vals) {
        for (let r = 0; r < vals.length; r++) {
          const targetRow = row - 1 + r;
          while (self.rows.length <= targetRow) self.rows.push([]);
          for (let c = 0; c < vals[r].length; c++) self.rows[targetRow][col - 1 + c] = vals[r][c];
        }
      },
      setFontWeight() {}
    };
  }
  appendRow(values) { this.rows.push(values.slice()); }
  deleteRow(rowNum) { this.rows.splice(rowNum - 1, 1); }
  setFrozenRows() {}
}

// --- ported logic (must match sheet_mirror_v2_Code.gs exactly) ---
function ensureHeaders(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }
  const width = sheet.getLastColumn();
  const currentHeaders = width > 0 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  let existingWidth = 0;
  for (let i = 0; i < currentHeaders.length; i++) if (currentHeaders[i] !== "") existingWidth = i + 1;
  if (existingWidth < headers.length) {
    const missing = headers.slice(existingWidth);
    sheet.getRange(1, existingWidth + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, existingWidth + 1, 1, missing.length).setFontWeight("bold");
  }
}
function upsertByColumn(sheet, keyCol, key, values) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().map((r) => r[0]);
    const idx = keys.indexOf(key);
    if (idx !== -1) { sheet.getRange(idx + 2, 1, 1, values.length).setValues([values]); return; }
  }
  sheet.appendRow(values);
}
function deleteByColumn(sheet, keyCol, key) {
  if (!sheet || key == null) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  const keys = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().map((r) => r[0]);
  const idx = keys.indexOf(key);
  if (idx === -1) return false;
  sheet.deleteRow(idx + 2);
  return true;
}
function deletePeerRow(sheet, key) {
  if (!sheet || !key) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === key.rater && data[i][2] === key.target && data[i][4] === key.cycle) { sheet.deleteRow(i + 2); return true; }
  }
  return false;
}

const KPI_RAW_HEADERS = ["Timestamp", "Editor", "Level", "Quarter", "Official KPI", "Self Overall", "ClickUp Task", "Detail (JSON)", "Case ID"];
const OLD_HEADER = ["Timestamp", "Editor", "Level", "Quarter", "Official KPI", "Self Overall", "ClickUp Task", "Detail (JSON)"];

function makeLiveSheet() {
  return new FakeSheet([
    OLD_HEADER,
    ["2026-01-05T00:00:00Z", "Davin Edbert", "jr", "Q1 2026", 3.2, 3.0, "t100", "{}"],
    ["2026-04-02T00:00:00Z", "Aqilla Fauzan", "intern", "Q2 2026", 3.5, 3.3, "t200", "{}"]
  ]);
}

test("migrating an existing live sheet extends the header without touching data", () => {
  const sheet = makeLiveSheet();
  ensureHeaders(sheet, KPI_RAW_HEADERS);
  assert.equal(sheet.rows[0].length, 9);
  assert.equal(sheet.rows[0][8], "Case ID");
  assert.deepEqual(sheet.rows[0].slice(0, 8), OLD_HEADER, "existing header labels A-H must be untouched");
  assert.deepEqual(sheet.rows[1].slice(0, 8), makeLiveSheet().rows[1], "historical data rows must be byte-identical");
  assert.ok(sheet.rows[1][8] === undefined || sheet.rows[1][8] === "", "historical rows never had a Case ID and shouldn't get one retroactively");
});

test("upsert appends a new row keyed on the trailing Case ID column", () => {
  const sheet = makeLiveSheet();
  ensureHeaders(sheet, KPI_RAW_HEADERS);
  upsertByColumn(sheet, 9, "KPI-2026-Q3-Fitra-Pratama-01",
    ["2026-07-20T00:00:00Z", "Fitra Pratama", "senior", "Q3 2026", 4.0, 3.8, "t300", "{}", "KPI-2026-Q3-Fitra-Pratama-01"]);
  assert.equal(sheet.getLastRow(), 4);
  assert.equal(sheet.rows[3][8], "KPI-2026-Q3-Fitra-Pratama-01");
});

test("re-pushing the same case id updates in place instead of duplicating", () => {
  const sheet = makeLiveSheet();
  ensureHeaders(sheet, KPI_RAW_HEADERS);
  const row = (v) => ["2026-07-20T00:00:00Z", "Fitra Pratama", "senior", "Q3 2026", v, 3.8, "t300", "{}", "KPI-2026-Q3-Fitra-Pratama-01"];
  upsertByColumn(sheet, 9, "KPI-2026-Q3-Fitra-Pratama-01", row(4.0));
  upsertByColumn(sheet, 9, "KPI-2026-Q3-Fitra-Pratama-01", row(4.2));
  assert.equal(sheet.getLastRow(), 4, "must still be one row, not two");
  assert.equal(sheet.rows[3][4], 4.2, "the row's content is the latest push");
});

test("delete by case id removes exactly the matching row", () => {
  const sheet = makeLiveSheet();
  ensureHeaders(sheet, KPI_RAW_HEADERS);
  upsertByColumn(sheet, 9, "KPI-2026-Q3-Fitra-Pratama-01",
    ["2026-07-20T00:00:00Z", "Fitra Pratama", "senior", "Q3 2026", 4.0, 3.8, "t300", "{}", "KPI-2026-Q3-Fitra-Pratama-01"]);
  assert.equal(deleteByColumn(sheet, 9, "KPI-2026-Q3-Fitra-Pratama-01"), true);
  assert.equal(sheet.getLastRow(), 3, "back to just the header + 2 historical rows");
});

test("deleting a case that was never filed (no Sheet row) is a safe no-op", () => {
  const sheet = makeLiveSheet();
  ensureHeaders(sheet, KPI_RAW_HEADERS);
  assert.equal(deleteByColumn(sheet, 9, "KPI-NEVER-FILED-01"), false);
  assert.equal(sheet.getLastRow(), 3, "nothing removed");
});

test("Peer_Raw delete matches the exact composite (rater, target, cycle)", () => {
  const sheet = new FakeSheet([
    ["Timestamp", "Rater Token", "Target", "Target Level", "Cycle"],
    ["t1", "tokDavin", "Aqilla Fauzan", "intern", "Q3 2026"],
    ["t2", "tokRashy", "Aqilla Fauzan", "intern", "Q3 2026"]
  ]);
  assert.equal(deletePeerRow(sheet, { rater: "tokDavin", target: "Aqilla Fauzan", cycle: "Q3 2026" }), true);
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(deletePeerRow(sheet, { rater: "tokDavin", target: "Aqilla Fauzan", cycle: "Q3 2026" }), false, "already gone, must not match again");
  assert.equal(sheet.rows[1][1], "tokRashy", "the other rater's row for the same target/cycle is untouched");
});
