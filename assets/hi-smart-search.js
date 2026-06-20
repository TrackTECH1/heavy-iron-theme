/* Heavy Iron — smart search: machine lookup + semantic product search + Shopify search */
(function () {
  'use strict';

  var CFG = window.HISmartSearch || {};
  var AGENT_EP = CFG.endpoint || '';
  var SEARCH_EP = CFG.searchEndpoint || '';
  var MIN = CFG.minChars || 3;
  var DEBOUNCE = CFG.debounceMs || 380;
  var machineCache = {};
  var semanticCache = {};
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

  function formatPrice(price) {
    if (price == null || price === '') return '';
    var n = Number(price);
    if (isNaN(n)) return '';
    return '$' + n.toFixed(2);
  }

  function renderMachineBlock(data) {
    if (!data || !data.found) return '';

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

    return (
      '<div class="hi-smart-search__block">' +
        '<p class="hi-smart-search__eyebrow">Machine match</p>' +
        '<p class="hi-smart-search__machine">' + esc(data.machine) + '</p>' +
        (extra ? '<p class="hi-smart-search__meta">' + esc(extra) + '</p>' : '') +
        (sizeHtml ? '<div class="hi-smart-search__sizes">' + sizeHtml + '</div>' : '') +
        (url ? '<a class="hi-smart-search__cta" href="' + esc(url) + '">See everything that fits →</a>' : '') +
      '</div>'
    );
  }

  function renderSemanticBlock(results) {
    if (!results || !results.length) return '';

    var items = results.slice(0, 6).map(function (r) {
      var href = r.url || (r.shopify_handle ? '/products/' + r.shopify_handle : '');
      var price = formatPrice(r.price);
      var score = r.similarity != null ? Math.round(r.similarity * 100) + '% match' : '';
      var meta = [price, score].filter(Boolean).join(' · ');
      var inner = esc(r.label || r.track_size || 'Track');
      if (href) {
        inner = '<a class="hi-smart-search__product-link" href="' + esc(href) + '">' + inner + '</a>';
      }
      return (
        '<li class="hi-smart-search__product">' +
          inner +
          (meta ? '<span class="hi-smart-search__product-meta">' + esc(meta) + '</span>' : '') +
        '</li>'
      );
    }).join('');

    return (
      '<div class="hi-smart-search__block hi-smart-search__block--semantic">' +
        '<p class="hi-smart-search__eyebrow">AI product matches</p>' +
        '<ul class="hi-smart-search__products">' + items + '</ul>' +
      '</div>'
    );
  }

  function renderPanel(panel, state, machineData, semanticResults) {
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
      panel.innerHTML = '<div class="hi-smart-search__inner"><p class="hi-smart-search__meta">Searching catalog…</p></div>';
      return;
    }

    var machineHtml = renderMachineBlock(machineData);
    var semanticHtml = renderSemanticBlock(semanticResults);
    if (!machineHtml && !semanticHtml) {
      renderPanel(panel, 'hide');
      return;
    }

    panel.hidden = false;
    panel.classList.remove('hi-smart-search--loading');
    panel.innerHTML =
      '<div class="hi-smart-search__inner">' +
        machineHtml +
        semanticHtml +
        '<p class="hi-smart-search__hint">Standard Shopify results appear below.</p>' +
      '</div>';
  }

  function fetchJson(url, body, signal) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal,
    }).then(function (r) { return r.json(); });
  }

  function lookup(q, panel) {
    if ((!AGENT_EP && !SEARCH_EP) || q.length < MIN) {
      renderPanel(panel, 'hide');
      return;
    }

    var cacheKey = q.toLowerCase();
    if (machineCache[cacheKey] !== undefined && semanticCache[cacheKey] !== undefined) {
      renderPanel(panel, 'done', machineCache[cacheKey], semanticCache[cacheKey]);
      return;
    }

    var prev = aborts.get(panel);
    if (prev) prev.abort();
    var ac = new AbortController();
    aborts.set(panel, ac);

    renderPanel(panel, 'loading');

    var machineP = AGENT_EP
      ? fetchJson(AGENT_EP, { make: q, model: '', question: q, session: session }, ac.signal)
          .catch(function () { return null; })
      : Promise.resolve(null);

    var semanticP = SEARCH_EP
      ? fetchJson(SEARCH_EP, { q: q, limit: 8 }, ac.signal)
          .then(function (d) { return (d && d.results) || []; })
          .catch(function () { return []; })
      : Promise.resolve([]);

    Promise.all([machineP, semanticP]).then(function (pair) {
      var machineData = pair[0];
      var semanticResults = pair[1];
      machineCache[cacheKey] = machineData;
      semanticCache[cacheKey] = semanticResults;
      renderPanel(panel, 'done', machineData, semanticResults);
    }).catch(function (e) {
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
    timers.set(input, setTimeout(function () { lookup(q, panel); }, DEBOUNCE));
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
    lookup(q, page);
  }

  function boot() {
    if (!AGENT_EP && !SEARCH_EP) return;
    document.querySelectorAll('input[type="search"].search__input').forEach(bindInput);
    initSearchPage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('shopify:section:load', boot);
})();
