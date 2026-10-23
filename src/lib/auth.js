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

// Hotels a user may open: the home hotel plus any granted through user_hotels.
export function userHotels(db, userId) {
  return db.prepare(`select h.id, h.name, h.slug, coalesce(nullif(u.kind, ''), u.role) as role from users u join hotels h on h.id = u.hotel_id where u.id = ?
    union select h.id, h.name, h.slug, coalesce(nullif(uh.kind, ''), uh.role) from user_hotels uh join hotels h on h.id = uh.hotel_id where uh.user_id = ?
    order by 2`).all(userId, userId);
}

// Express middleware: attaches req.user (scoped to the session's current hotel) and req.session.
export function loadUser(db) {
  const q = db.prepare(`select s.id as sid, s.csrf, s.expires_at, s.hotel_id as current_hotel, u.id, u.hotel_id, u.email, u.name, coalesce(nullif(u.kind, ''), u.role) as role, u.is_platform_admin
    from sessions s join users u on u.id = s.user_id where s.id = ?`);
  const grant = db.prepare("select coalesce(nullif(kind, ''), role) as role from user_hotels where user_id = ? and hotel_id = ?");
  return (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (sid) {
      const row = q.get(sid);
      if (row && row.expires_at > new Date().toISOString()) {
        let hotelId = row.hotel_id;
        let role = row.role;
        if (row.current_hotel && row.current_hotel !== row.hotel_id) {
          const g = grant.get(row.id, row.current_hotel);
          if (g) { hotelId = row.current_hotel; role = g.role; }
        }
        req.session = { id: row.sid, csrf: row.csrf };
        req.user = { id: row.id, hotel_id: hotelId, home_hotel_id: row.hotel_id, email: row.email, name: row.name, role, platform: Boolean(row.is_platform_admin) };
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

export function requireOwner(req, res, next) {
  if (req.user?.role === 'owner') return next();
  res.status(403).send('Этот раздел доступен только владельцу объекта.');
}

export function requirePlatform(req, res, next) {
  if (!req.user) return res.redirect(`/app/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.user.platform) return next();
  res.status(403).send('Раздел для команды платформы.');
}

export const ROLES = [
  ['owner', 'Владелец', 'всё, включая настройки и сотрудников'],
  ['manager', 'Администратор', 'брони, шахматка, цены, номера, отчёты; без настроек и сотрудников'],
  ['housekeeping', 'Горничная', 'только уборка номеров; не видит гостей и деньги'],
  ['investor', 'Инвестор', 'только сводка, загрузка, доход и продажи; ничего не меняет, не видит гостей'],
];

// What each limited role may open. Owner and manager are handled by requireOwner.
const LIMITED = {
  housekeeping: (req) => req.path.startsWith('/housekeeping') || ['/logout', '/switch'].includes(req.path),
  investor: (req) => (req.method === 'GET' && (req.path === '/' || (req.path === '/reports' && ['', 'occupancy', 'sales'].includes(String(req.query.tab || '')))))
    || (req.method === 'POST' && ['/logout', '/switch'].includes(req.path)),
};

export function roleGuard(req, res, next) {
  const allowed = LIMITED[req.user.role];
  if (!allowed || allowed(req)) return next();
  if (req.method === 'GET' && req.user.role === 'housekeeping') return res.redirect('/app/housekeeping');
  res.status(403).send('Этот раздел недоступен для вашей роли. Обратитесь к владельцу объекта.');
}
