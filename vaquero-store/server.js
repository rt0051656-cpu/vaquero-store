'use strict';
/**
 * EL VAQUERO STORE — servidor (Node 22+, sin dependencias externas).
 * - SQLite (node:sqlite) para pedidos y sesiones
 * - Comprobantes guardados en disco (carpeta privada, solo accesible por el admin)
 * - Login de administrador con scrypt + cookie de sesión HttpOnly
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------- Configuración (variables de entorno) ----------
const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const WHATSAPP = '51912420894';
const MAX_UPLOAD = 5 * 1024 * 1024; // 5 MB
const SECURE_COOKIE = process.env.NODE_ENV === 'production';

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('\n[ERROR] Debes definir la variable ADMIN_PASSWORD (mínimo 8 caracteres).');
  console.error('Ejemplo:  ADMIN_PASSWORD="MiClaveSegura123" node server.js\n');
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Catálogo (el servidor es la fuente de verdad de los precios) ----------
const PACKAGES = {
  p110: { diamonds: 110, label: '110 diamantes', price: 3.4 },
  p341: { diamonds: 341, label: '341 diamantes', price: 10.0 },
  p576: { diamonds: 576, label: '576 diamantes', price: 15.0 },
  p1167: { diamonds: 1167, label: '1,167 diamantes', price: 28.0 },
  p2398: { diamonds: 2398, label: '2,398 diamantes', price: 53.0 },
  p6160: { diamonds: 6160, label: '6,160 diamantes', price: 130.0 },
};
const STATUSES = {
  pending: 'Pendiente de verificación',
  verified: 'Pago verificado',
  processing: 'Pedido en proceso',
  completed: 'Pedido completado',
  rejected: 'Pedido rechazado',
};

// ---------- Base de datos ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  player_id TEXT NOT NULL,
  package_key TEXT NOT NULL,
  diamonds INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  receipt_file TEXT NOT NULL,
  receipt_mime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  status_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_player ON orders(player_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  year INTEGER PRIMARY KEY,
  last INTEGER NOT NULL
);
`);

// ---------- Contraseña admin (hash scrypt) ----------
const SALT = crypto.createHash('sha256').update('vaquero-salt:' + ADMIN_USER).digest();
const ADMIN_HASH = crypto.scryptSync(ADMIN_PASSWORD, SALT, 64);
function checkLogin(user, pass) {
  const h = crypto.scryptSync(String(pass), SALT, 64);
  const okPass = crypto.timingSafeEqual(h, ADMIN_HASH);
  const a = Buffer.from(String(user));
  const b = Buffer.from(ADMIN_USER);
  const okUser = a.length === b.length && crypto.timingSafeEqual(a, b);
  return okPass && okUser;
}

// ---------- Sesiones ----------
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(sha(token), Date.now() + SESSION_TTL);
  return token;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAdmin(req) {
  const t = parseCookies(req).vq_session;
  if (!t) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha(t));
  if (!row) return false;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
    return false;
  }
  return true;
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

// ---------- Límite de intentos ----------
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some((t) => n - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// ---------- Utilidades HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};
function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(body);
}
const json = (res, code, obj, headers = {}) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Archivo demasiado grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Parser multipart mínimo
function parseMultipart(buf, boundary) {
  const fields = {}; const files = {};
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    let part = buf.slice(pos + delim.length, next);
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.slice(0, sep).toString('utf8');
      const data = part.slice(sep + 4);
      const name = /name="([^"]*)"/i.exec(head);
      const fname = /filename="([^"]*)"/i.exec(head);
      if (name) {
        if (fname) files[name[1]] = { filename: fname[1], data };
        else fields[name[1]] = data.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}

// Detección real del tipo de imagen por firma (no confiamos en la extensión)
function sniffImage(b) {
  if (b.length > 8 && b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}

function nextReference() {
  const year = new Date().getFullYear();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT last FROM counters WHERE year = ?').get(year);
    const n = (row ? row.last : 0) + 1;
    db.prepare('INSERT INTO counters (year, last) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET last = excluded.last').run(year, n);
    db.exec('COMMIT');
    return `EVS-${year}-${String(n).padStart(4, '0')}`;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const publicOrder = (o) => ({
  reference: o.reference, playerId: o.player_id, diamonds: o.diamonds,
  price: o.price_cents / 100, status: o.status, statusLabel: STATUSES[o.status],
});
const adminOrder = (o) => ({
  ...publicOrder(o), id: o.id, packageKey: o.package_key, note: o.status_note || '',
  createdAt: o.created_at, updatedAt: o.updated_at, receiptUrl: `/api/admin/orders/${o.id}/receipt`,
});

// ---------- Rutas API ----------
async function handleApi(req, res, url) {
  const m = req.method; const p = url.pathname;

  if (m === 'GET' && p === '/api/config') {
    return json(res, 200, {
      whatsapp: WHATSAPP,
      packages: Object.entries(PACKAGES).map(([key, v]) => ({ key, ...v })),
    });
  }

  // Crear pedido
  if (m === 'POST' && p === '/api/orders') {
    if (!rateLimit('order:' + clientIp(req), 8, 3600e3)) return json(res, 429, { error: 'Demasiados pedidos desde tu conexión. Intenta más tarde o escríbenos por WhatsApp.' });
    const ct = req.headers['content-type'] || '';
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!ct.startsWith('multipart/form-data') || !bm) return json(res, 400, { error: 'Solicitud inválida.' });
    const buf = await readBody(req, MAX_UPLOAD + 64 * 1024);
    const { fields, files } = parseMultipart(buf, bm[1] || bm[2]);

    const playerId = String(fields.playerId || '').trim();
    if (!/^\d{6,14}$/.test(playerId)) return json(res, 400, { error: 'El ID de jugador debe tener solo números (entre 6 y 14 dígitos).' });
    const pkg = PACKAGES[fields.packageKey];
    if (!pkg) return json(res, 400, { error: 'Selecciona un paquete válido.' });
    const f = files.receipt;
    if (!f || !f.data.length) return json(res, 400, { error: 'Debes adjuntar tu comprobante de pago.' });
    if (f.data.length > MAX_UPLOAD) return json(res, 413, { error: 'La imagen supera los 5 MB.' });
    const kind = sniffImage(f.data);
    if (!kind) return json(res, 400, { error: 'El comprobante debe ser una imagen JPG, JPEG o PNG válida.' });

    const fileName = crypto.randomBytes(16).toString('hex') + '.' + kind.ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), f.data, { mode: 0o600 });
    const now = new Date().toISOString();
    let order;
    try {
      const reference = nextReference();
      db.prepare(`INSERT INTO orders (reference, player_id, package_key, diamonds, price_cents, receipt_file, receipt_mime, status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .run(reference, playerId, fields.packageKey, pkg.diamonds, Math.round(pkg.price * 100), fileName, kind.mime, now, now);
      order = db.prepare('SELECT * FROM orders WHERE reference = ?').get(reference);
    } catch (e) {
      fs.rmSync(path.join(UPLOAD_DIR, fileName), { force: true });
      throw e;
    }
    return json(res, 201, { order: publicOrder(order) });
  }

  // Login admin
  if (m === 'POST' && p === '/api/admin/login') {
    if (!rateLimit('login:' + clientIp(req), 8, 15 * 60e3)) return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    let body; try { body = JSON.parse((await readBody(req, 10 * 1024)).toString() || '{}'); } catch { return json(res, 400, { error: 'Solicitud inválida.' }); }
    if (!checkLogin(body.user || '', body.password || '')) return json(res, 401, { error: 'Usuario o contraseña incorrectos.' });
    const token = createSession();
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `vq_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${SECURE_COOKIE ? '; Secure' : ''}`,
    });
  }
  if (m === 'POST' && p === '/api/admin/logout') {
    const t = parseCookies(req).vq_session;
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'vq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // ---- A partir de aquí: solo administrador ----
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado' });
    // Protección CSRF adicional: las escrituras exigen cabecera personalizada
    if (m !== 'GET' && req.headers['x-requested-with'] !== 'vaquero') return json(res, 403, { error: 'Solicitud no permitida' });

    if (m === 'GET' && p === '/api/admin/me') return json(res, 200, { ok: true });

    if (m === 'GET' && p === '/api/admin/orders') {
      const q = (url.searchParams.get('q') || '').trim();
      const status = url.searchParams.get('status') || '';
      const where = []; const args = [];
      if (q) { where.push('(reference LIKE ? OR player_id LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
      if (STATUSES[status]) { where.push('status = ?'); args.push(status); }
      const rows = db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...args);
      const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all().map((r) => [r.status, r.c]));
      return json(res, 200, { orders: rows.map(adminOrder), counts, statuses: STATUSES });
    }

    let mm = /^\/api\/admin\/orders\/(\d+)\/status$/.exec(p);
    if (m === 'POST' && mm) {
      let body; try { body = JSON.parse((await readBody(req, 10 * 1024)).toString() || '{}'); } catch { return json(res, 400, { error: 'Solicitud inválida.' }); }
      if (!STATUSES[body.status]) return json(res, 400, { error: 'Estado inválido.' });
      const r = db.prepare('UPDATE orders SET status = ?, status_note = ?, updated_at = ? WHERE id = ?')
        .run(body.status, String(body.note || '').slice(0, 300), new Date().toISOString(), Number(mm[1]));
      if (!r.changes) return json(res, 404, { error: 'Pedido no encontrado.' });
      return json(res, 200, { order: adminOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(mm[1]))) });
    }

    mm = /^\/api\/admin\/orders\/(\d+)\/receipt$/.exec(p);
    if (m === 'GET' && mm) {
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(mm[1]));
      if (!o) return json(res, 404, { error: 'No encontrado' });
      const file = path.join(UPLOAD_DIR, path.basename(o.receipt_file));
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Archivo no encontrado' });
      const ext = o.receipt_mime === 'image/png' ? 'png' : 'jpg';
      const disp = url.searchParams.get('download') ? `attachment; filename="${o.reference}.${ext}"` : 'inline';
      return send(res, 200, fs.readFileSync(file), { 'Content-Type': o.receipt_mime, 'Content-Disposition': disp, 'Cache-Control': 'private, no-store' });
    }
  }
  return json(res, 404, { error: 'No encontrado' });
}

// ---------- Archivos estáticos ----------
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/admin' || p === '/admin/') p = '/admin/index.html';
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const ext = path.extname(file).toLowerCase();
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Error interno del servidor.' });
  }
});
server.listen(PORT, () => console.log(`EL VAQUERO STORE en http://localhost:${PORT}  (admin: /admin)`));
