/* Heavy Iron Supply Co - Compatible Machines hydration (canonical /pages/ links). */
(function () {
  'use strict';
  var SELECTOR = '[data-hi-compat]';
  var MODELS_PER_BRAND = 6;
  var ALIAS = { wacker: 'wacker-neuson', doosan: 'develon', caterpillar: 'cat' };
  var mapPromise = null;

  function fetchMap(url) {
    if (mapPromise) return mapPromise;
    mapPromise = fetch(url, { credentials: 'omit', cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function (e) { mapPromise = null; throw e; });
    return mapPromise;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function slug(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function makeSlug(name) { var s = slug(name); return ALIAS[s] || s; }
  function modelName(mo) { return (typeof mo === 'string') ? mo : (mo.name || mo.display_name || mo.handle || ''); }
  function modelUrl(mo, makeName) {
    if (mo && typeof mo === 'object' && mo.url && mo.url.indexOf('/pages/') === 0) return mo.url;
    return '/pages/model/' + makeSlug(makeName) + '-' + slug(modelName(mo));
  }

  function render(el, size, entry) {
    var machines = (entry && Array.isArray(entry.machines)) ? entry.machines : [];
    if (!machines.length) {
      el.innerHTML = '<p class="hi-compat__empty">No verified machine list for size <strong>' + esc(size) + '</strong> yet. <a href="/pages/contact">Contact us</a> or call (850) 816-7898.</p>';
      return;
    }
    var modelTotal = 0; for (var i = 0; i < machines.length; i++) modelTotal += (machines[i].models && machines[i].models.length) || 0;
    var parts = ['<div class="hi-compat__head"><span class="hi-compat__count">' + modelTotal + ' Compatible Model' + (modelTotal === 1 ? '' : 's') + '</span><span class="hi-compat__brands">' + machines.length + ' Brand' + (machines.length === 1 ? '' : 's') + '</span></div>'];
    machines.forEach(function (m) {
      var makeName = m.make || '';
      var models = Array.isArray(m.models) ? m.models : [];
      if (!models.length) return;
      var shown = models.slice(0, MODELS_PER_BRAND);
      var overflow = models.length - shown.length;
      var links = shown.map(function (mo) {
        return '<a class="hi-compat__model" href="' + esc(modelUrl(mo, makeName)) + '">' + esc(modelName(mo)) + '</a>';
      }).join('<span class="hi-compat__sep">,</span> ');
      if (overflow > 0) links += '<span class="hi-compat__sep">,</span> <a class="hi-compat__more" href="/pages/make/' + esc(makeSlug(makeName)) + '">+' + overflow + ' more</a>';
      parts.push('<div class="hi-compat__brand"><span class="hi-compat__brand-name">' + esc(makeName) + '</span><span class="hi-compat__models">' + links + '</span></div>');
    });
    parts.push('<p class="hi-compat__note">Click any model for tracks, undercarriage parts &amp; attachments.</p>');
    el.innerHTML = parts.join('');
  }

  function hydrate(el) {
    if (el.dataset.hiLoaded === '1') return; el.dataset.hiLoaded = '1';
    var size = el.getAttribute('data-track-size') || '';
    var mapUrl = el.getAttribute('data-map-url');
    if (!size || !mapUrl) return;
    fetchMap(mapUrl)
      .then(function (map) { render(el, size, map[size]); })
      .catch(function () { el.innerHTML = '<p class="hi-compat__empty">Fitment list temporarily unavailable. Call (850) 816-7898.</p>'; });
  }
  function init() { document.querySelectorAll(SELECTOR).forEach(hydrate); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();