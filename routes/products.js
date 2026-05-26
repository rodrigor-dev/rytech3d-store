const express = require('express');
const router = express.Router();
const { prepare } = require('../database');

router.get('/', (req, res) => {
  try {
    const { category, search } = req.query;
    let products;
    if (category && category !== 'Todos') {
      products = prepare('SELECT * FROM products WHERE active = 1 AND category = ? ORDER BY featured DESC, created_at DESC').all(category);
    } else if (search) {
      products = prepare('SELECT * FROM products WHERE active = 1 AND (name LIKE ? OR description LIKE ?) ORDER BY featured DESC, created_at DESC').all(`%${search}%`, `%${search}%`);
    } else {
      products = prepare('SELECT * FROM products WHERE active = 1 ORDER BY featured DESC, created_at DESC').all();
    }
    const catRows = prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all();
    const categories = catRows.map(c => c.category);
    const settings = prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);

    res.render('index', {
      products,
      categories,
      selectedCategory: category || 'Todos',
      search: search || '',
      settings: settingsMap
    });
  } catch (err) {
    console.error('Erro ao listar produtos:', err);
    res.status(500).send('Erro ao carregar produtos.');
  }
});

router.get('/product/:id', (req, res) => {
  try {
    const product = prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
    if (!product) return res.status(404).render('404');
    const extraImages = prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order').all(req.params.id);
    product.extraImages = extraImages;
    const related = prepare('SELECT * FROM products WHERE category = ? AND id != ? AND active = 1 LIMIT 4').all(product.category, product.id);
    const settings = prepare('SELECT key, value FROM settings').all();
    const siteSettings = {};
    settings.forEach(s => siteSettings[s.key] = s.value);
    res.render('product', { product, relatedProducts: related, siteSettings });
  } catch (err) {
    console.error('Erro ao carregar produto:', err);
    res.status(500).send('Erro ao carregar produto.');
  }
});

module.exports = router;
