import express from 'express';
import crypto from 'node:crypto';
import { tx, findFreeRoom } from '../db.js';
import { requireUser, requireOwner, roleGuard, ROLES, checkCsrf, verifyPassword, hashPassword, createSession, sessionCookie, clearCookie, userHotels } from '../lib/auth.js';
import { childGroups, relocate, assignUnassigned, parseSearch, createBooking, cancelBooking, markNoShow, moveBooking, moveSegment, splitStay, changeDates, segmentsOf, addPayment, validateGuest, ensureInventory, logToChannels, ratesMap, BookingError, ACTIVE } from '../lib/booking.js';
import { addDays, diffDays, isIsoDate, isWeekend, nightsOf, todayIn, timeIn, monthBounds } from '../lib/dates.js';
import { createHotel, addPhysicalRooms, recountRooms, PROPERTY_TYPES } from '../lib/hotels.js';
import { scope, BOOKING_LIST } from '../lib/scope.js';
import * as A from '../views/app.js';
import { chessPage, peekPanel, isOverdue, SORTS } from '../views/chess.js';
import { roomsPage } from '../views/rooms.js';
import * as S from '../views/settings.js';
import { reportsPage } from '../views/reports.js';
import { housekeepingPage } from '../views/housekeeping.js';
import { guestsSection, registrationCard } from '../views/guests.js';
import { bookingCard, TABS } from '../views/card.js';
import { confirmationDoc, invoiceDoc, receiptDoc, groupInvoiceDoc } from '../views/docs.js';
import { groupsPage, groupPage } from '../views/groups.js';
import { validateGroup, createGroup, groupMembers, groupTotals, listGroups, payGroup, cancelGroup, attachBooking, detachBooking } from '../lib/groups.js';
import { invoicesOf, findInvoice, createInvoice, deleteInvoice } from '../lib/invoices.js';
import { depositBalance, takeDeposit, returnDeposit, retainDeposit, logEvent, historyOf, refund, voidPayment, transferPayment, setStayPrice, applyDiscount, addService, removeService, tagsOf, setTags, notesOf, tracked, TAG_COLORS } from '../lib/card.js';
import { validateGuestDoc, mvdDeadline, splitName, isForeign } from '../lib/guests.js';
import { DEMO } from '../seed.js';

const int = (v, d = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const safeNext = (v) => {
  const s = String(v || '/app');
  return s.startsWith('/app') && !s.startsWith('//') ? s : '/app';
};

// Expands "101-105, 2A, 210" into a list of room numbers (max 300 at once).
export function parseNumbers(input) {
  const out = [];
  for (const part of String(input).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,5})-(\d{1,5})$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (b < a || b - a > 300) return null;
      for (let i = a; i <= b; i++) out.push(String(i));
    } else if (/^[\p{L}\d-]{1,10}$/u.test(part)) out.push(part);
    else return null;
  }
  return out.length && out.length <= 300 ? [...new Set(out)] : null;
}

export function appRouter(db, { showDemo }) {
  const r = express.Router();
  const loginLimiter = new Map();

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect('/app');
    res.send(A.loginPage({ next: safeNext(req.query.next), demo: showDemo ? DEMO : null }));
  });
  r.post('/login', (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const key = `${req.ip}|${email}`;
    const now = Date.now();
    const hits = (loginLimiter.get(key) || []).filter((t) => now - t < 15 * 60000);
    const next = safeNext(req.body.next);
    const demo = showDemo ? DEMO : null;
    if (hits.length >= 10) return res.status(429).send(A.loginPage({ email, next, error: 'Слишком много попыток. Подождите 15 минут.', demo }));
    const user = db.prepare('select * from users where email = ?').get(email);
    if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
      hits.push(now);
      loginLimiter.set(key, hits);
      return res.status(401).send(A.loginPage({ email, next, error: 'Неверная почта или пароль', demo }));
    }
    loginLimiter.delete(key);
    res.set('Set-Cookie', sessionCookie(createSession(db, user.id), req.secure));
    res.redirect(303, next);
  });

  r.use(requireUser);
  r.use(roleGuard);
  r.use((req, res, next) => (req.method === 'POST' ? checkCsrf(req, res, next) : next()));
  r.use((req, res, next) => {
    req.s = scope(db, req.user.hotel_id);
    req.hotelRow = req.s.hotel();
    req.hotels = userHotels(db, req.user.id);
    req.today = todayIn(req.hotelRow.timezone);
    const m = req.query.m;
    req.msg = m ? { type: req.query.e ? 'error' : 'success', text: String(m).slice(0, 300) } : null;
    next();
  });
  // Redirect with a flash message; the #anchor must stay after the query string.
  const back = (res, url, text, isError) => {
    const [path, hash] = url.split('#');
    res.redirect(303, `${path}${path.includes('?') ? '&' : '?'}m=${encodeURIComponent(text)}${isError ? '&e=1' : ''}${hash ? `#${hash}` : ''}`);
  };
  const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

  r.post('/logout', (req, res) => {
    db.prepare('delete from sessions where id = ?').run(req.session.id);
    res.set('Set-Cookie', clearCookie());
    res.redirect(303, '/app/login');
  });
  r.post('/switch', (req, res) => {
    const id = int(req.body.hotel_id);
    if (!req.hotels.some((h) => h.id === id)) return back(res, '/app', 'Нет доступа к этому объекту', true);
    db.prepare('update sessions set hotel_id = ? where id = ?').run(id, req.session.id);
    res.redirect(303, '/app');
  });

  // ---------- dashboard ----------
  r.get('/', (req, res) => {
    const hid = req.user.hotel_id;
    const t = req.today;
    const list = (where, ...p) => db.prepare(`${BOOKING_LIST} and ${where} order by room_number, b.id`).all(hid, ...p);
    const arrivals = list("b.checkin = ? and b.status in ('confirmed','checked_in')", t);
    const departures = list("b.checkout = ? and b.status in ('confirmed','checked_in','checked_out')", t);
    const rooms = db.prepare("select count(*) n from rooms where hotel_id = ? and active = 1 and status != 'repair'").get(hid).n;
    const occupiedOn = db.prepare(`select count(*) n from bookings where hotel_id = ? and checkin <= ? and checkout > ? and status in ${ACTIVE}`);
    const occupied = occupiedOn.get(hid, t, t).n;
    const inhouse = db.prepare("select coalesce(sum(adults+children),0) n from bookings where hotel_id = ? and status = 'checked_in'").get(hid).n;
    const forecast = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(t, i);
      return { date: d, value: rooms ? Math.round((occupiedOn.get(hid, d, d).n / rooms) * 100) : 0 };
    });
    const [mFrom, mTo] = monthBounds(t);
    const occ = occupancyReport(db, hid, mFrom, mTo);
    const debtRow = db.prepare(`select count(*) n, coalesce(sum(total - paid_amount),0) s from bookings where hotel_id = ? and status in ('confirmed','checked_in')
      and paid_amount < total and checkin <= ?`).get(hid, addDays(t, 7));
    const src = db.prepare(`select source, count(*) n, coalesce(sum(total),0) sum from bookings where hotel_id = ? and status != 'cancelled'
      and created_at >= datetime('now','-30 days') group by source order by n desc`).all(hid);
    const totalN = src.reduce((x, y) => x + y.n, 0);
    const cancelled30 = db.prepare("select count(*) n from bookings where hotel_id = ? and status = 'cancelled' and created_at >= datetime('now','-30 days')").get(hid).n;
    const unassigned = db.prepare(`select count(distinct s.booking_id) n from stay_segments s join bookings b on b.id = s.booking_id
      where s.hotel_id = ? and s.room_id is null and b.status in ('confirmed','checked_in') and s.end > ?`).get(hid, t).n;
    const dirty = db.prepare("select count(*) n from rooms where hotel_id = ? and active = 1 and status = 'dirty'").get(hid).n;
    const tasks = db.prepare('select n.*, b.code, b.guest_name from booking_notes n join bookings b on b.id = n.booking_id where n.hotel_id = ? and n.done = 0 and n.due_at is not null and date(n.due_at) <= ? order by n.due_at limit 10').all(hid, t);
    // Guests in house or already gone whose data has not been passed to the migration service.
    const mvdPending = db.prepare(`select count(*) n from booking_guests g join bookings b on b.id = g.booking_id
      where g.hotel_id = ? and g.mvd_status = 'new' and b.status in ('checked_in','checked_out')`).get(hid).n;
    const mvdMissing = db.prepare(`select coalesce(sum(b.adults + b.children - (select count(*) from booking_guests g where g.booking_id = b.id)), 0) n
      from bookings b where b.hotel_id = ? and b.status = 'checked_in' and (select count(*) from booking_guests g where g.booking_id = b.id) < b.adults + b.children`).get(hid).n;
    res.send(A.dashboardPage({
      req, hotel: req.hotelRow, msg: req.msg, limited: req.user.role === 'investor', arrivals, departures, inhouse, forecast, unassigned, dirty, mvdPending, mvdMissing,
      tasks: req.user.role === 'investor' ? [] : tasks, debtors: debtRow.n, channels: req.s.channels(),
      sources: src.map((x) => ({ ...x, pct: totalN ? Math.round((x.n / totalN) * 100) : 0 })),
      s: { rooms, occupied, occupancy: rooms ? Math.round((occupied / rooms) * 100) : 0, monthRevenue: occ.totals.revenue, adr: occ.totals.adr, revpar: occ.totals.revpar, debt: debtRow.s, cancelled30 },
    }));
  });

  // ---------- housekeeping ----------
  // ---------- group bookings ----------
  const groupsView = (req, extra = {}) => groupsPage({
    req, hotel: req.hotelRow, msg: req.msg, groups: listGroups(db, req.user.hotel_id),
    types: req.s.activeTypes(), rates: req.s.activeRates(), ...extra,
  });
  r.get('/groups', (req, res) => res.send(groupsView(req, {
    values: { checkin: req.today, checkout: addDays(req.today, 1), rate: req.s.activeRates()[0]?.id },
  })));
  r.post('/groups', (req, res) => {
    const body = req.body;
    const { g, errors } = validateGroup(body);
    const s = parseSearch({ checkin: body.checkin, checkout: body.checkout, adults: 1, children: 0 }, req.hotelRow, { staff: true });
    Object.assign(errors, s.errors);
    const rows = req.s.activeTypes().map((t) => ({ typeId: t.id, count: Math.min(50, Math.max(0, int(body[`count_${t.id}`]))), adults: Math.max(1, int(body[`adults_${t.id}`], 1)) })).filter((x) => x.count > 0);
    if (!rows.length) errors.rows = 'Укажите, сколько номеров нужно группе';
    const rate = req.s.rate(body.rate);
    const fail = (status, extra) => res.status(status).send(groupsView(req, { values: body, open: true, ...extra }));
    if (Object.keys(errors).length) return fail(422, { errors });
    if (!rate || !rate.active) return fail(422, { formError: 'Выберите тариф' });
    try {
      const id = createGroup(db, req.hotelRow, g, { query: s.query, rateId: rate.id, rows }, req.user);
      back(res, `/app/groups/${id}`, `Группа создана: ${rows.reduce((n, x) => n + x.count, 0)} брон.`);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      fail(409, { formError: e.message });
    }
  });
  const groupOf = (req) => req.s.bookingGroup(req.params.gid);
  r.get('/groups/:gid', (req, res, next) => {
    const group = groupOf(req);
    if (!group) return next();
    const members = groupMembers(db, group);
    res.send(groupPage({ req, hotel: req.hotelRow, msg: req.msg, group, members, totals: groupTotals(members) }));
  });
  r.get('/groups/:gid/invoice', (req, res, next) => {
    const group = groupOf(req);
    if (!group) return next();
    const members = groupMembers(db, group);
    res.send(groupInvoiceDoc({ hotel: req.hotelRow, group, members, totals: groupTotals(members) }));
  });
  const groupAction = (path, handler) => r.post(`/groups/:gid/${path}`, (req, res, next) => {
    const group = groupOf(req);
    if (!group) return next();
    try { handler(req, res, group); } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      back(res, `/app/groups/${group.id}`, e.message, true);
    }
  });
  groupAction('pay', (req, res, group) => {
    const method = ['cash', 'card', 'transfer'].includes(req.body.method) ? req.body.method : 'transfer';
    payGroup(db, group, int(req.body.amount), method, req.user);
    back(res, `/app/groups/${group.id}`, 'Оплата принята и распределена по броням');
  });
  groupAction('cancel', (req, res, group) => {
    const n = cancelGroup(db, group, req.user);
    back(res, `/app/groups/${group.id}`, n ? `Отменено броней: ${n}` : 'Отменять нечего — все уже заселены или отменены');
  });
  groupAction('attach', (req, res, group) => {
    const b = db.prepare('select * from bookings where code = ? and hotel_id = ?').get(str(req.body.code, 20).toUpperCase(), req.user.hotel_id);
    attachBooking(db, group, b, req.user);
    back(res, `/app/groups/${group.id}`, `Бронь ${b.code} добавлена в группу`);
  });
  groupAction('detach', (req, res, group) => {
    detachBooking(db, group, req.s.booking(req.body.booking), req.user);
    back(res, `/app/groups/${group.id}`, 'Бронь исключена из группы');
  });

  r.get('/housekeeping', (req, res) => {
    const t = req.today;
    const filter = ['dirty', 'today'].includes(req.query.show) ? req.query.show : 'all';
    const rooms = req.s.rooms();
    // What happens in each room today, from the stay parts (no guest data is read).
    const segs = db.prepare(`select s.room_id, s.start, s.end from stay_segments s join bookings b on b.id = s.booking_id
      where s.hotel_id = ? and s.room_id is not null and b.status in ('confirmed','checked_in','checked_out') and s.start <= ? and s.end >= ?`).all(req.user.hotel_id, t, t);
    for (const r of rooms) {
      const mine = segs.filter((x) => x.room_id === r.id);
      const out = mine.some((x) => x.end === t);
      const inn = mine.some((x) => x.start === t);
      const stay = mine.some((x) => x.start < t && x.end > t);
      r.today = out && inn ? 'turnover' : out ? 'departure' : inn ? 'arrival' : stay ? 'stay' : 'free';
    }
    let list = rooms;
    if (filter === 'dirty') list = rooms.filter((r) => r.status === 'dirty');
    if (filter === 'today') list = rooms.filter((r) => ['turnover', 'departure', 'arrival'].includes(r.today));
    const byFloor = new Map();
    for (const r of [...list].sort((a, b) => a.floor - b.floor || a.number.localeCompare(b.number, 'ru', { numeric: true }))) {
      (byFloor.get(r.floor) || byFloor.set(r.floor, []).get(r.floor)).push(r);
    }
    res.send(housekeepingPage({ req, hotel: req.hotelRow, filter, msg: req.msg, floors: [...byFloor.entries()], counts: {
      dirty: rooms.filter((r) => r.status === 'dirty').length, repair: rooms.filter((r) => r.status === 'repair').length,
      departures: rooms.filter((r) => ['turnover', 'departure'].includes(r.today)).length, arrivals: rooms.filter((r) => ['turnover', 'arrival'].includes(r.today)).length,
    } }));
  });
  r.post('/housekeeping/:id', (req, res, next) => {
    const room = req.s.room(req.params.id);
    if (!room) return next();
    const status = ['clean', 'dirty', 'repair'].includes(req.body.status) ? req.body.status : 'clean';
    const staff = ['owner', 'manager'].includes(req.user.role);
    // Repair takes a room out of sale: only staff decide that.
    if ((status === 'repair' || room.status === 'repair') && !staff) return back(res, '/app/housekeeping', 'Ремонт отмечает администратор', true);
    db.prepare('update rooms set status = ? where id = ?').run(status, room.id);
    const show = ['dirty', 'today'].includes(req.body.show) ? `?show=${req.body.show}` : '';
    back(res, `/app/housekeeping${show}`, `Номер ${room.number}: ${{ clean: 'убран', dirty: 'нужна уборка', repair: 'на ремонте' }[status]}`);
  });

  // ---------- chessboard ----------
  r.get('/chess', (req, res) => {
    const h = req.hotelRow;
    const days = [7, 14, 30].includes(int(req.query.days)) ? int(req.query.days) : h.grid_days;
    let sort = SORTS.some(([k]) => k === req.query.sort) ? req.query.sort : h.grid_sort;
    if (req.query.sort && req.query.sort !== h.grid_sort && SORTS.some(([k]) => k === req.query.sort)) {
      db.prepare('update hotels set grid_sort = ? where id = ?').run(sort, h.id);
    }
    if (req.query.days && days !== h.grid_days) db.prepare('update hotels set grid_days = ? where id = ?').run(days, h.id);
    const from = isIsoDate(req.query.from) ? req.query.from : addDays(req.today, -1);
    const to = addDays(from, days);
    const types = req.s.activeTypes();
    const typeFilter = types.some((t) => t.id === int(req.query.type)) ? int(req.query.type) : 0;
    let rooms = req.s.rooms();
    const natural = (a, b) => a.number.localeCompare(b.number, 'ru', { numeric: true });
    if (sort === 'number') rooms = [...rooms].sort(natural);
    if (sort === 'floor') rooms = [...rooms].sort((a, b) => a.floor - b.floor || natural(a, b));
    // One bar per part of a stay; first/last tell the view where the stay starts and ends.
    const bookings = db.prepare(`select b.*, s.id as segment_id, s.room_id as seg_room, s.room_type_id as seg_type, s.start, s.end,
        s.start = b.checkin as is_first, s.end = b.checkout as is_last, g.code as group_code
      from stay_segments s join bookings b on b.id = s.booking_id left join booking_groups g on g.id = b.group_id
      where s.hotel_id = ? and b.status not in ('cancelled','no_show') and s.start < ? and s.end > ? order by s.start`).all(h.id, to, from);
    const free = {};
    for (const t of types) {
      const dates = nightsOf(from, to);
      ensureInventory(db, t, dates);
      for (const c of db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ?').all(t.id, from, to)) free[`${t.id}:${c.date}`] = c;
    }
    // Today's strip above the board.
    const t = req.today;
    const nowTime = timeIn(h.timezone);
    const one = (sql, ...p) => db.prepare(sql).get(h.id, ...p).n;
    const roomsLive = rooms.filter((r) => r.status !== 'repair').length;
    const occupied = one(`select count(*) n from stay_segments s join bookings b on b.id = s.booking_id where s.hotel_id = ? and s.start <= ? and s.end > ? and b.status in ('confirmed','checked_in')`, t, t);
    const live = db.prepare(`select * from bookings where hotel_id = ? and status in ('confirmed','checked_in') and checkin <= ? and checkout >= ?`).all(h.id, addDays(t, 1), addDays(t, -30));
    const stats = {
      rooms: roomsLive, occupied, pct: roomsLive ? Math.round((occupied / roomsLive) * 100) : 0,
      arrivals: one(`select count(*) n from bookings where hotel_id = ? and checkin = ? and status in ('confirmed','checked_in','checked_out')`, t),
      arrivalsLeft: one(`select count(*) n from bookings where hotel_id = ? and checkin = ? and status = 'confirmed'`, t),
      departures: one(`select count(*) n from bookings where hotel_id = ? and checkout = ? and status in ('checked_in','checked_out')`, t),
      departuresLeft: one(`select count(*) n from bookings where hotel_id = ? and checkout = ? and status = 'checked_in'`, t),
      inhouse: one(`select coalesce(sum(adults + children), 0) n from bookings where hotel_id = ? and status = 'checked_in'`),
      free: Math.max(0, roomsLive - occupied),
      overdue: live.filter((b) => isOverdue(b, t, nowTime, h)).length,
      dirty: rooms.filter((r) => r.status === 'dirty').length,
      repair: rooms.filter((r) => r.status === 'repair').length,
    };
    // Tags per booking for the corner mark and the filter; open tasks for the strip.
    const tags = db.prepare('select * from hotel_tags where hotel_id = ? and active = 1 order by name').all(h.id);
    const tagMap = new Map();
    for (const x of db.prepare('select bt.booking_id, t.id, t.name, t.color from booking_tags bt join hotel_tags t on t.id = bt.tag_id where t.hotel_id = ? and t.active = 1').all(h.id)) {
      (tagMap.get(x.booking_id) || tagMap.set(x.booking_id, []).get(x.booking_id)).push(x);
    }
    bookings.forEach((x) => { x.tags = tagMap.get(x.id) || []; });
    stats.tasks = one(`select count(*) n from booking_notes where hotel_id = ? and done = 0 and due_at is not null and date(due_at) <= ?`, t);
    res.send(chessPage({ req, hotel: h, from, days, sort, typeFilter, types, rooms, bookings, free, today: t, nowTime, stats, tags, msg: req.msg, channels: req.s.channels() }));
  });

  // ---------- bookings ----------
  r.get('/bookings', (req, res) => {
    const f = { q: str(req.query.q, 100), status: str(req.query.status, 20), source: str(req.query.source, 40), by: req.query.by === 'checkin' ? 'checkin' : 'created', from: str(req.query.from, 10), to: str(req.query.to, 10), tag: int(req.query.tag) };
    let sql = BOOKING_LIST;
    const p = [req.user.hotel_id];
    if (f.q) { sql += ' and (b.guest_name like ? or b.guest_email like ? or b.guest_phone like ? or b.code like ? or b.channel_ref like ?)'; const like = `%${f.q}%`; p.push(like, like, like, like, like); }
    if (f.status) { sql += ' and b.status = ?'; p.push(f.status); }
    if (f.source) { sql += ' and b.source = ?'; p.push(f.source); }
    if (f.tag) { sql += ' and exists (select 1 from booking_tags bt join hotel_tags t on t.id = bt.tag_id where bt.booking_id = b.id and t.id = ? and t.hotel_id = b.hotel_id)'; p.push(f.tag); }
    const col = f.by === 'checkin' ? 'b.checkin' : 'date(b.created_at)';
    if (isIsoDate(f.from)) { sql += ` and ${col} >= ?`; p.push(f.from); }
    if (isIsoDate(f.to)) { sql += ` and ${col} <= ?`; p.push(f.to); }
    sql += f.by === 'checkin' ? ' order by b.checkin, b.id limit 1000' : ' order by b.id desc limit 1000';
    const rows = db.prepare(sql).all(...p);
    const channels = req.s.channels();
    const tags = db.prepare('select * from hotel_tags where hotel_id = ? order by name').all(req.user.hotel_id);
    const tagMap = new Map();
    for (const t of db.prepare('select bt.booking_id, t.* from booking_tags bt join hotel_tags t on t.id = bt.tag_id where t.hotel_id = ?').all(req.user.hotel_id)) {
      (tagMap.get(t.booking_id) || tagMap.set(t.booking_id, []).get(t.booking_id)).push(t);
    }
    rows.forEach((b) => { b.tags = tagMap.get(b.id) || []; });
    // The same list as a spreadsheet (opens in Excel; ";" separator, UTF-8 with BOM).
    if (req.query.format === 'csv') {
      const st = { confirmed: 'подтверждена', checked_in: 'проживает', checked_out: 'выехал', cancelled: 'отменена', no_show: 'незаезд' };
      return sendCsv(res, `bookings-${req.today}.csv`, [
        ['Бронь', 'Создана', 'Источник', 'Номер в канале', 'Гость', 'Телефон', 'Почта', 'Заказчик', 'Категория', 'Номер', 'Заезд', 'Выезд', 'Взрослые', 'Дети', 'Сумма', 'Оплачено', 'Долг', 'Статус', 'Теги'],
        ...rows.map((b) => [b.code, b.created_at, A.sourceName(b.source, channels), b.channel_ref || '', b.guest_name, b.guest_phone, b.guest_email, b.customer_name, b.room_name, b.room_number || '',
          b.checkin, b.checkout, b.adults, b.children, b.total, b.paid_amount, b.total - b.paid_amount, st[b.status] || b.status, b.tags.map((t) => t.name).join(', ')]),
      ]);
    }
    res.send(A.bookingsPage({ req, hotel: req.hotelRow, msg: req.msg, rows, filters: f, channels, tags, counts: { sum: rows.filter((b) => b.status !== 'cancelled').reduce((s, b) => s + b.total, 0) } }));
  });

  const newBookingView = (req, values, extra = {}) => A.newBookingPage({
    req, hotel: req.hotelRow, types: req.s.activeTypes(), rooms: req.s.rooms(), rates: req.s.activeRates(), extras: req.s.activeExtras(), values, ...extra,
  });
  r.get('/bookings/new', (req, res) => {
    const room = req.s.room(req.query.room);
    const type = room ? room.room_type_id : int(req.query.type) || req.s.activeTypes()[0]?.id;
    res.send(newBookingView(req, {
      idem: crypto.randomUUID(), type, room: room ? room.id : '',
      checkin: isIsoDate(req.query.checkin) ? req.query.checkin : req.today,
      checkout: isIsoDate(req.query.checkout) ? req.query.checkout : addDays(req.today, 1),
      adults: 2, children: 0, rate: req.s.activeRates()[0]?.id,
    }));
  });
  r.post('/bookings/new', (req, res) => {
    const b = req.body;
    const values = { ...b };
    const s = parseSearch(b, req.hotelRow, { staff: true });
    const v = validateGuest(b, { requireAgree: false, requireEmail: false });
    const errors = { ...s.errors, ...v.errors };
    if (Object.keys(errors).length) return res.status(422).send(newBookingView(req, values, { errors }));
    const type = req.s.type(b.type);
    const rate = req.s.rate(b.rate);
    if (!type || !rate) return res.status(422).send(newBookingView(req, values, { formError: 'Выберите категорию и тариф' }));
    const notes = { phone: 'звонок', walkin: 'на стойке', email: 'письмо', messenger: 'мессенджер', other: '' };
    const comment = [v.guest.comment, notes[b.source_note] ? `Источник: ${notes[b.source_note]}` : ''].filter(Boolean).join('\n');
    const override = b.price_override === undefined || b.price_override === '' ? null : int(b.price_override, -1);
    if (override !== null && override < 0) return res.status(422).send(newBookingView(req, values, { formError: 'Цена не может быть отрицательной' }));
    try {
      const booking = createBooking(db, req.hotelRow, {
        query: s.query, roomId: type.id, rateId: rate.id, extraIds: arr(b.extras).map(Number),
        guest: { ...v.guest, comment }, source: 'extranet', staff: true, physicalRoomId: b.room ? int(b.room) : null,
        priceOverride: override, createdBy: req.user.id, idemKey: /^[0-9a-f-]{36}$/.test(b.idem || '') ? b.idem : null,
      });
      const noRoom = segmentsOf(db, booking.id).some((x) => !x.room_id);
      back(res, `/app/bookings/${booking.id}`, `Бронь ${booking.code} создана${noRoom ? ' — свободного номера на весь срок нет, распределите её на шахматке' : ''}`);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      res.status(409).send(newBookingView(req, values, { formError: e.message }));
    }
  });

  r.get('/bookings/:id', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    res.send(bookingPage(req, b));
  });
  const TRANSITIONS = { confirmed: ['checked_in', 'no_show', 'cancelled'], checked_in: ['checked_out'], checked_out: ['checked_in'] };
  // Where to go after an action: a page inside the cabinet the form came from, else the booking card.
  const retTo = (req, fallback) => {
    const v = String(req.body.back || '');
    return v.startsWith('/app') && !v.startsWith('//') && !/[\r\n]/.test(v) ? v : fallback;
  };
  // "2026-10-23T14:05" from a datetime-local field; anything else falls back to now.
  const stamp = (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '') ? `${v.replace('T', ' ')}:00` : new Date().toISOString().slice(0, 19).replace('T', ' '));
  r.post('/bookings/:id/status', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const to = String(req.body.status || '');
    const ret = retTo(req, `/app/bookings/${b.id}`);
    if (!(TRANSITIONS[b.status] || []).includes(to)) return back(res, ret, 'Такой переход статуса невозможен', true);
    const segs = segmentsOf(db, b.id);
    if (to === 'checked_in' && segs.some((x) => !x.room_id)) return back(res, ret, 'Сначала назначьте номер — на шахматке или в карточке брони', true);
    const undo = b.status === 'checked_out' && to === 'checked_in';
    const reason = str(req.body.reason, 200);
    if (undo && reason.length < 3) return back(res, ret, 'Укажите причину отмены выселения', true);
    // Optional payment taken together with check-in or check-out.
    const amount = int(req.body.pay_amount);
    const method = ['cash', 'card', 'transfer'].includes(req.body.pay_method) ? req.body.pay_method : 'card';
    if (amount < 0 || amount > b.total - b.paid_amount) return back(res, ret, 'Сумма оплаты больше долга по брони', true);
    tracked(db, b.id, req.user, undo ? 'Отмена выселения' : '', () => tx(db, () => {
      if (to === 'cancelled') cancelBooking(db, b);
      else if (to === 'no_show') markNoShow(db, b);
      else {
        const last = segs[segs.length - 1];
        if (to === 'checked_in' && !undo) db.prepare('update bookings set status = ?, checked_in_at = ? where id = ?').run(to, stamp(req.body.at), b.id);
        if (undo) {
          db.prepare("update bookings set status = 'checked_in', checked_out_at = null, comment = trim(comment || char(10) || ?) where id = ?").run(`Отмена выселения: ${reason}`, b.id);
          if (last && last.room_id) db.prepare("update rooms set status = 'clean' where id = ? and status = 'dirty'").run(last.room_id);
        }
        if (to === 'checked_out') {
          db.prepare('update bookings set status = ?, checked_out_at = ? where id = ?').run(to, stamp(req.body.at), b.id);
          if (last && last.room_id) db.prepare("update rooms set status = 'dirty' where id = ?").run(last.room_id);
        }
      }
      if (amount > 0 && ['checked_in', 'checked_out'].includes(to)) addPayment(db, b, amount, method, to === 'checked_in' ? 'При заселении' : 'При выезде', req.user.id);
    }));
    const docs = db.prepare('select count(*) n from booking_guests where booking_id = ?').get(b.id).n;
    const docsNote = to === 'checked_in' && !undo && docs < b.adults + b.children ? '. Внесите документы гостей для МВД' : '';
    const text = undo ? `Выселение отменено: ${b.guest_name} снова проживает`
      : { checked_in: `${b.guest_name} заселён${amount ? `, оплата ${amount.toLocaleString('ru-RU')} ₽ принята` : ''}${docsNote}`, checked_out: `${b.guest_name} выселен, номер отмечен к уборке${depositBalance(db, b.id) > 0 ? `. Не забудьте залог: ${depositBalance(db, b.id).toLocaleString('ru-RU')} ₽ — верните или удержите` : ''}`, cancelled: 'Бронь отменена', no_show: 'Отмечен незаезд' }[to];
    back(res, ret + (docsNote && ret.startsWith('/app/bookings/') ? '#guests' : ''), text);
  });
  // Shared reply for the chessboard (JSON) and the booking card (form + redirect).
  // Every change is written to the booking's history.
  const reply = (req, res, b, fn, okText, prefix = '') => {
    const ret = retTo(req, `/app/bookings/${b.id}`);
    try {
      const text = okText(tracked(db, b.id, req.user, prefix, fn));
      return wantsJson(req) ? res.json({ ok: true, message: text }) : back(res, ret, text);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      return wantsJson(req) ? res.status(409).json({ error: e.message }) : back(res, ret, e.message, true);
    }
  };
  r.post('/bookings/:id/move', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const target = req.body.room_id ? req.s.room(req.body.room_id) : null;
    if (req.body.room_id && !target) return wantsJson(req) ? res.status(404).json({ error: 'Номер не найден' }) : next();
    const segId = int(req.body.segment_id);
    reply(req, res, b, () => (segId ? moveSegment(db, b, segId, target ? target.id : null) : moveBooking(db, b, target ? target.id : null)),
      () => (target ? `Перенесено в номер ${target.number}` : 'Номер снят с брони'), 'Переселение');
  });
  r.post('/bookings/:id/split', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const target = req.s.room(req.body.room_id);
    if (!target) return back(res, retTo(req, `/app/bookings/${b.id}`), 'Выберите номер для переселения', true);
    reply(req, res, b, () => splitStay(db, b, String(req.body.date || ''), target.id), () => `С ${String(req.body.date).split('-').reverse().join('.')} гость живёт в номере ${target.number}`, 'Переселение');
  });
  r.post('/bookings/:id/dates', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const checkin = String(req.body.checkin || b.checkin);
    const checkout = String(req.body.checkout || b.checkout);
    reply(req, res, b, () => changeDates(db, req.hotelRow, b, checkin, checkout),
      (nb) => `Даты изменены: ${nb.checkin.split('-').reverse().join('.')} — ${nb.checkout.split('-').reverse().join('.')}, сумма ${nb.total.toLocaleString('ru-RU')} ₽`);
  });
  // ---------- chessboard actions ----------
  // Drag on the chessboard: room and/or dates. ?dry=1 answers with before/after for the confirm dialog.
  r.post('/bookings/:id/relocate', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const body = req.body || {};
    const room = body.room_id ? req.s.room(body.room_id) : null;
    if (body.room_id && !room) return res.status(404).json({ error: 'Номер не найден' });
    try {
      const dry = req.query.dry === '1';
      const run = () => relocate(db, req.hotelRow, b, {
        segmentId: int(body.segment_id), roomId: body.room_id === undefined ? undefined : room ? room.id : null,
        checkin: isIsoDate(body.checkin) ? body.checkin : undefined, checkout: isIsoDate(body.checkout) ? body.checkout : undefined,
        keepPrice: body.keep_price !== false && body.keep_price !== 'false', today: req.today, dryRun: dry,
      });
      const result = dry ? run() : tracked(db, b.id, req.user, 'Перенос на шахматке', run);
      res.json({ ok: true, ...result, message: req.query.dry === '1' ? '' : 'Бронь перенесена' });
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      res.status(409).json({ error: e.message });
    }
  });
  // Side panel of the chessboard: the booking at a glance with quick actions.
  r.get('/bookings/:id/peek', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const segs = db.prepare('select s.*, r.number from stay_segments s left join rooms r on r.id = s.room_id where s.booking_id = ? order by s.start').all(b.id);
    res.set('Cache-Control', 'no-store');
    res.send(peekPanel({ req, b, segs, rate: req.s.rate(b.rate_plan_id), channels: req.s.channels(), tags: tagsOf(db, b.id), notes: notesOf(db, b.id).filter((n) => !n.done), back: retTo({ body: { back: req.query.back } }, '/app/chess'), nowLocal: `${req.today}T${timeIn(req.hotelRow.timezone)}` }).value);
  });
  r.post('/chess/assign', (req, res) => {
    const { placed, left } = assignUnassigned(db, req.user.hotel_id);
    back(res, retTo(req, '/app/chess'), placed ? `Распределено броней: ${placed}${left ? `, без свободного номера на весь срок осталось ${left}` : ''}` : 'Нечего распределять или нет свободных номеров на весь срок', !placed);
  });
  r.post('/chess/placement', (req, res) => {
    const mode = req.body.mode === 'manual' ? 'manual' : 'auto';
    db.prepare('update hotels set placement_mode = ? where id = ?').run(mode, req.user.hotel_id);
    back(res, retTo(req, '/app/chess'), mode === 'manual' ? 'Новые брони будут попадать в строку «Без номера»' : 'Новые брони сразу получают свободный номер');
  });

  // ---------- guests & documents (MVD) ----------
  const guestsOf = (b) => db.prepare('select * from booking_guests where booking_id = ? order by id').all(b.id);
  const guestsBlock = (req, b, extra = {}) => {
    const guests = guestsOf(b);
    const values = extra.values || (guests.length ? {} : splitName(b.guest_name));
    return guestsSection({ req, b, guests, today: req.today, values, ...extra });
  };
  const bookingPage = (req, b, extra = {}) => {
    const tab = TABS.some(([k]) => k === req.query.tab) ? req.query.tab : extra.tab || 'details';
    const tags = db.prepare('select * from hotel_tags where hotel_id = ? and active = 1 order by name').all(req.user.hotel_id);
    const guestList = guestsOf(b);
    return bookingCard({
      req, hotel: req.hotelRow, b, tab, msg: req.msg, channels: req.s.channels(), today: req.today,
      rate: req.s.rate(b.rate_plan_id), rooms: req.s.rooms(), tags, tagIds: tagsOf(db, b.id).map((t) => t.id),
      segments: db.prepare('select s.*, r.number, t.name as type_name from stay_segments s left join rooms r on r.id = s.room_id join room_types t on t.id = s.room_type_id where s.booking_id = ? order by s.start').all(b.id),
      payments: db.prepare('select * from payments where booking_id = ? order by id').all(b.id),
      extrasCatalog: db.prepare('select e.*, g.name as group_name from extras e left join extra_groups g on g.id = e.group_id where e.hotel_id = ? and e.active = 1 order by g.sort, e.name').all(req.user.hotel_id),
      notes: notesOf(db, b.id), history: historyOf(db, b.id), guestList, guestCount: guestList.length, deposit: depositBalance(db, b.id), invoices: invoicesOf(db, b),
      group: b.group_id ? db.prepare('select * from booking_groups where id = ? and hotel_id = ?').get(b.group_id, b.hotel_id) : null,
      guests: tab === 'guests' ? guestsBlock(req, b, extra) : '',
    });
  };
  const ownGuest = (req, b) => db.prepare('select * from booking_guests where id = ? and booking_id = ? and hotel_id = ?').get(int(req.params.gid), b.id, req.user.hotel_id);
  const GUEST_COLS = ['last_name', 'first_name', 'middle_name', 'birth_date', 'sex', 'citizenship', 'doc_type', 'doc_series', 'doc_number', 'doc_issued_at', 'doc_issued_by', 'doc_code', 'reg_address', 'migration_card', 'visa'];
  r.post('/bookings/:id/guests', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const v = validateGuestDoc(req.body, { checkin: b.checkin });
    if (!v.ok) return res.status(422).send(bookingPage(req, b, { values: req.body, errors: v.errors, open: true, tab: 'guests' }));
    db.prepare(`insert into booking_guests (booking_id, hotel_id, ${GUEST_COLS.join(', ')}) values (?, ?, ${GUEST_COLS.map(() => '?').join(', ')})`)
      .run(b.id, req.user.hotel_id, ...GUEST_COLS.map((k) => v.guest[k]));
    logEvent(db, b, req.user, 'Добавлен гость', '', `${v.guest.last_name} ${v.guest.first_name}`);
    back(res, `/app/bookings/${b.id}?tab=guests`, `${v.guest.last_name} ${v.guest.first_name} добавлен(а)`);
  });
  r.post('/bookings/:id/guests/:gid', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    const g = b && ownGuest(req, b);
    if (!g) return next();
    // The number is never sent back to the browser; an empty field keeps the stored one.
    const body = { ...req.body, doc_number: String(req.body.doc_number || '').trim() || g.doc_number };
    const v = validateGuestDoc(body, { checkin: b.checkin });
    if (!v.ok) return back(res, `/app/bookings/${b.id}?tab=guests`, Object.values(v.errors)[0], true);
    db.prepare(`update booking_guests set ${GUEST_COLS.map((k) => `${k} = ?`).join(', ')} where id = ?`).run(...GUEST_COLS.map((k) => v.guest[k]), g.id);
    logEvent(db, b, req.user, 'Изменены данные гостя', '', `${v.guest.last_name} ${v.guest.first_name}`);
    back(res, `/app/bookings/${b.id}?tab=guests`, 'Данные гостя сохранены');
  });
  r.post('/bookings/:id/guests/:gid/delete', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    const g = b && ownGuest(req, b);
    if (!g) return next();
    db.prepare('delete from booking_guests where id = ?').run(g.id);
    logEvent(db, b, req.user, 'Удалены данные гостя', `${g.last_name} ${g.first_name}`, '');
    back(res, `/app/bookings/${b.id}?tab=guests`, 'Данные гостя удалены');
  });
  r.post('/bookings/:id/guests/:gid/mvd', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    const g = b && ownGuest(req, b);
    if (!g) return next();
    const status = ['new', 'sent', 'not_required'].includes(req.body.status) ? req.body.status : 'sent';
    db.prepare("update booking_guests set mvd_status = ?, mvd_sent_at = case when ? = 'sent' then datetime('now') else null end where id = ?").run(status, status, g.id);
    logEvent(db, b, req.user, `МВД: ${g.last_name} ${g.first_name}`, g.mvd_status === 'sent' ? 'отправлено' : 'не отправлено', status === 'sent' ? 'отправлено' : status === 'new' ? 'не отправлено' : 'не требуется');
    back(res, `/app/bookings/${b.id}?tab=guests`, status === 'sent' ? 'Отмечено: сведения переданы в МВД' : 'Отметка снята');
  });
  r.get('/bookings/:id/guests/:gid/card', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    const g = b && ownGuest(req, b);
    if (!g) return next();
    const rooms = db.prepare('select group_concat(r.number, \' → \') n from (select r.number from stay_segments s join rooms r on r.id = s.room_id where s.booking_id = ? order by s.start) r').get(b.id).n;
    res.set('Cache-Control', 'no-store');
    res.send(registrationCard({ hotel: req.hotelRow, b, g, rooms }));
  });
  r.post('/reports/mvd/mark', (req, res) => {
    const ids = arr(req.body.ids).map((x) => int(x)).filter(Boolean);
    const status = req.body.status === 'not_required' ? 'not_required' : 'sent';
    const backTo = String(req.body.back || '').startsWith('/app/reports') ? req.body.back : '/app/reports?tab=mvd';
    if (!ids.length) return back(res, backTo, 'Отметьте гостей в списке', true);
    const upd = db.prepare("update booking_guests set mvd_status = ?, mvd_sent_at = case when ? = 'sent' then datetime('now') else null end where id = ? and hotel_id = ? and mvd_status = 'new'");
    let n = 0;
    tx(db, () => { for (const id of ids) n += upd.run(status, status, id, req.user.hotel_id).changes; });
    back(res, backTo, `Отмечено гостей: ${n}`);
  });

  // ---------- booking card: details, tags, price, services, money, notes, documents ----------
  const cardAction = (path, handler) => r.post(`/bookings/:id/${path}`, (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const ret = retTo(req, `/app/bookings/${b.id}`);
    try {
      handler(req, res, b, ret);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      back(res, ret, e.message, true);
    }
  });
  cardAction('details', (req, res, b, ret) => {
    const x = req.body;
    const name = str(x.guest_name, 120);
    const phone = str(x.guest_phone, 40);
    const email = str(x.guest_email, 200).toLowerCase();
    const time = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : '');
    if (name.length < 2) throw new BookingError('name', 'Укажите ФИО гостя');
    if (phone.replace(/\D/g, '').length < 10) throw new BookingError('phone', 'Нужен телефон, хотя бы 10 цифр');
    if (email && !isEmail(email)) throw new BookingError('email', 'Проверьте адрес почты');
    tracked(db, b.id, req.user, '', () => db.prepare(`update bookings set guest_name=?, guest_phone=?, guest_email=?, customer_name=?, customer_phone=?, customer_inn=?,
      purpose=?, arrival_time=?, departure_time=?, comment=? where id = ?`).run(name, phone, email, str(x.customer_name, 160), str(x.customer_phone, 40),
      str(x.customer_inn, 12).replace(/\D/g, ''), ['', 'tourism', 'business', 'treatment', 'event', 'transit', 'other'].includes(x.purpose) ? x.purpose : '',
      time(x.arrival_time), time(x.departure_time), str(x.comment, 1000), b.id));
    back(res, ret, 'Сохранено');
  });
  cardAction('tags', (req, res, b, ret) => {
    setTags(db, b, arr(req.body.tags).map((v) => int(v)), req.user);
    back(res, ret, 'Теги сохранены');
  });
  cardAction('price', (req, res, b, ret) => {
    setStayPrice(db, req.hotelRow, b, int(req.body.stay, -1), str(req.body.reason, 200), req.user);
    back(res, ret, 'Стоимость проживания изменена');
  });
  cardAction('discount', (req, res, b, ret) => {
    const v = int(req.body.value);
    applyDiscount(db, req.hotelRow, b, req.body.unit === 'sum' ? { sum: v } : { pct: v }, str(req.body.reason, 200), req.user);
    back(res, ret, 'Скидка применена');
  });
  cardAction('services', (req, res, b, ret) => {
    const qty = req.body.qty ? int(req.body.qty) : 0;
    if (req.body.extra_id) addService(db, b, { extraId: int(req.body.extra_id), qty }, req.user);
    else addService(db, b, { name: req.body.name, price: int(req.body.price, -1), qty: qty || 1 }, req.user);
    back(res, ret, 'Услуга добавлена');
  });
  r.post('/bookings/:id/services/:idx/delete', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const ret = retTo(req, `/app/bookings/${b.id}`);
    try { removeService(db, b, int(req.params.idx, -1), req.user); } catch (e) { if (!(e instanceof BookingError)) throw e; return back(res, ret, e.message, true); }
    back(res, ret, 'Услуга убрана');
  });
  cardAction('deposit', (req, res, b, ret) => {
    const amount = int(req.body.amount);
    const method = ['cash', 'card', 'transfer'].includes(req.body.method) ? req.body.method : 'cash';
    if (req.body.op === 'return') returnDeposit(db, b, amount, method, req.user);
    else if (req.body.op === 'retain') tracked(db, b.id, req.user, 'Удержание из залога', () => retainDeposit(db, b, amount, req.body.purpose === 'damage' ? 'damage' : 'debt', str(req.body.reason, 120), req.user));
    else takeDeposit(db, b, amount, method, req.user);
    back(res, ret, { return: 'Залог возвращён', retain: 'Удержано из залога' }[req.body.op] || 'Залог принят');
  });
  cardAction('refund', (req, res, b, ret) => {
    const method = ['cash', 'card', 'transfer'].includes(req.body.method) ? req.body.method : 'cash';
    refund(db, b, int(req.body.amount), method, str(req.body.reason, 200), req.user, req.body.invoice && req.body.invoice !== 'main' ? int(req.body.invoice) : null);
    back(res, ret, 'Возврат оформлен');
  });
  r.post('/bookings/:id/payments/:pid/void', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const ret = retTo(req, `/app/bookings/${b.id}`);
    try { voidPayment(db, b, int(req.params.pid), str(req.body.reason, 200), req.user); } catch (e) { if (!(e instanceof BookingError)) throw e; return back(res, ret, e.message, true); }
    back(res, ret, 'Платёж аннулирован');
  });
  cardAction('transfer', (req, res, b, ret) => {
    const target = db.prepare('select * from bookings where code = ? and hotel_id = ?').get(str(req.body.code, 20).toUpperCase(), req.user.hotel_id);
    if (!target) throw new BookingError('target', 'Бронь с таким номером не найдена в этом объекте');
    transferPayment(db, b, target, int(req.body.amount), req.user);
    back(res, ret, `Оплата перенесена в бронь ${target.code}`);
  });
  cardAction('invoices', (req, res, b, ret) => {
    createInvoice(db, b, { payerName: req.body.payer_name, payerInn: req.body.payer_inn, keys: arr(req.body.items).map(String) }, req.user);
    back(res, ret, 'Отдельный счёт выставлен');
  });
  r.post('/bookings/:id/invoices/:iid/delete', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const ret = retTo(req, `/app/bookings/${b.id}`);
    try { deleteInvoice(db, b, int(req.params.iid), req.user); } catch (e) { if (!(e instanceof BookingError)) throw e; return back(res, ret, e.message, true); }
    back(res, ret, 'Счёт удалён, строки вернулись на основной');
  });
  cardAction('notes', (req, res, b, ret) => {
    const text = str(req.body.text, 500);
    if (text.length < 2) throw new BookingError('note', 'Напишите текст заметки');
    const due = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(req.body.due_at || '') ? `${req.body.due_at.replace('T', ' ')}:00` : null;
    db.prepare('insert into booking_notes (booking_id, hotel_id, text, due_at, created_by) values (?,?,?,?,?)').run(b.id, b.hotel_id, text, due, req.user.name);
    logEvent(db, b, req.user, due ? 'Задача' : 'Заметка', '', `${text}${due ? ` (срок ${due.slice(0, 16)})` : ''}`);
    back(res, ret, due ? 'Задача добавлена' : 'Заметка добавлена');
  });
  r.post('/bookings/:id/notes/:nid/toggle', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    const n = b && db.prepare('select * from booking_notes where id = ? and booking_id = ?').get(int(req.params.nid), b.id);
    if (!n) return next();
    db.prepare('update booking_notes set done = 1 - done where id = ?').run(n.id);
    if (!n.done) logEvent(db, b, req.user, 'Задача выполнена', '', n.text);
    back(res, retTo(req, `/app/bookings/${b.id}?tab=notes`), n.done ? 'Задача снова в работе' : 'Отмечено выполненным');
  });
  r.get('/bookings/:id/doc/:kind', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b || !['confirmation', 'invoice', 'receipt'].includes(req.params.kind)) return next();
    const rooms = db.prepare(`select group_concat(x, ' → ') r from (select coalesce('№ ' || r.number, 'без номера') || ', ' || t.name x from stay_segments s
      left join rooms r on r.id = s.room_id join room_types t on t.id = s.room_type_id where s.booking_id = ? order by s.start)`).get(b.id).r;
    res.set('Cache-Control', 'no-store');
    if (req.params.kind === 'confirmation') return res.send(confirmationDoc({ hotel: req.hotelRow, b, rooms, rate: req.s.rate(b.rate_plan_id) }));
    if (req.params.kind === 'invoice') {
      const inv = findInvoice(db, b, req.query.inv);
      if (!inv) return next();
      return res.send(invoiceDoc({ hotel: req.hotelRow, b, inv }));
    }
    res.send(receiptDoc({ hotel: req.hotelRow, b, payments: db.prepare('select * from payments where booking_id = ? order by id').all(b.id) }));
  });

  r.post('/bookings/:id/pay', (req, res, next) => {
    const b = req.s.booking(req.params.id);
    if (!b) return next();
    const amount = int(req.body.amount);
    const method = ['cash', 'card', 'transfer'].includes(req.body.method) ? req.body.method : 'cash';
    if (amount < 1 || amount > 10000000) return back(res, retTo(req, `/app/bookings/${b.id}`), 'Укажите сумму', true);
    if (amount > b.total - b.paid_amount) return back(res, retTo(req, `/app/bookings/${b.id}`), 'Сумма больше долга по брони', true);
    const inv = findInvoice(db, b, req.body.invoice);
    if (!inv) return back(res, retTo(req, `/app/bookings/${b.id}`), 'Счёт не найден', true);
    if (inv.id && amount > inv.debt) return back(res, retTo(req, `/app/bookings/${b.id}`), `Сумма больше долга по счёту ${inv.number}`, true);
    tracked(db, b.id, req.user, `Оплата (${method === 'cash' ? 'наличные' : method === 'card' ? 'карта' : 'перевод'})${inv.id ? ` по счёту ${inv.number}` : ''}`, () => addPayment(db, b, amount, method, inv.id ? `Счёт ${inv.number}, ${inv.payer_name}` : '', req.user.id, 'payment', null, inv.id));
    back(res, retTo(req, `/app/bookings/${b.id}`), 'Оплата принята');
  });

  // ---------- prices & availability (per category) ----------
  r.get('/prices', (req, res) => {
    let from = isIsoDate(req.query.from) ? req.query.from : req.today;
    if (from < req.today) from = req.today;
    const dates = Array.from({ length: 14 }, (_, i) => addDays(from, i));
    const rooms = req.s.activeTypes();
    const cells = {};
    const q = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date <= ?');
    for (const t of rooms) {
      ensureInventory(db, t, dates);
      for (const c of q.all(t.id, dates[0], dates[dates.length - 1])) cells[`${t.id}:${c.date}`] = c;
    }
    res.send(A.pricesPage({ req, hotel: req.hotelRow, rooms, dates, cells, from, msg: req.msg }));
  });
  r.post('/prices', (req, res) => {
    const b = req.body || {};
    const type = req.s.type(b.room);
    if (!type || !isIsoDate(b.date) || b.date < req.today) return res.status(400).json({ error: 'Неверная категория или дата' });
    const price = int(b.price, -1), available = int(b.available, -1), minStay = int(b.min_stay, 1);
    const sold = db.prepare(`select count(*) n from stay_segments s join bookings b on b.id = s.booking_id where s.room_type_id = ? and s.start <= ? and s.end > ? and b.status in ${ACTIVE}`).get(type.id, b.date, b.date).n;
    if (price < 0 || price > 1000000) return res.status(422).json({ error: 'Цена от 0 до 1 000 000 ₽' });
    if (available < 0 || available + sold > type.total_rooms) return res.status(422).json({ error: `Свободно может быть от 0 до ${type.total_rooms - sold} (продано ${sold} из ${type.total_rooms})` });
    if (minStay < 1 || minStay > 30) return res.status(422).json({ error: 'Минимум ночей от 1 до 30' });
    const closed = b.open ? 0 : 1;
    const cta = b.cta ? 1 : 0;
    const ctd = b.ctd ? 1 : 0;
    ensureInventory(db, type, [b.date]);
    db.prepare('update inventory set price = ?, available = ?, closed = ?, min_stay = ?, cta = ?, ctd = ? where room_type_id = ? and date = ?').run(price, available, closed, minStay, cta, ctd, type.id, b.date);
    logToChannels(db, req.user.hotel_id, 'update', `${type.name}, ${b.date}: ${price} ₽, свободно ${available}${closed ? ', продажи закрыты' : ''}${cta ? ', запрет заезда' : ''}${ctd ? ', запрет выезда' : ''}`);
    res.json({ ok: true, cell: db.prepare('select * from inventory where room_type_id = ? and date = ?').get(type.id, b.date) });
  });
  r.post('/prices/bulk', (req, res) => {
    const b = req.body;
    const types = b.room === 'all' ? req.s.activeTypes() : [req.s.type(b.room)].filter(Boolean);
    const to = String(b.to || ''), from = String(b.from || '');
    if (!types.length || !isIsoDate(from) || !isIsoDate(to) || to < from) return back(res, '/app/prices', 'Проверьте категорию и даты', true);
    if (diffDays(from, to) > 365) return back(res, '/app/prices', 'Не больше года за раз', true);
    const value = int(b.value, NaN);
    if ((b.action === 'price' && !(value >= 0 && value <= 1000000)) || (b.action === 'percent' && !(value >= -90 && value <= 500))) {
      return back(res, `/app/prices?from=${from}`, 'Укажите корректное значение', true);
    }
    const st = {
      price: 'update inventory set price = ? where room_type_id = ? and date = ?',
      percent: 'update inventory set price = max(0, cast(round(price * (100 + ?) / 100.0) as integer)) where room_type_id = ? and date = ?',
      close: 'update inventory set closed = 1 where ? is not null and room_type_id = ? and date = ?',
      open: 'update inventory set closed = 0 where ? is not null and room_type_id = ? and date = ?',
      cta_on: 'update inventory set cta = 1 where ? is not null and room_type_id = ? and date = ?',
      cta_off: 'update inventory set cta = 0 where ? is not null and room_type_id = ? and date = ?',
      ctd_on: 'update inventory set ctd = 1 where ? is not null and room_type_id = ? and date = ?',
      ctd_off: 'update inventory set ctd = 0 where ? is not null and room_type_id = ? and date = ?',
      minstay: 'update inventory set min_stay = ? where room_type_id = ? and date = ?',
    }[b.action];
    if (b.action === 'minstay' && !(value >= 1 && value <= 30)) return back(res, `/app/prices?from=${from}`, 'Минимум ночей от 1 до 30', true);
    if (!st) return back(res, '/app/prices', 'Выберите действие', true);
    const start = from < req.today ? req.today : from;
    const dates = nightsOf(start, addDays(to, 1)).filter((d) => (b.days === 'weekend' ? isWeekend(d) : b.days === 'weekday' ? !isWeekend(d) : true));
    tx(db, () => {
      const q = db.prepare(st);
      for (const t of types) {
        ensureInventory(db, t, dates);
        for (const d of dates) q.run(Number.isFinite(value) ? value : 1, t.id, d);
      }
    });
    logToChannels(db, req.user.hotel_id, 'update', `Массовое изменение: ${types.length} кат., ${dates.length} дн. (${b.action})`);
    back(res, `/app/prices?from=${start}`, `Готово: изменено ${types.length * dates.length} ячеек`);
  });

  // ---------- rooms, stock, rates, extras, promos ----------
  r.get('/rooms', (req, res) => {
    res.send(roomsPage({
      req, hotel: req.hotelRow, msg: req.msg, types: req.s.types(), rooms: req.s.rooms(), rates: [...ratesMap(db, req.user.hotel_id).values()].sort((x, y) => x.id - y.id),
      ageGroups: childGroups(db, req.user.hotel_id),
      groups: req.s.groups(), extras: req.s.extras(), promos: req.s.promos(),
    }));
  });
  const typeInput = (b) => {
    const t = {
      name: str(b.name, 80), description: str(b.description, 1000), capacity: int(b.capacity), extra_beds: int(b.extra_beds),
      base_price: int(b.base_price, -1), area_m2: Math.max(0, int(b.area_m2)), beds: str(b.beds, 80), sort: int(b.sort), active: b.active === 'on' ? 1 : 0,
    };
    let err = null;
    if (t.name.length < 2) err = 'Укажите название категории';
    else if (t.capacity < 1 || t.capacity > 12) err = 'Основных мест: от 1 до 12';
    else if (t.extra_beds < 0 || t.extra_beds > 6) err = 'Дополнительных мест: от 0 до 6';
    else if (t.base_price < 0 || t.base_price > 1000000) err = 'Цена: от 0 до 1 000 000 ₽';
    return { t, err };
  };
  r.post('/rooms/types', (req, res) => {
    const { t, err } = typeInput(req.body);
    if (err) return back(res, '/app/rooms#types', err, true);
    const images = ['room-1', 'room-2', 'room-3', 'room-4'];
    const n = req.s.types().length;
    db.prepare('insert into room_types (hotel_id, name, description, capacity, extra_beds, beds, area_m2, total_rooms, base_price, image, sort) values (?,?,?,?,?,?,?,0,?,?,?)')
      .run(req.user.hotel_id, t.name, t.description, t.capacity, t.extra_beds, t.beds, t.area_m2, t.base_price, images[n % 4], t.sort || n);
    back(res, '/app/rooms#stock', `Категория «${t.name}» добавлена. Теперь добавьте в неё номера.`);
  });
  r.post('/rooms/types/:id', (req, res, next) => {
    const old = req.s.type(req.params.id);
    if (!old) return next();
    const { t, err } = typeInput(req.body);
    if (err) return back(res, '/app/rooms#types', err, true);
    db.prepare('update room_types set name=?, description=?, capacity=?, extra_beds=?, beds=?, area_m2=?, base_price=?, sort=?, active=? where id = ?')
      .run(t.name, t.description, t.capacity, t.extra_beds, t.beds, t.area_m2, t.base_price, t.sort, t.active, old.id);
    back(res, '/app/rooms#types', 'Сохранено');
  });
  r.post('/rooms/stock', (req, res) => {
    const type = req.s.type(req.body.room_type_id);
    const numbers = parseNumbers(req.body.numbers);
    if (!type || !numbers) return back(res, '/app/rooms#stock', 'Укажите категорию и номера: например 101-110, 115', true);
    const { added, skipped } = addPhysicalRooms(db, req.user.hotel_id, type.id, numbers, int(req.body.floor, 1));
    back(res, '/app/rooms#stock', `Добавлено номеров: ${added.length}${skipped.length ? `. Уже были: ${skipped.slice(0, 10).join(', ')}` : ''}`, !added.length);
  });
  r.post('/rooms/stock/:id', (req, res, next) => {
    const room = req.s.room(req.params.id);
    if (!room) return next();
    const number = str(req.body.number, 10);
    const status = ['clean', 'dirty', 'repair'].includes(req.body.status) ? req.body.status : room.status;
    if (!number) return back(res, '/app/rooms#stock', 'Укажите номер', true);
    if (number !== room.number && db.prepare('select 1 from rooms where hotel_id = ? and number = ?').get(req.user.hotel_id, number)) return back(res, '/app/rooms#stock', `Номер ${number} уже есть`, true);
    db.prepare('update rooms set number = ?, floor = ?, sort = ?, status = ?, note = ? where id = ?').run(number, int(req.body.floor, room.floor), int(req.body.sort, room.sort), status, str(req.body.note, 120), room.id);
    back(res, '/app/rooms#stock', `Номер ${number} сохранён`);
  });
  r.post('/rooms/stock/:id/delete', (req, res, next) => {
    const room = req.s.room(req.params.id);
    if (!room) return next();
    const future = db.prepare(`select count(distinct s.booking_id) n from stay_segments s join bookings b on b.id = s.booking_id
      where s.room_id = ? and s.end > ? and b.status in ('confirmed','checked_in')`).get(room.id, req.today).n;
    if (future) return back(res, '/app/rooms#stock', `В номере ${room.number} есть будущие брони (${future}) — сначала переселите их`, true);
    tx(db, () => {
      db.prepare('update rooms set active = 0, number = ? where id = ?').run(`${room.number}~${room.id}`, room.id);
      recountRooms(db, room.room_type_id);
    });
    back(res, '/app/rooms#stock', `Номер ${room.number} убран`);
  });
  const rateInput = (b) => ({
    name: str(b.name, 80), description: str(b.description, 500), meal: ['none', 'breakfast', 'half'].includes(b.meal) ? b.meal : 'none',
    meal_price: Math.max(0, int(b.meal_price)), refundable: b.refundable === 'on' ? 1 : 0,
    extra_adult_price: Math.max(0, int(b.extra_adult_price)), extra_child_price: Math.max(0, int(b.extra_child_price)), active: b.active === 'on' ? 1 : 0,
    parent_id: int(b.parent_id) || null, adjust_type: b.adjust_type === 'fixed' ? 'fixed' : 'pct', adjust_value: int(b.adjust_value),
    rounding: [0, 10, 50, 100].includes(int(b.rounding)) ? int(b.rounding) : 0, single_discount: Math.max(0, int(b.single_discount)),
  });
  // A parent must belong to the hotel, must not lead back to the rate itself, and
  // the chain stays within three levels.
  const rateError = (req, t, selfId = 0) => {
    if (t.name.length < 2) return 'Укажите название тарифа';
    if (t.adjust_type === 'pct' && (t.adjust_value < -90 || t.adjust_value > 300)) return 'Изменение в процентах — от −90 до +300';
    if (!t.parent_id) return null;
    let depth = 1;
    for (let p = req.s.rate(t.parent_id); p; p = p.parent_id ? req.s.rate(p.parent_id) : null) {
      if (p.id === selfId) return 'Тариф не может считаться от самого себя (через цепочку тарифов)';
      if (++depth > 3) return 'Цепочка тарифов — не глубже трёх уровней';
    }
    if (!req.s.rate(t.parent_id)) return 'Родительский тариф не найден';
    return null;
  };
  const RATE_COLS = 'name=?, description=?, meal=?, meal_price=?, refundable=?, extra_adult_price=?, extra_child_price=?, parent_id=?, adjust_type=?, adjust_value=?, rounding=?, single_discount=?, discount_pct=0';
  const rateVals = (t) => [t.name, t.description, t.meal, t.meal_price, t.refundable, t.extra_adult_price, t.extra_child_price, t.parent_id, t.adjust_type, t.adjust_value, t.rounding, t.single_discount];
  // Child prices per age group: field child_<groupId>; empty means "use the default".
  const saveChildPrices = (req, rateId) => {
    for (const g of childGroups(db, req.user.hotel_id)) {
      const v = req.body[`child_${g.id}`];
      if (v === undefined || v === '') db.prepare('delete from rate_child_prices where rate_id = ? and group_id = ?').run(rateId, g.id);
      else db.prepare('insert or replace into rate_child_prices (rate_id, group_id, price) values (?,?,?)').run(rateId, g.id, Math.max(0, int(v)));
    }
  };
  r.post('/rooms/rates', (req, res) => {
    const t = rateInput(req.body);
    const err = rateError(req, t);
    if (err) return back(res, '/app/rooms#rates', err, true);
    const id = db.prepare('insert into rate_plans (hotel_id, name) values (?, ?)').run(req.user.hotel_id, t.name).lastInsertRowid;
    db.prepare(`update rate_plans set ${RATE_COLS} where id = ?`).run(...rateVals(t), id);
    saveChildPrices(req, Number(id));
    back(res, '/app/rooms#rates', `Тариф «${t.name}» добавлен`);
  });
  r.post('/rooms/rates/:id', (req, res, next) => {
    const old = req.s.rate(req.params.id);
    if (!old) return next();
    const t = rateInput(req.body);
    const err = rateError(req, t, old.id);
    if (err) return back(res, '/app/rooms#rates', err, true);
    db.prepare(`update rate_plans set ${RATE_COLS}, active = ? where id = ?`).run(...rateVals(t), t.active, old.id);
    saveChildPrices(req, old.id);
    back(res, '/app/rooms#rates', 'Сохранено');
  });
  r.post('/rooms/groups', (req, res) => {
    const name = str(req.body.name, 60);
    if (name.length < 2) return back(res, '/app/rooms#extras', 'Укажите название группы', true);
    db.prepare('insert into extra_groups (hotel_id, name, sort) values (?, ?, ?)').run(req.user.hotel_id, name, req.s.groups().length + 1);
    back(res, '/app/rooms#extras', `Группа «${name}» создана`);
  });
  r.post('/rooms/groups/:id', (req, res, next) => {
    const g = req.s.group(req.params.id);
    const name = str(req.body.name, 60);
    if (!g) return next();
    if (name.length < 2) return back(res, '/app/rooms#extras', 'Укажите название группы', true);
    db.prepare('update extra_groups set name = ? where id = ?').run(name, g.id);
    back(res, '/app/rooms#extras', 'Сохранено');
  });
  r.post('/rooms/groups/:id/delete', (req, res, next) => {
    const g = req.s.group(req.params.id);
    if (!g) return next();
    if (db.prepare('select 1 from extras where group_id = ?').get(g.id)) return back(res, '/app/rooms#extras', 'В группе есть услуги — перенесите их', true);
    db.prepare('delete from extra_groups where id = ?').run(g.id);
    back(res, '/app/rooms#extras', 'Группа удалена');
  });
  r.post('/rooms/extras', (req, res) => {
    const name = str(req.body.name, 80);
    const price = int(req.body.price, -1);
    const per = ['stay', 'night', 'guest_night'].includes(req.body.per) ? req.body.per : 'stay';
    const group = req.body.group_id ? req.s.group(req.body.group_id) : null;
    if (name.length < 2 || price < 0) return back(res, '/app/rooms#extras', 'Укажите название и цену услуги', true);
    db.prepare('insert into extras (hotel_id, name, description, price, per, group_id) values (?,?,?,?,?,?)').run(req.user.hotel_id, name, str(req.body.description, 300), price, per, group ? group.id : null);
    back(res, '/app/rooms#extras', 'Услуга добавлена');
  });
  r.post('/rooms/extras/:id/group', (req, res, next) => {
    const e = req.s.extra(req.params.id);
    if (!e) return next();
    const group = req.body.group_id ? req.s.group(req.body.group_id) : null;
    db.prepare('update extras set group_id = ? where id = ?').run(group ? group.id : null, e.id);
    back(res, '/app/rooms#extras', 'Группа услуги изменена');
  });
  r.post('/rooms/extras/:id/toggle', (req, res, next) => {
    const e = req.s.extra(req.params.id);
    if (!e) return next();
    db.prepare('update extras set active = 1 - active where id = ?').run(e.id);
    back(res, '/app/rooms#extras', 'Сохранено');
  });
  r.post('/rooms/promos', (req, res) => {
    const code = str(req.body.code, 32).toUpperCase();
    const pct = int(req.body.discount_pct);
    if (!/^[A-Z0-9_-]{2,32}$/.test(code) || pct < 1 || pct > 90) return back(res, '/app/rooms#promos', 'Код: латиница и цифры, скидка 1–90%', true);
    try {
      db.prepare('insert into promo_codes (hotel_id, code, discount_pct) values (?,?,?)').run(req.user.hotel_id, code, pct);
    } catch {
      return back(res, '/app/rooms#promos', 'Такой промокод уже есть', true);
    }
    back(res, '/app/rooms#promos', `Промокод ${code} добавлен`);
  });
  r.post('/rooms/promos/:id/toggle', (req, res, next) => {
    const p = req.s.promo(req.params.id);
    if (!p) return next();
    db.prepare('update promo_codes set active = 1 - active where id = ?').run(p.id);
    back(res, '/app/rooms#promos', 'Сохранено');
  });

  // ---------- channels ----------
  r.get('/channels', (req, res) => {
    const log = db.prepare('select l.*, c.name as channel from channel_log l join channels c on c.id = l.channel_id where c.hotel_id = ? order by l.id desc limit 100').all(req.user.hotel_id);
    res.send(A.channelsPage({ req, hotel: req.hotelRow, channels: req.s.channels(), log, msg: req.msg }));
  });
  r.post('/channels/:id/toggle', (req, res, next) => {
    const c = req.s.channel(req.params.id);
    if (!c) return next();
    db.prepare('update channels set connected = ? where id = ?').run(c.connected ? 0 : 1, c.id);
    if (c.connected) db.prepare('insert into channel_log (channel_id, kind, summary) values (?,?,?)').run(c.id, 'disconnect', 'Канал отключён, продажи в нём остановлены');
    else db.prepare('insert into channel_log (channel_id, kind, summary) values (?,?,?)').run(c.id, 'full', `Выгружены цены и наличие: ${req.s.activeTypes().length} кат. на 365 дней${c.markup_pct ? `, наценка ${c.markup_pct}%` : ''}`);
    back(res, '/app/channels', c.connected ? `${c.name} отключён` : `${c.name} подключён`);
  });
  r.post('/channels/:id/markup', (req, res, next) => {
    const c = req.s.channel(req.params.id);
    const pct = int(req.body.markup_pct, -1);
    if (!c) return next();
    if (pct < 0 || pct > 50) return back(res, '/app/channels', 'Наценка от 0 до 50%', true);
    db.prepare('update channels set markup_pct = ? where id = ?').run(pct, c.id);
    back(res, '/app/channels', 'Наценка сохранена');
  });
  // Simulates an incoming booking from a connected channel, as a real integration would deliver it.
  r.post('/channels/:id/test-booking', (req, res, next) => {
    const c = req.s.channel(req.params.id);
    if (!c) return next();
    if (!c.connected) return back(res, '/app/channels', 'Сначала подключите канал', true);
    const rate = req.s.activeRates()[0];
    const types = req.s.activeTypes().filter((t) => t.total_rooms > 0);
    if (!rate || !types.length) return back(res, '/app/channels', 'Нужны хотя бы одна категория с номерами и тариф', true);
    for (let offset = 3; offset < 60; offset++) {
      for (const t of types) {
        try {
          const ci = addDays(req.today, offset);
          const b = createBooking(db, req.hotelRow, {
            query: { checkin: ci, checkout: addDays(ci, 2), adults: 2, children: 0, promo: '' }, roomId: t.id, rateId: rate.id,
            guest: { name: `Гость из ${c.name}`, email: 'channel-guest@example.com', phone: '+7 900 000-00-00', comment: 'Тестовая бронь из канала' },
            source: c.code, channelRef: `${c.code.toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          });
          return back(res, '/app/bookings', `Пришла бронь ${b.code} из ${c.name}`);
        } catch (e) {
          if (!(e instanceof BookingError)) throw e;
        }
      }
    }
    back(res, '/app/channels', 'Не нашлось свободных дат для тестовой брони', true);
  });

  // ---------- reports ----------
  r.get('/reports', (req, res) => {
    const tab = ['occupancy', 'sales', 'lists', 'tax', 'mvd'].includes(req.query.tab) ? req.query.tab : 'occupancy';
    const [mFrom, mTo] = monthBounds(req.today);
    let from = isIsoDate(req.query.from) ? req.query.from : tab === 'lists' ? req.today : tab === 'mvd' ? addDays(req.today, -7) : mFrom;
    let to = isIsoDate(req.query.to) ? req.query.to : tab === 'mvd' ? req.today : mTo;
    if (to < from) to = from;
    if (diffDays(from, to) > 366) to = addDays(from, 366);
    const hid = req.user.hotel_id;
    let data;
    if (tab === 'sales') data = salesReport(db, hid, from, to);
    else if (tab === 'lists') {
      const q = (where) => db.prepare(`${BOOKING_LIST} and ${where} order by room_number`).all(hid, from);
      data = {
        arrivals: q("b.checkin = ? and b.status in ('confirmed','checked_in','checked_out')"),
        departures: q("b.checkout = ? and b.status in ('confirmed','checked_in','checked_out')"),
        inhouse: db.prepare(`${BOOKING_LIST} and b.checkin <= ? and b.checkout > ? and b.status in ${ACTIVE} order by room_number`).all(hid, from, from),
      };
    } else if (tab === 'tax') {
      const rows = db.prepare(`select * from bookings where hotel_id = ? and status in ${ACTIVE} and checkout >= ? and checkout <= ? order by checkout`).all(hid, from, to);
      data = { rows, totals: { tax: rows.reduce((s, b) => s + b.tax_total, 0), base: rows.reduce((s, b) => s + b.nights_total, 0) } };
    } else if (tab === 'mvd') {
      const status = ['new', 'sent', 'not_required'].includes(req.query.status) ? req.query.status : '';
      const who = ['rus', 'foreign'].includes(req.query.who) ? req.query.who : '';
      let rows = db.prepare(`select g.*, b.checkin, b.checkout, b.code,
          (select group_concat(number, ' → ') from (select r.number from stay_segments s join rooms r on r.id = s.room_id where s.booking_id = b.id order by s.start)) as room_number
        from booking_guests g join bookings b on b.id = g.booking_id
        where g.hotel_id = ? and b.status in ${ACTIVE} and b.checkin >= ? and b.checkin <= ? order by b.checkin, g.last_name`).all(hid, from, to)
        .map((g) => ({ ...g, deadline: mvdDeadline(g, g.checkin) }));
      if (status) rows = rows.filter((g) => g.mvd_status === status);
      if (who) rows = rows.filter((g) => (who === 'foreign') === isForeign(g));
      const missingBookings = db.prepare(`select b.*, (select count(*) from booking_guests g where g.booking_id = b.id) have from bookings b
        where b.hotel_id = ? and b.status in ${ACTIVE} and b.checkin >= ? and b.checkin <= ? and b.checkin <= ?
        and (select count(*) from booking_guests g where g.booking_id = b.id) < b.adults + b.children order by b.checkin`).all(hid, from, to, req.today);
      data = {
        rows, status, who, today: req.today, missingBookings,
        totals: {
          pending: rows.filter((g) => g.mvd_status === 'new').length,
          late: rows.filter((g) => g.mvd_status === 'new' && g.deadline < req.today).length,
          foreign: rows.filter(isForeign).length,
          missing: missingBookings.reduce((x, b) => x + b.adults + b.children - b.have, 0),
        },
      };
    } else data = occupancyReport(db, hid, from, to);
    if (req.query.format === 'csv') {
      if (tab === 'mvd') res.set('Cache-Control', 'no-store');
      return sendCsv(res, `report-${tab}-${from}.csv`, csvFor(tab, data));
    }
    res.send(reportsPage({ req, hotel: req.hotelRow, tab, from, to, data, channels: req.s.channels(), msg: req.msg }));
  });

  // ---------- settings ----------
  r.get('/settings', (req, res) => res.send(S.settingsObject({ req, hotel: req.hotelRow, msg: req.msg })));
  r.post('/settings', requireOwner, (req, res) => {
    const b = req.body;
    const time = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : d);
    const name = str(b.name, 120);
    if (name.length < 2) return back(res, '/app/settings', 'Укажите название объекта', true);
    let tz = str(b.timezone, 40);
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'Europe/Moscow'; }
    db.prepare(`update hotels set name=?, property_type=?, stars=?, city=?, address=?, timezone=?, phone=?, email=?, notify_email=?, checkin_time=?, checkout_time=?,
      description=?, legal_name=?, inn=? where id = ?`).run(
      name, PROPERTY_TYPES.some(([k]) => k === b.property_type) ? b.property_type : 'hotel', Math.min(5, Math.max(0, int(b.stars))), str(b.city, 80), str(b.address, 200), tz,
      str(b.phone, 40), str(b.email, 200), str(b.notify_email, 200), time(b.checkin_time, '14:00'), time(b.checkout_time, '12:00'),
      str(b.description, 1000), str(b.legal_name, 200), str(b.inn, 12).replace(/\D/g, ''), req.user.hotel_id,
    );
    back(res, '/app/settings', 'Настройки сохранены');
  });
  r.get('/settings/booking', (req, res) => res.send(S.settingsBooking({ req, hotel: req.hotelRow, msg: req.msg, groups: childGroups(db, req.user.hotel_id) })));
  // Age groups. hotel.child_max_age follows the oldest group: older guests are adults.
  const syncChildAge = (hid) => db.prepare('update hotels set child_max_age = (select max(max_age) from child_age_groups where hotel_id = ?) where id = ?').run(hid, hid);
  const groupInput = (b) => ({ name: str(b.name, 40), max_age: int(b.max_age), meal_pct: Math.min(100, Math.max(0, int(b.meal_pct, 100))), no_bed: b.no_bed === 'on' ? 1 : 0 });
  const groupError = (g, selfId = 0, hid) => {
    if (g.name.length < 2) return 'Укажите название группы';
    if (g.max_age < 1 || g.max_age > 18) return 'Возраст «до» — от 1 до 18 лет';
    if (db.prepare('select 1 from child_age_groups where hotel_id = ? and max_age = ? and id != ?').get(hid, g.max_age, selfId)) return `Группа «до ${g.max_age} лет» уже есть`;
    return null;
  };
  r.post('/settings/child-groups', requireOwner, (req, res) => {
    const g = groupInput(req.body);
    const err = groupError(g, 0, req.user.hotel_id);
    if (err) return back(res, '/app/settings/booking#ages', err, true);
    db.prepare('insert into child_age_groups (hotel_id, name, max_age, meal_pct, no_bed) values (?,?,?,?,?)').run(req.user.hotel_id, g.name, g.max_age, g.meal_pct, g.no_bed);
    syncChildAge(req.user.hotel_id);
    back(res, '/app/settings/booking#ages', `Группа «${g.name}» добавлена. Задайте её цены в тарифах.`);
  });
  r.post('/settings/child-groups/:id', requireOwner, (req, res, next) => {
    const old = db.prepare('select * from child_age_groups where id = ? and hotel_id = ?').get(int(req.params.id), req.user.hotel_id);
    if (!old) return next();
    const g = groupInput(req.body);
    const err = groupError(g, old.id, req.user.hotel_id);
    if (err) return back(res, '/app/settings/booking#ages', err, true);
    db.prepare('update child_age_groups set name = ?, max_age = ?, meal_pct = ?, no_bed = ? where id = ?').run(g.name, g.max_age, g.meal_pct, g.no_bed, old.id);
    syncChildAge(req.user.hotel_id);
    back(res, '/app/settings/booking#ages', 'Группа сохранена');
  });
  r.post('/settings/child-groups/:id/delete', requireOwner, (req, res, next) => {
    const old = db.prepare('select * from child_age_groups where id = ? and hotel_id = ?').get(int(req.params.id), req.user.hotel_id);
    if (!old) return next();
    if (childGroups(db, req.user.hotel_id).length < 2) return back(res, '/app/settings/booking#ages', 'Должна остаться хотя бы одна группа', true);
    db.prepare('delete from child_age_groups where id = ?').run(old.id);
    syncChildAge(req.user.hotel_id);
    back(res, '/app/settings/booking#ages', `Группа «${old.name}» удалена`);
  });
  r.post('/settings/booking', requireOwner, (req, res) => {
    const b = req.body;
    const taxPct = Number.parseFloat(String(b.tax_pct || '0').replace(',', '.'));
    if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 5) return back(res, '/app/settings/booking', 'Ставка налога от 0 до 5%', true);
    if (b.pay_at_hotel !== 'on' && b.pay_card !== 'on') return back(res, '/app/settings/booking', 'Оставьте хотя бы один способ оплаты', true);
    db.prepare(`update hotels set min_days_ahead=?, max_days_ahead=?, cutoff_time=?, pay_at_hotel=?, pay_card=?, prepay_pct=?, cancel_policy=?,
      tax_bp=?, tax_min_night=? where id = ?`).run(
      Math.min(60, Math.max(0, int(b.min_days_ahead))), Math.min(730, Math.max(1, int(b.max_days_ahead, 365))),
      /^([01]\d|2[0-3]):[0-5]\d$/.test(b.cutoff_time || '') ? b.cutoff_time : '23:59',
      b.pay_at_hotel === 'on' ? 1 : 0, b.pay_card === 'on' ? 1 : 0, Math.min(100, Math.max(0, int(b.prepay_pct))), str(b.cancel_policy, 1000),
      Math.round(taxPct * 100), Math.max(0, int(b.tax_min_night)), req.user.hotel_id,
    );
    back(res, '/app/settings/booking', 'Правила бронирования сохранены');
  });
  r.get('/settings/team', (req, res) => res.send(S.settingsTeam({ req, hotel: req.hotelRow, users: req.s.users(), msg: req.msg, created: req.query.pw })));
  r.post('/settings/team', requireOwner, (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const name = str(req.body.name, 80);
    const wanted = ROLES.some(([k]) => k === req.body.role) ? req.body.role : 'manager';
    // The stored role stays owner/manager (old databases check it); kind narrows it down.
    const role = wanted === 'owner' ? 'owner' : 'manager';
    const kind = ['housekeeping', 'investor'].includes(wanted) ? wanted : '';
    if (!isEmail(email) || name.length < 2) return back(res, '/app/settings/team', 'Укажите имя и почту', true);
    const existing = db.prepare('select * from users where email = ?').get(email);
    if (existing) {
      if (existing.hotel_id === req.user.hotel_id || db.prepare('select 1 from user_hotels where user_id = ? and hotel_id = ?').get(existing.id, req.user.hotel_id)) {
        return back(res, '/app/settings/team', 'У этого человека уже есть доступ', true);
      }
      db.prepare('insert into user_hotels (user_id, hotel_id, role, kind) values (?,?,?,?)').run(existing.id, req.user.hotel_id, role, kind);
      return back(res, '/app/settings/team', `Доступ к объекту выдан: ${existing.name}`);
    }
    const pw = crypto.randomBytes(6).toString('base64url');
    db.prepare('insert into users (hotel_id, email, name, password_hash, role, kind) values (?,?,?,?,?,?)').run(req.user.hotel_id, email, name, hashPassword(pw), role, kind);
    res.redirect(303, `/app/settings/team?pw=${encodeURIComponent(pw)}`);
  });
  r.post('/settings/team/:id/remove', requireOwner, (req, res) => {
    const id = int(req.params.id);
    if (id === req.user.id) return back(res, '/app/settings/team', 'Нельзя закрыть доступ самому себе', true);
    const grant = db.prepare('delete from user_hotels where user_id = ? and hotel_id = ?').run(id, req.user.hotel_id);
    if (!grant.changes) {
      const u = db.prepare('select * from users where id = ? and hotel_id = ?').get(id, req.user.hotel_id);
      if (!u) return back(res, '/app/settings/team', 'Сотрудник не найден', true);
      db.prepare('delete from users where id = ?').run(id);
    }
    back(res, '/app/settings/team', 'Доступ закрыт');
  });
  r.post('/settings/password', (req, res) => {
    const u = db.prepare('select * from users where id = ?').get(req.user.id);
    if (!verifyPassword(req.body.current || '', u.password_hash)) return back(res, '/app/settings/team', 'Текущий пароль неверный', true);
    if (String(req.body.password || '').length < 8) return back(res, '/app/settings/team', 'Новый пароль — не короче 8 символов', true);
    db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(req.body.password), u.id);
    db.prepare('delete from sessions where user_id = ? and id != ?').run(u.id, req.session.id);
    back(res, '/app/settings/team', 'Пароль изменён, остальные сеансы завершены');
  });
  r.get('/settings/properties', (req, res) => res.send(S.settingsProperties({ req, hotel: req.hotelRow, hotels: req.hotels, msg: req.msg })));
  r.post('/settings/properties', (req, res) => {
    const name = str(req.body.name, 120);
    if (name.length < 2) return back(res, '/app/settings/properties', 'Укажите название объекта', true);
    const type = PROPERTY_TYPES.some(([k]) => k === req.body.property_type) ? req.body.property_type : 'hotel';
    const { hotelId } = createHotel(db, { name, city: str(req.body.city, 80), propertyType: type, ownerUserId: req.user.id });
    db.prepare('update sessions set hotel_id = ? where id = ?').run(hotelId, req.session.id);
    back(res, '/app/rooms', `Объект «${name}» создан — начните с категорий и номеров`);
  });
  // Tags are reference data: any member of the hotel's team can maintain them.
  r.get('/settings/tags', (req, res) => res.send(S.settingsTags({ req, hotel: req.hotelRow, msg: req.msg,
    tags: db.prepare('select t.*, (select count(*) from booking_tags bt where bt.tag_id = t.id) uses from hotel_tags t where t.hotel_id = ? order by t.name').all(req.user.hotel_id) })));
  const tagColor = (c) => (TAG_COLORS.some(([k]) => k === c) ? c : 'teal');
  r.post('/settings/tags', (req, res) => {
    const name = str(req.body.name, 30);
    if (name.length < 2) return back(res, '/app/settings/tags', 'Укажите название тега', true);
    try {
      db.prepare('insert into hotel_tags (hotel_id, name, color) values (?,?,?)').run(req.user.hotel_id, name, tagColor(req.body.color));
    } catch {
      return back(res, '/app/settings/tags', 'Такой тег уже есть', true);
    }
    back(res, '/app/settings/tags', `Тег «${name}» добавлен`);
  });
  r.post('/settings/tags/:id', (req, res, next) => {
    const t = db.prepare('select * from hotel_tags where id = ? and hotel_id = ?').get(int(req.params.id), req.user.hotel_id);
    if (!t) return next();
    const name = str(req.body.name, 30);
    if (name.length < 2) return back(res, '/app/settings/tags', 'Укажите название тега', true);
    try {
      db.prepare('update hotel_tags set name = ?, color = ?, active = ? where id = ?').run(name, tagColor(req.body.color), req.body.active === 'on' ? 1 : 0, t.id);
    } catch {
      return back(res, '/app/settings/tags', 'Такой тег уже есть', true);
    }
    back(res, '/app/settings/tags', 'Тег сохранён');
  });
  r.get('/settings/widget', (req, res) => res.send(S.settingsWidget({ req, hotel: req.hotelRow, origin: `${req.protocol}://${req.get('host')}`, msg: req.msg })));

  // Old addresses from the first version.
  r.get('/grid', (req, res) => res.redirect(301, '/app/prices'));
  r.get('/leads', (req, res) => res.redirect(301, req.user.platform ? '/admin' : '/app'));
  return r;
}

// Occupancy and lodging revenue per day of [from, to]. Rooms under repair are not counted as available.
export function occupancyReport(db, hotelId, from, to) {
  const end = addDays(to, 1);
  const days = nightsOf(from, end);
  const types = db.prepare('select * from room_types where hotel_id = ? and active = 1 order by sort, id').all(hotelId);
  const roomsByType = new Map(types.map((t) => [t.id, db.prepare("select count(*) n from rooms where room_type_id = ? and active = 1 and status != 'repair'").get(t.id).n]));
  const bookings = db.prepare(`select * from bookings where hotel_id = ? and status in ${ACTIVE} and checkin < ? and checkout > ?`).all(hotelId, end, from);
  const segs = db.prepare('select * from stay_segments where booking_id = ? order by start');
  const perDay = new Map(days.map((d) => [d, { date: d, sold: 0, revenue: 0, arrivals: 0, departures: 0 }]));
  const perType = new Map(types.map((t) => [t.id, { name: t.name, sold: 0, revenue: 0 }]));
  for (const b of bookings) {
    const nightly = b.nights_total / diffDays(b.checkin, b.checkout);
    for (const sg of segs.all(b.id)) {
      for (const d of nightsOf(sg.start, sg.end)) {
        const row = perDay.get(d);
        if (!row) continue;
        row.sold++;
        row.revenue += nightly;
        const t = perType.get(sg.room_type_id);
        if (t) { t.sold++; t.revenue += nightly; }
      }
    }
    if (perDay.has(b.checkin)) perDay.get(b.checkin).arrivals++;
    if (perDay.has(b.checkout)) perDay.get(b.checkout).departures++;
  }
  const totalRooms = [...roomsByType.values()].reduce((s, n) => s + n, 0);
  const byDay = [...perDay.values()].map((r) => ({ ...r, revenue: Math.round(r.revenue), available: totalRooms, occupancy: totalRooms ? Math.round((r.sold / totalRooms) * 100) : 0 }));
  const byType = types.map((t) => {
    const x = perType.get(t.id);
    const available = roomsByType.get(t.id) * days.length;
    return { name: x.name, sold: x.sold, available, revenue: Math.round(x.revenue), adr: x.sold ? Math.round(x.revenue / x.sold) : 0, occupancy: available ? Math.round((x.sold / available) * 100) : 0 };
  });
  const sold = byDay.reduce((s, r) => s + r.sold, 0);
  const available = totalRooms * days.length;
  const revenue = byDay.reduce((s, r) => s + r.revenue, 0);
  return {
    byDay, byType,
    totals: { sold, available, revenue, occupancy: available ? Math.round((sold / available) * 100) : 0, adr: sold ? Math.round(revenue / sold) : 0, revpar: available ? Math.round(revenue / available) : 0 },
  };
}

export function salesReport(db, hotelId, from, to) {
  const rows = db.prepare('select * from bookings where hotel_id = ? and date(created_at) >= ? and date(created_at) <= ?').all(hotelId, from, to);
  const live = rows.filter((b) => b.status !== 'cancelled');
  const bySourceMap = new Map();
  for (const b of rows) {
    const x = bySourceMap.get(b.source) || { source: b.source, n: 0, cancelled: 0, sum: 0 };
    x.n++;
    if (b.status === 'cancelled') x.cancelled++;
    else x.sum += b.total;
    bySourceMap.set(b.source, x);
  }
  const sum = live.reduce((s, b) => s + b.total, 0);
  const bySource = [...bySourceMap.values()].sort((a, b) => b.sum - a.sum).map((x) => ({ ...x, pct: sum ? Math.round((x.sum / sum) * 100) : 0 }));
  const paid = db.prepare('select coalesce(sum(p.amount),0) s from payments p join bookings b on b.id = p.booking_id where b.hotel_id = ? and date(p.created_at) >= ? and date(p.created_at) <= ?').get(hotelId, from, to).s;
  const cancelled = rows.length - live.length;
  return { bySource, totals: { count: rows.length, sum, cancelled, cancelRate: rows.length ? Math.round((cancelled / rows.length) * 100) : 0, avg: live.length ? Math.round(sum / live.length) : 0, paid } };
}

function csvFor(tab, d) {
  if (tab === 'sales') return [['Источник', 'Броней', 'Отмен', 'Сумма'], ...d.bySource.map((x) => [x.source, x.n, x.cancelled, x.sum])];
  if (tab === 'lists') return [['Тип', 'Номер', 'Гость', 'Телефон', 'Заезд', 'Выезд', 'Долг'], ...['arrivals', 'departures', 'inhouse'].flatMap((k) => d[k].map((b) => [k, b.room_number || '', b.guest_name, b.guest_phone, b.checkin, b.checkout, b.total - b.paid_amount]))];
  if (tab === 'mvd') {
    return [['Фамилия', 'Имя', 'Отчество', 'Дата рождения', 'Пол', 'Гражданство', 'Документ', 'Серия', 'Номер', 'Дата выдачи', 'Кем выдан', 'Код подразделения', 'Адрес регистрации', 'Миграционная карта', 'Виза', 'Номер', 'Заезд', 'Выезд', 'Бронь', 'Срок', 'Статус'],
      ...d.rows.map((g) => [g.last_name, g.first_name, g.middle_name, g.birth_date, g.sex, g.citizenship, g.doc_type, g.doc_series, g.doc_number, g.doc_issued_at, g.doc_issued_by, g.doc_code, g.reg_address, g.migration_card, g.visa, g.room_number || '', g.checkin, g.checkout, g.code, g.deadline, g.mvd_status])];
  }
  if (tab === 'tax') return [['Бронь', 'Гость', 'Выезд', 'Проживание', 'Налог'], ...d.rows.map((b) => [b.code, b.guest_name, b.checkout, b.nights_total, b.tax_total])];
  return [['Дата', 'Продано', 'Доступно', 'Загрузка %', 'Заезды', 'Выезды', 'Доход'], ...d.byDay.map((r) => [r.date, r.sold, r.available, r.occupancy, r.arrivals, r.departures, r.revenue])];
}

function sendCsv(res, name, rows) {
  // Leading quote neutralises formulas when the file is opened in a spreadsheet.
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'));
}
