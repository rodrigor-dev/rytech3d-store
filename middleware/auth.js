const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.full_name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Sessão expirada' });
    }
    res.clearCookie('token');
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  req.user = decoded;
  next();
}

function adminAuth(req, res, next) {
  const token = req.cookies?.admin_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    return res.redirect('/admin/login');
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      throw new Error('Not admin');
    }
    req.admin = decoded;
    res.locals.adminUser = decoded;
    next();
  } catch {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Sessão expirada' });
    }
    res.clearCookie('admin_token');
    return res.redirect('/admin/login');
  }
}

function generateAdminToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { generateToken, verifyToken, authMiddleware, adminAuth, generateAdminToken };
