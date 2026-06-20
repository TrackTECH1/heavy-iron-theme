/* Heavy Iron — Find My Fit floating widget (lazy-loaded) */
(function () {
  'use strict';

  var CFG = window.HIFindMyFit || {};
  var EP = CFG.endpoint || '';
  var sid = 'hi-' + Math.random().toString(36).slice(2);
  var btn = document.getElementById('hi-agent-btn');
  var panel = document.getElementById('hi-agent-panel');
  var out = document.getElementById('hi-agent-out');
  var inp = document.getElementById('hi-agent-input');
  if (!btn || !panel || !out || !inp || !EP) return;

  function esc(s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  }

  function normalizeModelUrl(url) {
    return String(url || '').replace(/^https?:\/\/heavyironsupply\.com\/model\//i, '/pages/model/');
  }

  function openPanel() {
    btn.style.display = 'none';
    panel.classList.add('is-open');
    inp.focus();
  }

  function closePanel() {
    panel.classList.remove('is-open');
    btn.style.display = 'block';
  }

  function ask() {
    var q = inp.value.trim();
    if (!q) return;
    out.innerHTML = '<p>Looking up <b>' + esc(q) + '</b>…</p>';
    fetch(EP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: q, model: '', question: q, session: sid }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.found) {
          out.innerHTML =
            '<p>We don\'t have <b>' + esc(q) + '</b> in the catalog yet.</p>' +
            '<a class="hi-cta" href="/pages/quote">Request a quote →</a>';
          return;
        }
        var h = '<div class="hi-machine">' + esc(d.machine) + '</div>';
        if (d.track_sizes && d.track_sizes.length) {
          h += '<div class="hi-sub">Tracks that fit</div>';
          d.track_sizes.forEach(function (s) {
            h += '<div class="row"><b>' + esc(s.size) + '</b> — ' +
              (s.treads || []).map(esc).join(', ') + '</div>';
          });
        }
        if (d.undercarriage && d.undercarriage.length) {
          h += '<div class="hi-sub">Undercarriage that fits</div>';
          d.undercarriage.forEach(function (u) {
            h += '<div class="row">' + esc(u.part_type) +
              ' <span style="color:#999">x' + u.count + '</span></div>';
          });
        }
        var na = (d.attachment_categories || []).length;
        h += '<div class="hi-note">' +
          (na ? na + ' attachment categories also fit this machine.' : '') + '</div>';
        if (d.page_url) {
          h += '<a class="hi-cta" href="' + esc(normalizeModelUrl(d.page_url)) +
            '">See everything that fits your ' + esc(d.machine) + ' →</a>';
        }
        out.innerHTML = h;
      })
      .catch(function () {
        out.innerHTML = '<p>Something went wrong — please try again.</p>';
      });
  }

  btn.addEventListener('click', openPanel);
  document.getElementById('hi-agent-x').addEventListener('click', closePanel);
  document.getElementById('hi-agent-go').addEventListener('click', ask);
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
  document.querySelectorAll('[data-hi-fit-agent]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
  });

  window.HIFindMyFit = { open: openPanel, close: closePanel };
})();
