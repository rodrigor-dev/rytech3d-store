function getItemKey(id, variations) {
  if (!variations) return 'item_' + id;
  const varStr = Object.values(variations).map(v => v.name).sort().join('_');
  return 'item_' + id + '_' + varStr;
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem('rytech3d_cart') || '[]');
  } catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem('rytech3d_cart', JSON.stringify(cart));
}

function addToCart(id, name, price, image, variations) {
  const cart = getCart();
  const key = getItemKey(id, variations);
  const existing = cart.find(item => item._key === key);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ _key: key, product_id: id, product_name: name, quantity: 1, price, image, variations: variations || null });
  }
  saveCart(cart);
  updateCartBadge();
}

document.addEventListener('DOMContentLoaded', function() {
  updateCartBadge();

  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const id = parseInt(this.dataset.id);
      const name = this.dataset.name;
      const price = parseFloat(this.dataset.price);
      const image = this.dataset.image || this.dataset.imageUrl || '/uploads/products/default.svg';
      addToCart(id, name, price, image);
      showToast(name + ' adicionado ao carrinho!');
    });
  });
});

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (badge) {
    const cart = getCart();
    const total = cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
  }
}

function clearCart() {
  localStorage.removeItem('rytech3d_cart');
  updateCartBadge();
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
