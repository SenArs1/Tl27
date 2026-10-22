import crypto from 'node:crypto';
import { tx } from '../db.js';
import { addDays, diffDays, isIsoDate, nightsOf, today } from './dates.js';

export const MAX_NIGHTS = 30;
export const HORIZON_DAYS = 365;

export class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Validates a search query. Returns { ok, errors, query }.
export function parseSearch(q, now = new Date()) {
  const errors = {};
  const t = today(now);
  const checkin = String(q.checkin || '');
  const checkout = String(q.checkout || '');
  const adults = Number.parseInt(q.adults ?? '2', 10);
  const children = Number.parseInt(q.children ?? '0', 10);
  if (!isIsoDate(checkin)) errors.checkin = 'Укажите дату заезда';
  else if (checkin < t) errors.checkin = 'Дата заезда уже прошла';
  else if (diffDays(t, checkin) > HORIZON_DAYS) errors.checkin = 'Бронирование открыто на год вперёд';
  if (!isIsoDate(checkout)) errors.checkout = 'Укажите дату выезда';
  else if (!errors.checkin && checkout <= checkin) errors.checkout = 'Выезд должен быть позже заезда';
  else if (!errors.checkin && diffDays(checkin, checkout) > MAX_NIGHTS) errors.checkout = `Не больше ${MAX_NIGHTS} ночей за одно бронирование`;
  if (!Number.isInteger(adults) || adults < 1 || adults > 12) errors.adults = 'От 1 до 12 взрослых';
  if (!Number.isInteger(children) || children < 0 || children > 8) errors.children = 'От 0 до 8 детей';
  const promo = String(q.promo || '').trim().toUpperCase().slice(0, 32);
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    query: { checkin, checkout, adults: adults || 0, children: children || 0, promo },
  };
}

// Makes sure inventory rows exist for every night, using the room type's defaults.
export function ensureInventory(db, roomType, dates) {
  const ins = db.prepare('insert or ignore into inventory (room_type_id, date, price, available) values (?, ?, ?, ?)');
  for (const d of dates) ins.run(roomType.id, d, roomType.base_price, roomType.total_rooms);
}

export function findPromo(db, hotelId, code) {
  if (!code) return null;
  return db.prepare('select * from promo_codes where hotel_id = ? and code = ? and active = 1').get(hotelId, code) || null;
}

// Price of one rate for a stay. nightly = list of inventory prices.
export function priceStay({ nightly, rate, guests, promo }) {
  const base = nightly.reduce((s, p) => s + p, 0);
  const rateDiscount = Math.round((base * rate.discount_pct) / 100);
  const meals = rate.meal_price * guests * nightly.length;
  const subtotal = base - rateDiscount + meals;
  const promoDiscount = promo ? Math.round((subtotal * promo.discount_pct) / 100) : 0;
  return { base, rateDiscount, meals, promoDiscount, total: subtotal - promoDiscount };
}

export function extrasTotal(extras, chosenIds, nights, guests) {
  const lines = [];
  for (const e of extras) {
    if (!chosenIds.includes(e.id)) continue;
    const qty = e.per === 'stay' ? 1 : e.per === 'night' ? nights : nights * guests;
    lines.push({ id: e.id, name: e.name, price: e.price, qty, sum: e.price * qty });
  }
  return { lines, total: lines.reduce((s, l) => s + l.sum, 0) };
}

// All offers for a search: one entry per room type with rate options.
export function searchOffers(db, hotel, query) {
  const nights = nightsOf(query.checkin, query.checkout);
  const guests = query.adults + query.children;
  const promo = findPromo(db, hotel.id, query.promo);
  const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 order by sort, id').all(hotel.id);
  const rates = db.prepare('select * from rate_plans where hotel_id = ? and active = 1 order by id').all(hotel.id);
  const inv = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ? order by date');
  const offers = rooms.map((room) => {
    ensureInventory(db, room, nights);
    const rows = inv.all(room.id, query.checkin, query.checkout);
    const left = Math.min(...rows.map((r) => (r.closed ? 0 : r.available)));
    const minStay = Math.max(...rows.map((r) => r.min_stay));
    const fits = guests <= room.capacity;
    let reason = null;
    if (!fits) reason = 'capacity';
    else if (left <= 0) reason = 'sold_out';
    else if (nights.length < minStay) reason = 'min_stay';
    const nightly = rows.map((r) => r.price);
    const rateOffers = rates.map((rate) => ({ rate, price: priceStay({ nightly, rate, guests, promo }) }));
    return { room, left: Math.max(left, 0), minStay, reason, available: !reason, rates: rateOffers };
  });
  return { nights: nights.length, guests, promo, promoInvalid: Boolean(query.promo && !promo), offers };
}

function newCode() {
  return 'SR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function validateGuest(body) {
  const errors = {};
  const name = String(body.guest_name || '').trim().slice(0, 120);
  const email = String(body.guest_email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(body.guest_phone || '').trim().slice(0, 40);
  const comment = String(body.comment || '').trim().slice(0, 1000);
  if (name.length < 2) errors.guest_name = 'Как к вам обращаться?';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.guest_email = 'Проверьте адрес почты';
  if (phone.replace(/\D/g, '').length < 10) errors.guest_phone = 'Нужен телефон, хотя бы 10 цифр';
  if (body.agree !== 'on' && body.agree !== true) errors.agree = 'Нужно согласие на обработку данных';
  return { ok: Object.keys(errors).length === 0, errors, guest: { name, email, phone, comment } };
}

// Creates a booking atomically. Throws BookingError when rooms ran out.
export function createBooking(db, hotel, input) {
  const { query, roomId, rateId, extraIds = [], guest, payment = 'hotel', idemKey, source = 'site' } = input;
  return tx(db, () => {
    if (idemKey) {
      const dup = db.prepare('select * from bookings where idem_key = ?').get(idemKey);
      if (dup) return dup;
    }
    const room = db.prepare('select * from room_types where id = ? and hotel_id = ? and active = 1').get(roomId, hotel.id);
    const rate = db.prepare('select * from rate_plans where id = ? and hotel_id = ? and active = 1').get(rateId, hotel.id);
    if (!room || !rate) throw new BookingError('not_found', 'Такой номер или тариф больше не продаётся');
    const guests = query.adults + query.children;
    if (guests > room.capacity) throw new BookingError('capacity', 'В этот номер столько гостей не поместится');
    const nights = nightsOf(query.checkin, query.checkout);
    ensureInventory(db, room, nights);
    const rows = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ? order by date').all(room.id, query.checkin, query.checkout);
    if (rows.length !== nights.length || rows.some((r) => r.closed || r.available <= 0)) {
      throw new BookingError('sold_out', 'Пока вы заполняли форму, номера на эти даты закончились');
    }
    if (nights.length < Math.max(...rows.map((r) => r.min_stay))) throw new BookingError('min_stay', 'На эти даты действует минимальный срок проживания');
    const promo = findPromo(db, hotel.id, query.promo);
    const price = priceStay({ nightly: rows.map((r) => r.price), rate, guests, promo });
    const extras = db.prepare('select * from extras where hotel_id = ? and active = 1').all(hotel.id);
    const ex = extrasTotal(extras, extraIds, nights.length, guests);
    const dec = db.prepare('update inventory set available = available - 1 where room_type_id = ? and date = ? and available > 0');
    for (const d of nights) {
      if (dec.run(room.id, d).changes !== 1) throw new BookingError('sold_out', 'Номера на эти даты закончились');
    }
    const code = newCode();
    const r = db.prepare(`insert into bookings (code, idem_key, hotel_id, room_type_id, rate_plan_id, checkin, checkout, adults, children,
      guest_name, guest_email, guest_phone, comment, extras, promo_code, nights_total, extras_total, discount_total, total, payment, paid, source)
      values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, idemKey || null, hotel.id, room.id, rate.id, query.checkin, query.checkout, query.adults, query.children,
      guest.name, guest.email, guest.phone, guest.comment || '', JSON.stringify(ex.lines), promo ? promo.code : null,
      price.total, ex.total, price.rateDiscount + price.promoDiscount, price.total + ex.total, payment, payment === 'card' ? 1 : 0, source,
    );
    const booking = db.prepare('select * from bookings where id = ?').get(r.lastInsertRowid);
    logToChannels(db, hotel.id, 'booking', `Бронь ${code}: ${room.name}, ${query.checkin} – ${query.checkout}, осталось обновлено`);
    return booking;
  });
}

export function cancelBooking(db, booking) {
  return tx(db, () => {
    const fresh = db.prepare('select * from bookings where id = ?').get(booking.id);
    if (fresh.status === 'cancelled') return fresh;
    if (!['confirmed'].includes(fresh.status)) throw new BookingError('state', 'Эту бронь уже нельзя отменить');
    const inc = db.prepare('update inventory set available = available + 1 where room_type_id = ? and date = ?');
    for (const d of nightsOf(fresh.checkin, fresh.checkout)) inc.run(fresh.room_type_id, d);
    db.prepare("update bookings set status = 'cancelled' where id = ?").run(fresh.id);
    logToChannels(db, fresh.hotel_id, 'update', `Отмена ${fresh.code}: номера возвращены в продажу`);
    return db.prepare('select * from bookings where id = ?').get(fresh.id);
  });
}

export function logToChannels(db, hotelId, kind, summary) {
  const chans = db.prepare('select id from channels where hotel_id = ? and connected = 1').all(hotelId);
  const ins = db.prepare('insert into channel_log (channel_id, kind, summary) values (?, ?, ?)');
  for (const c of chans) ins.run(c.id, kind, summary);
}

export function canCancelUntil(booking) {
  return addDays(booking.checkin, -1);
}
