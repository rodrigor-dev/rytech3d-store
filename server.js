require('dotenv').config();

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('⚠️  AVISO: JWT_SECRET não definido! Usando fallback inseguro. Defina JWT_SECRET no .env ou nas variáveis de ambiente do Render.');
  JWT_SECRET = 'fallback_' + Math.random().toString(36).slice(2);
  process.env.JWT_SECRET = JWT_SECRET;
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const passport = require('./middleware/passport');
const { initDatabase, prepare } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      formAction: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  }
}));

app.use(cors({
  origin: process.env.SITE_URL || 'http://localhost:3000',
  credentials: true
}));



app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));

const fileCache = new Map();
const FILE_CACHE_MAX = 100;

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/uploads/')) return next();
  const filePath = path.join(__dirname, 'public', req.path.replace(/^\//, ''));
  if (fs.existsSync(filePath)) return next();
  const cached = fileCache.get(req.path);
  if (cached) {
    res.set('Content-Type', cached.mime);
    res.set('Cache-Control', 'public, max-age=31536000');
    return res.send(cached.buf);
  }
  try {
    const url = req.path.replace(/\\/g, '/');
    let row = await prepare('SELECT image_data, image_mime FROM products WHERE image_url = ?').get(url);
    if (!row) {
      row = await prepare('SELECT image_data, image_mime FROM product_images WHERE image_url = ?').get(url);
    }
    if (row && row.image_data) {
      const buf = Buffer.from(row.image_data, 'base64');
      if (fileCache.size >= FILE_CACHE_MAX) fileCache.delete(fileCache.keys().next().value);
      fileCache.set(req.path, { buf, mime: row.image_mime || 'image/jpeg' });
      res.set('Content-Type', row.image_mime || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.send(buf);
    }
    let videoRow = await prepare('SELECT video_data, video_mime FROM products WHERE video_url = ?').get(url);
    if (videoRow && videoRow.video_data) {
      const buf = Buffer.from(videoRow.video_data, 'base64');
      if (fileCache.size >= FILE_CACHE_MAX) fileCache.delete(fileCache.keys().next().value);
      fileCache.set(req.path, { buf, mime: videoRow.video_mime || 'video/mp4' });
      res.set('Content-Type', videoRow.video_mime || 'video/mp4');
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.send(buf);
    }
    next();
  } catch { next(); }
});
app.use(passport.initialize());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(async (req, res, next) => {
  try {
    const settings = await prepare('SELECT key, value FROM settings').all();
    res.locals.siteSettings = {};
    settings.forEach(s => res.locals.siteSettings[s.key] = s.value);
    res.locals.currentPath = req.path;
    res.locals.currentUser = null;
    res.locals.hasGoogleAuth = !!process.env.GOOGLE_CLIENT_ID;
    const token = req.cookies?.token;
    if (token) {
      try {
        res.locals.currentUser = jwt.verify(token, JWT_SECRET);
      } catch {}
    }
    next();
  } catch (err) {
    next(err);
  }
});

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

app.use('/', authRoutes);
app.use('/', orderRoutes);
app.use('/', productRoutes);
app.use('/admin', adminRoutes);

app.get('/cart', (req, res) => {
  res.render('cart');
});

app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, next) => {
  console.error('❌ ERRO NÃO TRATADO:', err);
  console.error('Stack:', err.stack);
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: 'Erro no upload. Verifique o tamanho e tipo do arquivo.' });
  }
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
  res.status(500).send('Erro interno do servidor');
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 RYTECH3D Store rodando em http://localhost:${PORT}`);
    console.log(`📱 Site do cliente: http://localhost:${PORT}`);
    console.log(`🔧 Admin: http://localhost:${PORT}/admin/login`);

  });
}).catch(err => {
  console.error('Erro ao iniciar banco de dados:', err);
  process.exit(1);
});
