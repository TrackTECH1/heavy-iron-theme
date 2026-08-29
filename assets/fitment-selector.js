/* TrackTECH — governed machine fitment helper.
   Uses only embedded custom.fitments data projected from the certified graph.
   It never fetches legacy static maps and never blocks checkout. */
(function () {
  'use strict';

  var MAKE_LOOKUP = {
    Caterpillar: 'Cat', CAT: 'Cat', cat: 'Cat',
    Wacker: 'Wacker Neuson', Doosan: 'Develon'
  };

  function opt(v, t) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = t || v;
    return o;
  }

  function canonMake(k) {
    k = (k || '').trim();
    return MAKE_LOOKUP[k] || k;
  }

  function groupByMake(rows) {
    var map = {};
    rows.forEach(function (row) {
      var k = canonMake((row.k || '').trim());
      var m = (row.m || '').trim();
      if (!k || !m) return;
      var label = m;
      if (m.toLowerCase().indexOf(k.toLowerCase() + ' ') === 0) {
        label = m.slice(k.length + 1).trim() || m;
      }
      if (!map[k]) map[k] = [];
      if (map[k].indexOf(label) === -1) map[k].push(label);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) {
        return a.localeCompare(b, undefined, { numeric: true });
      });
    });
    return map;
  }

  function wire(el, rows) {
    var grouped = groupByMake(rows);
    var makes = Object.keys(grouped).sort(function (a, b) { return a.localeCompare(b); });
    var makeSel = el.querySelector('[data-fit-make]');
    var modelSel = el.querySelector('[data-fit-model-select]');
    var okEl = el.querySelector('[data-fit-ok]');
    var noteEl = el.querySelector('[data-fit-note]');
    if (!makeSel || !modelSel) return;

    makeSel.innerHTML = '';
    makeSel.appendChild(opt('', 'Select make…'));
    makes.forEach(function (k) { makeSel.appendChild(opt(k)); });

    function showOk(on) {
      if (!okEl) return;
      okEl.hidden = !on;
      el.classList.toggle('hi-fit--ok', !!on);
    }

    function resetModels() {
      modelSel.innerHTML = '';
      modelSel.appendChild(opt('', 'Select model…'));
      modelSel.disabled = true;
      showOk(false);
    }

    function fillModels(k) {
      modelSel.innerHTML = '';
      modelSel.appendChild(opt('', 'Select model…'));
      (grouped[k] || []).forEach(function (lbl) { modelSel.appendChild(opt(lbl)); });
      modelSel.disabled = false;
    }

    makeSel.addEventListener('change', function () {
      showOk(false);
      var k = canonMake(makeSel.value);
      if (!k || !grouped[k]) {
        resetModels();
        return;
      }
      fillModels(k);
    });

    modelSel.addEventListener('change', function () {
      showOk(!!modelSel.value);
    });

    if (!makes.length) {
      el.hidden = true;
      return;
    }

    el.hidden = false;
    resetModels();
    if (noteEl) noteEl.hidden = false;
  }

  function updateTrackSize(el, html, sectionId) {
    if (!html || !sectionId) return;
    var source = html.querySelector('[data-fit][data-section-id="' + sectionId + '"]');
    if (!source) return;
    var newSize = source.getAttribute('data-track-size') || '';
    el.setAttribute('data-track-size', newSize);
    var sizeInput = el.querySelector('[data-fit-track-size]');
    if (sizeInput) sizeInput.value = newSize;
  }

  function init(el) {
    if (el.dataset.fitInit === '1') return;
    el.dataset.fitInit = '1';
    var rows = [];
    var dataEl = el.querySelector('[data-fit-data]');
    if (dataEl) {
      try { rows = JSON.parse(dataEl.textContent) || []; }
      catch (e) { rows = []; }
    }
    wire(el, rows);
  }

  function boot() {
    document.querySelectorAll('[data-fit]').forEach(init);
    document.querySelectorAll('[data-hi-fit-agent]').forEach(function (btn) {
      if (btn.dataset.agentBound === '1') return;
      btn.dataset.agentBound = '1';
      btn.addEventListener('click', function () {
        var agentBtn = document.getElementById('hi-agent-btn');
        var panel = document.getElementById('hi-agent-panel');
        if (agentBtn) agentBtn.click();
        else if (panel) {
          panel.style.display = 'flex';
          var inp = document.getElementById('hi-agent-input');
          if (inp) inp.focus();
        }
      });
    });
  }

  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS.variantChange) {
    subscribe(PUB_SUB_EVENTS.variantChange, function (event) {
      var data = event && event.data;
      if (!data || !data.sectionId || !data.html) return;
      document.querySelectorAll('[data-fit][data-section-id="' + data.sectionId + '"]').forEach(function (el) {
        updateTrackSize(el, data.html, data.sectionId);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('shopify:section:load', boot);
})();
