(function () {
  'use strict';

  function text(value) {
    return String(value == null ? '' : value);
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function money(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  }

  function cardType(bucket, item) {
    if (bucket === 'tracks') return item.tread_pattern || item.guide_type || 'Rubber Track';
    if (bucket === 'undercarriage') return item.part_type || 'Undercarriage';
    return item.attachment_category || item.part_type || 'Attachment';
  }

  function cardSub(bucket, item) {
    var parts = [];
    if (bucket === 'tracks') {
      if (item.track_size) parts.push('Size: ' + item.track_size);
      else {
        if (item.width_mm) parts.push(item.width_mm + 'mm');
        if (item.pitch_mm) parts.push(item.pitch_mm + ' pitch');
        if (item.links) parts.push(item.links + ' links');
      }
    }
    if (bucket === 'undercarriage') {
      if (item.mpn) parts.push('MPN: ' + item.mpn);
      if (item.qty_per_machine) parts.push('Qty: ' + item.qty_per_machine);
    }
    if (bucket === 'attachments') {
      if (item.attachment_category) parts.push(item.attachment_category);
      if (item.weight_lbs) parts.push(item.weight_lbs + ' lb');
    }
    return parts.join(' / ');
  }

  function buttonLabel(bucket) {
    if (bucket === 'tracks') return 'View Track';
    if (bucket === 'undercarriage') return 'View Part';
    return 'View Attachment';
  }

  function renderCard(item, bucket) {
    var title = item.title || item.sku || 'Verified Part';
    var price = money(item.price);
    var compare = money(item.compare_at_price);
    var sub = cardSub(bucket, item);
    var href = item.url || '#';
    var image = item.image;

    return [
      '<a class="hi-card" href="' + escapeHtml(href) + '">',
      '<div class="hi-card__imgwrap">',
      image
        ? '<img class="hi-card__img" src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.image_alt || title) + '" width="440" height="340" loading="lazy">'
        : '<span class="hi-card__type">No image</span>',
      '</div>',
      '<p class="hi-card__type">' + escapeHtml(cardType(bucket, item)) + '</p>',
      '<h3 class="hi-card__title">' + escapeHtml(title) + '</h3>',
      sub ? '<p class="hi-card__sub">' + escapeHtml(sub) + '</p>' : '',
      price ? '<p class="hi-card__price">' + (compare && compare !== price ? '<span class="hi-card__compare">' + escapeHtml(compare) + '</span>' : '') + escapeHtml(price) + '</p>' : '',
      '<span class="hi-card__btn">' + escapeHtml(buttonLabel(bucket)) + '</span>',
      '</a>'
    ].join('');
  }

  function renderEmpty(root, bucket) {
    var machineName = root.dataset.machineName || 'this machine';
    var quoteUrl = root.dataset.quoteUrl || '/pages/quote';
    var labels = {
      tracks: 'No live track inventory is mapped yet.',
      undercarriage: 'No undercarriage parts are mapped yet.',
      attachments: 'Verified attachment mapping is still being completed.'
    };
    var href = quoteUrl + '?machine=' + encodeURIComponent(machineName) + '&part=' + encodeURIComponent(bucket);

    return [
      '<a class="hi-card hi-card--empty" href="' + escapeHtml(href) + '">',
      '<div class="hi-card__imgwrap"><span class="hi-card__type">Fitment Desk</span></div>',
      '<p class="hi-card__type">Verified Fitment</p>',
      '<h3 class="hi-card__title">' + escapeHtml(labels[bucket]) + '</h3>',
      '<p class="hi-card__sub">Send the model or serial number and we will confirm the correct part.</p>',
      '<span class="hi-card__btn">Request Quote</span>',
      '</a>'
    ].join('');
  }

  function renderBucket(root, payload, bucket) {
    var target = root.querySelector('[data-hi-bento-target="' + bucket + '"]');
    if (!target) return;

    var rows = Array.isArray(payload[bucket]) ? payload[bucket] : [];
    target.innerHTML = rows.length
      ? rows.map(function (item) { return renderCard(item, bucket); }).join('')
      : renderEmpty(root, bucket);
  }

  function endpoint(root) {
    var base = root.dataset.bentoEndpoint || '';
    var slug = root.dataset.machineSlug || '';
    if (!base || !slug) return '';
    var separator = base.indexOf('?') === -1 ? '?' : '&';
    return base + separator + 'slug=' + encodeURIComponent(slug);
  }

  async function hydrate(root) {
    if (root.dataset.hiBentoBound === '1') return;
    root.dataset.hiBentoBound = '1';

    var url = endpoint(root);
    if (!url) return;

    try {
      var response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Bento request failed: ' + response.status);
      var payload = await response.json();
      renderBucket(root, payload, 'tracks');
      renderBucket(root, payload, 'undercarriage');
      renderBucket(root, payload, 'attachments');
      window.dispatchEvent(new Event('resize'));
    } catch (error) {
      root.querySelectorAll('[data-hi-bento-target]').forEach(function (target) {
        target.innerHTML = '<div class="hi-mf__loader">Live fitment is temporarily unavailable. Call us to confirm this machine.</div>';
      });
    }
  }

  function boot() {
    document.querySelectorAll('[data-hi-machine-bento]').forEach(hydrate);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('shopify:section:load', boot);
})();
