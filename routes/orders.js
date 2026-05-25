const express = require('express');
const router = express.Router();
const { prepare, transaction, getSettings } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { sendWhatsAppNotification } = require('./whatsapp');

router.get('/checkout', authMiddleware, (req, res) => {
  try {
    const user = prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const settings = getSettings();
    res.render('checkout', { user, settings, error: null });
  } catch (err) {
    console.error('Erro no checkout:', err);
    res.status(500).send('Erro ao carregar checkout.');
  }
});

router.post('/place', authMiddleware, (req, res) => {
  try {
    const { items, notes } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrinho vazio.' });
    }

    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const product = prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
      if (!product) {
        return res.status(400).json({ error: `Produto "${item.product_name || item.product_id}" não encontrado.` });
      }
      const qty = parseInt(item.quantity) || 1;
      const subtotal = product.price * qty;
      total += subtotal;
      orderItems.push({
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        price: product.price
      });
    }

    const placeOrderTransaction = transaction(() => {
      const result = prepare('INSERT INTO orders (user_id, total, status, notes) VALUES (?, ?, ?, ?)').run(req.user.id, total, 'pending', notes || '');
      const orderId = result.lastInsertRowid;
      for (const item of orderItems) {
        prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)')
          .run(orderId, item.product_id, item.product_name, item.quantity, item.price);
      }
      return orderId;
    });

    const orderId = placeOrderTransaction();

    const order = prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const user = prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    sendWhatsAppNotification(order, user, orderItems).catch(err => {
      console.error('Erro ao enviar notificação WhatsApp:', err.message);
    });

    res.json({ success: true, orderId });
  } catch (err) {
    console.error('Erro ao criar pedido:', err);
    res.status(500).json({ error: 'Erro ao processar pedido. Tente novamente.' });
  }
});

router.get('/confirmation/:id', authMiddleware, (req, res) => {
  try {
    const order = prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) return res.status(404).send('Pedido não encontrado');
    const items = prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
    const user = prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const settings = getSettings();
    res.render('order-confirmation', { order, items, user, settings });
  } catch (err) {
    console.error('Erro ao carregar confirmação:', err);
    res.status(500).send('Erro ao carregar confirmação.');
  }
});

router.get('/my-orders', authMiddleware, (req, res) => {
  try {
    const orders = prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as total_items 
      FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC
    `).all(req.user.id);
    const settings = getSettings();
    res.render('my-orders', { orders, settings });
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(500).send('Erro ao carregar pedidos.');
  }
});

module.exports = router;
