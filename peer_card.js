/* Single source of truth for the pooled Peer Scorecard markup + styles.
   Consumed by peer_growth_view.html (the live, always-current view) and by
   worker/index.js's own copy (peerScorecardHtml) for the PDF attached to the
   ClickUp task at submission time -- keep the two in step, same reasoning as
   kpi_card.js for the KPI result card.

   All selectors are scoped under .peercard. peer_growth_view.html also uses
   plain .section/.stitle for its own page chrome (the "Load a scorecard" bar
   and loading/error placeholders) outside this module -- those stay defined
   on the page itself and are unaffected by this scoping. */
(function () {
  var CLUSTERS = [
    ['Underdog Mindset', ['Growth Potential', 'Agility', 'Continuous Improvement']],
    ['Selfless Collaboration', ['Teamwork', 'Knowledge Sharing', 'Conflict Resolution']],
    ['Clarity', ['Communication & Handoff', 'Visibility', 'Deep Dive']],
    ['Ownership', ['Accountability', 'Reliability & Deadlines', 'Fill-the-Gap Attitude', 'Quality of Work']],
    ['True Leadership', ['Integrity', 'Earn Trust']]
  ];
  var LVLNAME = { intern: 'Intern', jr: 'Junior', assoc: 'Video Editor', ve: 'Video Editor', senior: 'Senior', supervisor: 'Supervisor', principal: 'Principal' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var band = function (s) { return s == null ? 'na' : s < 2.5 ? 'lo' : s < 3.5 ? 'mid' : 'hi'; };
  var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  var fmt = function (x) { return x.toFixed(2); };

  function distBars(scores) {
    var c = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    scores.forEach(function (s) { c[s]++; });
    var max = Math.max(c[1], c[2], c[3], c[4], c[5], 1);
    var h = '<div class="dist">';
    for (var i = 1; i <= 5; i++) {
      var ht = c[i] ? Math.round(c[i] / max * 28) + 4 : 2;
      h += '<div class="dc"><div class="b on' + i + '" style="height:' + ht + 'px" title="' + c[i] + ' rated ' + i + '"></div><div class="n">' + i + '</div></div>';
    }
    return h + '</div>';
  }

  // S: {ratee, level, cycle, n, values:[{name,mean,scores}], track_reco, pooled_strengths, pooled_constructive}
  function html(S) {
    var V = {};
    (S.values || []).forEach(function (v) { V[v.name] = v.scores || []; });
    var known = CLUSTERS.reduce(function (a, c) { return a.concat(c[1]); }, []).filter(function (n) { return V[n] && V[n].length; });
    var extras = (S.values || []).map(function (v) { return v.name; }).filter(function (n) { return !CLUSTERS.some(function (c) { return c[1].indexOf(n) !== -1; }); });
    var allVals = known.concat(extras);
    if (!allVals.length) return '<div class="section"><div class="stitle">No score data</div></div>';
    var overall = mean(allVals.map(function (v) { return mean(V[v]); }));

    var clhtml = '';
    CLUSTERS.forEach(function (pair) {
      var cn = pair[0], vals = pair[1];
      var have = vals.filter(function (v) { return V[v] && V[v].length; });
      if (!have.length) return;
      var cm = mean(have.map(function (v) { return mean(V[v]); }));
      var b = band(cm);
      clhtml += '<div class="cl"><div class="cn">' + esc(cn) + '</div><div class="cm"><b class="cm-' + b + '">' + fmt(cm) + '</b><span>cluster mean</span></div></div>';
    });

    var vhtml = '';
    CLUSTERS.forEach(function (pair) {
      var cn = pair[0], vals = pair[1];
      var have = vals.filter(function (v) { return V[v] && V[v].length; });
      if (!have.length) return;
      vhtml += '<div class="clushd">' + esc(cn) + '</div>';
      have.forEach(function (v) {
        var m = mean(V[v]);
        vhtml += '<div class="val"><div class="vtop"><span class="vname">' + esc(v) + '</span><span class="vmean ' + band(m) + '">' + fmt(m) + '</span></div>' + distBars(V[v]) + '</div>';
      });
    });
    if (extras.length) {
      vhtml += '<div class="clushd">Other values</div>';
      extras.forEach(function (v) {
        var m = mean(V[v]);
        vhtml += '<div class="val"><div class="vtop"><span class="vname">' + esc(v) + '</span><span class="vmean ' + band(m) + '">' + fmt(m) + '</span></div>' + distBars(V[v]) + '</div>';
      });
    }

    var trackHtml = '';
    if (S.level === 'senior' && S.track_reco) {
      var t = S.track_reco, tot = (t.mg || 0) + (t.ic || 0) + (t.unsure || 0);
      var row = function (cls, lbl, c) {
        return '<div class="tr"><span class="lbl ' + cls + '">' + lbl + '</span><div class="track-bar"><div class="track-fill ' + cls + '" style="width:' + (tot ? Math.round(c / tot * 100) : 0) + '%"></div></div><span class="cnt">' + c + '</span></div>';
      };
      var lead = (t.mg || 0) >= (t.ic || 0) ? 'Management → Supervisor' : 'IC → Principal';
      trackHtml = '<div class="section"><div class="stitle">Track fit · peers\' read</div>' +
        '<div class="track"><div class="q">Which way is this senior growing?</div>' +
        '<div class="g">Aggregated peer recommendations. Developmental signal to inform the track decision — not a verdict.</div>' +
        '<div class="trbars">' + row('mg', 'Management → Supervisor', t.mg || 0) + row('ic', 'IC → Principal', t.ic || 0) + row('un', 'Too early to say', t.unsure || 0) + '</div>' +
        (tot ? '<div class="lean">Peers lean <b>' + esc(lead) + '</b> (' + Math.max(t.mg || 0, t.ic || 0) + ' of ' + tot + ').</div>' : '') +
        '</div></div>';
    }

    var li = function (x) { return '<li>' + esc(x) + '</li>'; };
    var pooled = ((S.pooled_strengths && S.pooled_strengths.length) || (S.pooled_constructive && S.pooled_constructive.length))
      ? '<div class="section"><div class="stitle">Pooled feedback</div>' +
        (S.pooled_strengths && S.pooled_strengths.length ? '<div class="pooled"><div class="who">Strengths</div><ul>' + S.pooled_strengths.map(li).join('') + '</ul></div>' : '') +
        (S.pooled_constructive && S.pooled_constructive.length ? '<div class="pooled"><div class="who">To grow</div><ul>' + S.pooled_constructive.map(li).join('') + '</ul></div>' : '') +
        '</div>'
      : '';

    return '<div class="head">' +
      '<div><div class="eyebrow">Peer Scorecard · developmental</div>' +
      '<h1>' + esc(S.ratee) + '</h1>' +
      '<div class="meta"><b>' + esc(LVLNAME[S.level] || S.level || '—') + '</b> · ' + esc(S.cycle) + ' · aggregated from <b>' + S.n + '</b> peer response' + (S.n > 1 ? 's' : '') + '</div>' +
      '</div>' +
      '<div class="overall"><div class="medal ' + band(overall) + '"><div class="lbl">Overall</div>' +
      '<div class="big">' + fmt(overall) + '</div>' +
      '<div class="sub">mean of ' + allVals.length + ' values</div></div></div>' +
      '</div>' +
      '<div class="anon"><div><b>Pooled from every response this cycle.</b> Scores are averaged across all raters, and the bars are shuffled so no single rater\'s row can be reconstructed. This only unlocks once at least two peers have responded. Developmental input, not a disciplinary record.</div></div>' +
      '<div class="section"><div class="stitle">Cluster means</div><div class="clusters">' + clhtml + '</div></div>' +
      '<div class="section"><div class="stitle">By value · mean + how peers rated (1–5)</div>' + vhtml + '</div>' +
      trackHtml + pooled +
      '<div class="foot">Peer Scorecard · pooled data · comments pooled when n&gt;1.</div>';
  }

  var css = [
    '.peercard{text-align:left}',
    '.peercard .head{padding:24px 26px;border-bottom:1px solid var(--line,#e6e8eb);display:flex;justify-content:space-between;align-items:flex-start;gap:16px}',
    '.peercard .eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--peer,#0d9488)}',
    '.peercard h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:6px 0 0}',
    '.peercard .meta{font-size:13px;color:var(--muted,#6b7280);margin-top:6px}',
    '.peercard .meta b{color:var(--ink,#17191d);font-weight:600}',
    '.peercard .overall{text-align:center;flex:0 0 auto}',
    '.peercard .overall .medal{border-radius:14px;padding:13px 22px;min-width:132px;background:#fff;border:1.5px solid var(--line,#e6e8eb);box-shadow:0 6px 18px rgba(23,25,29,.07)}',
    '.peercard .overall .medal.lo{border-color:#f0c2b5;background:#fdf3f0}',
    '.peercard .overall .medal.mid{border-color:#ecd7ac;background:#fbf4e7}',
    '.peercard .overall .medal.hi{border-color:#bde5d6;background:#eff9f4}',
    '.peercard .overall .lbl{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#6b7280)}',
    '.peercard .overall .big{font-size:42px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--ink,#17191d)}',
    '.peercard .overall .medal.lo .big{color:#c4381d}',
    '.peercard .overall .medal.mid .big{color:#b45309}',
    '.peercard .overall .medal.hi .big{color:#1c8a68}',
    '.peercard .overall .sub{font-size:11.5px;color:var(--muted,#6b7280);margin-top:3px;font-weight:600}',
    '.peercard .anon{display:flex;gap:10px;align-items:flex-start;background:var(--peer-bg,#e9f6f4);padding:12px 26px;font-size:12.5px;color:#0b6055;border-bottom:1px solid var(--line,#e6e8eb)}',
    '.peercard .anon b{color:#083f38}',
    '.peercard .section{padding:22px 26px;border-bottom:1px solid var(--line,#e6e8eb)}',
    '.peercard .section:last-child{border-bottom:none}',
    '.peercard .stitle{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#6b7280);margin:0 0 14px}',
    '.peercard .clusters{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:640px){.peercard .clusters{grid-template-columns:1fr}}',
    '.peercard .cl{border:1px solid var(--line,#e6e8eb);border-radius:9px;padding:11px 13px}',
    '.peercard .cl .cn{font-size:12px;font-weight:650;color:var(--peer,#0d9488)}',
    '.peercard .cl .cm{display:flex;align-items:baseline;gap:6px;margin-top:3px}',
    '.peercard .cl .cm b{font-size:20px;font-weight:800;letter-spacing:-.02em}',
    '.peercard .cl .cm span{font-size:11px;color:var(--muted,#6b7280)}',
    '.peercard .cl .cm .cm-hi{color:var(--hi,#2f9e7e)}.peercard .cl .cm .cm-mid{color:var(--mid-ink,#b45309)}.peercard .cl .cm .cm-lo{color:var(--lo,#e0603b)}',
    '.peercard .val{padding:11px 0;border-bottom:1px solid #f1f2f4}',
    '.peercard .val:last-child{border-bottom:none}',
    '.peercard .vtop{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}',
    '.peercard .vname{font-weight:600;font-size:13.5px}',
    '.peercard .vmean{font-weight:800;font-size:15px}',
    '.peercard .vmean.lo{color:var(--lo,#e0603b)}.peercard .vmean.mid{color:var(--mid-ink,#b45309)}.peercard .vmean.hi{color:var(--hi,#2f9e7e)}',
    '.peercard .dist{display:flex;gap:3px;align-items:flex-end;height:34px}',
    '.peercard .dc{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}',
    '.peercard .dc .b{width:100%;background:#eef0f2;border-radius:3px 3px 0 0;position:relative;min-height:2px}',
    '.peercard .dc .b.on1,.peercard .dc .b.on2{background:var(--lo,#e0603b)}',
    '.peercard .dc .b.on3{background:var(--mid,#e3a008)}',
    '.peercard .dc .b.on4,.peercard .dc .b.on5{background:var(--hi,#2f9e7e)}',
    '.peercard .dc .n{font-size:9px;color:var(--muted,#6b7280)}',
    '.peercard .clushd{grid-column:1/-1;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--peer,#0d9488);margin:14px 0 2px;padding-top:4px}',
    '.peercard .clushd:first-child{margin-top:0}',
    '.peercard .track{border:1px solid var(--line,#e6e8eb);border-radius:10px;padding:16px;background:#fafafb}',
    '.peercard .track .q{font-size:13px;font-weight:600;margin-bottom:4px}',
    '.peercard .track .g{font-size:12px;color:var(--muted,#6b7280);margin-bottom:12px}',
    '.peercard .trbars{display:flex;flex-direction:column;gap:8px}',
    '.peercard .tr{display:grid;grid-template-columns:170px 1fr 34px;gap:10px;align-items:center;font-size:13px}',
    '.peercard .tr .lbl{font-weight:600}',
    '.peercard .tr .lbl.mg{color:var(--kpi,#4f46e5)}.peercard .tr .lbl.ic{color:var(--peer,#0d9488)}.peercard .tr .lbl.un{color:var(--muted,#6b7280)}',
    '.peercard .tr .track-bar{height:16px;background:#eef0f2;border-radius:5px;overflow:hidden}',
    '.peercard .tr .track-fill{height:100%;border-radius:5px}',
    '.peercard .tr .track-fill.mg{background:var(--kpi,#4f46e5)}.peercard .tr .track-fill.ic{background:var(--peer,#0d9488)}.peercard .tr .track-fill.un{background:#c3c7cd}',
    '.peercard .tr .cnt{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}',
    '.peercard .lean{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:8px;background:var(--peer-bg,#e9f6f4);color:#0b6055}',
    '.peercard .lean b{color:#083f38}',
    '.peercard .pooled{border:1px solid var(--line,#e6e8eb);border-radius:10px;padding:14px 16px;margin-bottom:10px}',
    '.peercard .pooled .who{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b7280);margin-bottom:8px}',
    '.peercard .pooled ul{margin:0;padding-left:16px}',
    '.peercard .pooled li{margin:4px 0;font-size:13px}',
    '.peercard .foot{padding:16px 26px;font-size:11.5px;color:var(--muted,#6b7280);background:#fafafb}'
  ].join('\n');

  window.PEERCARD = { css: css, html: html, band: band, mean: mean, fmt: fmt, distBars: distBars, CLUSTERS: CLUSTERS, LVLNAME: LVLNAME };
})();
