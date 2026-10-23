import crypto from 'node:crypto';
import { tx, findFreeRoom, roomIsFree } from '../db.js';
import { addDays, diffDays, isIsoDate, nightsOf, todayIn, timeIn } from './dates.js';

export const MAX_NIGHTS = 30;
export const ACTIVE = "('confirmed','checked_in','checked_out')";

export class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Validates a search query against the hotel's sales window.
// staff: extranet bookings ignore the window and may start up to a week back.
export function parseSearch(q, hotel = {}, { staff = false, now = new Date() } = {}) {
  const errors = {};
  const t = todayIn(hotel.timezone, now);
  const checkin = String(q.checkin || '');
  const checkout = String(q.checkout || '');
  const adults = Number.parseInt(q.adults ?? '2', 10);
  const children = Number.parseInt(q.children ?? '0', 10);
  const minAhead = staff ? -7 : hotel.min_days_ahead || 0;
  const maxAhead = staff ? 730 : hotel.max_days_ahead || 365;
  if (!isIsoDate(checkin)) errors.checkin = 'Укажите дату заезда';
  else if (diffDays(t, checkin) < Math.min(minAhead, 0) || (checkin < t && !staff)) errors.checkin = 'Дата заезда уже прошла';
  else if (!staff && diffDays(t, checkin) < minAhead) errors.checkin = `Бронирование не позднее чем за ${minAhead} дн. до заезда`;
  else if (!staff && checkin === t && hotel.cutoff_time && timeIn(hotel.timezone, now) > hotel.cutoff_time) errors.checkin = `Бронь на сегодня принимается до ${hotel.cutoff_time}`;
  else if (diffDays(t, checkin) > maxAhead) errors.checkin = `Бронирование открыто на ${maxAhead} дн. вперёд`;
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

export function ensureInventory(db, roomType, dates) {
  const ins = db.prepare('insert or ignore into inventory (room_type_id, date, price, available) values (?, ?, ?, ?)');
  for (const d of dates) ins.run(roomType.id, d, roomType.base_price, roomType.total_rooms);
}

export function findPromo(db, hotelId, code) {
  if (!code) return null;
  return db.prepare('select * from promo_codes where hotel_id = ? and code = ? and active = 1').get(hotelId, code) || null;
}

// Who sleeps where: adults take main places first, then children; the rest use extra beds.
export function placement(room, adults, children) {
  const main = room.capacity;
  const extraAdults = Math.max(0, adults - main);
  const freeMain = Math.max(0, main - adults);
  const extraChildren = Math.max(0, children - freeMain);
  const fits = extraAdults + extraChildren <= (room.extra_beds || 0);
  return { extraAdults, extraChildren, fits };
}

// Price of a stay for one rate. Promo applies to lodging and meals; tourist tax is
// charged on lodging only (not on meals or services).
export function priceStay({ nightly, rate, room = { capacity: 99, extra_beds: 0 }, adults, children = 0, promo, hotel = {} }) {
  const n = nightly.length;
  const pl = placement(room, adults, children);
  const base = nightly.reduce((s, p) => s + p, 0);
  const rateDiscount = Math.round((base * (rate.discount_pct || 0)) / 100);
  const extraBeds = (pl.extraAdults * (rate.extra_adult_price || 0) + pl.extraChildren * (rate.extra_child_price || 0)) * n;
  const meals = (rate.meal_price || 0) * (adults + children) * n;
  const lodging = base - rateDiscount + extraBeds;
  const pct = promo ? promo.discount_pct : 0;
  const promoLodging = Math.round((lodging * pct) / 100);
  const promoMeals = Math.round((meals * pct) / 100);
  const lodgingNet = lodging - promoLodging;
  const tax = hotel.tax_bp ? Math.max(Math.round((lodgingNet * hotel.tax_bp) / 10000), (hotel.tax_min_night || 0) * n) : 0;
  const stay = lodgingNet + meals - promoMeals;
  return { base, rateDiscount, extraBeds, meals, promoDiscount: promoLodging + promoMeals, tax, stay, total: stay + tax, ...pl };
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
  const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 and total_rooms > 0 order by sort, id').all(hotel.id);
  const rates = db.prepare('select * from rate_plans where hotel_id = ? and active = 1 order by id').all(hotel.id);
  const inv = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ? order by date');
  const offers = rooms.map((room) => {
    ensureInventory(db, room, nights);
    const rows = inv.all(room.id, query.checkin, query.checkout);
    const left = Math.min(...rows.map((r) => (r.closed ? 0 : r.available)));
    const minStay = Math.max(...rows.map((r) => r.min_stay));
    const pl = placement(room, query.adults, query.children);
    let reason = null;
    if (!pl.fits) reason = 'capacity';
    else if (left <= 0) reason = 'sold_out';
    else if (nights.length < minStay) reason = 'min_stay';
    const nightly = rows.map((r) => r.price);
    const rateOffers = rates.map((rate) => ({ rate, price: priceStay({ nightly, rate, room, adults: query.adults, children: query.children, promo, hotel }) }));
    return { room, left: Math.max(left, 0), minStay, reason, available: !reason, rates: rateOffers };
  });
  return { nights: nights.length, guests, promo, promoInvalid: Boolean(query.promo && !promo), offers };
}

function newCode() {
  return 'SR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function validateGuest(body, { requireAgree = true, requireEmail = true } = {}) {
  const errors = {};
  const name = String(body.guest_name || '').trim().slice(0, 120);
  const email = String(body.guest_email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(body.guest_phone || '').trim().slice(0, 40);
  const comment = String(body.comment || '').trim().slice(0, 1000);
  if (name.length < 2) errors.guest_name = 'Как к вам обращаться?';
  if ((requireEmail || email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.guest_email = 'Проверьте адрес почты';
  if (phone.replace(/\D/g, '').length < 10) errors.guest_phone = 'Нужен телефон, хотя бы 10 цифр';
  if (requireAgree && body.agree !== 'on' && body.agree !== true) errors.agree = 'Нужно согласие на обработку данных';
  return { ok: Object.keys(errors).length === 0, errors, guest: { name, email, phone, comment } };
}

// Creates a booking atomically. Throws BookingError when it cannot be placed.
// staff bookings may sell closed dates and pick a specific physical room.
export function createBooking(db, hotel, input) {
  const {
    query, roomId, rateId, extraIds = [], guest, payment = 'hotel', idemKey, source = 'site',
    staff = false, physicalRoomId = null, priceOverride = null, createdBy = null, channelRef = null,
  } = input;
  return tx(db, () => {
    if (idemKey) {
      const dup = db.prepare('select * from bookings where idem_key = ?').get(idemKey);
      if (dup) return dup;
    }
    const room = db.prepare('select * from room_types where id = ? and hotel_id = ? and active = 1').get(roomId, hotel.id);
    const rate = db.prepare('select * from rate_plans where id = ? and hotel_id = ? and active = 1').get(rateId, hotel.id);
    if (!room || !rate) throw new BookingError('not_found', 'Такой номер или тариф больше не продаётся');
    const pl = placement(room, query.adults, query.children);
    if (!pl.fits) throw new BookingError('capacity', 'В этот номер столько гостей не поместится, даже с дополнительными местами');
    const nights = nightsOf(query.checkin, query.checkout);
    ensureInventory(db, room, nights);
    const rows = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ? order by date').all(room.id, query.checkin, query.checkout);
    if (rows.length !== nights.length || rows.some((r) => r.available <= 0 || (r.closed && !staff))) {
      throw new BookingError('sold_out', staff ? 'На эти даты в категории нет свободных номеров' : 'Пока вы заполняли форму, номера на эти даты закончились');
    }
    if (!staff && nights.length < Math.max(...rows.map((r) => r.min_stay))) throw new BookingError('min_stay', 'На эти даты действует минимальный срок проживания');
    let physical = null;
    if (physicalRoomId) {
      physical = db.prepare('select * from rooms where id = ? and hotel_id = ? and room_type_id = ? and active = 1').get(physicalRoomId, hotel.id, room.id);
      if (!physical) throw new BookingError('room', 'Этот номер не относится к выбранной категории');
      if (!roomIsFree(db, physical.id, query.checkin, query.checkout)) throw new BookingError('room_busy', `Номер ${physical.number} на эти даты занят`);
    } else {
      physical = findFreeRoom(db, room.id, query.checkin, query.checkout);
    }
    const promo = findPromo(db, hotel.id, query.promo);
    const price = priceStay({ nightly: rows.map((r) => r.price), rate, room, adults: query.adults, children: query.children, promo, hotel });
    if (Number.isInteger(priceOverride) && priceOverride >= 0) {
      price.stay = priceOverride;
      price.tax = hotel.tax_bp ? Math.max(Math.round((priceOverride * hotel.tax_bp) / 10000), (hotel.tax_min_night || 0) * nights.length) : 0;
    }
    const extras = db.prepare('select * from extras where hotel_id = ? and active = 1').all(hotel.id);
    const ex = extrasTotal(extras, extraIds, nights.length, query.adults + query.children);
    const dec = db.prepare('update inventory set available = available - 1 where room_type_id = ? and date = ? and available > 0');
    for (const d of nights) {
      if (dec.run(room.id, d).changes !== 1) throw new BookingError('sold_out', 'Номера на эти даты закончились');
    }
    const total = price.stay + price.tax + ex.total;
    const prepaid = payment === 'card' ? Math.round((total * (hotel.prepay_pct || 100)) / 100) : 0;
    const code = newCode();
    const r = db.prepare(`insert into bookings (code, idem_key, hotel_id, room_type_id, rate_plan_id, room_id, checkin, checkout, adults, children,
      guest_name, guest_email, guest_phone, comment, extras, promo_code, nights_total, extras_total, discount_total, extra_beds_total, tax_total, total,
      payment, paid, paid_amount, source, created_by, channel_ref)
      values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, idemKey || null, hotel.id, room.id, rate.id, physical ? physical.id : null, query.checkin, query.checkout, query.adults, query.children,
      guest.name, guest.email || '', guest.phone, guest.comment || '', JSON.stringify(ex.lines), promo ? promo.code : null,
      price.stay, ex.total, price.rateDiscount + price.promoDiscount, price.extraBeds, price.tax, total,
      payment === 'card' ? 'card' : 'hotel', prepaid >= total ? 1 : 0, prepaid, source, createdBy, channelRef,
    );
    if (prepaid) db.prepare("insert into payments (booking_id, amount, method, note) values (?, ?, 'online', 'Предоплата при бронировании (тест)')").run(r.lastInsertRowid, prepaid);
    const booking = db.prepare('select * from bookings where id = ?').get(r.lastInsertRowid);
    logToChannels(db, hotel.id, 'booking', `Бронь ${code}: ${room.name}, ${query.checkin} – ${query.checkout}, наличие обновлено`, source);
    return booking;
  });
}

export function cancelBooking(db, booking) {
  return tx(db, () => {
    const fresh = db.prepare('select * from bookings where id = ?').get(booking.id);
    if (fresh.status === 'cancelled') return fresh;
    if (fresh.status !== 'confirmed') throw new BookingError('state', 'Эту бронь уже нельзя отменить');
    returnInventory(db, fresh);
    db.prepare("update bookings set status = 'cancelled' where id = ?").run(fresh.id);
    logToChannels(db, fresh.hotel_id, 'update', `Отмена ${fresh.code}: номера возвращены в продажу`);
    return db.prepare('select * from bookings where id = ?').get(fresh.id);
  });
}

export function markNoShow(db, booking) {
  return tx(db, () => {
    const fresh = db.prepare('select * from bookings where id = ?').get(booking.id);
    if (fresh.status !== 'confirmed') throw new BookingError('state', 'Незаезд можно отметить только у подтверждённой брони');
    returnInventory(db, fresh);
    db.prepare("update bookings set status = 'no_show' where id = ?").run(fresh.id);
    return db.prepare('select * from bookings where id = ?').get(fresh.id);
  });
}

function returnInventory(db, b) {
  const inc = db.prepare('update inventory set available = available + 1 where room_type_id = ? and date = ?');
  for (const d of nightsOf(b.checkin, b.checkout)) inc.run(b.room_type_id, d);
}

// Moves a booking to another physical room. Moving to another category also moves
// the sold nights between the two categories. The price stays as booked.
export function moveBooking(db, booking, targetRoomId) {
  return tx(db, () => {
    const b = db.prepare('select * from bookings where id = ?').get(booking.id);
    if (['cancelled', 'no_show'].includes(b.status)) throw new BookingError('state', 'Отменённую бронь нельзя переселить');
    if (!targetRoomId) {
      db.prepare('update bookings set room_id = null where id = ?').run(b.id);
      return db.prepare('select * from bookings where id = ?').get(b.id);
    }
    const target = db.prepare('select * from rooms where id = ? and hotel_id = ? and active = 1').get(targetRoomId, b.hotel_id);
    if (!target) throw new BookingError('room', 'Номер не найден');
    if (target.status === 'repair') throw new BookingError('room', `Номер ${target.number} на ремонте`);
    if (!roomIsFree(db, target.id, b.checkin, b.checkout, b.id)) throw new BookingError('room_busy', `Номер ${target.number} на эти даты занят`);
    if (target.room_type_id !== b.room_type_id) {
      const type = db.prepare('select * from room_types where id = ?').get(target.room_type_id);
      if (!placement(type, b.adults, b.children).fits) throw new BookingError('capacity', `В номер ${target.number} не поместятся ${b.adults + b.children} гостей`);
      const nights = nightsOf(b.checkin, b.checkout);
      ensureInventory(db, type, nights);
      const dec = db.prepare('update inventory set available = available - 1 where room_type_id = ? and date = ? and available > 0');
      for (const d of nights) {
        if (dec.run(type.id, d).changes !== 1) throw new BookingError('sold_out', `В категории «${type.name}» нет свободных номеров на ${d}`);
      }
      returnInventory(db, b);
      db.prepare('update bookings set room_type_id = ? where id = ?').run(type.id, b.id);
    }
    db.prepare('update bookings set room_id = ? where id = ?').run(target.id, b.id);
    return db.prepare('select * from bookings where id = ?').get(b.id);
  });
}

export function addPayment(db, booking, amount, method, note = '', userId = null) {
  return tx(db, () => {
    db.prepare('insert into payments (booking_id, amount, method, note, created_by) values (?,?,?,?,?)').run(booking.id, amount, method, note, userId);
    const sum = db.prepare('select coalesce(sum(amount),0) s from payments where booking_id = ?').get(booking.id).s;
    db.prepare('update bookings set paid_amount = ?, paid = ? where id = ?').run(sum, sum >= booking.total ? 1 : 0, booking.id);
    return db.prepare('select * from bookings where id = ?').get(booking.id);
  });
}

export function logToChannels(db, hotelId, kind, summary, exceptSource = null) {
  const chans = db.prepare('select id, code from channels where hotel_id = ? and connected = 1').all(hotelId);
  const ins = db.prepare('insert into channel_log (channel_id, kind, summary) values (?, ?, ?)');
  // The channel a booking came from already knows about it.
  for (const c of chans) if (c.code !== exceptSource) ins.run(c.id, kind, summary);
}

export function canCancelUntil(booking) {
  return addDays(booking.checkin, -1);
}
