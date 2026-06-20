/* Heavy Iron Supply Co - required Make/Model fitment selector.
   Only makes + models that fit THIS track (from custom.fitments, else track-fitment-map.json by size).
   Posts Machine Make / Machine Model + Track Size. Green confirm on list selection. */
(function () {
  'use strict';

  var MAKE_LOOKUP = {
    Caterpillar: 'Cat', CAT: 'Cat', cat: 'Cat',
    Wacker: 'Wacker Neuson', Doosan: 'Develon'
  };

  var mapPromise = null;

  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t || v; return o; }

  function canonMake(k) {
    k = (k || '').trim();
    return MAKE_LOOKUP[k] || k;
  }

  function fetchMap(url) {
    if (mapPromise) return mapPromise;
    mapPromise = fetch(url, { credentials: 'omit', cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function (e) { mapPromise = null; throw e; });
    return mapPromise;
  }

  function mapEntry(map, size) {
    if (!map || !size) return null;
    if (map[size]) return map[size];
    var alt = size.replace(/x/gi, '-');
    if (map[alt]) return map[alt];
    alt = size.replace(/-/g, 'x');
    if (map[alt]) return map[alt];
    return null;
  }

  function rowsFromMapEntry(entry) {
    var rows = [];
    (entry && entry.machines ? entry.machines : []).forEach(function (brand) {
      var k = canonMake(brand.make || '');
      (brand.models || []).forEach(function (model) {
        var m = (typeof model === 'string') ? model : (model.name || model.display_name || model.handle || '');
        m = String(m || '').trim();
        if (k && m) rows.push({ k: k, m: m, u: '' });
      });
    });
    return rows;
  }

  function groupByMake(rows) {
    var map = {};
    rows.forEach(function (row) {
      var k = canonMake((row.k || '').trim());
      var m = (row.m || '').trim();
      if (!m) return;
      if (!k) k = 'Other';
      var label = m;
      if (k !== 'Other' && m.toLowerCase().indexOf(k.toLowerCase() + ' ') === 0) {
        label = m.slice(k.length + 1).trim() || m;
      }
      if (!map[k]) map[k] = [];
      if (map[k].indexOf(label) === -1) map[k].push(label);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    });
    return map;
  }

  function wire(el, rows) {
    var grouped = groupByMake(rows);
    var makes = Object.keys(grouped).filter(function (k) { return k !== 'Other'; }).sort(function (a, b) { return a.localeCompare(b); });

    var makeSel = el.querySelector('[data-fit-make]');
    var modelSel = el.querySelector('[data-fit-model-select]');
    var modelInp = el.querySelector('[data-fit-model-input]');
    var err = el.querySelector('[data-fit-error]');
    var okEl = el.querySelector('[data-fit-ok]');
    if (!makeSel || !modelSel || !modelInp) return;

    makeSel.innerHTML = '';
    makeSel.appendChild(opt('', 'Select make…'));
    makes.forEach(function (k) { makeSel.appendChild(opt(k)); });
    makeSel.appendChild(opt('Other', 'Other / Not listed'));

    if (!makes.length) {
      el.classList.add('hi-fit--empty');
    }

    function clearErr() { if (err) err.hidden = true; el.classList.remove('hi-fit--err'); }
    function showOk(on) {
      if (!okEl) return;
      if (on) { okEl.hidden = false; okEl.style.animation = 'none'; void okEl.offsetWidth; okEl.style.animation = ''; }
      else { okEl.hidden = true; }
      el.classList.toggle('hi-fit--ok', !!on);
    }

    function useInput(on, isOther) {
      if (on) {
        modelInp.hidden = false; modelInp.disabled = false;
        modelInp.placeholder = isOther ? 'Type your make & model' : 'Type your model';
        modelSel.hidden = true; modelSel.disabled = true;
      } else {
        modelInp.hidden = true; modelInp.disabled = true; modelInp.value = '';
        modelSel.hidden = false; modelSel.disabled = false;
      }
    }

    function fillModels(k) {
      modelSel.innerHTML = '';
      modelSel.appendChild(opt('', 'Select model…'));
      (grouped[k] || []).forEach(function (lbl) { modelSel.appendChild(opt(lbl)); });
      modelSel.appendChild(opt('__other__', "My model isn't listed"));
    }

    makeSel.addEventListener('change', function () {
      clearErr(); showOk(false);
      var k = makeSel.value;
      if (!k) { useInput(false); modelSel.innerHTML = ''; modelSel.appendChild(opt('', 'Select model…')); return; }
      var ck = canonMake(k);
      if (k === 'Other' || (!grouped[ck] && !grouped[k])) { useInput(true, k === 'Other'); return; }
      useInput(false); fillModels(grouped[ck] ? ck : k);
    });

    modelSel.addEventListener('change', function () {
      clearErr();
      if (modelSel.value === '__other__') { useInput(true, false); modelInp.focus(); showOk(false); return; }
      if (modelSel.value) { showOk(true); }
      else { showOk(false); }
    });

    modelInp.addEventListener('input', function () { clearErr(); showOk(false); });

    var form = el.closest('form');
    if (form && form.dataset.fitBound !== '1') {
      form.dataset.fitBound = '1';
      form.addEventListener('submit', function (e) {
        var makeOk = !!makeSel.value;
        var modelVal = (!modelInp.disabled)
          ? modelInp.value.trim()
          : (modelSel.value && modelSel.value !== '__other__' ? modelSel.value : '');
        if (!makeOk || !modelVal) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (err) err.hidden = false;
          el.classList.add('hi-fit--err');
          (makeOk ? (!modelInp.disabled ? modelInp : modelSel) : makeSel).focus();
        }
      }, true);
    }
  }

  function init(el) {
    if (el.dataset.fitInit === '1') return;
    el.dataset.fitInit = '1';

    var rows = [];
    var dataEl = el.querySelector('[data-fit-data]');
    if (dataEl) { try { rows = JSON.parse(dataEl.textContent) || []; } catch (e) { rows = []; } }

    if (rows.length) {
      wire(el, rows);
      return;
    }

    var trackSize = el.getAttribute('data-track-size') || '';
    var mapUrl = el.getAttribute('data-map-url') || '';
    if (!trackSize || !mapUrl) {
      wire(el, []);
      return;
    }

    el.classList.add('hi-fit--loading');
    fetchMap(mapUrl)
      .then(function (map) { wire(el, rowsFromMapEntry(mapEntry(map, trackSize))); })
      .catch(function () { wire(el, []); })
      .finally(function () { el.classList.remove('hi-fit--loading'); });
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
        else if (panel) { panel.style.display = 'flex'; var inp = document.getElementById('hi-agent-input'); if (inp) inp.focus(); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  document.addEventListener('shopify:section:load', boot);
})();
