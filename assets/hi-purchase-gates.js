(() => {
  function setQuantity(form, quantity) {
    const formId = form.getAttribute('id');
    const quantityInput = document.querySelector(`input[name="quantity"][form="${formId}"]`) || form.querySelector('input[name="quantity"]');
    if (!quantityInput) return;
    quantityInput.value = String(quantity);
    quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('change', (event) => {
    const option = event.target.closest('[data-hi-quantity-option]');
    if (!option) return;
    const form = option.closest('form');
    if (!form) return;
    setQuantity(form, Number(option.dataset.quantity || 1));
  });
})();
