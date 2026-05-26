const express = require('express');
const router = express.Router();
const { prepare, transaction, getSettings } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { sendWhatsAppNotification } = require('./whatsapp');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/checkout', authMiddleware, asyncHandler(async (req, res) => {
  const user = await prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const settings = await getSettings();
  res.render('checkout', { user, settings, error: null });
}));

router.post('/place', authMiddleware, asyncHandler(async (req, res) => {
  const { items, notes } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Carrinho vazio.' });
  }

  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `Produto "${item.product_name || item.product_id}" não encontrado.` });
    }
    const qty = parseInt(item.quantity) || 1;
    const subtotal = product.price * qty;
    total += subtotal;
    const variations = item.variations || {};
    orderItems.push({
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      price: product.price,
      variations
    });
  }

  const placeOrderTransaction = transaction(async () => {
    const result = await prepare('INSERT INTO orders (user_id, total, status, notes) VALUES (?, ?, ?, ?)').run(req.user.id, total, 'pending', notes || '');
    const orderId = result.lastInsertRowid;
    for (const item of orderItems) {
      const variationsJson = JSON.stringify(item.variations || {});
      await prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price, variations) VALUES (?, ?, ?, ?, ?, ?)')
        .run(orderId, item.product_id, item.product_name, item.quantity, item.price, variationsJson);
    }
    return orderId;
  });

  const orderId = await placeOrderTransaction();

  const order = await prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const user = await prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  sendWhatsAppNotification(order, user, orderItems).catch(err => {
    console.error('Erro ao enviar notificação WhatsApp:', err.message);
  });

  res.json({ success: true, orderId });
}));

router.get('/confirmation/:id', authMiddleware, asyncHandler(async (req, res) => {
  const order = await prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).send('Pedido não encontrado');
  const items = await prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  const user = await prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const settings = await getSettings();
  res.render('order-confirmation', { order, items, user, settings });
}));

router.get('/my-orders', authMiddleware, asyncHandler(async (req, res) => {
  const orders = await prepare(`
    SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as total_items 
    FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC
  `).all(req.user.id);
  const settings = await getSettings();
  res.render('my-orders', { orders, settings });
}));

module.exports = router;
