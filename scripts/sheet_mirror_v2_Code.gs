/**
 * Planaria People System — Master Data Mirror (v2)
 *
 * Mirrors the richer raw + live-formula-summary layout from the original
 * Planaria_People_System.xlsx, but fed automatically by the Cloudflare
 * Worker every time someone submits on the live web forms.
 *
 * Supabase remains the real source of truth. This sheet is a MIRROR for
 * easy viewing -- if this script ever fails, nothing breaks in the actual
 * forms (the Worker's push is fire-and-forget).
 *
 * SETUP:
 * 1. In your Google Sheet, create these tabs (exact names):
 *      KPI_Raw, KPI_Summary, Peer_Raw, Peer_Summary, Peer_Assignments, PIP_Raw
 * 2. Extensions -> Apps Script -> paste this whole file in, replacing the default code.
 * 3. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 * 4. Copy the /exec URL -> put it in Cloudflare as the SHEET_WEBHOOK_URL secret.
 * 5. Peer_Assignments is LEGACY -- rater assignment now lives in the
 *    links_admin.html portal (Supabase-backed), not this tab. This script never
 *    reads or writes it; kept only for historical reference in the sheet.
 * 6. Peer_Summary and KPI_Summary formulas auto-extend as new editors show
 *    up in the raw data (see ensureSummaryRow below) -- you don't need to
 *    add rows by hand.
 *
 * v2.1 — added Remove-cascades-to-Sheet support:
 * - KPI_Raw gained a trailing "Case ID" column and switched from append-only
 *   to upsert-by-id (same pattern PIP_Raw already used), so a case's row can
 *   be found and deleted. The column was added AT THE END on purpose -- an
 *   already-live sheet with existing formulas/data must never have a column
 *   inserted in the middle, which would silently shift everything after it.
 *   Existing historical rows simply have a blank Case ID (they predate the
 *   feature and were never individually deletable anyway); the header row
 *   extends itself automatically on first use, no manual sheet edit needed.
 * - Peer_Raw still has no single-column id (each row is a genuine one-time
 *   submission event, not something that gets upserted) -- delete instead
 *   matches the composite (Rater Token, Target, Cycle), which is already
 *   guaranteed unique server-side (one rating per rater per target per cycle).
 * - doPost now also accepts {action:"delete", sheet, key} from the Worker's
 *   Remove buttons, alongside the existing {sheet, row} push shape.
 */

const KPI_RAW_HEADERS = ["Timestamp", "Editor", "Level", "Quarter", "Official KPI", "Self Overall", "ClickUp Task", "Detail (JSON)", "Case ID"];
const PEER_RAW_HEADERS = [
  "Timestamp", "Rater Token", "Target", "Target Level", "Cycle",
  "Growth Potential", "Agility", "Continuous Improvement",
  "Teamwork", "Knowledge Sharing", "Conflict Resolution",
  "Communication & Handoff", "Visibility", "Deep Dive",
  "Accountability", "Reliability & Deadlines", "Fill-the-Gap Attitude", "Quality of Work",
  "Integrity", "Earn Trust",
  "Key Strengths", "Constructive", "Overall", "Track Reco"
];
const PIP_RAW_HEADERS = ["PIP ID", "Editor", "Level", "Managers", "Severity", "Start Date", "Result", "Verdict", "Final Review Date", "Summary", "ClickUp Task", "Updated At"];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.action === "delete") {
      return jsonOut(handleDeleteAction(ss, body));
    }

    if (body.sheet === "KPI") {
      const sheet = ss.getSheetByName("KPI_Raw");
      ensureHeaders(sheet, KPI_RAW_HEADERS);
      upsertByColumn(sheet, KPI_RAW_HEADERS.length, body.row.id, body.row.values);
      ensureSummaryRow(ss.getSheetByName("KPI_Summary"), body.row.values[1], "KPI_Raw", "kpi");
    } else if (body.sheet === "Peer") {
      const sheet = ss.getSheetByName("Peer_Raw");
      ensureHeaders(sheet, PEER_RAW_HEADERS);
      sheet.appendRow(body.row.values);
      ensureSummaryRow(ss.getSheetByName("Peer_Summary"), body.row.values[2], "Peer_Raw", "peer");
    } else if (body.sheet === "PIP") {
      const sheet = ss.getSheetByName("PIP_Raw");
      ensureHeaders(sheet, PIP_RAW_HEADERS);
      upsertByColumn(sheet, 1, body.row.pip_id, body.row.values);
    } else {
      return jsonOut({ ok: false, error: "Unknown sheet: " + body.sheet });
    }
    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/**
 * Routes a {action:"delete", sheet, key} request from a links_admin.html
 * Remove button to the right tab. Returns {ok:true} only if a matching row was
 * actually found and removed, so the caller can tell "deleted" from "wasn't
 * there to begin with" (the latter is normal -- e.g. a case removed before it
 * was ever filed has no Sheet row at all).
 */
function handleDeleteAction(ss, body) {
  if (body.sheet === "KPI") {
    return { ok: deleteByColumn(ss.getSheetByName("KPI_Raw"), KPI_RAW_HEADERS.length, body.key) };
  }
  if (body.sheet === "PIP") {
    return { ok: deleteByColumn(ss.getSheetByName("PIP_Raw"), 1, body.key) };
  }
  if (body.sheet === "Peer") {
    return { ok: deletePeerRow(ss.getSheetByName("Peer_Raw"), body.key) };
  }
  return { ok: false, error: "Unknown sheet for delete: " + body.sheet };
}

function ensureHeaders(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }
  // Backward-compatible self-migration: if this tab already had data before a
  // trailing column (e.g. Case ID) was added to the headers array, extend the
  // existing header row with just the missing labels. Nothing already in the
  // sheet shifts or gets touched -- this only ever writes into columns that
  // were previously blank.
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

// keyCol is 1-indexed (A=1). Used for both KPI_Raw (key in the LAST column,
// Case ID) and PIP_Raw (key in the FIRST column, PIP ID -- its original,
// unchanged layout).
function upsertByColumn(sheet, keyCol, key, values) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().map(r => r[0]);
    const idx = keys.indexOf(key);
    if (idx !== -1) {
      sheet.getRange(idx + 2, 1, 1, values.length).setValues([values]);
      return;
    }
  }
  sheet.appendRow(values);
}

function deleteByColumn(sheet, keyCol, key) {
  if (!sheet || key == null) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  const keys = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().map(r => r[0]);
  const idx = keys.indexOf(key);
  if (idx === -1) return false;
  sheet.deleteRow(idx + 2);
  return true;
}

// Peer_Raw has no single-column key -- match the composite that's already
// guaranteed unique server-side (one submitted rating per rater per target
// per cycle). key: {rater, target, cycle}. Columns are fixed by
// PEER_RAW_HEADERS: B=Rater Token, C=Target, E=Cycle.
function deletePeerRow(sheet, key) {
  if (!sheet || !key) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === key.rater && data[i][2] === key.target && data[i][4] === key.cycle) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

/**
 * Adds a live-formula row for `name` to the summary sheet if one doesn't
 * already exist. Formulas reference the raw tab directly (AVERAGEIF-style),
 * matching the original xlsx's approach -- fully transparent, no hidden
 * calculation logic, editable by you like any spreadsheet formula.
 */
function ensureSummaryRow(summarySheet, name, rawTabName, kind) {
  if (!summarySheet) return;
  if (summarySheet.getLastRow() === 0) {
    if (kind === "kpi") {
      summarySheet.appendRow(["Editor", "Submissions", "Latest Quarter", "Latest Official KPI", "Avg Official KPI (all time)"]);
    } else {
      summarySheet.appendRow(["Editor", "N Responses", "Overall Mean", "Min", "Max"]);
    }
    summarySheet.getRange(1, 1, 1, 5).setFontWeight("bold");
    summarySheet.setFrozenRows(1);
  }
  const lastRow = summarySheet.getLastRow();
  const existing = lastRow > 1 ? summarySheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]) : [];
  if (existing.indexOf(name) !== -1) return;

  const r = lastRow + 1;
  if (kind === "kpi") {
    summarySheet.appendRow([
      name,
      '=COUNTIF(' + rawTabName + '!B:B,A' + r + ')',
      '=IFERROR(INDEX(' + rawTabName + '!D:D,MATCH(2,1/(' + rawTabName + '!B:B=A' + r + '))),"")',
      '=IFERROR(INDEX(' + rawTabName + '!E:E,MATCH(2,1/(' + rawTabName + '!B:B=A' + r + '))),"")',
      '=IFERROR(AVERAGEIF(' + rawTabName + '!B:B,A' + r + ',' + rawTabName + '!E:E),"")'
    ]);
  } else {
    summarySheet.appendRow([
      name,
      '=COUNTIF(' + rawTabName + '!C:C,A' + r + ')',
      '=IFERROR(AVERAGEIF(' + rawTabName + '!C:C,A' + r + ',' + rawTabName + '!W:W),"")',
      '=IFERROR(MIN(FILTER(' + rawTabName + '!W:W,' + rawTabName + '!C:C=A' + r + ')),"")',
      '=IFERROR(MAX(FILTER(' + rawTabName + '!W:W,' + rawTabName + '!C:C=A' + r + ')),"")'
    ]);
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
