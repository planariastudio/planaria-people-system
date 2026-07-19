/**
 * Planaria People System — CONFIG EDITOR (sheet -> Supabase)
 *
 * MODEL A: this spreadsheet is the MASTER for configuration (roster, levels,
 * rubrics, lists). A maintainer edits the plain tables here, clicks
 * "Planaria -> Sync config to LIVE", and every form updates.
 *
 * This is the file a future maintainer works in. They never touch code,
 * Supabase, or Cloudflare — they edit cells and click one menu button.
 *
 * ============================ ONE-TIME SETUP ============================
 * 1. Put this in the SAME Google Sheet as your response-mirror tabs (or a
 *    separate one — either works). Extensions -> Apps Script -> paste this in.
 * 2. Set the two script properties (Project Settings -> Script Properties):
 *      WORKER_URL        = https://planaria-people-worker.planariastudio.workers.dev
 *      CONFIG_SYNC_TOKEN = (a long random password you invent; must match the
 *                          CONFIG_SYNC_TOKEN secret you set in Cloudflare)
 * 3. Reload the Sheet. A "Planaria" menu appears.
 * 4. Click Planaria -> Pull LIVE config into sheet  (fills the tabs with your
 *    current live config so you start from real data, not blank).
 * 5. From now on: edit the config tabs, then Planaria -> Sync config to LIVE.
 *
 * ============================ HOW EDITING WORKS ============================
 * - Config_Roster:   one row per person. Columns: id, name, level, track, active
 * - Config_Levels:   the career ladder. Columns: key, label, sort_order
 * - Config_KPI:      one row per metric. Columns: id, category, metric, then one
 *                    column per level (intern..principal). Multiple bullet points
 *                    in a level = separate them with a newline (Alt+Enter) inside the cell.
 * - Config_Peer:     one row per value. Columns: id, cluster, value, then per-level cols.
 * - Config_PIP:      one row per competency. Columns: id, competency, kind, then per-level cols.
 * - Config_Lists:    special key/value settings (scale, severity_duration, supervisors,
 *                    pass_bar). Edit the JSON in the "value_json" column carefully.
 *
 * To ADD a KPI metric: add a new row, give it a new unique id (next number),
 * fill category + metric + each level cell. Sync. Done — it's on the form.
 * To REMOVE one: delete the row. Sync. It's gone from the form.
 */

const LEVEL_KEYS = ["intern", "jr", "assoc", "senior", "supervisor", "principal"];
var LEVEL_LABELS = { intern: "Intern", jr: "Junior", assoc: "Associate", senior: "Senior", supervisor: "Supervisor", principal: "Principal" };

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Planaria")
    .addItem("Pull LIVE config into sheet", "pullConfig")
    .addSeparator()
    .addItem("Sync config to LIVE", "syncConfig")
    .addToUi();
}

function props_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty("WORKER_URL");
  const token = p.getProperty("CONFIG_SYNC_TOKEN");
  if (!url || !token) throw new Error("Set WORKER_URL and CONFIG_SYNC_TOKEN in Script Properties first.");
  return { url, token };
}
// Pull is a read from the public GET /config endpoint -- it needs WORKER_URL
// but never the sync token, unlike syncConfig() which writes and must prove
// it's authorized. Using props_() here would wrongly block a pull-only setup
// that never got round to setting CONFIG_SYNC_TOKEN.
function urlProp_() {
  const url = PropertiesService.getScriptProperties().getProperty("WORKER_URL");
  if (!url) throw new Error("Set WORKER_URL in Script Properties first.");
  return url;
}

// ---------------------------------------------------------------------------
// PULL: live /config -> sheet tabs
// ---------------------------------------------------------------------------
function pullConfig() {
  const url = urlProp_();
  const res = UrlFetchApp.fetch(url + "/config", { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    SpreadsheetApp.getUi().alert("Could not pull config: " + res.getContentText());
    return;
  }
  const cfg = JSON.parse(res.getContentText());
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Refresh level labels from live config so rubric headers stay accurate.
  if (cfg.levels && cfg.levels.length) {
    LEVEL_LABELS = {};
    cfg.levels.forEach(l => { LEVEL_LABELS[l.key] = l.label; });
  }

  writeTable_(ss, "Config_Roster", ["id", "name", "level", "track", "active"],
    cfg.roster.map(r => [r.id, r.name, r.level, r.track || "", r.active === false ? false : true]));

  writeTable_(ss, "Config_Levels", ["key", "label", "sort_order"],
    cfg.levels.map(l => [l.key, l.label, l.sort_order]));

  writeRubric_(ss, "Config_KPI", ["id", "category", "metric"], cfg.kpi_rubric,
    r => [r.id, r.category, r.metric]);

  writeRubric_(ss, "Config_Peer", ["id", "cluster", "value"], cfg.peer_rubric,
    r => [r.id, r.cluster, r.value]);

  writeRubric_(ss, "Config_PIP", ["id", "competency", "kind"], cfg.pip_rubric,
    r => [r.id, r.competency, r.kind]);

  writeTable_(ss, "Config_Lists", ["key", "value_json"],
    cfg.lists.map(l => [l.key, JSON.stringify(l.value)]));

  SpreadsheetApp.getUi().alert("Pulled live config into the Config_* tabs. Edit there, then Sync.");
}

function writeTable_(ss, tabName, headers, rows, kind) {
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  sh.clear();
  sh.appendRow(headers);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  styleTab_(sh, headers.length, rows.length, kind || "config");
}

// House style: charcoal-slate ink, teal config headers, grey mirror headers,
// thin borders, wrap on, frozen header, sensible column widths. Matches xlsx.
function styleTab_(sh, nCols, nRows, kind, baseColCount) {
  const TEAL = "#3F6B61", GREY = "#6B7280", INK = "#233139", LINE = "#E6E8EB";
  const headerBg = kind === "mirror" ? GREY : TEAL;
  const hdr = sh.getRange(1, 1, 1, nCols);
  hdr.setBackground(headerBg).setFontColor("#FFFFFF").setFontWeight("bold")
     .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
  if (nRows > 0) {
    const body = sh.getRange(2, 1, nRows, nCols);
    body.setFontFamily("Arial").setFontColor(INK).setVerticalAlignment("top").setWrap(true);
  }
  const all = sh.getRange(1, 1, Math.max(nRows + 1, 1), nCols);
  all.setBorder(true, true, true, true, true, true, LINE, SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(1);
  // Column widths: base columns narrow-ish, level/bullet columns wide.
  const base = baseColCount || nCols;
  for (let c = 1; c <= nCols; c++) {
    sh.setColumnWidth(c, c <= base ? 150 : 240);
  }
  // Give roomy row height so wrapped bullets are visible.
  if (nRows > 0) sh.setRowHeights(2, nRows, 21);
}

// Rubric tabs: base columns + one column per level. Bullet arrays become
// newline-joined text in a cell.
function writeRubric_(ss, tabName, baseHeaders, rubricRows, baseVals) {
  const headers = baseHeaders.concat(LEVEL_KEYS.map(k => LEVEL_LABELS[k] || k));
  const rows = rubricRows.map(r => {
    const base = baseVals(r);
    const levelCells = LEVEL_KEYS.map(k => {
      const arr = (r.levels && r.levels[k]) || [];
      return arr.map(b => "\u2022  " + b).join("\n");
    });
    return base.concat(levelCells);
  });
  writeTableRubric_(ss, tabName, headers, rows, baseHeaders.length);
}

function writeTableRubric_(ss, tabName, headers, rows, baseColCount) {
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  sh.clear();
  sh.appendRow(headers);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  styleTab_(sh, headers.length, rows.length, "config", baseColCount);
}

// ---------------------------------------------------------------------------
// SYNC: sheet tabs -> /config/sync -> Supabase
// ---------------------------------------------------------------------------
function syncConfig() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert("Sync config to LIVE?",
    "This overwrites the live configuration that every form reads from. " +
    "Responses are NOT affected. Continue?", ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  const { url, token } = props_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const payload = { token };

  const rosterRows = readTable_(ss, "Config_Roster");
  if (rosterRows) payload.roster = rosterRows.map(r => ({
    id: String(r.id).trim(), name: r.name, level: r.level,
    track: r.track === "" ? null : r.track, active: r.active !== false && r.active !== "FALSE"
  }));

  const levelRows = readTable_(ss, "Config_Levels");
  if (levelRows) payload.levels = levelRows.map(r => ({
    key: String(r.key).trim(), label: r.label, sort_order: Number(r.sort_order)
  }));
  // Rubric tabs' level columns are headed by these labels (see writeRubric_/
  // readRubric_) -- refresh from the sheet's own Config_Levels first, so a
  // customized label still matches the column it was actually written under.
  if (payload.levels) {
    LEVEL_LABELS = {};
    payload.levels.forEach(l => { LEVEL_LABELS[l.key] = l.label; });
  }

  payload.kpi_rubric = readRubric_(ss, "Config_KPI", ["id", "category", "metric"]);
  payload.peer_rubric = readRubric_(ss, "Config_Peer", ["id", "cluster", "value"]);
  payload.pip_rubric = readRubric_(ss, "Config_PIP", ["id", "competency", "kind"]);

  const listRows = readTable_(ss, "Config_Lists");
  if (listRows) payload.lists = listRows.map(r => {
    let val;
    try { val = JSON.parse(r.value_json); }
    catch (e) { throw new Error(`Config_Lists row "${r.key}" has invalid JSON in value_json: ${e.message}`); }
    return { key: String(r.key).trim(), value: val };
  });

  // ---- VALIDATION: abort BEFORE any live write if anything is wrong ----
  const problems = validateConfig_(payload);
  if (problems.length) {
    ui.alert("Sync BLOCKED — fix these first (nothing was changed live):\n\n• " +
      problems.join("\n• "));
    return;
  }

  const res = UrlFetchApp.fetch(url + "/config/sync", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const out = res.getContentText();
  if (res.getResponseCode() !== 200) {
    ui.alert("Sync FAILED:\n\n" + out);
    return;
  }
  const j = JSON.parse(out);
  ui.alert("Synced to LIVE.\n\n" + JSON.stringify(j.synced, null, 2) +
    "\n\nForms will show the new config immediately.");
}

// Returns an array of human-readable problems. Empty array = safe to sync.
function validateConfig_(p) {
  const errs = [];

  // Level keys are the backbone — everything references them.
  let validLevelKeys = LEVEL_KEYS.slice();
  if (p.levels) {
    if (p.levels.length === 0) errs.push("Config_Levels is empty — the whole ladder would vanish.");
    validLevelKeys = p.levels.map(l => l.key);
    const seen = {};
    p.levels.forEach(l => {
      if (!l.key) errs.push("Config_Levels: a row is missing its key.");
      if (l.key && seen[l.key]) errs.push(`Config_Levels: duplicate key "${l.key}".`);
      seen[l.key] = true;
      if (l.sort_order === "" || isNaN(l.sort_order)) errs.push(`Config_Levels: "${l.key}" has a non-number sort_order.`);
    });
  }

  // Roster: unique ids, non-empty name, level must exist in the ladder.
  if (p.roster) {
    if (p.roster.length === 0) errs.push("Config_Roster is empty — no editors would exist.");
    const seen = {};
    p.roster.forEach((r, i) => {
      const where = r.name || r.id || `row ${i + 2}`;
      if (!r.id) errs.push(`Config_Roster: "${where}" is missing an id.`);
      if (r.id && seen[r.id]) errs.push(`Config_Roster: duplicate id "${r.id}".`);
      seen[r.id] = true;
      if (!r.name) errs.push(`Config_Roster: row with id "${r.id}" is missing a name.`);
      if (r.level && validLevelKeys.indexOf(r.level) === -1)
        errs.push(`Config_Roster: "${where}" has level "${r.level}" which is not in Config_Levels (valid: ${validLevelKeys.join(", ")}).`);
      if (r.track && ["ic", "mg"].indexOf(String(r.track)) === -1)
        errs.push(`Config_Roster: "${where}" has track "${r.track}" — only "ic", "mg", or blank are allowed.`);
    });
  }

  // Rubrics: unique numeric ids, required base fields, no fully-empty rows.
  checkRubric_(errs, p.kpi_rubric, "Config_KPI", ["category", "metric"], validLevelKeys);
  checkRubric_(errs, p.peer_rubric, "Config_Peer", ["cluster", "value"], validLevelKeys);
  checkRubric_(errs, p.pip_rubric, "Config_PIP", ["competency", "kind"], validLevelKeys);

  // Lists: required keys must be present and shaped right.
  if (p.lists) {
    const byKey = {};
    p.lists.forEach(l => { byKey[l.key] = l.value; });
    ["scale", "severity_duration", "supervisors", "pass_bar"].forEach(k => {
      if (!(k in byKey)) errs.push(`Config_Lists: required key "${k}" is missing.`);
    });
    if (byKey.supervisors && !Array.isArray(byKey.supervisors))
      errs.push('Config_Lists: "supervisors" value must be a JSON array, e.g. ["Joshua","Rashy"].');
  }

  return errs;
}

function checkRubric_(errs, rows, tab, requiredFields, validLevelKeys) {
  if (!rows) return;
  if (rows.length === 0) { errs.push(`${tab} is empty.`); return; }
  const seen = {};
  rows.forEach((r, i) => {
    const where = r[requiredFields[1]] || r[requiredFields[0]] || `row ${i + 2}`;
    if (r.id === "" || isNaN(r.id)) errs.push(`${tab}: "${where}" has a missing or non-numeric id.`);
    if (r.id !== "" && !isNaN(r.id) && seen[r.id]) errs.push(`${tab}: duplicate id ${r.id}.`);
    seen[r.id] = true;
    requiredFields.forEach(f => {
      if (!r[f] || String(r[f]).trim() === "") errs.push(`${tab}: "${where}" is missing "${f}".`);
    });
    // At least one level column should have content, else the row is meaningless.
    const anyLevel = validLevelKeys.some(k => r.levels && r.levels[k] && r.levels[k].length);
    if (!anyLevel) errs.push(`${tab}: "${where}" has no bullet text in ANY level column.`);
  });
}

// Reads a flat tab into array of {header: value} objects. Returns null if tab missing.
function readTable_(ss, tabName) {
  const sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return sh ? [] : null;
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i].every(c => c === "" || c === null)) continue; // skip blank rows
    const obj = {};
    headers.forEach((h, c) => { obj[h] = data[i][c]; });
    rows.push(obj);
  }
  return rows;
}

// Reads a rubric tab, rebuilding the nested levels {} object from per-level columns.
// A cell with newline-separated bullets becomes an array; a single line becomes a 1-item array.
function readRubric_(ss, tabName, baseHeaders) {
  const sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return sh ? [] : undefined;
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i].every(c => c === "" || c === null)) continue;
    const row = {};
    headers.forEach((h, c) => { row[h] = data[i][c]; });
    const rec = {};
    baseHeaders.forEach(h => { rec[h] = h === "id" ? Number(row[h]) : row[h]; });
    const levels = {};
    LEVEL_KEYS.forEach(k => {
      // Columns are written using the human label (LEVEL_LABELS), not the raw
      // key -- e.g. "jr" is written as header "Junior". Must read back by the
      // same label or every level column comes back empty and sync gets
      // blocked with "no bullet text in ANY level column" for every row.
      const header = LEVEL_LABELS[k] || k;
      const cell = row[header];
      if (cell === "" || cell === null || cell === undefined) { levels[k] = []; return; }
      levels[k] = String(cell).split("\n")
        .map(s => s.replace(/^[\s•·\-\*]+/, "").trim())
        .filter(Boolean);
    });
    rec.levels = levels;
    out.push(rec);
  }
  return out;
}
