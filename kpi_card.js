/* Single source of truth for the KPI result card markup + styles.
   Consumed by kpi_result_card.html (the filed record) and by kpi_scorecard.html's
   final step (the pre-file preview) so a supervisor approves exactly the document
   that gets filed.

   All selectors are scoped under .kpicard because kpi_scorecard.html has its own
   .chip / .head / .section rules that would otherwise collide.

   The worker renders the PDF from its own copy (kpiResultCardHtml in
   worker/index.js) since it can't load this file -- keep the two in step. */
(function () {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var band = function (v) { return v == null ? 'na' : v < 2.5 ? 'lo' : v < 3.5 ? 'mid' : 'hi'; };
  var bandLabel = function (v) { return v == null ? '—' : v < 2.5 ? 'Needs work' : v < 3.5 ? 'Fair' : 'Good'; };
  var f2 = function (v) { return v == null ? '—' : (+v).toFixed(2); };

  function html(p) {
    var catHtml = (p.categories || []).map(function (c) {
      var mrows = (c.metrics || []).map(function (m) {
        var hasSelf = !!(m.self != null || m.self_actual || m.self_note);
        var selfBody = hasSelf
          ? (m.self_actual ? '<div class="mp-line"><span class="mp-k">Actual</span>' + esc(m.self_actual) + '</div>' : '') +
            (m.self_note ? '<div class="mp-line"><span class="mp-k">Notes</span>' + esc(m.self_note) + '</div>' : '') +
            (!m.self_actual && !m.self_note ? '<div class="mp-empty">Rated, no written notes.</div>' : '')
          : '<div class="mp-empty">No self-assessment submitted.</div>';
        var spvBody = m.spv_note
          ? '<div class="mp-line"><span class="mp-k">Note</span>' + esc(m.spv_note) + '</div>'
          : '<div class="mp-empty">No note added.</div>';
        var targetBox = m.target
          ? '<div class="mtg"><span class="mtg-k">What was expected' + (p.level ? ' · ' + esc(p.level) : '') + '</span>' + esc(m.target) + '</div>'
          : '';
        return '<div class="mrow">' +
          '<div class="mrow-h"><div class="mname">' + esc(m.metric) + '</div>' +
          '<div class="mscores"><span class="chip self">' + (m.self == null ? '—' : m.self) + '</span>' +
          '<span class="chip official ' + band(m.spv) + '">' + (m.spv == null ? '—' : m.spv) + '</span></div></div>' +
          targetBox +
          '<div class="mpanels">' +
          '<div class="mp self"><div class="mp-h">Self</div>' + selfBody + '</div>' +
          '<div class="mp spv"><div class="mp-h">Supervisor</div>' + spvBody + '</div>' +
          '</div></div>';
      }).join('');
      var pct = c.spv != null ? Math.round(c.spv / 5 * 100) : 0;
      return '<div class="cat">' +
        '<div class="cathd"><div class="catname">' + esc(c.name) + '</div>' +
        '<div class="catscores"><span class="mut">self</span> <span class="chip self">' + f2(c.self) + '</span> ' +
        '<span class="mut">supervisor</span> <span class="chip official ' + band(c.spv) + '">' + f2(c.spv) + '</span></div></div>' +
        '<div class="bar"><div class="fill ' + band(c.spv) + '" style="width:' + pct + '%"></div></div>' +
        mrows +
        '</div>';
    }).join('');

    var focusHtml = (p.focus || []).filter(function (f) { return f && f.area; }).map(function (f) {
      return '<div class="frow">' +
        '<div class="farea">' + esc(f.area) +
        (f.source === 'supervisor' ? '<span class="src-spv">Added by supervisor</span>' : '') +
        (f.priority ? '<span class="pri ' + String(f.priority).toLowerCase() + '">' + esc(f.priority) + '</span>' : '') +
        '</div><div class="fgrid">' +
        '<div><span class="k">Why</span>' + esc(f.why || '—') + '</div>' +
        '<div><span class="k">Agreed action</span>' + esc(f.action || '—') + '</div>' +
        '<div><span class="k">How we measure</span>' + esc(f.measure || '—') + '</div>' +
        '</div></div>';
    }).join('') || '<p class="none">No focus areas recorded.</p>';

    var gap = (p.self_overall != null && p.official_kpi != null)
      ? (p.self_overall - p.official_kpi >= 0 ? '+' : '') + f2(p.self_overall - p.official_kpi)
      : null;

    return '<div class="doc">' +
      '<div class="head"><div>' +
      '<div class="eyebrow">KPI Scorecard · Result</div>' +
      '<h1>' + esc(p.editor) + '</h1>' +
      '<div class="meta"><b>' + esc(p.level || '—') + '</b> · ' + esc(p.quarter || '—') + ' · ' + esc(p.supervisor || 'Supervisor') + '</div>' +
      '</div><div class="official"><div class="scorebox n-' + band(p.official_kpi) + '">' +
      '<div class="lbl">Official KPI</div>' +
      '<div class="big">' + f2(p.official_kpi) + '</div>' +
      '<div class="sub">' + bandLabel(p.official_kpi) + ' · supervisor rating</div>' +
      '</div></div></div>' +
      (p.self_overall != null
        ? '<div class="section"><div class="calib">' +
          '<div class="c spv">Official (supervisor) <b>' + f2(p.official_kpi) + '</b></div>' +
          '<div class="c self">Self-assessment <b>' + f2(p.self_overall) + '</b></div>' +
          (gap != null ? '<div class="c gap">Calibration gap <b>' + gap + '</b></div>' : '') +
          '</div></div>'
        : '') +
      '<div class="section"><div class="stitle">Category breakdown</div>' +
      '<div class="scorekey"><span><i class="k-self"></i> Self — calibration only</span>' +
      '<span><i class="k-spv"></i> Supervisor — the KPI of record</span></div>' +
      (catHtml || '<p class="none">No category data.</p>') + '</div>' +
      '<div class="section"><div class="stitle">Focus for next quarter</div>' + focusHtml + '</div>' +
      '<div class="foot">Official record · supervisor rating is the KPI of record; self-assessment is calibration only. Case <b>' + esc(p.id || '') + '</b>.</div>' +
      '</div>';
  }

  var css = [
    '.kpicard{max-width:860px;margin:0 auto}',
    '.kpicard .doc{background:var(--card,#fff);border:1px solid var(--line,#e6e8eb);border-top:3px solid var(--kpi,#4f46e5);border-radius:14px;overflow:hidden;text-align:left}',
    '.kpicard .head{padding:24px 26px;border-bottom:1px solid var(--line,#e6e8eb);display:flex;justify-content:space-between;align-items:flex-start;gap:16px}',
    '.kpicard .eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--kpi,#4f46e5)}',
    '.kpicard h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:6px 0 0}',
    '.kpicard .meta{font-size:13px;color:var(--muted,#6b7280);margin-top:6px}',
    '.kpicard .meta b{color:var(--ink,#17191d);font-weight:600}',
    '.kpicard .official{text-align:center;flex:0 0 auto}',
    '.kpicard .official .scorebox{border-radius:14px;padding:13px 22px;min-width:132px;background:#fff;border:1.5px solid var(--line,#e6e8eb);box-shadow:0 6px 18px rgba(23,25,29,.07)}',
    '.kpicard .official .scorebox.n-lo{border-color:#f0c2b5;background:#fdf3f0}',
    '.kpicard .official .scorebox.n-mid{border-color:#ecd7ac;background:#fbf4e7}',
    '.kpicard .official .scorebox.n-hi{border-color:#bde5d6;background:#eff9f4}',
    '.kpicard .official .lbl{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#6b7280)}',
    '.kpicard .official .big{font-size:46px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--ink,#17191d)}',
    '.kpicard .official .scorebox.n-lo .big{color:#c4381d}',
    '.kpicard .official .scorebox.n-mid .big{color:#b45309}',
    '.kpicard .official .scorebox.n-hi .big{color:#1c8a68}',
    '.kpicard .official .sub{font-size:11.5px;color:var(--muted,#6b7280);margin-top:3px;font-weight:600}',
    '.kpicard .section{padding:22px 26px;border-bottom:1px solid var(--line,#e6e8eb)}',
    '.kpicard .section:last-child{border-bottom:none}',
    '.kpicard .stitle{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#6b7280);margin:0 0 14px}',
    '.kpicard .none{color:var(--muted,#6b7280);font-size:13px}',
    '.kpicard .calib{display:flex;gap:16px;align-items:center;background:#fafafb;border:1px solid var(--line,#e6e8eb);border-radius:10px;padding:12px 16px;margin-bottom:4px;flex-wrap:wrap}',
    '.kpicard .calib .c{font-size:13px;color:var(--muted,#6b7280);position:relative;padding-right:16px}',
    '.kpicard .calib .c b{color:var(--ink,#17191d)}',
    '.kpicard .calib .c:not(:last-child):after{content:"";position:absolute;right:0;top:2px;bottom:2px;width:1px;background:var(--line,#e6e8eb)}',
    '.kpicard .calib .c.gap b{color:var(--pip,#b45309)}',
    '.kpicard .calib .c.spv b{color:var(--kpi,#4f46e5)}',
    '.kpicard .calib .c.self b{color:#5b6472}',
    /* self = calibration only -> quiet outline; official = KPI of record -> solid band colour */
    '.kpicard .chip{display:inline-block;min-width:24px;text-align:center;border-radius:6px;padding:1px 7px;font-weight:700;font-size:12px}',
    '.kpicard .chip.self{background:#fff;color:#5b6472;border:1.5px solid #d8dce1}',
    '.kpicard .chip.official{color:#fff;border:1.5px solid transparent}',
    '.kpicard .chip.official.lo{background:var(--lo,#e0603b)}',
    '.kpicard .chip.official.mid{background:var(--mid,#e3a008);color:#3d2c00}',
    '.kpicard .chip.official.hi{background:var(--hi,#2f9e7e)}',
    '.kpicard .chip.official.na{background:var(--muted,#6b7280)}',
    '.kpicard .scorekey{display:flex;gap:14px;align-items:center;font-size:11px;color:var(--muted,#6b7280);margin:0 0 12px;flex-wrap:wrap}',
    '.kpicard .scorekey span{display:inline-flex;align-items:center;gap:6px}',
    '.kpicard .scorekey i{width:9px;height:9px;border-radius:3px;display:inline-block}',
    '.kpicard .scorekey i.k-self{background:#fff;border:1.5px solid #d8dce1}',
    '.kpicard .scorekey i.k-spv{background:var(--kpi,#4f46e5)}',
    '.kpicard .cat{margin-bottom:18px}',
    '.kpicard .cathd{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px;flex-wrap:wrap}',
    '.kpicard .catname{font-weight:700;font-size:14.5px}',
    '.kpicard .catscores{font-size:12px}',
    '.kpicard .mut{color:var(--muted,#6b7280);margin:0 3px 0 8px}',
    '.kpicard .bar{height:9px;background:#eef0f2;border-radius:99px;overflow:hidden;margin-bottom:10px}',
    '.kpicard .fill{height:100%;border-radius:99px}',
    '.kpicard .fill.lo{background:linear-gradient(90deg,#f0653d,#d5371c)}',
    '.kpicard .fill.mid{background:linear-gradient(90deg,#f7cf4d,#e3a008)}',
    '.kpicard .fill.hi{background:linear-gradient(90deg,#2ec295,#1f9a74)}',
    '.kpicard .fill.na{background:#cfd4da}',
    /* per-metric self-vs-supervisor comparison -- same visual language as the
       scorecard form itself (self = quiet slate, supervisor = indigo tint) so the
       result card reads as a continuation of the form, not a different document */
    '.kpicard .mrow{border:1px solid var(--line,#e6e8eb);border-radius:10px;padding:14px 16px;margin-bottom:12px}',
    '.kpicard .mrow-h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}',
    '.kpicard .mname{font-weight:700;font-size:14.5px}',
    '.kpicard .mscores{display:flex;gap:6px}',
    /* what the metric was measuring someone against -- same accent-tinted box the
       live scoring form uses for "Target", carried into the record so the score
       isn't orphaned from what it was actually scored against */
    '.kpicard .mtg{font-size:12.5px;color:#3b4250;background:var(--accent-soft,#eef0fe);border-left:3px solid var(--kpi,#4f46e5);border-radius:6px;padding:8px 11px;margin-bottom:12px;line-height:1.5}',
    '.kpicard .mtg-k{display:block;color:var(--kpi,#4f46e5);text-transform:uppercase;font-size:9.5px;letter-spacing:.06em;font-weight:800;margin-bottom:3px}',
    '.kpicard .mpanels{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.kpicard .mp{border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.55}',
    '.kpicard .mp.self{background:#f4f5f7;border:1px solid #e2e5e9}',
    '.kpicard .mp.spv{background:#f6f5fe;border:1px solid #e6e3fb}',
    '.kpicard .mp-h{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}',
    '.kpicard .mp.self .mp-h{color:#5b6472}',
    '.kpicard .mp.spv .mp-h{color:var(--kpi,#4f46e5)}',
    '.kpicard .mp-line{margin-bottom:4px}',
    '.kpicard .mp-line:last-child{margin-bottom:0}',
    '.kpicard .mp-k{display:block;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#6b7280);margin-bottom:1px}',
    '.kpicard .mp-empty{color:var(--muted,#6b7280);font-style:italic}',
    '@media(max-width:640px){.kpicard .mpanels{grid-template-columns:1fr}}',
    '.kpicard .frow{border:1px solid var(--line,#e6e8eb);border-radius:10px;padding:14px 16px;margin-bottom:10px}',
    '.kpicard .farea{font-weight:650;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}',
    '.kpicard .pri{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:5px}',
    '.kpicard .pri.high{color:var(--lo,#e0603b);background:#fbeae5}',
    '.kpicard .pri.medium{color:#b45309;background:#fdf3e8}',
    '.kpicard .pri.low{color:var(--muted,#6b7280);background:#f1f1f2}',
    '.kpicard .src-spv{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:5px;color:var(--kpi,#4f46e5);background:#eeecfd}',
    '.kpicard .fgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;font-size:12.5px}',
    '.kpicard .fgrid>div{padding:0 16px;position:relative}',
    '.kpicard .fgrid>div:first-child{padding-left:0}',
    '.kpicard .fgrid>div+div{border-left:1px solid var(--line,#e6e8eb)}',
    '.kpicard .fgrid .k{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#6b7280);margin-bottom:2px}',
    '.kpicard .fgrid .k:before{content:"";width:7px;height:7px;border-radius:2px;flex:0 0 auto;background:var(--muted,#6b7280)}',
    '.kpicard .fgrid>div:nth-child(2) .k{color:var(--kpi,#4f46e5)}',
    '.kpicard .fgrid>div:nth-child(2) .k:before{background:var(--kpi,#4f46e5)}',
    '.kpicard .fgrid>div:nth-child(3) .k{color:var(--hi,#2f9e7e)}',
    '.kpicard .fgrid>div:nth-child(3) .k:before{background:var(--hi,#2f9e7e)}',
    '.kpicard .foot{padding:16px 26px;font-size:11.5px;color:var(--muted,#6b7280);background:#fafafb}',
    '@media(max-width:640px){.kpicard .fgrid{grid-template-columns:1fr}' +
      '.kpicard .fgrid>div{padding:10px 0 0}' +
      '.kpicard .fgrid>div+div{border-left:0;border-top:1px solid var(--line,#e6e8eb);margin-top:6px}' +
      '.kpicard .head{flex-direction:column}}'
  ].join('\n');

  window.KPICARD = { css: css, html: html, band: band, f2: f2, bandLabel: bandLabel };
})();
