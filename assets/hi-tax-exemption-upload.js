(() => {
  function setStatus(root, message, state) {
    const status = root.querySelector('[data-hi-tax-status]');
    if (!status) return;
    status.textContent = message || '';
    status.dataset.state = state || '';
  }

  function setHidden(root, selector, value) {
    const input = root.querySelector(selector);
    if (input) input.value = value || '';
  }

  async function upload(root, file) {
    const endpoint = root.dataset.uploadEndpoint;
    if (!endpoint || !file) return;

    if (file.size > 10 * 1024 * 1024) {
      setStatus(root, 'File is over 10 MB. Please upload a smaller certificate.', 'error');
      return;
    }

    const body = new FormData();
    body.append('file', file);
    body.append('company', root.querySelector('[data-hi-tax-company]')?.value || '');
    body.append('email', root.querySelector('[data-hi-tax-email]')?.value || '');

    setStatus(root, 'Uploading certificate...', 'loading');

    try {
      const response = await fetch(endpoint, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Upload failed');

      setHidden(root, '[data-hi-tax-status-input]', 'Pending admin review');
      setHidden(root, '[data-hi-tax-reference-input]', payload.reference || payload.path || '');
      setHidden(root, '[data-hi-tax-filename-input]', payload.filename || file.name);
      setStatus(root, 'Certificate attached. Tax exemption will be reviewed before fulfillment.', 'success');
    } catch (error) {
      setHidden(root, '[data-hi-tax-status-input]', '');
      setHidden(root, '[data-hi-tax-reference-input]', '');
      setHidden(root, '[data-hi-tax-filename-input]', '');
      setStatus(root, `Upload failed: ${error.message || error}`, 'error');
    }
  }

  function bind(root) {
    if (root.dataset.hiTaxUploadBound === '1') return;
    root.dataset.hiTaxUploadBound = '1';
    const input = root.querySelector('[data-hi-tax-file]');
    input?.addEventListener('change', () => upload(root, input.files && input.files[0]));
  }

  function boot() {
    document.querySelectorAll('[data-hi-tax-upload]').forEach(bind);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('shopify:section:load', boot);
})();
