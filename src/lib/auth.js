import crypto from 'node:crypto';

const COOKIE = 'sr_sid';
const TTL_DAYS = 14;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(db, userId) {
  const id = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(16).toString('base64url');
  const exp = new Date(Date.now() + TTL_DAYS * 86400000).toISOString();
  db.prepare('insert into sessions (id, user_id, csrf, expires_at) values (?, ?, ?, ?)').run(id, userId, csrf, exp);
  return id;
}

export function sessionCookie(id, secure) {
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Express middleware: attaches req.user and req.session when the cookie is valid.
export function loadUser(db) {
  const q = db.prepare(`select s.id as sid, s.csrf, s.expires_at, u.id, u.hotel_id, u.email, u.name, u.role
    from sessions s join users u on u.id = s.user_id where s.id = ?`);
  return (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (sid) {
      const row = q.get(sid);
      if (row && row.expires_at > new Date().toISOString()) {
        req.session = { id: row.sid, csrf: row.csrf };
        req.user = { id: row.id, hotel_id: row.hotel_id, email: row.email, name: row.name, role: row.role };
      }
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  const back = encodeURIComponent(req.originalUrl);
  return res.redirect(`/app/login?next=${back}`);
}

export function checkCsrf(req, res, next) {
  const token = req.body?._csrf || req.get('x-csrf-token');
  if (req.session && token && token === req.session.csrf) return next();
  res.status(403).send('Сессия устарела. Обновите страницу и попробуйте ещё раз.');
}
