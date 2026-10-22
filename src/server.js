import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, SOLUTIONS, ARTICLES } from './content.js';
import { quote, TOOLS } from './lib/pricing.js';
import { loadUser, requireUser, checkCsrf, verifyPassword, createSession, sessionCookie, clearCookie } from './lib/auth.js';
import { parseSearch, searchOffers, createBooking, cancelBooking, validateGuest, priceStay, findPromo, ensureInventory, BookingError, logToChannels } from './lib/booking.js';
import { addDays, today, nightsOf, isIsoDate, diffDays, isWeekend } from './lib/dates.js';
import * as M from './views/marketing.js';
import * as E from './views/engine.js';
import * as A from './views/app.js';
import { DEMO } from './seed.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const int = (v, d = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function createApp(db, opts = {}) {
  const secret = opts.secret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const showDemo = opts.showDemo ?? true;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    if (!req.path.startsWith('/widget')) res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(express.static(path.join(ROOT, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use(loadUser(db));

  // Signed token that lets a guest open their booking page.
  const bookingToken = (code) => crypto.createHmac('sha256', secret).update(code).digest('base64url').slice(0, 22);

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

  // ---------- marketing ----------
  app.get('/', (req, res) => res.send(M.home()));
  app.get('/products', (req, res) => res.send(M.productsIndex()));
  app.get('/products/:slug', (req, res, next) => {
    const p = PRODUCTS.find((x) => x.slug === req.params.slug);
    return p ? res.send(M.productPage(p)) : next();
  });
  app.get('/solutions/:slug', (req, res, next) => {
    const s = SOLUTIONS.find((x) => x.slug === req.params.slug);
    return s ? res.send(M.solutionPage(s)) : next();
  });
  const priceParams = (q) => {
    const type = String(q.type || 'hotel');
    const rooms = q.rooms === undefined ? 20 : q.rooms;
    const tools = q.tools === undefined && q.rooms === undefined ? ['channels', 'pms'] : arr(q.tools).map(String);
    return { type: SOLUTIONS.some((s) => s.slug === type) || type ? type : 'hotel', rooms, tools };
  };
  app.get('/price', (req, res) => {
    const p = priceParams(req.query);
    if (!['hotel', 'mini', 'apartments', 'resort', 'glamping', 'sanatorium'].includes(p.type)) p.type = 'hotel';
    res.send(M.pricePage({ ...p, quote: quote(p) }));
  });
  app.get('/api/quote', (req, res) => {
    const q = quote(priceParams(req.query));
    res.json({ ...q, html: M.quoteView(q).value });
  });
  app.get('/demo', (req, res) => res.send(M.demoPage({ values: { source_page: String(req.query.product || req.get('referer') || '').slice(0, 200) } })));
  app.post('/demo', (req, res) => {
    const b = req.body;
    if (b.website) return res.send(M.demoPage({ done: true })); // honeypot
    const values = {
      name: String(b.name || '').trim().slice(0, 120),
      phone: String(b.phone || '').trim().slice(0, 40),
      email: String(b.email || '').trim().slice(0, 200),
      property_type: String(b.property_type || '').slice(0, 40),
      rooms: String(b.rooms || '').trim(),
      message: String(b.message || '').trim().slice(0, 2000),
      source_page: String(b.source_page || '').slice(0, 200),
      agree: b.agree === 'on',
    };
    const errors = {};
    if (values.name.length < 2) errors.name = 'Представьтесь, пожалуйста';
    if (values.phone.replace(/\D/g, '').length < 10) errors.phone = 'Нужен телефон, хотя бы 10 цифр';
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Проверьте адрес почты';
    if (values.rooms && (int(values.rooms, -1) < 1 || int(values.rooms) > 2000)) errors.rooms = 'От 1 до 2000';
    if (!values.agree) errors.agree = 'Нужно согласие на обработку данных';
    if (Object.keys(errors).length) return res.status(422).send(M.demoPage({ values, errors }));
    db.prepare('insert into leads (name, phone, email, property_type, rooms, message, source_page) values (?,?,?,?,?,?,?)')
      .run(values.name, values.phone, values.email, values.property_type, values.rooms ? int(values.rooms) : null, values.message, values.source_page);
    res.send(M.demoPage({ done: true }));
  });
  app.get('/contacts', (req, res) => res.send(M.contactsPage()));
  app.get('/about', (req, res) => res.send(M.aboutPage()));
  app.get('/privacy', (req, res) => res.send(M.privacyPage()));
  app.get('/support', (req, res) => {
    const q = String(req.query.q || '').slice(0, 100);
    res.send(M.supportPage({ q, results: M.searchArticles(q) }));
  });
  app.get('/support/:slug', (req, res, next) => {
    const a = ARTICLES.find((x) => x.slug === req.params.slug);
    return a ? res.send(M.articlePage(a)) : next();
  });

  // ---------- booking engine ----------
  const hotelBySlug = db.prepare('select * from hotels where slug = ?');
  app.param('hotel', (req, res, next, slug) => {
    const h = hotelBySlug.get(slug);
    if (!h) return res.status(404).send(M.notFound());
    req.hotel = h;
    next();
  });
  const defaultQuery = () => ({ checkin: addDays(today(), 7), checkout: addDays(today(), 9), adults: 2, children: 0, promo: '' });

  app.get('/h/:hotel', (req, res) => {
    const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 order by sort, id').all(req.hotel.id);
    res.send(E.hotelPage(req.hotel, rooms, defaultQuery(), {}));
  });
  app.get('/h/:hotel/rooms', (req, res) => {
    const s = parseSearch(req.query);
    if (!s.ok) {
      const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 order by sort, id').all(req.hotel.id);
      return res.status(422).send(E.hotelPage(req.hotel, rooms, s.query, s.errors));
    }
    res.send(E.resultsPage(req.hotel, s.query, searchOffers(db, req.hotel, s.query)));
  });
  app.get('/api/h/:hotel/offers', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const s = parseSearch(req.query);
    if (!s.ok) return res.status(422).json({ errors: s.errors });
    const r = searchOffers(db, req.hotel, s.query);
    res.json({
      hotel: { slug: req.hotel.slug, name: req.hotel.name },
      nights: r.nights,
      promoInvalid: r.promoInvalid,
      offers: r.offers.map((o) => ({
        room: { id: o.room.id, name: o.room.name, capacity: o.room.capacity },
        available: o.available, left: o.left, reason: o.reason,
        rates: o.rates.map(({ rate, price }) => ({ id: rate.id, name: rate.name, refundable: Boolean(rate.refundable), meal: rate.meal, total: price.total })),
      })),
    });
  });

  function checkoutContext(hotel, src) {
    const s = parseSearch(src);
    if (!s.ok) return { error: 'search', s };
    const room = db.prepare('select * from room_types where id = ? and hotel_id = ? and active = 1').get(int(src.room), hotel.id);
    const rate = db.prepare('select * from rate_plans where id = ? and hotel_id = ? and active = 1').get(int(src.rate), hotel.id);
    if (!room || !rate) return { error: 'gone', s };
    const nights = nightsOf(s.query.checkin, s.query.checkout);
    ensureInventory(db, room, nights);
    const rows = db.prepare('select price from inventory where room_type_id = ? and date >= ? and date < ? order by date').all(room.id, s.query.checkin, s.query.checkout);
    const price = priceStay({ nightly: rows.map((r) => r.price), rate, guests: s.query.adults + s.query.children, promo: findPromo(db, hotel.id, s.query.promo) });
    const extras = db.prepare('select * from extras where hotel_id = ? and active = 1 order by id').all(hotel.id);
    return { query: s.query, room, rate, price, extras, nights: nights.length };
  }

  app.get('/h/:hotel/checkout', (req, res) => {
    const ctx = checkoutContext(req.hotel, req.query);
    if (ctx.error) return res.redirect(303, `/h/${req.hotel.slug}`);
    res.send(E.checkoutPage(req.hotel, { ...ctx, idemKey: crypto.randomUUID() }));
  });

  app.post('/h/:hotel/book', (req, res) => {
    const ctx = checkoutContext(req.hotel, req.body);
    if (ctx.error) return res.redirect(303, `/h/${req.hotel.slug}`);
    const chosen = arr(req.body.extras).map((x) => int(x)).filter((x) => ctx.extras.some((e) => e.id === x));
    const v = validateGuest(req.body);
    const idemKey = /^[0-9a-f-]{36}$/.test(req.body.idem || '') ? req.body.idem : crypto.randomUUID();
    const values = { ...req.body, agree: req.body.agree === 'on' };
    if (!v.ok) return res.status(422).send(E.checkoutPage(req.hotel, { ...ctx, chosen, values, errors: v.errors, idemKey }));
    try {
      const b = createBooking(db, req.hotel, {
        query: ctx.query, roomId: ctx.room.id, rateId: ctx.rate.id, extraIds: chosen, guest: v.guest,
        payment: req.body.payment === 'card' ? 'card' : 'hotel', idemKey,
      });
      res.redirect(303, `/h/${req.hotel.slug}/booking/${b.code}?t=${bookingToken(b.code)}&new=1`);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      res.status(409).send(E.checkoutPage(req.hotel, { ...ctx, chosen, values, errors: {}, idemKey: crypto.randomUUID(), formError: e.message }));
    }
  });

  const bookingByCode = db.prepare('select * from bookings where code = ? and hotel_id = ?');
  const showBooking = (req, res, b, extra = {}) => {
    const room = db.prepare('select * from room_types where id = ?').get(b.room_type_id);
    const rate = db.prepare('select * from rate_plans where id = ?').get(b.rate_plan_id);
    res.send(E.confirmationPage(req.hotel, b, room, rate, extra));
  };
  app.get('/h/:hotel/booking/:code', (req, res) => {
    const b = bookingByCode.get(req.params.code, req.hotel.id);
    if (!b || req.query.t !== bookingToken(b.code)) return res.status(404).send(E.managePage(req.hotel, { error: 'Бронь не найдена. Проверьте номер и почту.' }));
    showBooking(req, res, b, { justBooked: req.query.new === '1' });
  });
  app.get('/h/:hotel/manage', (req, res) => res.send(E.managePage(req.hotel, {})));
  app.post('/h/:hotel/manage', (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const b = bookingByCode.get(code, req.hotel.id);
    if (!b || b.guest_email !== email) return res.status(404).send(E.managePage(req.hotel, { values: { code, email }, error: 'Бронь не найдена. Проверьте номер и почту.' }));
    res.redirect(303, `/h/${req.hotel.slug}/booking/${b.code}?t=${bookingToken(b.code)}`);
  });
  app.post('/h/:hotel/booking/:code/cancel', (req, res) => {
    const b = bookingByCode.get(req.params.code, req.hotel.id);
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!b || b.guest_email !== email) return res.status(404).send(E.managePage(req.hotel, { error: 'Бронь не найдена. Проверьте номер и почту.' }));
    try {
      cancelBooking(db, b);
      res.redirect(303, `/h/${req.hotel.slug}/booking/${b.code}?t=${bookingToken(b.code)}`);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      showBooking(req, res.status(409), b, { error: e.message });
    }
  });
  app.get('/widget-demo', (req, res) => {
    const h = db.prepare('select slug from hotels order by id limit 1').get();
    res.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тестовый сайт отеля</title>
      <style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f3f1ec;color:#1b1f1d}main{max-width:900px;margin:0 auto}</style></head>
      <body><main><h1>Сайт вашего отеля</h1><p>Так выглядит модуль бронирования, встроенный на чужой сайт одной строкой кода.</p>
      <div id="stayra-booking"></div><script src="/widget.js" data-hotel="${h ? h.slug : ''}" async></script></main></body></html>`);
  });

  // ---------- extranet ----------
  const loginLimiter = new Map();
  app.get('/app/login', (req, res) => {
    if (req.user) return res.redirect('/app');
    res.send(A.loginPage({ next: safeNext(req.query.next), demo: showDemo ? DEMO : null }));
  });
  app.post('/app/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const key = `${req.ip}|${email}`;
    const now = Date.now();
    const hits = (loginLimiter.get(key) || []).filter((t) => now - t < 15 * 60000);
    const next = safeNext(req.body.next);
    if (hits.length >= 10) return res.status(429).send(A.loginPage({ email, next, error: 'Слишком много попыток. Подождите 15 минут.', demo: showDemo ? DEMO : null }));
    const user = db.prepare('select * from users where email = ?').get(email);
    if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
      hits.push(now);
      loginLimiter.set(key, hits);
      return res.status(401).send(A.loginPage({ email, next, error: 'Неверная почта или пароль', demo: showDemo ? DEMO : null }));
    }
    loginLimiter.delete(key);
    const sid = createSession(db, user.id);
    res.set('Set-Cookie', sessionCookie(sid, req.secure));
    res.redirect(303, next);
  });

  const appRouter = express.Router();
  appRouter.use(requireUser);
  appRouter.use((req, res, next) => {
    if (req.method === 'POST') return checkCsrf(req, res, next);
    next();
  });
  appRouter.use((req, res, next) => {
    req.hotelRow = db.prepare('select * from hotels where id = ?').get(req.user.hotel_id);
    const m = req.query.m;
    req.msg = m ? { type: req.query.e ? 'error' : 'success', text: String(m).slice(0, 200) } : null;
    next();
  });
  const back = (res, url, text, isError) => res.redirect(303, `${url}${url.includes('?') ? '&' : '?'}m=${encodeURIComponent(text)}${isError ? '&e=1' : ''}`);

  appRouter.post('/logout', (req, res) => {
    db.prepare('delete from sessions where id = ?').run(req.session.id);
    res.set('Set-Cookie', clearCookie());
    res.redirect(303, '/app/login');
  });

  const bookingsJoin = `select b.*, r.name as room_name from bookings b join room_types r on r.id = b.room_type_id where b.hotel_id = ?`;
  appRouter.get('/', (req, res) => {
    const hid = req.user.hotel_id;
    const t = today();
    const arrivals = db.prepare(`${bookingsJoin} and b.checkin = ? and b.status in ('confirmed','checked_in') order by b.id`).all(hid, t);
    const departures = db.prepare(`${bookingsJoin} and b.checkout = ? and b.status in ('checked_in','confirmed') order by b.id`).all(hid, t);
    const recent = db.prepare(`${bookingsJoin} order by b.id desc limit 8`).all(hid);
    const rooms = db.prepare('select coalesce(sum(total_rooms),0) n from room_types where hotel_id = ? and active = 1').get(hid).n;
    const occupied = db.prepare(`select count(*) n from bookings where hotel_id = ? and checkin <= ? and checkout > ? and status in ('confirmed','checked_in')`).get(hid, t, t).n;
    const r30 = db.prepare(`select count(*) n, coalesce(sum(total),0) s from bookings where hotel_id = ? and status != 'cancelled' and created_at >= datetime('now','-30 days')`).get(hid);
    res.send(A.dashboardPage({ req, hotel: req.hotelRow, arrivals, departures, recent, stats: { rooms, occupied, occupancy: rooms ? Math.round((occupied / rooms) * 100) : 0, revenue30: r30.s, count30: r30.n } }));
  });

  appRouter.get('/bookings', (req, res) => {
    const f = { q: String(req.query.q || '').trim().slice(0, 100), status: String(req.query.status || ''), from: String(req.query.from || ''), to: String(req.query.to || '') };
    let sql = bookingsJoin;
    const params = [req.user.hotel_id];
    if (f.q) { sql += ' and (b.guest_name like ? or b.guest_email like ? or b.code like ?)'; const like = `%${f.q}%`; params.push(like, like, like); }
    if (f.status) { sql += ' and b.status = ?'; params.push(f.status); }
    if (isIsoDate(f.from)) { sql += ' and b.checkin >= ?'; params.push(f.from); }
    if (isIsoDate(f.to)) { sql += ' and b.checkin <= ?'; params.push(f.to); }
    sql += ' order by b.checkin desc, b.id desc limit 500';
    res.send(A.bookingsPage({ req, hotel: req.hotelRow, rows: db.prepare(sql).all(...params), filters: f }));
  });

  const ownBooking = (req) => db.prepare('select * from bookings where id = ? and hotel_id = ?').get(int(req.params.id), req.user.hotel_id);
  appRouter.get('/bookings/:id', (req, res, next) => {
    const b = ownBooking(req);
    if (!b) return next();
    const room = db.prepare('select * from room_types where id = ?').get(b.room_type_id);
    const rate = db.prepare('select * from rate_plans where id = ?').get(b.rate_plan_id);
    res.send(A.bookingDetailPage({ req, hotel: req.hotelRow, b, room, rate, msg: req.msg }));
  });
  const TRANSITIONS = { confirmed: ['checked_in', 'no_show', 'cancelled'], checked_in: ['checked_out'] };
  appRouter.post('/bookings/:id/status', (req, res, next) => {
    const b = ownBooking(req);
    if (!b) return next();
    const to = String(req.body.status || '');
    if (!(TRANSITIONS[b.status] || []).includes(to)) return back(res, `/app/bookings/${b.id}`, 'Такой переход статуса невозможен', true);
    if (to === 'cancelled') cancelBooking(db, b);
    else db.prepare('update bookings set status = ? where id = ?').run(to, b.id);
    back(res, `/app/bookings/${b.id}`, 'Статус изменён');
  });

  // Grid
  appRouter.get('/grid', (req, res) => {
    const t = today();
    let from = isIsoDate(req.query.from) ? req.query.from : t;
    if (from < t) from = t;
    const dates = Array.from({ length: 14 }, (_, i) => addDays(from, i));
    const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 order by sort, id').all(req.user.hotel_id);
    const cells = {};
    const q = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date <= ?');
    for (const r of rooms) {
      ensureInventory(db, r, dates);
      for (const c of q.all(r.id, dates[0], dates[dates.length - 1])) cells[`${r.id}:${c.date}`] = c;
    }
    res.send(A.gridPage({ req, hotel: req.hotelRow, rooms, dates, cells, from, msg: req.msg }));
  });
  appRouter.post('/grid', (req, res) => {
    const b = req.body || {};
    const room = db.prepare('select * from room_types where id = ? and hotel_id = ?').get(int(b.room), req.user.hotel_id);
    if (!room || !isIsoDate(b.date) || b.date < today()) return res.status(400).json({ error: 'Неверная категория или дата' });
    const price = int(b.price, -1), available = int(b.available, -1), minStay = int(b.min_stay, 1);
    if (price < 0 || price > 1000000) return res.status(422).json({ error: 'Цена от 0 до 1 000 000 ₽' });
    if (available < 0 || available > room.total_rooms) return res.status(422).json({ error: `Свободно может быть от 0 до ${room.total_rooms}` });
    if (minStay < 1 || minStay > 30) return res.status(422).json({ error: 'Минимум ночей от 1 до 30' });
    const closed = b.open ? 0 : 1;
    ensureInventory(db, room, [b.date]);
    db.prepare('update inventory set price = ?, available = ?, closed = ?, min_stay = ? where room_type_id = ? and date = ?').run(price, available, closed, minStay, room.id, b.date);
    logToChannels(db, req.user.hotel_id, 'update', `${room.name}, ${b.date}: ${price} ₽, свободно ${available}${closed ? ', продажи закрыты' : ''}`);
    res.json({ ok: true, cell: db.prepare('select * from inventory where room_type_id = ? and date = ?').get(room.id, b.date) });
  });
  appRouter.post('/grid/bulk', (req, res) => {
    const b = req.body;
    const hid = req.user.hotel_id;
    const rooms = b.room === 'all'
      ? db.prepare('select * from room_types where hotel_id = ? and active = 1').all(hid)
      : db.prepare('select * from room_types where id = ? and hotel_id = ?').all(int(b.room), hid);
    const to = String(b.to || ''), from = String(b.from || '');
    if (!rooms.length || !isIsoDate(from) || !isIsoDate(to) || to < from) return back(res, '/app/grid', 'Проверьте категорию и даты', true);
    if (diffDays(from, to) > 365) return back(res, '/app/grid', 'Не больше года за раз', true);
    const value = int(b.value, NaN);
    if ((b.action === 'price' && !(value >= 0 && value <= 1000000)) || (b.action === 'percent' && !(value >= -90 && value <= 500))) {
      return back(res, `/app/grid?from=${from}`, 'Укажите корректное значение', true);
    }
    const start = from < today() ? today() : from;
    const dates = nightsOf(start, addDays(to, 1)).filter((d) => b.days === 'weekend' ? isWeekend(d) : b.days === 'weekday' ? !isWeekend(d) : true);
    db.exec('begin immediate');
    try {
      for (const r of rooms) {
        ensureInventory(db, r, dates);
        const st = {
          price: db.prepare('update inventory set price = ? where room_type_id = ? and date = ?'),
          percent: db.prepare('update inventory set price = max(0, cast(round(price * (100 + ?) / 100.0) as integer)) where room_type_id = ? and date = ?'),
          close: db.prepare('update inventory set closed = 1 where room_type_id = ? and date = ? and ? is not null'),
          open: db.prepare('update inventory set closed = 0 where room_type_id = ? and date = ? and ? is not null'),
        }[b.action];
        if (!st) throw new Error('bad action');
        for (const d of dates) {
          if (b.action === 'close' || b.action === 'open') st.run(r.id, d, 1);
          else st.run(value, r.id, d);
        }
      }
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      return back(res, '/app/grid', 'Не удалось применить изменения', true);
    }
    logToChannels(db, hid, 'update', `Массовое изменение: ${rooms.length} кат., ${dates.length} дн. (${b.action})`);
    back(res, `/app/grid?from=${start}`, `Готово: изменено ${rooms.length * dates.length} ячеек`);
  });

  // Rooms & rates
  appRouter.get('/rooms', (req, res) => {
    const hid = req.user.hotel_id;
    res.send(A.roomsPage({
      req, hotel: req.hotelRow, msg: req.msg,
      rooms: db.prepare('select * from room_types where hotel_id = ? order by sort, id').all(hid),
      rates: db.prepare('select * from rate_plans where hotel_id = ? order by id').all(hid),
      extras: db.prepare('select * from extras where hotel_id = ? order by id').all(hid),
      promos: db.prepare('select * from promo_codes where hotel_id = ? order by id').all(hid),
    }));
  });
  const roomInput = (b) => {
    const r = {
      name: String(b.name || '').trim().slice(0, 80), description: String(b.description || '').trim().slice(0, 1000),
      capacity: int(b.capacity), total_rooms: int(b.total_rooms, -1), base_price: int(b.base_price, -1),
      area_m2: Math.max(0, int(b.area_m2)), beds: String(b.beds || '').trim().slice(0, 80), active: b.active === 'on' ? 1 : 0,
    };
    let err = null;
    if (r.name.length < 2) err = 'Укажите название категории';
    else if (r.capacity < 1 || r.capacity > 12) err = 'Мест: от 1 до 12';
    else if (r.total_rooms < 0 || r.total_rooms > 500) err = 'Номеров: от 0 до 500';
    else if (r.base_price < 0 || r.base_price > 1000000) err = 'Цена: от 0 до 1 000 000 ₽';
    return { r, err };
  };
  appRouter.post('/rooms', (req, res) => {
    const { r, err } = roomInput(req.body);
    if (err) return back(res, '/app/rooms', err, true);
    const sort = db.prepare('select coalesce(max(sort),0)+1 s from room_types where hotel_id = ?').get(req.user.hotel_id).s;
    const images = ['room-1', 'room-2', 'room-3', 'room-4'];
    db.prepare('insert into room_types (hotel_id, name, description, capacity, beds, area_m2, total_rooms, base_price, image, sort) values (?,?,?,?,?,?,?,?,?,?)')
      .run(req.user.hotel_id, r.name, r.description, r.capacity, r.beds, r.area_m2, r.total_rooms, r.base_price, images[sort % 4], sort);
    back(res, '/app/rooms', `Категория «${r.name}» добавлена`);
  });
  appRouter.post('/rooms/:id', (req, res, next) => {
    const old = db.prepare('select * from room_types where id = ? and hotel_id = ?').get(int(req.params.id), req.user.hotel_id);
    if (!old) return next();
    const { r, err } = roomInput(req.body);
    if (err) return back(res, '/app/rooms', err, true);
    tx_(db, () => {
      db.prepare('update room_types set name=?, description=?, capacity=?, beds=?, area_m2=?, total_rooms=?, base_price=?, active=? where id = ?')
        .run(r.name, r.description, r.capacity, r.beds, r.area_m2, r.total_rooms, r.base_price, r.active, old.id);
      // Room count changed: shift future availability by the difference, never below zero.
      const delta = r.total_rooms - old.total_rooms;
      if (delta) db.prepare('update inventory set available = max(0, min(?, available + ?)) where room_type_id = ? and date >= ?').run(r.total_rooms, delta, old.id, today());
    });
    back(res, '/app/rooms', 'Сохранено');
  });
  const rateInput = (b) => ({
    name: String(b.name || '').trim().slice(0, 80), description: String(b.description || '').trim().slice(0, 500),
    meal: ['none', 'breakfast', 'half'].includes(b.meal) ? b.meal : 'none', meal_price: Math.max(0, int(b.meal_price)),
    refundable: b.refundable === 'on' ? 1 : 0, discount_pct: Math.min(90, Math.max(0, int(b.discount_pct))), active: b.active === 'on' ? 1 : 0,
  });
  appRouter.post('/rates', (req, res) => {
    const r = rateInput(req.body);
    if (r.name.length < 2) return back(res, '/app/rooms', 'Укажите название тарифа', true);
    db.prepare('insert into rate_plans (hotel_id, name, description, meal, meal_price, refundable, discount_pct) values (?,?,?,?,?,?,?)')
      .run(req.user.hotel_id, r.name, r.description, r.meal, r.meal_price, r.refundable, r.discount_pct);
    back(res, '/app/rooms', `Тариф «${r.name}» добавлен`);
  });
  appRouter.post('/rates/:id', (req, res, next) => {
    const r = rateInput(req.body);
    if (r.name.length < 2) return back(res, '/app/rooms', 'Укажите название тарифа', true);
    const u = db.prepare('update rate_plans set name=?, description=?, meal=?, meal_price=?, refundable=?, discount_pct=?, active=? where id = ? and hotel_id = ?')
      .run(r.name, r.description, r.meal, r.meal_price, r.refundable, r.discount_pct, r.active, int(req.params.id), req.user.hotel_id);
    if (!u.changes) return next();
    back(res, '/app/rooms', 'Сохранено');
  });
  appRouter.post('/extras', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const price = int(req.body.price, -1);
    const per = ['stay', 'night', 'guest_night'].includes(req.body.per) ? req.body.per : 'stay';
    if (name.length < 2 || price < 0) return back(res, '/app/rooms', 'Укажите название и цену услуги', true);
    db.prepare('insert into extras (hotel_id, name, price, per) values (?,?,?,?)').run(req.user.hotel_id, name, price, per);
    back(res, '/app/rooms', 'Услуга добавлена');
  });
  appRouter.post('/extras/:id/toggle', (req, res, next) => {
    const u = db.prepare('update extras set active = 1 - active where id = ? and hotel_id = ?').run(int(req.params.id), req.user.hotel_id);
    return u.changes ? back(res, '/app/rooms', 'Сохранено') : next();
  });
  appRouter.post('/promos', (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const pct = int(req.body.discount_pct);
    if (!/^[A-Z0-9_-]{2,32}$/.test(code) || pct < 1 || pct > 90) return back(res, '/app/rooms', 'Код: латиница и цифры, скидка 1–90%', true);
    try {
      db.prepare('insert into promo_codes (hotel_id, code, discount_pct) values (?,?,?)').run(req.user.hotel_id, code, pct);
    } catch {
      return back(res, '/app/rooms', 'Такой промокод уже есть', true);
    }
    back(res, '/app/rooms', `Промокод ${code} добавлен`);
  });
  appRouter.post('/promos/:id/toggle', (req, res, next) => {
    const u = db.prepare('update promo_codes set active = 1 - active where id = ? and hotel_id = ?').run(int(req.params.id), req.user.hotel_id);
    return u.changes ? back(res, '/app/rooms', 'Сохранено') : next();
  });

  // Channels
  appRouter.get('/channels', (req, res) => {
    const hid = req.user.hotel_id;
    const channels = db.prepare('select * from channels where hotel_id = ? order by connected desc, id').all(hid);
    const log = db.prepare('select l.*, c.name as channel from channel_log l join channels c on c.id = l.channel_id where c.hotel_id = ? order by l.id desc limit 50').all(hid);
    res.send(A.channelsPage({ req, hotel: req.hotelRow, channels, log, msg: req.msg }));
  });
  appRouter.post('/channels/:id/toggle', (req, res, next) => {
    const c = db.prepare('select * from channels where id = ? and hotel_id = ?').get(int(req.params.id), req.user.hotel_id);
    if (!c) return next();
    db.prepare('update channels set connected = ? where id = ?').run(c.connected ? 0 : 1, c.id);
    if (c.connected) db.prepare('insert into channel_log (channel_id, kind, summary) values (?,?,?)').run(c.id, 'disconnect', 'Канал отключён, продажи в нём остановлены');
    else {
      const rooms = db.prepare('select count(*) n from room_types where hotel_id = ? and active = 1').get(req.user.hotel_id).n;
      db.prepare('insert into channel_log (channel_id, kind, summary) values (?,?,?)').run(c.id, 'full', `Выгружены цены и наличие: ${rooms} кат. на 365 дней${c.markup_pct ? `, наценка ${c.markup_pct}%` : ''}`);
    }
    back(res, '/app/channels', c.connected ? `${c.name} отключён` : `${c.name} подключён`);
  });
  appRouter.post('/channels/:id/markup', (req, res, next) => {
    const pct = int(req.body.markup_pct, -1);
    if (pct < 0 || pct > 50) return back(res, '/app/channels', 'Наценка от 0 до 50%', true);
    const u = db.prepare('update channels set markup_pct = ? where id = ? and hotel_id = ?').run(pct, int(req.params.id), req.user.hotel_id);
    return u.changes ? back(res, '/app/channels', 'Наценка сохранена') : next();
  });

  // Leads: the marketing site belongs to the platform, so every signed-in owner sees them in the demo.
  appRouter.get('/leads', (req, res) => {
    res.send(A.leadsPage({ req, hotel: req.hotelRow, leads: db.prepare('select * from leads order by id desc limit 200').all() }));
  });

  appRouter.get('/reports', (req, res) => {
    const hid = req.user.hotel_id;
    const t = today();
    const from = isIsoDate(req.query.from) ? req.query.from : addDays(t, -29);
    let to = isIsoDate(req.query.to) ? req.query.to : t;
    if (to < from) to = from;
    if (diffDays(from, to) > 366) to = addDays(from, 366);
    const days = diffDays(from, to) + 1;
    const end = addDays(to, 1);
    const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 order by sort, id').all(hid);
    const bookings = db.prepare(`select * from bookings where hotel_id = ? and status in ('confirmed','checked_in','checked_out') and checkin < ? and checkout > ?`).all(hid, end, from);
    const rows = rooms.map((r) => {
      let sold = 0, revenue = 0;
      for (const b of bookings.filter((x) => x.room_type_id === r.id)) {
        const n = diffDays(b.checkin, b.checkout);
        const inPeriod = nightsOf(b.checkin, b.checkout).filter((d) => d >= from && d < end).length;
        sold += inPeriod;
        revenue += Math.round((b.nights_total * inPeriod) / n);
      }
      const capacity = r.total_rooms * days;
      return { name: r.name, sold, capacity, revenue, occupancy: capacity ? Math.round((sold / capacity) * 100) : 0 };
    });
    const nights = rows.reduce((s, r) => s + r.sold, 0);
    const cap = rows.reduce((s, r) => s + r.capacity, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    res.send(A.reportsPage({ req, hotel: req.hotelRow, from, to, rows, totals: { nights, revenue, occupancy: cap ? Math.round((nights / cap) * 100) : 0, adr: nights ? Math.round(revenue / nights) : 0 } }));
  });

  appRouter.get('/settings', (req, res) => {
    res.send(A.settingsPage({ req, hotel: req.hotelRow, origin: `${req.protocol}://${req.get('host')}`, msg: req.msg }));
  });
  appRouter.post('/settings', (req, res) => {
    const b = req.body;
    const time = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : d);
    const name = String(b.name || '').trim().slice(0, 120);
    if (name.length < 2) return back(res, '/app/settings', 'Укажите название объекта', true);
    db.prepare('update hotels set name=?, city=?, address=?, phone=?, email=?, checkin_time=?, checkout_time=?, description=? where id = ?').run(
      name, String(b.city || '').trim().slice(0, 80), String(b.address || '').trim().slice(0, 200), String(b.phone || '').trim().slice(0, 40),
      String(b.email || '').trim().slice(0, 200), time(b.checkin_time, '14:00'), time(b.checkout_time, '12:00'), String(b.description || '').trim().slice(0, 1000), req.user.hotel_id,
    );
    back(res, '/app/settings', 'Настройки сохранены');
  });

  app.use('/app', appRouter);

  app.use((req, res) => res.status(404).send(M.notFound()));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).send('Что-то пошло не так. Мы уже разбираемся.');
  });
  return app;
}

function tx_(db, fn) {
  db.exec('begin immediate');
  try {
    fn();
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

function safeNext(v) {
  const s = String(v || '/app');
  return s.startsWith('/app') && !s.startsWith('//') ? s : '/app';
}

export { TOOLS };
