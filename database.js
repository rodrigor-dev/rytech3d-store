const path = require('path');
const fs = require('fs');

const isPg = () => !!process.env.DATABASE_URL;

let _sqlite = null;
let _pool = null;
let _txClient = null;

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

function convertSql(sql) {
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  sql = sql.replace(
    /INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
    (_, table, cols, vals) => {
      const c = cols.split(',').map(s => s.trim());
      const v = vals.split(',').map(s => s.trim());
      if (table.toLowerCase() === 'settings') {
        const set = c.slice(1).map((col, idx) => `${col} = ${v[idx + 1]}`).join(', ');
        return `INSERT INTO ${table} (${cols}) VALUES (${vals}) ON CONFLICT (key) DO UPDATE SET ${set}`;
      }
      return `INSERT INTO ${table} (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING`;
    }
  );
  return sql;
}

function isInsert(sql) {
  return /^\s*INSERT\s(?!OR\sREPLACE)/i.test(sql);
}

async function pgQuery(sql, params) {
  const client = _txClient || _pool;
  const text = convertSql(sql);
  const flat = params.length > 0 && Array.isArray(params[0]) ? params[0] : params;
  if (isInsert(sql) && _pool) {
    const result = await client.query(`${text} RETURNING id`, flat);
    return result;
  }
  return client.query(text, flat);
}

function pgPrepare(sql) {
  return {
    run: async (...params) => {
      const r = await pgQuery(sql, params);
      return { lastInsertRowid: r.rows[0]?.id || null, changes: r.rowCount || 0 };
    },
    get: async (...params) => {
      const r = await pgQuery(sql, params);
      return r.rows[0] || undefined;
    },
    all: async (...params) => {
      const r = await pgQuery(sql, params);
      return r.rows;
    }
  };
}

async function pgExec(sql) {
  const client = _txClient || _pool;
  await client.query(sql);
}

function pgTransaction(fn) {
  return async (...args) => {
    const client = await _pool.connect();
    _txClient = client;
    try {
      await client.query('BEGIN');
      const result = await fn(...args);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      _txClient = null;
    }
  };
}

// ─── SQLite ──────────────────────────────────────────────────────────────────

function sqliteGetDb() {
  if (!_sqlite) throw new Error('Database not initialized');
  return _sqlite;
}

function sqliteSave() {
  try {
    if (!_sqlite) return;
    const dir = path.join(__dirname, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = _sqlite.export();
    fs.writeFileSync(path.join(__dirname, 'data', 'rytech3d.db'), Buffer.from(data));
  } catch (err) {
    console.error('Erro ao salvar banco:', err.message);
  }
}

function sqliteGetLastRowid() {
  try {
    const r = _sqlite.exec("SELECT last_insert_rowid()");
    if (r && r.length > 0 && r[0].values && r[0].values.length > 0) return r[0].values[0][0];
  } catch {}
  return 0;
}

function sqliteExecPrepare(sql, method, params) {
  const db = sqliteGetDb();
  let stmt = null;
  try {
    stmt = db.prepare(sql);
    if (!stmt) throw new Error(`Prepare returned null for: ${sql}`);
  } catch (err) {
    throw new Error(`SQL prepare error: ${err.message}\nSQL: ${sql}`);
  }
  const flat = params.length > 0 && Array.isArray(params[0]) ? params[0] : params;
  try {
    if (flat.length > 0) stmt.bind(flat);
    if (method === 'run') {
      while (stmt.step()) {}
      stmt.free();
      sqliteSave();
      return { lastInsertRowid: sqliteGetLastRowid(), changes: 0 };
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

function sqlitePrepare(sql) {
  return {
    run: (...params) => Promise.resolve(sqliteExecPrepare(sql, 'run', params)),
    get: (...params) => Promise.resolve(sqliteExecPrepare(sql, 'get', params)),
    all: (...params) => Promise.resolve(sqliteExecPrepare(sql, 'all', params))
  };
}

function sqliteExec(sql) {
  sqliteGetDb().exec(sql);
  sqliteSave();
}

function sqliteTransaction(fn) {
  return (...args) => {
    try {
      sqliteExec('BEGIN TRANSACTION');
      const maybePromise = fn(...args);
      if (maybePromise instanceof Promise) {
        return maybePromise.then(result => {
          sqliteExec('COMMIT');
          return result;
        }).catch(err => {
          try { sqliteExec('ROLLBACK'); } catch {}
          throw err;
        });
      } else {
        sqliteExec('COMMIT');
        return maybePromise;
      }
    } catch (err) {
      try { sqliteExec('ROLLBACK'); } catch {}
      throw err;
    }
  };
}

// ─── Unified API ─────────────────────────────────────────────────────────────

function prepare(sql) {
  return isPg() ? pgPrepare(sql) : sqlitePrepare(sql);
}

function exec(sql) {
  if (isPg()) return pgExec(sql);
  else { sqliteExec(sql); return Promise.resolve(); }
}

function transaction(fn) {
  if (isPg()) return pgTransaction(fn);
  else {
    const wrapped = sqliteTransaction(fn);
    return (...args) => Promise.resolve(wrapped(...args));
  }
}

async function getSettings() {
  const rows = await prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach(r => map[r.key] = r.value);
  return map;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = isPg() ? `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, cpf TEXT DEFAULT '',
    email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, phone TEXT NOT NULL,
    street TEXT NOT NULL, number TEXT NOT NULL, complement TEXT DEFAULT '',
    neighborhood TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL,
    zip_code TEXT NOT NULL, google_id TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    price REAL NOT NULL, delivery_time TEXT NOT NULL, category TEXT DEFAULT 'Geral',
    image_url TEXT DEFAULT '/uploads/products/default.svg',
    video_url TEXT DEFAULT '', featured INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_images (
    id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    total REAL NOT NULL, status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'pending', notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL,
    variations TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '', password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_variations (
    id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL, variation_name TEXT NOT NULL,
    price_modifier REAL DEFAULT 0, sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY, type TEXT NOT NULL DEFAULT 'revenue',
    category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0, order_id INTEGER REFERENCES orders(id),
    date TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cost_settings (
    id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0, unit TEXT DEFAULT '', category TEXT DEFAULT 'fixed'
  );
  CREATE TABLE IF NOT EXISTS product_costs (
    id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    filament_grams REAL DEFAULT 0, print_hours REAL DEFAULT 0,
    filament_price REAL DEFAULT 0, material_cost REAL DEFAULT 0,
    energy_cost REAL DEFAULT 0, packaging_cost REAL DEFAULT 0,
    additional_cost REAL DEFAULT 0, total_cost REAL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
` : `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
    cpf TEXT DEFAULT '', email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    phone TEXT NOT NULL, street TEXT NOT NULL, number TEXT NOT NULL,
    complement TEXT DEFAULT '', neighborhood TEXT NOT NULL, city TEXT NOT NULL,
    state TEXT NOT NULL, zip_code TEXT NOT NULL, google_id TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    description TEXT NOT NULL, price REAL NOT NULL, delivery_time TEXT NOT NULL,
    category TEXT DEFAULT 'Geral', image_url TEXT DEFAULT '/uploads/products/default.svg',
    video_url TEXT DEFAULT '', featured INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    total REAL NOT NULL, status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'pending', notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL, product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL, price REAL NOT NULL,
    variations TEXT DEFAULT '[]',
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS product_variations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
    group_name TEXT NOT NULL, variation_name TEXT NOT NULL,
    price_modifier REAL DEFAULT 0, sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '', password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS product_variations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
    group_name TEXT NOT NULL, variation_name TEXT NOT NULL,
    price_modifier REAL DEFAULT 0, sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'revenue',
    category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0, order_id INTEGER,
    date TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cost_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0, unit TEXT DEFAULT '', category TEXT DEFAULT 'fixed'
  );
  CREATE TABLE IF NOT EXISTS product_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
    filament_grams REAL DEFAULT 0, print_hours REAL DEFAULT 0,
    filament_price REAL DEFAULT 0, material_cost REAL DEFAULT 0,
    energy_cost REAL DEFAULT 0, packaging_cost REAL DEFAULT 0,
    additional_cost REAL DEFAULT 0, total_cost REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`;

// ─── Init ────────────────────────────────────────────────────────────────────

async function initDatabase() {
  const bcrypt = require('bcryptjs');
  const dbPath = path.join(__dirname, 'data', 'rytech3d.db');

  if (isPg()) {
    const { Pool } = require('pg');
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5
    });
    await _pool.query('SELECT 1');
    console.log('🐘 Conectado ao PostgreSQL');
    await _pool.query(SCHEMA);
    try { await _pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT DEFAULT NULL"); } catch (e) { console.log('pg migration google_id:', e.message); }
    try { await _pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_cpf_key"); } catch (e) { console.log('pg drop cpf constraint:', e.message); }
    try { await _pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price REAL DEFAULT 0"); } catch (e) { console.log('pg migration cost_price:', e.message); }
    try { await _pool.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variations TEXT DEFAULT '[]'"); } catch (e) { console.log('pg migration order_items.variations:', e.message); }
    console.log('✅ Schema PostgreSQL criado');
  } else {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({
      locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
    });
    if (fs.existsSync(dbPath)) {
      _sqlite = new SQL.Database(fs.readFileSync(dbPath));
      console.log('📁 SQLite carregado do arquivo.');
    } else {
      _sqlite = new SQL.Database();
      console.log('🆕 Novo banco SQLite criado.');
    }
    _sqlite.exec(SCHEMA);
    try { _sqlite.exec("ALTER TABLE products ADD COLUMN video_url TEXT DEFAULT ''"); } catch {}
    try { _sqlite.exec("ALTER TABLE order_items ADD COLUMN variations TEXT DEFAULT '[]'"); } catch {}
    try { _sqlite.exec("CREATE TABLE IF NOT EXISTS product_variations (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, group_name TEXT NOT NULL, variation_name TEXT NOT NULL, price_modifier REAL DEFAULT 0, sort_order INTEGER DEFAULT 0, FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE)"); } catch {}
    try { _sqlite.exec("ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT NULL"); } catch {}
    try { _sqlite.exec("ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0"); } catch {}
    sqliteSave();
    console.log('✅ Schema SQLite criado');
  }

  // Seed admins — ensure both admin users exist
  const ensureAdmin = async (username, email, password) => {
    const existing = await prepare('SELECT id FROM admins WHERE username = ?').get(username);
    const h = bcrypt.hashSync(password, 10);
    if (!existing) {
      await prepare('INSERT INTO admins (username, email, password) VALUES (?, ?, ?)').run(username, email, h);
      console.log(`🔑 Admin "${username}" criado`);
    } else if (existing) {
      await prepare('UPDATE admins SET email = ?, password = ? WHERE username = ?').run(email, h, username);
    }
  };
  await ensureAdmin('admin', '', 'Rytech3d@2026');
  await ensureAdmin('rodrigo-admin', 'rodrigo@admin.com', 'rytech2026');

  // Seed products
  const productCount = await prepare('SELECT COUNT(*) as count FROM products').get();
  if (productCount.count === 0) {
    console.log('📦 Criando produtos padrão...');
    const p = await prepare('INSERT INTO products (name, description, price, delivery_time, category, image_url, featured, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    await p.run('Caneca Personalizada 3D', 'Caneca personalizada impressa em 3D com design exclusivo.', 49.90, '5-7 dias úteis', 'Canecas', '/uploads/products/default.svg', 1, 1);
    await p.run('Porta-Canetas Geek', 'Porta-canetas temático com design moderno.', 35.90, '3-5 dias úteis', 'Organizadores', '/uploads/products/default.svg', 1, 1);
    await p.run('Action Figure Personalizada', 'Action figure impressa em 3D com altos detalhes.', 89.90, '7-10 dias úteis', 'Figuras', '/uploads/products/default.svg', 1, 1);
    await p.run('Suporte para Celular', 'Suporte ergonômico para celular.', 25.90, '2-4 dias úteis', 'Acessórios', '/uploads/products/default.svg', 1, 1);
    await p.run('Chaveiro Personalizado', 'Chaveiro 3D personalizado com seu nome ou logo.', 19.90, '2-3 dias úteis', 'Chaveiros', '/uploads/products/default.svg', 1, 1);
    await p.run('Vaso Decorativo', 'Vaso decorativo impresso em 3D com design moderno.', 45.90, '4-6 dias úteis', 'Decoração', '/uploads/products/default.svg', 1, 1);
    console.log('📦 Produtos padrão criados');
  }

  // Seed settings
  const settingsCount = await prepare('SELECT COUNT(*) as count FROM settings').get();
  if (settingsCount.count === 0) {
    const s = await prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    await s.run('whatsapp_number', '5562992371986');
    await s.run('instagram_url', 'https://instagram.com/rytech3d');
    await s.run('whatsapp_message', 'Olá! Gostaria de fazer um pedido na RYTECH3D.');
    await s.run('site_name', 'RYTECH3D');
    await s.run('site_url', process.env.SITE_URL || 'http://localhost:3000');
    await s.run('logo_url', '');
  }

  // Seed default cost settings
  const costSettingsCount = await prepare('SELECT COUNT(*) as count FROM cost_settings').get();
  if (costSettingsCount.count === 0) {
    const cs = await prepare('INSERT INTO cost_settings (key, name, value, unit, category) VALUES (?, ?, ?, ?, ?)');
    await cs.run('energy_rate', 'Tarifa de Energia (kWh)', 0.80, 'R$/kWh', 'fixed');
    await cs.run('printer_power', 'Consumo da Impressora', 0.3, 'kWh', 'fixed');
    await cs.run('packaging_cost', 'Custo de Embalagem', 5.00, 'R$', 'fixed');
    await cs.run('other_costs', 'Outros Custos Fixos', 2.00, 'R$', 'fixed');
    await cs.run('filament_price', 'Preço do Filamento (por grama)', 0.10, 'R$/g', 'variable');
    console.log('⚙️ Custos padrão criados');
  }

  console.log('✅ Banco de dados inicializado!');
}

module.exports = { initDatabase, prepare, exec, transaction, getSettings };