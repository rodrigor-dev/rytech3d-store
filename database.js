const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'rytech3d.db');
const dir = path.join(__dirname, 'data');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let _db = null;

function getDb() {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

function saveToFile() {
  try {
    if (!_db) return;
    const data = _db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err) {
    console.error('Erro ao salvar banco:', err.message);
  }
}

function execPrepare(sql, method, params) {
  const db = getDb();
  let stmt = null;
  try {
    stmt = db.prepare(sql);
    if (!stmt) throw new Error(`Prepare returned null for: ${sql}`);
  } catch (err) {
    throw new Error(`SQL prepare error: ${err.message}\nSQL: ${sql}`);
  }

  const flatParams = params.length > 0 && Array.isArray(params[0]) ? params[0] : params;

  try {
    if (flatParams.length > 0) stmt.bind(flatParams);

    if (method === 'run') {
      while (stmt.step()) { }
      stmt.free();
      saveToFile();
      return { lastInsertRowid: getLastInsertRowid(), changes: 0 };
    } else if (method === 'get') {
      let result = undefined;
      if (stmt.step()) result = stmt.getAsObject();
      stmt.free();
      return result;
    } else if (method === 'all') {
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    }
  } catch (err) {
    try { stmt.free(); } catch {}
    throw new Error(`SQL ${method} error: ${err.message}`);
  }
}

function prepare(sql) {
  return {
    run: (...params) => execPrepare(sql, 'run', params),
    get: (...params) => execPrepare(sql, 'get', params),
    all: (...params) => execPrepare(sql, 'all', params)
  };
}

function getLastInsertRowid() {
  try {
    const result = _db.exec("SELECT last_insert_rowid()");
    if (result && result.length > 0 && result[0].values && result[0].values.length > 0) {
      return result[0].values[0][0];
    }
  } catch {}
  return 0;
}

function exec(sql) {
  try {
    _db.exec(sql);
    saveToFile();
  } catch (err) {
    throw new Error(`SQL exec error: ${err.message}`);
  }
}

function transaction(fn) {
  return function (...args) {
    try {
      exec('BEGIN TRANSACTION');
      const result = fn.apply(this, args);
      exec('COMMIT');
      return result;
    } catch (err) {
      try { exec('ROLLBACK'); } catch {}
      throw err;
    }
  };
}

async function initDatabase() {
  const bcrypt = require('bcryptjs');
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    _db = new SQL.Database(buffer);
    console.log('Banco de dados carregado do arquivo.');
  } else {
    _db = new SQL.Database();
    console.log('Novo banco de dados criado.');
  }

  exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    cpf TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    phone TEXT NOT NULL,
    street TEXT NOT NULL,
    number TEXT NOT NULL,
    complement TEXT DEFAULT '',
    neighborhood TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    delivery_time TEXT NOT NULL,
    category TEXT DEFAULT 'Geral',
    image_url TEXT DEFAULT '/uploads/products/default.svg',
    video_url TEXT DEFAULT '',
    featured INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  try { exec(`ALTER TABLE products ADD COLUMN video_url TEXT DEFAULT ''`); } catch {}

  exec(`CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  exec(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  exec(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '',
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  const adminCount = prepare('SELECT COUNT(*) as count FROM admins').get();
  if (adminCount.count === 0) {
    const hash1 = bcrypt.hashSync('Rytech3d@2026', 10);
    prepare('INSERT INTO admins (username, email, password) VALUES (?, ?, ?)').run('admin', '', hash1);
    const hash2 = bcrypt.hashSync('rytech2026', 10);
    prepare('INSERT INTO admins (username, email, password) VALUES (?, ?, ?)').run('rodrigo-admin', 'rodrigo@admin.com', hash2);
    console.log('🔑 Admin padrão: admin / Rytech3d@2026');
    console.log('🔑 Admin email: rodrigo@admin.com / rytech2026');
  }

  const emailAdmin = prepare('SELECT id FROM admins WHERE email = ?').get('rodrigo@admin.com');
  if (!emailAdmin) {
    const hash = bcrypt.hashSync('rytech2026', 10);
    prepare('INSERT INTO admins (username, email, password) VALUES (?, ?, ?)').run('rodrigo-admin', 'rodrigo@admin.com', hash);
    console.log('📧 Admin por email adicionado: rodrigo@admin.com / rytech2026');
  }

  const productCount = prepare('SELECT COUNT(*) as count FROM products').get();
  if (productCount.count === 0) {
    const insert = prepare('INSERT INTO products (name, description, price, delivery_time, category, image_url, featured) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('Caneca Personalizada 3D', 'Caneca personalizada impressa em 3D com design exclusivo. Ideal para presente ou uso pessoal. Material PLA de alta qualidade.', 49.90, '5-7 dias úteis', 'Canecas', '/uploads/products/default.svg', 1);
    insert.run('Porta-Canetas Geek', 'Porta-canetas temático com design moderno. Perfeito para organizar sua mesa de trabalho ou estudos.', 35.90, '3-5 dias úteis', 'Organizadores', '/uploads/products/default.svg', 1);
    insert.run('Action Figure Personalizada', 'Action figure impressa em 3D com altos detalhes. Pode ser personalizada conforme sua referência.', 89.90, '7-10 dias úteis', 'Figuras', '/uploads/products/default.svg', 1);
    insert.run('Suporte para Celular', 'Suporte ergonômico para celular, compatível com todos os modelos. Design compacto e resistente.', 25.90, '2-4 dias úteis', 'Acessórios', '/uploads/products/default.svg', 1);
    insert.run('Chaveiro Personalizado', 'Chaveiro 3D personalizado com seu nome ou logo. Acabamento perfeito e durável.', 19.90, '2-3 dias úteis', 'Chaveiros', '/uploads/products/default.svg', 1);
    insert.run('Vaso Decorativo', 'Vaso decorativo impresso em 3D com design moderno e minimalista. Disponível em várias cores.', 45.90, '4-6 dias úteis', 'Decoração', '/uploads/products/default.svg', 1);
    console.log('📦 Produtos padrão criados com sucesso!');
  }

  const settingsCount = prepare('SELECT COUNT(*) as count FROM settings').get();
  if (settingsCount.count === 0) {
    const insert = prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    insert.run('whatsapp_number', '5562992371986');
    insert.run('instagram_url', 'https://instagram.com/rytech3d');
    insert.run('whatsapp_message', 'Olá! Gostaria de fazer um pedido na RYTECH3D.');
    insert.run('site_name', 'RYTECH3D');
    insert.run('site_url', process.env.SITE_URL || 'http://localhost:3000');
    insert.run('logo_url', '');
  }

  saveToFile();
  console.log('✅ Banco de dados inicializado com sucesso!');
}

function getSettings() {
  const rows = prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach(r => map[r.key] = r.value);
  return map;
}

module.exports = { initDatabase, getDb, prepare, exec, transaction, saveToFile, getSettings };
