import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, SOLUTIONS, ARTICLES } from './content.js';
import { quote, TOOLS } from './lib/pricing.js';
import { loadUser, requirePlatform, createSession, sessionCookie } from './lib/auth.js';
import { parseSearch, searchOffers, createBooking, cancelBooking, validateGuest, priceStay, findPromo, ensureInventory, ratesMap, BookingError } from './lib/booking.js';
import { addDays, nightsOf, todayIn } from './lib/dates.js';
import { createHotel, PROPERTY_TYPES } from './lib/hotels.js';
import { appRouter } from './routes/app.js';
import * as ADM from './views/admin.js';
import * as M from './views/marketing.js';
import * as E from './views/engine.js';
import * as A from './views/app.js';

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
  const defaultQuery = (h) => ({ checkin: addDays(todayIn(h.timezone), Math.max(7, h.min_days_ahead)), checkout: addDays(todayIn(h.timezone), Math.max(7, h.min_days_ahead) + 2), adults: 2, children: 0, promo: '' });
  const sellableRooms = (h) => db.prepare('select * from room_types where hotel_id = ? and active = 1 and total_rooms > 0 order by sort, id').all(h.id);

  app.get('/h/:hotel', (req, res) => {
    res.send(E.hotelPage(req.hotel, sellableRooms(req.hotel), defaultQuery(req.hotel), {}));
  });
  app.get('/h/:hotel/rooms', (req, res) => {
    const s = parseSearch(req.query, req.hotel);
    if (!s.ok) return res.status(422).send(E.hotelPage(req.hotel, sellableRooms(req.hotel), s.query, s.errors));
    res.send(E.resultsPage(req.hotel, s.query, searchOffers(db, req.hotel, s.query)));
  });
  app.get('/api/h/:hotel/offers', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const s = parseSearch(req.query, req.hotel);
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
    const s = parseSearch(src, hotel);
    if (!s.ok) return { error: 'search', s };
    const room = db.prepare('select * from room_types where id = ? and hotel_id = ? and active = 1').get(int(src.room), hotel.id);
    const rate = db.prepare('select * from rate_plans where id = ? and hotel_id = ? and active = 1').get(int(src.rate), hotel.id);
    if (!room || !rate) return { error: 'gone', s };
    const nights = nightsOf(s.query.checkin, s.query.checkout);
    ensureInventory(db, room, nights);
    const rows = db.prepare('select price from inventory where room_type_id = ? and date >= ? and date < ? order by date').all(room.id, s.query.checkin, s.query.checkout);
    const price = priceStay({ nightly: rows.map((r) => r.price), rate, rates: ratesMap(db, hotel.id), room, adults: s.query.adults, children: s.query.children, promo: findPromo(db, hotel.id, s.query.promo), hotel });
    const extras = db.prepare('select e.*, g.name as group_name from extras e left join extra_groups g on g.id = e.group_id where e.hotel_id = ? and e.active = 1 order by g.sort, e.id').all(hotel.id);
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
        payment: req.body.payment === 'card' && req.hotel.pay_card ? 'card' : 'hotel', idemKey,
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
    const h = db.prepare('select slug from hotels where slug = ?').get(String(req.query.hotel || '')) || db.prepare('select slug from hotels order by id limit 1').get();
    res.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тестовый сайт отеля</title>
      <style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f3f1ec;color:#1b1f1d}main{max-width:900px;margin:0 auto}</style></head>
      <body><main><h1>Сайт вашего отеля</h1><p>Так выглядит модуль бронирования, встроенный на чужой сайт одной строкой кода.</p>
      <div id="stayra-booking"></div><script src="/widget.js" data-hotel="${h ? h.slug : ''}" async></script></main></body></html>`);
  });

  // ---------- sign up: every new property is its own tenant ----------
  app.get('/signup', (req, res) => res.send(A.signupPage({})));
  app.post('/signup', (req, res) => {
    const b = req.body;
    const values = { hotel_name: String(b.hotel_name || '').trim().slice(0, 120), city: String(b.city || '').trim().slice(0, 80), property_type: String(b.property_type || 'hotel'),
      name: String(b.name || '').trim().slice(0, 80), email: String(b.email || '').trim().toLowerCase().slice(0, 200), agree: b.agree === 'on' };
    const errors = {};
    if (values.hotel_name.length < 2) errors.hotel_name = 'Укажите название объекта';
    if (values.name.length < 2) errors.name = 'Как к вам обращаться?';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Проверьте адрес почты';
    else if (db.prepare('select 1 from users where email = ?').get(values.email)) errors.email = 'С этой почтой уже есть кабинет — войдите и добавьте объект в настройках';
    if (String(b.password || '').length < 8) errors.password = 'Пароль — не короче 8 символов';
    if (!values.agree) errors.agree = 'Нужно согласие с условиями';
    if (Object.keys(errors).length) return res.status(422).send(A.signupPage({ values, errors }));
    const type = PROPERTY_TYPES.some(([k]) => k === values.property_type) ? values.property_type : 'hotel';
    const { userId } = createHotel(db, { name: values.hotel_name, city: values.city, propertyType: type, owner: { email: values.email, name: values.name, password: b.password } });
    res.set('Set-Cookie', sessionCookie(createSession(db, userId), req.secure));
    res.redirect(303, '/app/rooms?m=' + encodeURIComponent('Кабинет создан. Начните с категорий и номеров.'));
  });

  // ---------- platform team ----------
  app.get('/admin', requirePlatform, (req, res) => {
    const hotels = db.prepare(`select h.*, (select count(*) from rooms r where r.hotel_id = h.id and r.active = 1) rooms,
      (select count(*) from bookings b where b.hotel_id = h.id) bookings,
      (select count(*) from users u where u.hotel_id = h.id) + (select count(*) from user_hotels uh where uh.hotel_id = h.id) users
      from hotels h order by h.id`).all();
    res.send(ADM.adminPage({ hotels, leads: db.prepare('select * from leads order by id desc limit 300').all() }));
  });

  app.use('/app', appRouter(db, { showDemo }));

  app.use((req, res) => res.status(404).send(M.notFound()));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).send('Что-то пошло не так. Мы уже разбираемся.');
  });
  return app;
}

export { TOOLS };
