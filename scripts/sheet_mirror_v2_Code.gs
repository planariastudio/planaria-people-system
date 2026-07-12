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
 * 5. Peer_Assignments is NOT auto-filled -- it's your manual rater-matrix
 *    planning tab, same as in the original xlsx. Fill it in yourself.
 * 6. Peer_Summary and KPI_Summary formulas auto-extend as new editors show
 *    up in the raw data (see ensureSummaryRow below) -- you don't need to
 *    add rows by hand.
 */

const KPI_RAW_HEADERS = ["Timestamp", "Editor", "Level", "Quarter", "Official KPI", "Self Overall", "ClickUp Task", "Detail (JSON)"];
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

    if (body.sheet === "KPI") {
      const sheet = ss.getSheetByName("KPI_Raw");
      ensureHeaders(sheet, KPI_RAW_HEADERS);
      sheet.appendRow(body.row.values);
      ensureSummaryRow(ss.getSheetByName("KPI_Summary"), body.row.values[1], "KPI_Raw", "kpi");
    } else if (body.sheet === "Peer") {
      const sheet = ss.getSheetByName("Peer_Raw");
      ensureHeaders(sheet, PEER_RAW_HEADERS);
      sheet.appendRow(body.row.values);
      ensureSummaryRow(ss.getSheetByName("Peer_Summary"), body.row.values[2], "Peer_Raw", "peer");
    } else if (body.sheet === "PIP") {
      const sheet = ss.getSheetByName("PIP_Raw");
      ensureHeaders(sheet, PIP_RAW_HEADERS);
      upsertByFirstColumn(sheet, body.row.pip_id, body.row.values);
    } else {
      return jsonOut({ ok: false, error: "Unknown sheet: " + body.sheet });
    }
    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

function upsertByFirstColumn(sheet, key, values) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
    const idx = ids.indexOf(key);
    if (idx !== -1) {
      sheet.getRange(idx + 2, 1, 1, values.length).setValues([values]);
      return;
    }
  }
  sheet.appendRow(values);
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
