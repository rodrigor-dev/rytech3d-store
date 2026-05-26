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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Apenas imagens (JPEG, PNG, GIF, WebP) são permitidas.'));
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /mp4|webm|ogg|mov|avi/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) cb(null, true);
    else cb(new Error('Apenas vídeos (MP4, WebM, OGG, MOV) são permitidos.'));
  }
});

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

router.get('/login', (req, res) => {
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = prepare('SELECT * FROM admins WHERE username = ? OR email = ?').get(username, username);
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
});

router.get('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/admin/login');
});

router.use(adminAuth);

router.get('/', (req, res) => {
  try {
    const totalProducts = prepare('SELECT COUNT(*) as count FROM products').get().count;
    const totalOrders = prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const totalCustomers = prepare('SELECT COUNT(*) as count FROM users').get().count;
    const revenueRow = prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status != 'cancelled'").get();
    const totalRevenue = revenueRow.total;
    const recentOrders = prepare(`
      SELECT o.*, u.full_name as customer_name FROM orders o 
      JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC LIMIT 5
    `).all();
    const pendingOrders = prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;

    res.render('admin/dashboard', {
      totalProducts, totalOrders, totalCustomers, totalRevenue, pendingOrders, recentOrders
    });
  } catch (err) {
    console.error('Erro no dashboard:', err);
    res.status(500).send('Erro ao carregar dashboard.');
  }
});

router.get('/products', (req, res) => {
  try {
    const products = prepare('SELECT * FROM products ORDER BY created_at DESC').all();
    res.render('admin/products', { products });
  } catch (err) {
    console.error('Erro ao listar produtos:', err);
    res.status(500).send('Erro ao carregar produtos.');
  }
});

router.get('/products/new', (req, res) => {
  res.render('admin/product-form', { product: null, error: null });
});

router.get('/products/edit/:id', (req, res) => {
  try {
    const product = prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).send('Produto não encontrado');
    const extraImages = prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order').all(req.params.id);
    product.extraImages = extraImages;
    res.render('admin/product-form', { product, error: null });
  } catch (err) {
    console.error('Erro ao carregar produto:', err);
    res.status(500).send('Erro ao carregar produto.');
  }
});

router.post('/products/save', upload.array('images', 10), uploadVideo.single('video_file'), (req, res) => {
  try {
    const { id, name, description, price, delivery_time, category, featured, active } = req.body;
    let video_url = req.body.video_url || '';
    if (req.file && req.file.fieldname === 'video_file') {
      video_url = '/uploads/products/' + req.file.filename;
    }
    if (!name || !description || !price || !delivery_time) {
      return res.render('admin/product-form', {
        product: req.body,
        error: 'Nome, descrição, preço e tempo de entrega são obrigatórios.'
      });
    }

    let image_url = req.body.current_image || '/uploads/products/default.svg';
    if (req.files && req.files.length > 0) {
      image_url = '/uploads/products/' + req.files[0].filename;
    }

    const activeValue = active !== undefined ? (active === '1' || active === true ? 1 : 0) : 1;

    if (id) {
      prepare(`UPDATE products SET name=?, description=?, price=?, delivery_time=?, category=?, image_url=?, video_url=?, featured=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(name, description, parseFloat(price), delivery_time, category || 'Geral', image_url, video_url || '', featured ? 1 : 0, activeValue, parseInt(id));
      prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
    } else {
      const result = prepare(`INSERT INTO products (name, description, price, delivery_time, category, image_url, video_url, featured, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(name, description, parseFloat(price), delivery_time, category || 'Geral', image_url, video_url || '', featured ? 1 : 0, activeValue);
      var productId = result.lastInsertRowid;
    }

    const targetId = id || productId;

    if (req.files && req.files.length > 1) {
      for (let i = 1; i < req.files.length; i++) {
        const imgUrl = '/uploads/products/' + req.files[i].filename;
        prepare('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)').run(targetId, imgUrl, i);
      }
    }

    if (req.body.existing_images) {
      const existingImages = Array.isArray(req.body.existing_images) ? req.body.existing_images : [req.body.existing_images];
      existingImages.forEach((url, i) => {
        if (url) prepare('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)').run(targetId, url, 99 + i);
      });
    }

    res.redirect('/admin/products');
  } catch (err) {
    console.error('Erro ao salvar produto:', err);
    res.render('admin/product-form', {
      product: req.body,
      error: 'Erro ao salvar produto. Verifique os dados e tente novamente.'
    });
  }
});

router.post('/products/toggle-active/:id', (req, res) => {
  try {
    const product = prepare('SELECT active FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
    const newActive = product.active ? 0 : 1;
    prepare('UPDATE products SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newActive, req.params.id);
    res.json({ success: true, active: newActive });
  } catch (err) {
    console.error('Erro ao toggle active:', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

router.post('/products/delete/:id', (req, res) => {
  try {
    const product = prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (product && product.image_url && product.image_url !== '/uploads/products/default.svg') {
      const imgPath = path.join(__dirname, '..', 'public', product.image_url);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    const extraImages = prepare('SELECT * FROM product_images WHERE product_id = ?').all(req.params.id);
    extraImages.forEach(img => {
      const imgPath = path.join(__dirname, '..', 'public', img.image_url);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    });
    prepare('DELETE FROM product_images WHERE product_id = ?').run(req.params.id);
    prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Erro ao deletar produto:', err);
    res.status(500).send('Erro ao deletar produto.');
  }
});

router.get('/orders', (req, res) => {
  try {
    const status = req.query.status || '';
    let orders;
    if (status) {
      orders = prepare(`
        SELECT o.*, u.full_name as customer_name FROM orders o 
        JOIN users u ON o.user_id = u.id 
        WHERE o.status = ? ORDER BY o.created_at DESC
      `).all(status);
    } else {
      orders = prepare(`
        SELECT o.*, u.full_name as customer_name FROM orders o 
        JOIN users u ON o.user_id = u.id 
        ORDER BY o.created_at DESC
      `).all();
    }
    res.render('admin/orders', { orders, currentStatus: status });
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(500).send('Erro ao carregar pedidos.');
  }
});

router.get('/orders/:id', (req, res) => {
  try {
    const order = prepare(`
      SELECT o.*, u.full_name, u.cpf, u.email, u.phone, u.street, u.number, u.complement, u.neighborhood, u.city, u.state, u.zip_code 
      FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(req.params.id);
    if (!order) return res.status(404).send('Pedido não encontrado');
    const items = prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
    res.render('admin/order-detail', { order, items });
  } catch (err) {
    console.error('Erro ao carregar pedido:', err);
    res.status(500).send('Erro ao carregar pedido.');
  }
});

router.post('/orders/status/:id', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'printing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
    res.redirect('/admin/orders/' + req.params.id);
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
    res.status(500).send('Erro ao atualizar status.');
  }
});

router.get('/customers', (req, res) => {
  try {
    const search = req.query.search || '';
    let customers;
    if (search) {
      customers = prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as total_orders,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id AND status != 'cancelled') as total_spent
        FROM users u WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.cpf LIKE ?
        ORDER BY u.created_at DESC
      `).all(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      customers = prepare(`
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
});

router.get('/settings', (req, res) => {
  try {
    const settings = prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.render('admin/settings', { settings: settingsMap, error: null, success: null });
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
    res.status(500).send('Erro ao carregar configurações.');
  }
});

router.post('/settings', uploadLogo.single('logo'), (req, res) => {
  try {
    const { site_name, whatsapp_number, instagram_url, whatsapp_message } = req.body;
    const insert = prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    insert.run('site_name', site_name || 'RYTECH3D');
    insert.run('whatsapp_number', whatsapp_number?.replace(/\D/g, '') || '5562992371986');
    insert.run('instagram_url', instagram_url || 'https://instagram.com/rytech3d');
    insert.run('whatsapp_message', whatsapp_message || 'Olá! Gostaria de fazer um pedido na RYTECH3D.');

    if (req.file) {
      insert.run('logo_url', '/uploads/' + req.file.filename);
    }

    const settings = prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.render('admin/settings', { settings: settingsMap, success: 'Configurações salvas com sucesso!', error: null });
  } catch (err) {
    console.error('Erro ao salvar configurações:', err);
    res.status(500).send('Erro ao salvar configurações.');
  }
});

module.exports = router;
