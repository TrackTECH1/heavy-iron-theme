/* Heavy Iron — site-wide smart search: Supabase machine lookup + Shopify product search */
(function () {
  'use strict';

  var CFG = window.HISmartSearch || {};
  var EP = CFG.endpoint || '';
  var MIN = CFG.minChars || 3;
  var DEBOUNCE = CFG.debounceMs || 380;
  var cache = {};
  var timers = new WeakMap();
  var aborts = new WeakMap();
  var session = CFG.session || ('hi-search-' + Math.random().toString(36).slice(2));

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function normalizeModelUrl(url) {
    if (!url) return '';
    return url.replace(/^https?:\/\/heavyironsupply\.com\/model\//i, '/pages/model/');
  }

  function panelForInput(input) {
    var form = input.closest('form');
    if (!form) return null;
    return form.querySelector('[data-hi-smart-search-panel]');
  }

  function renderPanel(panel, state, data) {
    if (!panel) return;
    if (state === 'hide') {
      panel.hidden = true;
      panel.classList.remove('hi-smart-search--loading');
      panel.innerHTML = '';
      return;
    }
    if (state === 'loading') {
      panel.hidden = false;
      panel.classList.add('hi-smart-search--loading');
      panel.innerHTML = '<div class="hi-smart-search__inner"><p class="hi-smart-search__meta">Looking up your machine…</p></div>';
      return;
    }
    if (!data || !data.found) {
      panel.hidden = true;
      panel.classList.remove('hi-smart-search--loading');
      panel.innerHTML = '';
      return;
    }

    var sizes = (data.track_sizes || []).slice(0, 4);
    var sizeHtml = sizes.map(function (s) {
      var treads = (s.treads || []).slice(0, 2).join(', ');
      var label = esc(s.size) + (treads ? ' · ' + esc(treads) : '');
      return '<span class="hi-smart-search__size">' + label + '</span>';
    }).join('');

    var uc = (data.undercarriage_total || 0) > 0
      ? (data.undercarriage_total + ' undercarriage parts also fit.')
      : '';
    var attach = (data.attachment_categories || []).length
      ? (data.attachment_categories.length + ' attachment categories also fit.')
      : '';
    var extra = [uc, attach].filter(Boolean).join(' ');

    var url = normalizeModelUrl(data.page_url);
    panel.hidden = false;
    panel.classList.remove('hi-smart-search--loading');
    panel.innerHTML =
      '<div class="hi-smart-search__inner">' +
        '<p class="hi-smart-search__eyebrow">Machine match</p>' +
        '<p class="hi-smart-search__machine">' + esc(data.machine) + '</p>' +
        (extra ? '<p class="hi-smart-search__meta">' + esc(extra) + '</p>' : '') +
        (sizeHtml ? '<div class="hi-smart-search__sizes">' + sizeHtml + '</div>' : '') +
        (url ? '<a class="hi-smart-search__cta" href="' + esc(url) + '">See everything that fits →</a>' : '') +
        '<p class="hi-smart-search__hint">Product matches appear below.</p>' +
      '</div>';
  }

  function fetchMachine(q, panel) {
    if (!EP || q.length < MIN) {
      renderPanel(panel, 'hide');
      return;
    }

    if (cache[q]) {
      renderPanel(panel, 'done', cache[q]);
      return;
    }

    var prev = aborts.get(panel);
    if (prev) prev.abort();
    var ac = new AbortController();
    aborts.set(panel, ac);

    renderPanel(panel, 'loading');

    fetch(EP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: q, model: '', question: q, session: session }),
      signal: ac.signal,
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        cache[q] = d;
        renderPanel(panel, 'done', d);
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return;
        renderPanel(panel, 'hide');
      });
  }

  function schedule(input) {
    var panel = panelForInput(input);
    if (!panel) return;
    var q = (input.value || '').trim();
    clearTimeout(timers.get(input));
    if (!q || q.length < MIN) {
      renderPanel(panel, 'hide');
      return;
    }
    timers.set(input, setTimeout(function () { fetchMachine(q, panel); }, DEBOUNCE));
  }

  function bindInput(input) {
    if (input.dataset.hiSmartBound === '1') return;
    input.dataset.hiSmartBound = '1';
    input.addEventListener('input', function () { schedule(input); });
    input.addEventListener('focus', function () {
      if ((input.value || '').trim().length >= MIN) schedule(input);
    });
    input.form && input.form.addEventListener('reset', function () {
      renderPanel(panelForInput(input), 'hide');
    });
  }

  function initSearchPage() {
    var page = document.getElementById('hi-smart-search-page');
    if (!page) return;
    var params = new URLSearchParams(window.location.search);
    var q = (params.get('q') || '').trim();
    if (!q || q.length < MIN) return;
    fetchMachine(q, page);
  }

  function boot() {
    if (!EP) return;
    document.querySelectorAll('input[type="search"].search__input').forEach(bindInput);
    initSearchPage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('shopify:section:load', boot);
})();
