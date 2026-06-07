const express = require('express');
const router = express.Router();
const { prepare } = require('../database');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.param('id', (req, res, next, val) => {
  const num = parseInt(val, 10);
  if (isNaN(num) || num < 1) return res.status(400).send('ID inválido');
  req.params.id = num;
  next();
});

router.get('/', asyncHandler(async (req, res) => {
    const { category, search } = req.query;
    let products;
    if (category && category !== 'Todos') {
      products = await prepare('SELECT id, name, price, image_url, category, delivery_time, featured FROM products WHERE active = 1 AND category = ? ORDER BY featured DESC, created_at DESC').all(category);
    } else if (search) {
      products = await prepare('SELECT id, name, price, image_url, category, delivery_time, featured FROM products WHERE active = 1 AND (name LIKE ? OR description LIKE ?) ORDER BY featured DESC, created_at DESC').all(`%${search}%`, `%${search}%`);
    } else {
      products = await prepare('SELECT id, name, price, image_url, category, delivery_time, featured FROM products WHERE active = 1 ORDER BY featured DESC, created_at DESC').all();
    }
    const catRows = await prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all();
    const categories = catRows.map(c => c.category);
    const featuredProducts = await prepare('SELECT id, name, price, image_url, category, delivery_time, featured FROM products WHERE active = 1 AND featured = 1 ORDER BY created_at DESC LIMIT 4').all();
    const settings = await prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    const bannerImg = settingsMap.banner_url || '';

    res.render('index', {
      products,
      categories,
      selectedCategory: category || 'Todos',
      search: search || '',
      settings: settingsMap,
      featuredProducts
    });
}));

router.get('/product/:id', asyncHandler(async (req, res) => {
    const product = await prepare('SELECT id, name, description, price, delivery_time, category, image_url, video_url, video_mime, main_media FROM products WHERE id = ? AND active = 1').get(req.params.id);
    if (!product) return res.status(404).render('404');
    const extraImages = await prepare('SELECT image_url, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order').all(req.params.id);
    product.extraImages = extraImages;
    const variations = await prepare('SELECT * FROM product_variations WHERE product_id = ? ORDER BY sort_order ASC').all(req.params.id);
    const related = await prepare('SELECT id, name, price, image_url FROM products WHERE category = ? AND id != ? AND active = 1 LIMIT 4').all(product.category, product.id);
    const settings = await prepare('SELECT key, value FROM settings').all();
    const siteSettings = {};
    settings.forEach(s => siteSettings[s.key] = s.value);
    res.render('product', { product, relatedProducts: related, siteSettings, variations });
}));

module.exports = router;
