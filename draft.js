/* Local draft persistence for the People System forms.

   Every form here keeps what you type in memory only, and none of them write
   anything server-side until the final submit (KPI: /kpi/editor and
   /kpi/finalize; peer: /peer/submit; PIP: /pip/open). So a refresh, a crashed
   tab, a stray Ctrl+W -- or being told to hard-refresh to pick up a deploy --
   used to throw the whole sitting away. This keeps a copy in localStorage as
   you type and offers it back when you return.

   Deliberately client-only: no worker route, no schema change, nothing that has
   to deploy in step with anything else. A draft is cleared the moment its form
   submits successfully, so a filed case can never resurrect an old draft.

   Two rules this file must never break:

   1. Losing a draft must never break a form. Every entry point is wrapped in
      try/catch -- in a private window, with storage blocked, or over quota, the
      forms behave exactly as they did before this file existed.
   2. A draft is never applied silently. Restoring one quietly would let a
      supervisor open case B and see case A's answers with no idea why. Keys are
      per-case so that can't happen, and the caller still shows a banner naming
      what was restored and how old it is, with a way to discard it. */
(function () {
  var PREFIX = 'pps.draft.';
  var MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000; // 45 days, then it's stale enough to be noise

  function full(k) { return PREFIX + k; }

  function save(k, data) {
    if (!k) return;
    try { localStorage.setItem(full(k), JSON.stringify({ t: Date.now(), data: data })); } catch (e) {}
  }

  function read(k) {
    if (!k) return null;
    try {
      var raw = localStorage.getItem(full(k));
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.t !== 'number' || o.data == null) return null;
      if (Date.now() - o.t > MAX_AGE_MS) { clear(k); return null; }
      return o;
    } catch (e) { return null; }
  }

  function load(k) { var o = read(k); return o ? o.data : null; }
  function savedAt(k) { var o = read(k); return o ? o.t : null; }
  function clear(k) { if (!k) return; try { localStorage.removeItem(full(k)); } catch (e) {} }

  /* "3 minutes ago" -- deliberately coarse. The point is "is this mine, from
     just now?" not an audit timestamp. */
  function ago(t) {
    if (!t) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  /* Debounced writer. keyFn is a function because the key usually isn't known
     when the form wires its listeners -- the case id arrives later. Returning a
     no-op save when the key is still empty is intentional: better to drop a few
     early keystrokes than to write them under a key that means nothing. */
  function writer(keyFn, dataFn, ms) {
    var timer = null;
    return function () {
      try {
        clearTimeout(timer);
        timer = setTimeout(function () {
          try {
            var k = typeof keyFn === 'function' ? keyFn() : keyFn;
            if (k) save(k, dataFn());
          } catch (e) {}
        }, ms == null ? 400 : ms);
      } catch (e) {}
    };
  }

  /* Drop anything past MAX_AGE on load, so abandoned drafts don't accumulate on
     a shared machine. Cheap: these forms have at most a handful of entries. */
  (function sweep() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        var o = null;
        try { o = JSON.parse(localStorage.getItem(k)); } catch (e) {}
        if (!o || typeof o.t !== 'number' || Date.now() - o.t > MAX_AGE_MS) localStorage.removeItem(k);
      }
    } catch (e) {}
  })();

  window.DRAFT = { save: save, load: load, clear: clear, savedAt: savedAt, ago: ago, writer: writer };
})();
