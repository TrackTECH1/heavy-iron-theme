(() => {
  const SPEC_ORDER = [
    'width_in',
    'length_in',
    'open_tine_height_in',
    'weight_lbs',
    'rated_hp',
    'cylinder_size',
    'tine_thickness_in',
    'cutting_edge',
    'bolt_on_edge',
    'bolt_on_sides',
    'cylinder_rod_protector',
    'weld_on_teeth',
    'teeth',
    'has_teeth',
    'machine_type',
    'family',
    'family_title',
    'fits',
    'availability',
    'brand',
    'product_type',
  ];

  const SKIP_KEYS = new Set(['sku', 'family_handle', 'mpn', 'weight_estimated']);

  const LABELS = {
    width_in: 'Width',
    length_in: 'Length',
    open_tine_height_in: 'Open tine height',
    weight_lbs: 'Weight',
    rated_hp: 'Rated HP',
    cylinder_size: 'Cylinder size',
    tine_thickness_in: 'Tine thickness',
    cutting_edge: 'Cutting edge',
    bolt_on_edge: 'Bolt-on edge',
    bolt_on_sides: 'Bolt-on sides',
    cylinder_rod_protector: 'Cylinder rod protector',
    weld_on_teeth: 'Weld-on teeth',
    teeth: 'Teeth',
    has_teeth: 'Has teeth',
    machine_type: 'Machine type',
    family: 'Family',
    family_title: 'Family',
    fits: 'Fits',
    availability: 'Availability',
    brand: 'Brand',
    product_type: 'Product type',
  };

  function labelFor(key) {
    if (LABELS[key]) return LABELS[key];
    return key
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function formatValue(key, value) {
    if (value === true || value === false) {
      return value ? 'Yes' : 'No';
    }
    if (value == null || value === '') return '';
    if (key === 'weight_lbs') return `${value} lbs`;
    if (key === 'width_in' || key === 'length_in' || key === 'open_tine_height_in') {
      return `${value}"`;
    }
    if (key === 'tine_thickness_in') return `${value}"`;
    return String(value);
  }

  function renderRows(specs) {
    if (!specs || typeof specs !== 'object') return '';

    const used = new Set();
    let html = '';

    const appendRow = (key, value) => {
      const formatted = formatValue(key, value);
      if (!formatted) return;
      used.add(key);
      const highlight = key === 'width_in' ? ' track-specs__value--highlight' : '';
      html += `<tr><td class="track-specs__label">${labelFor(key)}</td><td class="track-specs__value${highlight}">${formatted}</td></tr>`;
    };

    SPEC_ORDER.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(specs, key)) {
        appendRow(key, specs[key]);
      }
    });

    Object.keys(specs)
      .filter((key) => !used.has(key) && !SKIP_KEYS.has(key))
      .sort()
      .forEach((key) => appendRow(key, specs[key]));

    return html;
  }

  function initContainer(container) {
    const sectionId = container.dataset.sectionId;
    const dataEl = document.getElementById(`AttachmentSpecsData-${sectionId}`);
    const bodyEl = document.getElementById(`AttachmentSpecsBody-${sectionId}`);
    if (!dataEl || !bodyEl) return;

    let variants = [];
    try {
      variants = JSON.parse(dataEl.textContent || '[]');
    } catch (_err) {
      return;
    }

    const specsById = new Map(
      variants.filter((entry) => entry && entry.id).map((entry) => [String(entry.id), entry.specs || null])
    );

    const render = (variantId) => {
      const specs = specsById.get(String(variantId));
      const html = renderRows(specs);
      bodyEl.innerHTML = html;
      container.classList.toggle('hidden', !html);
    };

    const productInfo = container.closest('product-info');
    const variantInput = productInfo?.querySelector('[name="id"]');
    if (variantInput?.value) {
      render(variantInput.value);
    }

    if (typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return;

    subscribe(PUB_SUB_EVENTS.variantChange, (event) => {
      if (String(event?.data?.sectionId) !== String(sectionId)) return;
      const variantId = event?.data?.variant?.id || variantInput?.value;
      if (variantId) render(variantId);
    });
  }

  function init() {
    document.querySelectorAll('.attachment-specs[data-section-id]').forEach(initContainer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
