const jwt = require('jsonwebtoken');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.full_name },
    process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure',
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure');
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure');
    if (decoded.role !== 'admin') {
      throw new Error('Not admin');
    }
    req.admin = decoded;
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
    process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure',
    { expiresIn: '24h' }
  );
}

module.exports = { generateToken, verifyToken, authMiddleware, adminAuth, generateAdminToken };
