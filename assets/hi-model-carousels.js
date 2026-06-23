(function () {
  'use strict';

  function update(root, track) {
    var prev = root.querySelector('[data-hi-carousel-prev]');
    var next = root.querySelector('[data-hi-carousel-next]');
    if (!prev || !next || !track) return;

    var max = track.scrollWidth - track.clientWidth - 2;
    var hasOverflow = max > 4;
    prev.disabled = !hasOverflow || track.scrollLeft <= 2;
    next.disabled = !hasOverflow || track.scrollLeft >= max;
  }

  function step(track) {
    var firstCard = track.querySelector('.hi-oem-product-card, .hi-card');
    if (!firstCard) return Math.max(track.clientWidth * 0.85, 240);
    var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '18') || 18;
    return firstCard.getBoundingClientRect().width + gap;
  }

  function bind(root) {
    if (root.dataset.hiCarouselBound === '1') return;
    root.dataset.hiCarouselBound = '1';

    var track = root.querySelector('[data-hi-carousel-track]');
    if (!track) return;

    var prev = root.querySelector('[data-hi-carousel-prev]');
    var next = root.querySelector('[data-hi-carousel-next]');

    if (prev) {
      prev.addEventListener('click', function () {
        track.scrollBy({ left: -step(track), behavior: 'smooth' });
      });
    }

    if (next) {
      next.addEventListener('click', function () {
        track.scrollBy({ left: step(track), behavior: 'smooth' });
      });
    }

    track.addEventListener('scroll', function () { update(root, track); }, { passive: true });
    window.addEventListener('resize', function () { update(root, track); });
    update(root, track);
  }

  function boot() {
    document.querySelectorAll('[data-hi-model-carousel]').forEach(bind);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('shopify:section:load', boot);
})();
