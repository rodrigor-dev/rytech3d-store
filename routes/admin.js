const express = require('express');
const router = express.Router();
const { prepare } = require('../database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { adminAuth, generateAdminToken } = require('../middleware/auth');
const { getSettings } = require('../database');

const sharp = require('sharp');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.param('id', (req, res, next, val) => {
  const num = parseInt(val, 10);
  if (isNaN(num) || num < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  req.params.id = num;
  next();
});

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'products');

const productFileFilter = (req, file, cb) => {
  if (file.fieldname === 'images') {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    return cb(new Error('Apenas imagens (JPEG, PNG, GIF, WebP) são permitidas.'));
  }
  if (file.fieldname === 'video_file') {
    const allowed = /mp4|webm|ogg|mov|avi/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) return cb(null, true);
    return cb(new Error('Apenas vídeos (MP4, WebM, OGG, MOV) são permitidos.'));
  }
  cb(new Error('Campo inesperado: ' + file.fieldname));
};

const mixedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: productFileFilter
});

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) return cb(null, true);
    cb(new Error('Apenas imagens (JPEG, PNG, GIF, WebP) são permitidas.'));
  }
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /mp4|webm|ogg|mov|avi/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) return cb(null, true);
    cb(new Error('Apenas vídeos (MP4, WebM, OGG, MOV, AVI) são permitidos.'));
  }
});

async function saveProductFile(buffer, originalname) {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = path.extname(originalname).toLowerCase();
  const filename = `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
  const filePath = path.join(uploadsDir, filename);
  const isImage = /\.(jpe?g|png|gif|webp)$/i.test(ext);
  if (isImage) {
    try {
      let pipeline = sharp(buffer);
      if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 80, progressive: true });
      else if (ext === '.png') pipeline = pipeline.png({ quality: 80, progressive: true });
      else if (ext === '.webp') pipeline = pipeline.webp({ quality: 80 });
      const compressed = await pipeline.toBuffer();
      fs.writeFileSync(filePath, compressed);
    } catch (e) {
      console.error('Erro ao comprimir imagem, salvando original:', e.message);
      fs.writeFileSync(filePath, buffer);
    }
  } else {
    fs.writeFileSync(filePath, buffer);
  }
  return { url: '/uploads/products/' + filename, path: filePath };
}

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo${ext}`);
  }
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('Apenas imagens (JPEG, PNG, GIF, WebP, SVG) são permitidas.'));
  }
});

router.get('/login', asyncHandler(async (req, res) => {
  res.render('admin/login', { error: null });
}));

router.post('/login', asyncHandler(async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await prepare('SELECT * FROM admins WHERE username = ? OR email = ?').get(username, username);
    if (!admin || !bcrypt.compareSync(password, admin.password)) {
      return res.render('admin/login', { error: 'Usuário ou senha incorretos.' });
    }
    const token = generateAdminToken(admin);
    res.cookie('admin_token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
    res.redirect('/admin');
  } catch (err) {
    console.error('Erro no login admin:', err);
    res.render('admin/login', { error: 'Erro ao fazer login.' });
  }
}));

router.get('/logout', asyncHandler(async (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/admin/login');
}));

router.use(adminAuth);

router.get('/', asyncHandler(async (req, res) => {
  try {
    const totalProducts = (await prepare('SELECT COUNT(*) as count FROM products').get()).count;
    const totalOrders = (await prepare('SELECT COUNT(*) as count FROM orders').get()).count;
    const totalCustomers = (await prepare('SELECT COUNT(*) as count FROM users').get()).count;
    const revenueRow = await prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status != 'cancelled'").get();
    const totalRevenue = revenueRow.total;
    const recentOrders = await prepare(`
      SELECT o.*, u.full_name as customer_name FROM orders o 
      JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC LIMIT 5
    `).all();
    const pendingOrders = (await prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get()).count;

    res.render('admin/dashboard', {
      totalProducts, totalOrders, totalCustomers, totalRevenue, pendingOrders, recentOrders
    });
  } catch (err) {
    console.error('Erro no dashboard:', err);
    res.status(500).send('Erro ao carregar dashboard.');
  }
}));

router.get('/products', asyncHandler(async (req, res) => {
  try {
    const products = await prepare('SELECT id, name, price, image_url, category, delivery_time, featured, active FROM products ORDER BY created_at DESC').all();
    res.render('admin/products', { products });
  } catch (err) {
    console.error('Erro ao listar produtos:', err);
    res.status(500).send('Erro ao carregar produtos.');
  }
}));

router.get('/products/new', asyncHandler(async (req, res) => {
  res.render('admin/product-form', { product: null, variations: [], error: null });
}));

router.get('/products/edit/:id', asyncHandler(async (req, res) => {
  try {
    const product = await prepare('SELECT id, name, description, price, cost_price, delivery_time, category, image_url, video_url, main_media, featured, active FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).send('Produto não encontrado');
    const extraImages = await prepare('SELECT image_url, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order').all(req.params.id);
    product.extraImages = extraImages;
    const variations = await prepare('SELECT * FROM product_variations WHERE product_id = ? ORDER BY sort_order ASC').all(req.params.id);
    res.render('admin/product-form', { product, variations, error: null });
  } catch (err) {
    console.error('Erro ao carregar produto:', err);
    res.status(500).send('Erro ao carregar produto.');
  }
}));

router.post('/upload-image', singleUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const { url } = await saveProductFile(req.file.buffer, req.file.originalname);
    res.json({ url });
  } catch (err) {
    console.error('Erro no upload de imagem:', err);
    res.status(500).json({ error: 'Erro ao fazer upload.' });
  }
}));

router.post('/upload-video', videoUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const { url } = await saveProductFile(req.file.buffer, req.file.originalname);
    res.json({ url });
  } catch (err) {
    console.error('Erro no upload de vídeo:', err);
    res.status(500).json({ error: 'Erro ao fazer upload de vídeo.' });
  }
}));

router.post('/products/save', mixedUpload.fields([
  { name: 'video_file', maxCount: 1 }
]), asyncHandler(async (req, res) => {
  try {
    const { id, name, description, price, cost_price, delivery_time, category, featured, active } = req.body;
    let video_url = '';
    if (req.body.uploaded_video) {
      video_url = req.body.uploaded_video;
    } else if (req.body.video_url_input && req.body.video_url_input.startsWith('/uploads/')) {
      video_url = req.body.video_url_input;
    } else if (req.body.video_url_fallback) {
      video_url = req.body.video_url_fallback;
    }
    if (!name || !description || !price || !delivery_time) {
      return res.render('admin/product-form', {
        product: req.body,
        error: 'Nome, descrição, preço e tempo de entrega são obrigatórios.'
      });
    }

    const activeValue = active !== undefined ? (active === '1' || active === true ? 1 : 0) : 1;

    // Collect kept existing image urls
    const keptUrls = [];
    if (req.body.existing_images) {
      const urls = Array.isArray(req.body.existing_images) ? req.body.existing_images : [req.body.existing_images];
      urls.forEach(u => { if (u && u.trim()) keptUrls.push(u.trim()); });
    }

    // Collect URLs from AJAX uploads (hidden inputs)
    const uploadedUrls = [];
    if (req.body.uploaded_images) {
      const urls = Array.isArray(req.body.uploaded_images) ? req.body.uploaded_images : [req.body.uploaded_images];
      urls.forEach(u => { if (u && u.trim()) uploadedUrls.push(u.trim()); });
    }

    // Remove deleted existing images from disk
    const removedRaw = req.body.removed_images || '';
    const removed = removedRaw ? removedRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    removed.forEach(url => {
      if (url && url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    });

    // Build ordered list of all images (kept urls + AJAX uploads)
    const allImages = [];
    for (const url of keptUrls) {
      let data = null, mime = null;
      const existing = await prepare('SELECT image_data, image_mime FROM products WHERE image_url = ?').get(url);
      if (existing) { data = existing.image_data; mime = existing.image_mime; }
      else {
        const extra = await prepare('SELECT image_data, image_mime FROM product_images WHERE image_url = ?').get(url);
        if (extra) { data = extra.image_data; mime = extra.image_mime; }
      }
      allImages.push({ url, data, mime });
    }
    for (const url of uploadedUrls) {
      const filePath = path.join(__dirname, '..', 'public', url.replace(/^\//, ''));
      let data = null, mime = null;
      try {
        if (fs.existsSync(filePath)) {
          const buffer = fs.readFileSync(filePath);
          data = buffer.toString('base64');
          const ext = path.extname(url).toLowerCase();
          mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
        }
      } catch (e) {
        console.error('Erro ao ler imagem do disco:', e.message);
      }
      allImages.push({ url, data, mime });
    }

    const selectedMainImage = req.body.selected_main_image || null;
    if (selectedMainImage) {
      const idx = allImages.findIndex(function(img) { return img.url === selectedMainImage; });
      if (idx > 0) {
        var mainImg = allImages.splice(idx, 1)[0];
        allImages.unshift(mainImg);
      }
    }

    let mainImageUrl = '/uploads/products/default.svg';
    let mainImageData = null;
    let mainImageMime = null;
    if (allImages.length > 0) {
      mainImageUrl = allImages[0].url;
      mainImageData = allImages[0].data;
      mainImageMime = allImages[0].mime;
    }

    let videoData = null, videoMime = null;
    if (video_url && video_url.startsWith('/uploads/')) {
      const videoPath = path.join(__dirname, '..', 'public', video_url.replace(/^\//, ''));
      try {
        if (fs.existsSync(videoPath)) {
          const buf = fs.readFileSync(videoPath);
          videoData = buf.toString('base64');
          const vext = path.extname(video_url).toLowerCase();
          videoMime = vext === '.webm' ? 'video/webm' : vext === '.ogg' ? 'video/ogg' : vext === '.mov' ? 'video/quicktime' : vext === '.avi' ? 'video/x-msvideo' : 'video/mp4';
        } else if (id) {
          const existing = await prepare('SELECT video_data, video_mime FROM products WHERE id = ?').get(id);
          if (existing) { videoData = existing.video_data; videoMime = existing.video_mime; }
        }
      } catch (e) { console.error('Erro ao ler vídeo do disco:', e.message); }
    }

    const mainMedia = req.body.main_media === 'video' ? 'video' : 'image';

    if (id) {
      await prepare(`UPDATE products SET name=?, description=?, price=?, cost_price=?, delivery_time=?, category=?, image_url=?, image_data=?, image_mime=?, video_url=?, video_data=?, video_mime=?, main_media=?, featured=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(name, description, parseFloat(price), parseFloat(cost_price || 0), delivery_time, category || 'Geral', mainImageUrl, mainImageData || null, mainImageMime || null, video_url || '', videoData, videoMime, mainMedia, featured ? 1 : 0, activeValue, parseInt(id));
      await prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
      var targetId = id;
    } else {
      const result = await prepare(`INSERT INTO products (name, description, price, cost_price, delivery_time, category, image_url, image_data, image_mime, video_url, video_data, video_mime, main_media, featured, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(name, description, parseFloat(price), parseFloat(cost_price || 0), delivery_time, category || 'Geral', mainImageUrl, mainImageData || null, mainImageMime || null, video_url || '', videoData, videoMime, mainMedia, featured ? 1 : 0, activeValue);
      let productId = result.lastInsertRowid;
      if (!productId) {
        const last = await prepare('SELECT MAX(id) as id FROM products').get();
        productId = last ? last.id : null;
      }
      if (!productId) throw new Error('Falha ao criar produto');
      var targetId = productId;
    }

    let sortOrder = 1;
    for (let i = 1; i < allImages.length; i++) {
      const img = allImages[i];
      await prepare('INSERT INTO product_images (product_id, image_url, image_data, image_mime, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(targetId, img.url, img.data || null, img.mime || null, sortOrder++);
    }

    const costVal = parseFloat(cost_price || 0);
    if (costVal > 0) {
      await prepare('INSERT INTO cost_price_history (product_id, cost_price, note) VALUES (?, ?, ?)').run(targetId, costVal, 'Atualizado via formulário');
    }

    res.redirect('/admin/products');
  } catch (err) {
    console.error('Erro ao salvar produto:', err);
    res.render('admin/product-form', {
      product: req.body,
      error: 'Erro ao salvar produto. Verifique os dados e tente novamente.'
    });
  }
}));

router.post('/products/delete-extra-image', asyncHandler(async (req, res) => {
  try {
    const { product_id, image_url } = req.body;
    if (!product_id || !image_url) return res.status(400).json({ error: 'Dados incompletos' });
    await prepare('DELETE FROM product_images WHERE product_id = ? AND image_url = ?').run(product_id, image_url);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao deletar imagem extra:', err);
    res.status(500).json({ error: 'Erro ao deletar imagem.' });
  }
}));

router.post('/products/delete-main-image', asyncHandler(async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'ID do produto obrigatório' });
    await prepare('UPDATE products SET image_url = ? WHERE id = ?').run('/uploads/products/default.svg', product_id);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao deletar imagem principal:', err);
    res.status(500).json({ error: 'Erro ao deletar imagem principal.' });
  }
}));

router.post('/products/delete-video', asyncHandler(async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'ID do produto obrigatório' });
    const product = await prepare('SELECT video_url FROM products WHERE id = ?').get(product_id);
    if (product && product.video_url) {
      const videoPath = path.join(__dirname, '..', 'public', product.video_url);
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    }
    await prepare('UPDATE products SET video_url = ?, video_data = ?, video_mime = ? WHERE id = ?').run('', null, null, product_id);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao deletar vídeo:', err);
    res.status(500).json({ error: 'Erro ao deletar vídeo.' });
  }
}));

router.post('/products/toggle-active/:id', asyncHandler(async (req, res) => {
  try {
    const product = await prepare('SELECT active FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
    const newActive = product.active ? 0 : 1;
    await prepare('UPDATE products SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newActive, req.params.id);
    res.json({ success: true, active: newActive });
  } catch (err) {
    console.error('Erro ao toggle active:', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
}));

router.post('/products/delete/:id', asyncHandler(async (req, res) => {
  try {
    const product = await prepare('SELECT image_url FROM products WHERE id = ?').get(req.params.id);
    if (product && product.image_url && product.image_url !== '/uploads/products/default.svg') {
      const imgPath = path.join(__dirname, '..', 'public', product.image_url);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    const extraImages = await prepare('SELECT image_url FROM product_images WHERE product_id = ?').all(req.params.id);
    extraImages.forEach(img => {
      const imgPath = path.join(__dirname, '..', 'public', img.image_url);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    });
    await prepare('DELETE FROM product_images WHERE product_id = ?').run(req.params.id);
    await prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Erro ao deletar produto:', err);
    res.status(500).send('Erro ao deletar produto.');
  }
}));

// ─── Manual Order ──────────────────────────────────────────────────────────

async function getOrCreateManualUser() {
  let user = await prepare("SELECT id, full_name FROM users WHERE email = 'manual@rytech3d.local'").get();
  if (!user) {
    const r = await prepare("INSERT INTO users (full_name, email, password, phone, street, number, complement, neighborhood, city, state, zip_code, cpf) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('Cliente Manual', 'manual@rytech3d.local', 'manual-order-user', '', 'Rua Manual', '0', '', 'Centro', 'Cidade', 'UF', '00000000', '');
    let uid = r.lastInsertRowid;
    if (!uid) { const last = await prepare('SELECT MAX(id) as id FROM users').get(); uid = last ? last.id : null; }
    if (!uid) throw new Error('Falha ao criar usuário para pedidos manuais');
    user = { id: uid, full_name: 'Cliente Manual' };
  }
  return user;
}

router.get('/orders/manual/new', asyncHandler(async (req, res) => {
  try {
    const products = await prepare('SELECT id, name, price, cost_price, image_url FROM products WHERE active = 1 ORDER BY name').all();
    res.render('admin/manual-order', { products, error: null });
  } catch (err) {
    console.error('Erro ao carregar formulário de pedido manual:', err);
    res.status(500).send('Erro ao carregar formulário.');
  }
}));

router.post('/orders/manual/save', asyncHandler(async (req, res) => {
  try {
    const { customer_name, customer_company, customer_phone, customer_email, admin_notes, items } = req.body;

    if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
      const products = await prepare('SELECT id, name, price, cost_price, image_url FROM products WHERE active = 1 ORDER BY name').all();
      return res.render('admin/manual-order', { products, error: 'Nome do cliente e pelo menos um item são obrigatórios.' });
    }

    const manualUser = await getOrCreateManualUser();
    const userId = manualUser.id;

    // Build notes with source marker
    const notesPayload = `__MANUAL__|${customer_name}|${customer_company || ''}|${customer_phone || ''}|${customer_email || ''}|${admin_notes || ''}`;

    // Process items
    let subtotal = 0;
    let totalDiscount = 0;
    let totalCost = 0;
    const orderItems = [];

    for (const item of items) {
      const qty = parseInt(item.quantity) || 1;
      const price = parseFloat(item.price) || 0;
      const costPrice = parseFloat(item.cost_price) || 0;
      const discType = item.discount_type || 'none';
      const discVal = parseFloat(item.discount_value) || 0;

      let finalPrice = price;
      let itemDiscount = 0;
      if (discType === 'fixed') {
        itemDiscount = Math.min(discVal, price);
        finalPrice = price - itemDiscount;
      } else if (discType === 'percent') {
        itemDiscount = price * (Math.min(discVal, 100) / 100);
        finalPrice = price - itemDiscount;
      }

      const itemSubtotal = price * qty;
      const itemFinal = finalPrice * qty;
      const itemCost = costPrice * qty;
      const itemDiscTotal = itemDiscount * qty;

      subtotal += itemSubtotal;
      totalDiscount += itemDiscTotal;
      totalCost += itemCost;

      // Store discount info in variations field
      const variationsPayload = JSON.stringify({
        __discount__: { type: discType, value: discVal, total: itemDiscTotal }
      });

      orderItems.push({
        product_id: parseInt(item.product_id),
        product_name: item.product_name,
        quantity: qty,
        price: finalPrice,
        cost_price: costPrice,
        variations: variationsPayload
      });
    }

    const finalTotal = subtotal - totalDiscount;
    const profit = finalTotal - totalCost;
    const margin = finalTotal > 0 ? (profit / finalTotal) * 100 : 0;

    // Create order
    const result = await prepare('INSERT INTO orders (user_id, total, status, payment_method, notes) VALUES (?, ?, ?, ?, ?)')
      .run(userId, finalTotal, 'confirmed', 'manual', notesPayload);
    let orderId = result.lastInsertRowid;
    if (!orderId) { const last = await prepare('SELECT MAX(id) as id FROM orders').get(); orderId = last ? last.id : null; }
    if (!orderId) throw new Error('Falha ao criar pedido manual');

    // Create order items
    for (const oi of orderItems) {
      await prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price, cost_price, variations) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(orderId, oi.product_id, oi.product_name, oi.quantity, oi.price, oi.cost_price, oi.variations);
    }

    // Create revenue transaction (same pattern as automatic orders)
    try {
      const itemNames = orderItems.map(i => `${i.product_name} x${i.quantity}`).join(', ');
      await prepare('INSERT INTO transactions (type, category, description, amount, order_id, date) VALUES (?, ?, ?, ?, ?, ?)')
        .run('revenue', 'order', `Pedido Manual #${orderId}: ${itemNames}`, finalTotal, orderId, new Date().toISOString().split('T')[0]);
    } catch (err) {
      console.error('Erro ao criar transação de receita para pedido manual:', err.message);
    }

    res.redirect('/admin/orders/' + orderId);
  } catch (err) {
    console.error('Erro ao salvar pedido manual:', err);
    const products = await prepare('SELECT id, name, price, cost_price, image_url FROM products WHERE active = 1 ORDER BY name').all();
    res.render('admin/manual-order', { products, error: 'Erro ao salvar pedido manual. Verifique os dados.' });
  }
}));

// ─── Existing Orders ────────────────────────────────────────────────────────

router.get('/orders', asyncHandler(async (req, res) => {
  try {
    const status = req.query.status || '';
    const source = req.query.source || '';
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('o.status = ?');
      params.push(status);
    }
    if (source === 'manual') {
      conditions.push("o.notes LIKE '__MANUAL__|%'");
    } else if (source === 'site') {
      conditions.push("(o.notes NOT LIKE '__MANUAL__|%' OR o.notes IS NULL OR o.notes = '')");
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const orders = await prepare(`
      SELECT o.*, u.full_name as customer_name,
        COALESCE((SELECT SUM(oi.cost_price * oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0) as total_cost
      FROM orders o 
      JOIN users u ON o.user_id = u.id 
      ${whereClause}
      ORDER BY o.created_at DESC
    `).all(...params);

    res.render('admin/orders', { orders, currentStatus: status, currentSource: source });
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(500).send('Erro ao carregar pedidos.');
  }
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  try {
    const order = await prepare(`
      SELECT o.*, u.full_name, u.cpf, u.email, u.phone, u.street, u.number, u.complement, u.neighborhood, u.city, u.state, u.zip_code 
      FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(req.params.id);
    if (!order) return res.status(404).send('Pedido não encontrado');
    const items = await prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
    res.render('admin/order-detail', { order, items });
  } catch (err) {
    console.error('Erro ao carregar pedido:', err);
    res.status(500).send('Erro ao carregar pedido.');
  }
}));

router.post('/orders/status/:id', asyncHandler(async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'printing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    const order = await prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    await prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);

    if (status === 'cancelled') {
      await prepare("UPDATE transactions SET type = 'cancelled', category = 'cancelled' WHERE order_id = ? AND type = 'revenue'").run(req.params.id);
    } else if (order.status === 'cancelled' && status !== 'cancelled') {
      await prepare("UPDATE transactions SET type = 'revenue', category = 'order' WHERE order_id = ? AND type = 'cancelled'").run(req.params.id);
    }

    res.redirect('/admin/orders/' + req.params.id);
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
    res.status(500).send('Erro ao atualizar status.');
  }
}));

router.get('/customers', asyncHandler(async (req, res) => {
  try {
    const search = req.query.search || '';
    let customers;
    if (search) {
      customers = await prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as total_orders,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id AND status != 'cancelled') as total_spent
        FROM users u WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.cpf LIKE ?
        ORDER BY u.created_at DESC
      `).all(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      customers = await prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as total_orders,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id AND status != 'cancelled') as total_spent
        FROM users u ORDER BY u.created_at DESC
      `).all();
    }
    res.render('admin/customers', { customers, search });
  } catch (err) {
    console.error('Erro ao listar clientes:', err);
    res.status(500).send('Erro ao carregar clientes.');
  }
}));

router.get('/admins', asyncHandler(async (req, res) => {
  try {
    const admins = await prepare('SELECT id, username, email, created_at FROM admins ORDER BY id ASC').all();
    res.render('admin/admins', { admins, error: null, success: null });
  } catch (err) {
    console.error('Erro ao listar admins:', err);
    res.status(500).send('Erro ao carregar administradores.');
  }
}));

router.post('/admins/create', asyncHandler(async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) {
      const admins = await prepare('SELECT id, username, email, created_at FROM admins ORDER BY id ASC').all();
      return res.render('admin/admins', { admins, error: 'Usuário e senha são obrigatórios.', success: null });
    }
    if (password.length < 6) {
      const admins = await prepare('SELECT id, username, email, created_at FROM admins ORDER BY id ASC').all();
      return res.render('admin/admins', { admins, error: 'Senha deve ter no mínimo 6 caracteres.', success: null });
    }
    const existing = await prepare('SELECT id FROM admins WHERE username = ? OR (email = ? AND email != ?)').get(username, email || '', '');
    if (existing) {
      const admins = await prepare('SELECT id, username, email, created_at FROM admins ORDER BY id ASC').all();
      return res.render('admin/admins', { admins, error: 'Nome de usuário ou email já existe.', success: null });
    }
    const hash = bcrypt.hashSync(password, 10);
    await prepare('INSERT INTO admins (username, email, password) VALUES (?, ?, ?)').run(username, email || '', hash);
    const admins = await prepare('SELECT id, username, email, created_at FROM admins ORDER BY id ASC').all();
    res.render('admin/admins', { admins, success: 'Administrador cadastrado com sucesso!', error: null });
  } catch (err) {
    console.error('Erro ao criar admin:', err);
    const admins = await prepare('SELECT id, username, email, created_at FROM admins ORDER BY id ASC').all();
    res.render('admin/admins', { admins, error: 'Erro ao cadastrar administrador.', success: null });
  }
}));

router.post('/admins/delete/:id', asyncHandler(async (req, res) => {
  try {
    const admin = await prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Admin não encontrado' });
    const adminCount = (await prepare('SELECT COUNT(*) as count FROM admins').get()).count;
    if (adminCount <= 1) return res.status(400).json({ error: 'Não é possível excluir o único administrador.' });
    if (parseInt(req.params.id) === req.admin.id) return res.status(400).json({ error: 'Você não pode excluir a si mesmo.' });
    await prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao deletar admin:', err);
    res.status(500).json({ error: 'Erro ao excluir administrador.' });
  }
}));

router.get('/settings', asyncHandler(async (req, res) => {
  try {
    const settings = await prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.render('admin/settings', { settings: settingsMap, error: null, success: null });
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
    res.status(500).send('Erro ao carregar configurações.');
  }
}));

router.post('/settings', uploadLogo.single('logo'), asyncHandler(async (req, res) => {
  try {
    const { site_name, whatsapp_number, instagram_url, whatsapp_message } = req.body;
    const insert = prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    await insert.run('site_name', site_name || 'RYTECH3D');
    await insert.run('whatsapp_number', whatsapp_number?.replace(/\D/g, '') || '5562992371986');
    await insert.run('instagram_url', instagram_url || 'https://instagram.com/rytech3d');
    await insert.run('whatsapp_message', whatsapp_message || 'Olá! Gostaria de fazer um pedido na RYTECH3D.');

    if (req.file) {
      await insert.run('logo_url', '/uploads/' + req.file.filename);
    }

    const settings = await prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.render('admin/settings', { settings: settingsMap, success: 'Configurações salvas com sucesso!', error: null });
  } catch (err) {
    console.error('Erro ao salvar configurações:', err);
    res.status(500).send('Erro ao salvar configurações.');
  }
}));

router.post('/products/variations/save', asyncHandler(async (req, res) => {
  try {
    const { product_id, variations } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Product ID required' });

    await prepare('DELETE FROM product_variations WHERE product_id = ?').run(product_id);

    if (variations && Array.isArray(variations)) {
      for (let i = 0; i < variations.length; i++) {
        const v = variations[i];
        if (v.group_name && v.variation_name) {
          await prepare('INSERT INTO product_variations (product_id, group_name, variation_name, price_modifier, sort_order) VALUES (?, ?, ?, ?, ?)')
            .run(product_id, v.group_name, v.variation_name, parseFloat(v.price_modifier || 0), i);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao salvar variações:', err);
    res.status(500).json({ error: 'Erro ao salvar variações.' });
  }
}));

// ─── Finances ─────────────────────────────────────────────────────────────────

router.get('/finances', asyncHandler(async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const now = new Date();
    let sDate, eDate;

    if (start_date && end_date) {
      sDate = start_date;
      eDate = end_date;
    } else {
      // Default: current month
      const m = now.getMonth() + 1;
      const y = now.getFullYear();
      sDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      eDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    const transactions = await prepare(
      `SELECT * FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC, id DESC`
    ).all(sDate, eDate);

    const totalRevenue = transactions.filter(t => t.type === 'revenue').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalCancelled = transactions.filter(t => t.type === 'cancelled').reduce((s, t) => s + t.amount, 0);
    const orderTotals = transactions.filter(t => t.category === 'order').reduce((s, t) => s + t.amount, 0);
    const cancelledCount = transactions.filter(t => t.type === 'cancelled').length;
    const totalOrderTransactions = transactions.filter(t => t.category === 'order' || t.type === 'cancelled').length;
    const cancelRate = totalOrderTransactions > 0 ? (cancelledCount / totalOrderTransactions * 100) : 0;

    // Profit analysis
    const profitRow = await prepare(`
      SELECT 
        COALESCE(SUM(oi.cost_price * oi.quantity), 0) as total_cost,
        COALESCE(SUM(oi.price * oi.quantity), 0) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND o.status != 'cancelled'
    `).get(sDate, eDate);
    const profitTotalRevenue = profitRow.total_revenue || 0;
    const profitTotalCost = profitRow.total_cost || 0;
    const profitAmount = profitTotalRevenue - profitTotalCost;
    const profitMargin = profitTotalRevenue > 0 ? (profitAmount / profitTotalRevenue * 100) : 0;

    const mostProfitable = await prepare(`
      SELECT 
        oi.product_id, oi.product_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue,
        SUM(oi.cost_price * oi.quantity) as total_cost,
        SUM(oi.price * oi.quantity) - SUM(oi.cost_price * oi.quantity) as total_profit
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND o.status != 'cancelled'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY total_profit DESC
      LIMIT 10
    `).all(sDate, eDate);

    res.render('admin/finances', {
      transactions, startDate: sDate, endDate: eDate,
      totalRevenue, totalExpenses, totalCancelled, orderTotals,
      cancelledCount, cancelRate,
      profitTotalRevenue, profitTotalCost, profitAmount, profitMargin,
      mostProfitable,
      error: null, success: null
    });
  } catch (err) {
    console.error('Erro ao carregar finanças:', err);
    res.status(500).send('Erro ao carregar finanças.');
  }
}));

router.post('/finances/add', asyncHandler(async (req, res) => {
  try {
    const { type, category, description, amount, date } = req.body;
    if (!type || !amount) {
      const transactions = await prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all();
      return res.render('admin/finances', {
        transactions, currentMonth: new Date().getMonth() + 1, currentYear: new Date().getFullYear(),
        totalRevenue: 0, totalExpenses: 0, orderTotals: 0,
        error: 'Tipo e valor são obrigatórios.', success: null
      });
    }
    await prepare('INSERT INTO transactions (type, category, description, amount, date) VALUES (?, ?, ?, ?, ?)')
      .run(type, category || '', description || '', parseFloat(amount), date || new Date().toISOString().split('T')[0]);
    res.redirect('/admin/finances');
  } catch (err) {
    console.error('Erro ao adicionar transação:', err);
    res.status(500).send('Erro ao adicionar transação.');
  }
}));

router.post('/finances/edit/:id', asyncHandler(async (req, res) => {
  try {
    const { type, category, description, amount, date } = req.body;
    await prepare('UPDATE transactions SET type=?, category=?, description=?, amount=?, date=? WHERE id=?')
      .run(type, category || '', description || '', parseFloat(amount), date, req.params.id);
    res.redirect('/admin/finances');
  } catch (err) {
    console.error('Erro ao editar transação:', err);
    res.status(500).send('Erro ao editar transação.');
  }
}));

router.post('/finances/delete/:id', asyncHandler(async (req, res) => {
  try {
    await prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
    res.redirect('/admin/finances');
  } catch (err) {
    console.error('Erro ao deletar transação:', err);
    res.status(500).send('Erro ao deletar transação.');
  }
}));

module.exports = router;
