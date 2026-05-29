require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const passport = require('./middleware/passport');
const { initDatabase, prepare } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.SITE_URL || 'http://localhost:3000',
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
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
        res.locals.currentUser = jwt.verify(token, process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure');
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
    return res.status(400).json({ error: 'Erro no upload: ' + err.message });
  }
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
  res.status(500).send('Erro interno do servidor: ' + err.message);
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 RYTECH3D Store rodando em http://localhost:${PORT}`);
    console.log(`📱 Site do cliente: http://localhost:${PORT}`);
    console.log(`🔧 Admin: http://localhost:${PORT}/admin/login`);
    console.log(`📧 Admin padrão: admin / Rytech3d@2026\n`);
  });
}).catch(err => {
  console.error('Erro ao iniciar banco de dados:', err);
  process.exit(1);
});
