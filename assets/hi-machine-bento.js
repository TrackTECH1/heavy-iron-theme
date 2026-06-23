(function () {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    var n = Number(value || 0);
    if (!n) return '';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function itemUrl(item) {
    if (item.url) return item.url;
    if (item.handle) return '/products/' + encodeURIComponent(item.handle);
    if (item.product_handle) return '/products/' + encodeURIComponent(item.product_handle);
    return '/pages/quote';
  }

  function itemImage(item) {
    return item.image || item.image_cdn || item.featured_image || item.media_url || '';
  }

  function itemTitle(item) {
    return item.title || item.name || item.product_title || item.sku || 'Verified Part';
  }

  function renderCard(item, typeLabel) {
    var image = itemImage(item);
    var price = money(item.price || item.base_price || item.variant_price);
    var sub = item.sub || item.track_size || item.oem_part_number || item.sku || '';
    return [
      '<a class="hi-card" href="' + esc(itemUrl(item)) + '">',
      '<div class="hi-card__imgwrap">',
      image
        ? '<img class="hi-card__img" src="' + esc(image) + '" alt="' + esc(itemTitle(item)) + '" width="440" height="340" loading="lazy">'
        : '<span class="hi-card__type">No image</span>',
      '</div>',
      '<p class="hi-card__type">' + esc(item.type_label || item.tread_pattern || typeLabel) + '</p>',
      '<h3 class="hi-card__title">' + esc(itemTitle(item)) + '</h3>',
      sub ? '<p class="hi-card__sub">' + esc(sub) + '</p>' : '',
      price ? '<p class="hi-card__price">' + esc(price) + '</p>' : '',
      '<span class="hi-card__btn">' + esc(item.button || 'View') + '</span>',
      '</a>'
    ].join('');
  }

  function normalizePayload(data) {
    if (Array.isArray(data.groups)) {
      var tracks = [];
      var undercarriage = [];
      data.groups.forEach(function (group) {
        if (group.type === 'tracks' && Array.isArray(group.variants)) {
          group.variants.forEach(function (variant) {
            tracks.push({
              title: group.title,
              type_label: variant.label || 'Rubber Track',
              sku: variant.sku,
              price: variant.price,
              handle: variant.handle,
              url: variant.href,
              sub: variant.sku,
              button: 'View Track'
            });
          });
          return;
        }
        if (group.type === 'part') {
          undercarriage.push({
            title: group.title,
            type_label: group.part_type || 'Undercarriage',
            sku: group.sku,
            price: group.price,
            handle: group.handle,
            url: group.href,
            sub: group.sku,
            button: 'View Part'
          });
        }
      });
      return {
        tracks: tracks,
        undercarriage: undercarriage,
        attachments: data.attachments || []
      };
    }

    return {
      tracks: data.tracks || data.track_variants || data.rubber_tracks || [],
      undercarriage: data.undercarriage || data.uc_products || data.undercarriage_parts || [],
      attachments: data.attachments || data.featured_attachments || []
    };
  }

  function renderRow(root, key, items, label) {
    var row = root.querySelector('[data-hi-bento-row="' + key + '"]');
    if (!row) return;
    row.classList.remove('hi-mf__cards--loading');
    if (!Array.isArray(items) || !items.length) {
      row.innerHTML = '<div class="hi-mf__empty">No verified ' + esc(label.toLowerCase()) + ' are linked yet.</div>';
      return;
    }
    row.innerHTML = items.map(function (item) { return renderCard(item, label); }).join('');
  }

  function endpointUrl(endpoint, slug) {
    var joiner = endpoint.indexOf('?') === -1 ? '?' : '&';
    return endpoint + joiner + 'slug=' + encodeURIComponent(slug);
  }

  function fitmentEndpointFrom(endpoint) {
    if (endpoint.indexOf('/bento') !== -1) return endpoint.replace('/bento', '/fitment-search');
    return '/apps/iron-api/fitment-search';
  }

  function fitmentUrl(endpoint, slug) {
    var joiner = endpoint.indexOf('?') === -1 ? '?' : '&';
    return endpoint + joiner + 'q=' + encodeURIComponent(slug);
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Endpoint returned ' + response.status);
        return response.json();
      });
  }

  function init(root) {
    var slug = root.getAttribute('data-machine-slug');
    var endpoint = root.getAttribute('data-bento-endpoint') || '/apps/iron-api/bento';
    if (!slug || !root.querySelector('[data-hi-bento-row]')) return;

    fetchJson(endpointUrl(endpoint, slug))
      .catch(function () {
        return fetchJson(fitmentUrl(fitmentEndpointFrom(endpoint), slug));
      })
      .catch(function () {
        return fetchJson(fitmentUrl('https://tcykyktvdlsbscrsbjyt.supabase.co/functions/v1/fitment-search', slug));
      })
      .then(function (data) {
        var payload = normalizePayload(data || {});
        renderRow(root, 'tracks', payload.tracks, 'Rubber Track');
        renderRow(root, 'undercarriage', payload.undercarriage, 'Undercarriage');
        renderRow(root, 'attachments', payload.attachments, 'Attachment');
      })
      .catch(function () {
        root.querySelectorAll('[data-hi-bento-row]').forEach(function (row) {
          row.classList.remove('hi-mf__cards--loading');
          row.innerHTML = '<div class="hi-mf__empty">Fitment data is being refreshed. Call (850) 816-7898 and we will verify it.</div>';
        });
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-hi-machine-bento]').forEach(init);
  });
})();
