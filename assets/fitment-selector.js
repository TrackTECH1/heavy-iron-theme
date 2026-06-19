/* Heavy Iron Supply Co - required Make/Model fitment selector.
   Make > Model dependent dropdown from inline JSON (custom.fits_equipment_models).
   Fallback: full make list + free text. Posts: Machine Make / Machine Model (+ Track Size hidden).
   Green confirm shows when a real model is selected from the list. */
(function () {
  'use strict';

  var MAKES_FALLBACK = ["Bobcat","Caterpillar","Takeuchi","Kubota","John Deere","Case","New Holland","JCB","ASV","Yanmar","Gehl","Wacker Neuson","Volvo","Ditch Witch","Hitachi","Komatsu","Develon","IHI","Hyundai","Kobelco","Terex","Vermeer","Sany","Manitou","Toro","Kioti","Mustang"];

  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t || v; return o; }

  function groupByMake(rows) {
    var map = {};
    rows.forEach(function (row) {
      var k = (row.k || '').trim();
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
    Object.keys(map).forEach(function (k) { map[k].sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }); });
    return map;
  }

  function init(el) {
    if (el.dataset.fitInit === '1') return;
    el.dataset.fitInit = '1';

    var rows = [];
    var dataEl = el.querySelector('[data-fit-data]');
    if (dataEl) { try { rows = JSON.parse(dataEl.textContent) || []; } catch (e) { rows = []; } }

    var grouped = groupByMake(rows);
    var makes = Object.keys(grouped).filter(function (k) { return k !== 'Other'; }).sort(function (a, b) { return a.localeCompare(b); });
    var hasData = makes.length > 0;

    var makeSel = el.querySelector('[data-fit-make]');
    var modelSel = el.querySelector('[data-fit-model-select]');
    var modelInp = el.querySelector('[data-fit-model-input]');
    var err = el.querySelector('[data-fit-error]');
    var okEl = el.querySelector('[data-fit-ok]');
    if (!makeSel || !modelSel || !modelInp) return;

    (hasData ? makes : MAKES_FALLBACK).forEach(function (k) { makeSel.appendChild(opt(k)); });
    makeSel.appendChild(opt('Other', 'Other / Not listed'));

    function clearErr() { if (err) err.hidden = true; el.classList.remove('hi-fit--err'); }
    function showOk(on) {
      if (!okEl) return;
      // re-trigger the entrance animation each time it shows
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
      if (k === 'Other' || !grouped[k]) { useInput(true, k === 'Other'); return; }
      useInput(false); fillModels(k);
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

  function boot() { document.querySelectorAll('[data-fit]').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  document.addEventListener('shopify:section:load', boot);
})();