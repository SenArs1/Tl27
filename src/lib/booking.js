import crypto from 'node:crypto';
import { tx, findFreeRoom, roomIsFree } from '../db.js';
import { addDays, diffDays, isIsoDate, nightsOf, todayIn, timeIn } from './dates.js';

export const MAX_NIGHTS = 30;
export const MAX_NIGHTS_STAFF = 90;
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
  else if (!errors.checkin && diffDays(checkin, checkout) > (staff ? MAX_NIGHTS_STAFF : MAX_NIGHTS)) errors.checkout = `Не больше ${staff ? MAX_NIGHTS_STAFF : MAX_NIGHTS} ночей за одно бронирование`;
  if (!Number.isInteger(adults) || adults < 1 || adults > 12) errors.adults = 'От 1 до 12 взрослых';
  if (!Number.isInteger(children) || children < 0 || children > 8) errors.children = 'От 0 до 8 детей';
  const promo = String(q.promo || '').trim().toUpperCase().slice(0, 32);
  // Children's ages: "3, 7" or [3, 7]. Required when there are children, so the
  // price can follow the hotel's age groups.
  const rawAges = Array.isArray(q.ages) ? q.ages.join(',') : String(q.ages ?? '');
  const ages = rawAges.split(/[\s,;]+/).filter(Boolean).map((x) => Number.parseInt(x, 10));
  const maxAge = hotel.child_max_age ?? 17;
  if (!errors.children && children > 0) {
    if (ages.length !== children) errors.ages = `Укажите возраст каждого ребёнка (${children} ${children === 1 ? 'значение' : 'значения'} через запятую)`;
    else if (ages.some((x) => !Number.isInteger(x) || x < 0 || x >= maxAge)) errors.ages = `Возраст ребёнка — от 0 до ${maxAge - 1} лет. Гости старше считаются взрослыми`;
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    query: { checkin, checkout, adults: adults || 0, children: children || 0, ages: children > 0 && ages.length === children ? ages : [], promo },
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

// Age groups of a hotel, youngest first.
export function childGroups(db, hotelId) {
  return db.prepare('select * from child_age_groups where hotel_id = ? order by max_age').all(hotelId);
}

export function groupOf(groups, age) {
  return groups.find((g) => age < g.max_age) || null;
}

// Who sleeps where. Adults take main places first, then children with a place,
// oldest first; the rest use extra beds. Children of a "no place" group take none.
// Without ages (old links, simple callers) every child is a child with a place.
export function placement(room, adults, children, ages = [], groups = []) {
  const main = room.capacity;
  const extraAdults = Math.max(0, adults - main);
  const freeMain = Math.max(0, main - adults);
  const kids = ages.length === children && groups.length
    ? ages.map((age) => ({ age, group: groupOf(groups, age) })).sort((a, b) => b.age - a.age)
    : Array.from({ length: children }, () => ({ age: null, group: null }));
  const noBed = kids.filter((k) => k.group && k.group.no_bed);
  const withBed = kids.filter((k) => !(k.group && k.group.no_bed));
  const kidsExtra = withBed.slice(freeMain);
  const fits = extraAdults + kidsExtra.length <= (room.extra_beds || 0);
  return { extraAdults, extraChildren: kidsExtra.length, kidsExtra, noBed, kids, fits };
}

export const MAX_RATE_DEPTH = 3;

// Nightly price of a rate from the category's base price for that night.
// A derived rate starts from its parent rate (up to three levels), then applies
// its own adjustment: percent or fixed roubles, and optional rounding.
export function rateNightly(rate, base, rates = new Map(), depth = 0) {
  let p = base;
  const parent = rate.parent_id ? rates.get(rate.parent_id) : null;
  if (parent && depth < MAX_RATE_DEPTH) p = rateNightly(parent, base, rates, depth + 1);
  const v = rate.adjust_value || 0;
  if (v) p = rate.adjust_type === 'fixed' ? p + v : (p * (100 + v)) / 100;
  else if (rate.discount_pct && rate.adjust_type === undefined) p = (p * (100 - rate.discount_pct)) / 100; // rates written before adjustments existed
  if (rate.rounding > 0) p = Math.round(p / rate.rounding) * rate.rounding;
  return Math.max(0, Math.round(p));
}

// Price of a stay for one rate. Promo applies to lodging and meals; tourist tax is
// charged on lodging only (not on meals or services).
export function priceStay({ nightly, rate, rates, room = { capacity: 99, extra_beds: 0 }, adults, children = 0, ages = [], groups = [], promo, hotel = {} }) {
  const n = nightly.length;
  const pl = placement(room, adults, children, ages, groups);
  const base = nightly.reduce((s, p) => s + p, 0);
  const rated = nightly.reduce((s, p) => s + rateNightly(rate, p, rates), 0);
  const single = adults === 1 && children === 0 ? Math.min(rate.single_discount || 0, Math.floor(rated / Math.max(n, 1))) * n : 0;
  const rateDiscount = base - rated + single;
  // A group price set on the rate wins; otherwise the rate's generic child extra-bed
  // price, and nothing for children who take no place.
  // Derived rates without their own child price inherit it from the parent rate.
  const childPrice = (k, noBed) => {
    if (k.group) {
      for (let r = rate, depth = 0; r && depth <= MAX_RATE_DEPTH; r = r.parent_id && rates ? rates.get(r.parent_id) : null, depth++) {
        if (r.childPrices && r.childPrices[k.group.id] !== undefined) return r.childPrices[k.group.id];
      }
    }
    return noBed ? 0 : rate.extra_child_price || 0;
  };
  const kidsBeds = pl.kidsExtra.reduce((s, k) => s + childPrice(k, false), 0) + pl.noBed.reduce((s, k) => s + childPrice(k, true), 0);
  const extraBeds = (pl.extraAdults * (rate.extra_adult_price || 0) + kidsBeds) * n;
  const kidsMeals = pl.kids.reduce((s, k) => s + (k.group ? k.group.meal_pct : 100), 0) / 100;
  const meals = Math.round((rate.meal_price || 0) * (adults + kidsMeals) * n);
  const lodging = base - rateDiscount + extraBeds;
  const pct = promo ? promo.discount_pct : 0;
  const promoLodging = Math.round((lodging * pct) / 100);
  const promoMeals = Math.round((meals * pct) / 100);
  const lodgingNet = lodging - promoLodging;
  const tax = taxFor(hotel, lodgingNet, n);
  const stay = lodgingNet + meals - promoMeals;
  return { base, rateDiscount, single, extraBeds, meals, promoDiscount: promoLodging + promoMeals, tax, stay, total: stay + tax, ...pl };
}

export function taxFor(hotel, lodging, nights) {
  return hotel.tax_bp ? Math.max(Math.round((lodging * hotel.tax_bp) / 10000), (hotel.tax_min_night || 0) * nights) : 0;
}

// All rates of a hotel by id, each with its child prices by age group.
export function ratesMap(db, hotelId) {
  const rates = new Map(db.prepare('select * from rate_plans where hotel_id = ?').all(hotelId).map((r) => [r.id, { ...r, childPrices: {} }]));
  const rows = db.prepare('select cp.* from rate_child_prices cp join rate_plans r on r.id = cp.rate_id where r.hotel_id = ?').all(hotelId);
  for (const cp of rows) if (rates.has(cp.rate_id)) rates.get(cp.rate_id).childPrices[cp.group_id] = cp.price;
  return rates;
}

export function extrasTotal(extras, chosenIds, nights, guests) {
  const lines = [];
  for (const e of extras) {
    if (!chosenIds.includes(e.id)) continue;
    const qty = e.per === 'stay' ? 1 : e.per === 'night' ? nights : nights * guests;
    lines.push({ id: e.id, name: e.name, price: e.price, qty, per: e.per, sum: e.price * qty });
  }
  return { lines, total: lines.reduce((s, l) => s + l.sum, 0) };
}

// Restrictions for a stay in one category: closed nights, min stay, no arrival on
// the check-in day (CTA), no departure on the check-out day (CTD).
function restrictionOf(db, room, query, rows) {
  const left = Math.min(...rows.map((r) => (r.closed ? 0 : r.available)));
  const minStay = Math.max(...rows.map((r) => r.min_stay));
  ensureInventory(db, room, [query.checkout]);
  const out = db.prepare('select ctd from inventory where room_type_id = ? and date = ?').get(room.id, query.checkout);
  return { left: Math.max(left, 0), minStay, cta: Boolean(rows[0] && rows[0].cta), ctd: Boolean(out && out.ctd) };
}

// All offers for a search: one entry per room type with rate options.
export function searchOffers(db, hotel, query) {
  const nights = nightsOf(query.checkin, query.checkout);
  const guests = query.adults + query.children;
  const promo = findPromo(db, hotel.id, query.promo);
  const rooms = db.prepare('select * from room_types where hotel_id = ? and active = 1 and hourly = 0 and total_rooms > 0 order by sort, id').all(hotel.id);
  const all = ratesMap(db, hotel.id);
  const groups = childGroups(db, hotel.id);
  const rates = [...all.values()].filter((r) => r.active).sort((a, b) => a.id - b.id);
  const inv = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ? order by date');
  const offers = rooms.map((room) => {
    ensureInventory(db, room, nights);
    const rows = inv.all(room.id, query.checkin, query.checkout);
    const r = restrictionOf(db, room, query, rows);
    const pl = placement(room, query.adults, query.children, query.ages, groups);
    let reason = null;
    if (!pl.fits) reason = 'capacity';
    else if (r.left <= 0) reason = 'sold_out';
    else if (nights.length < r.minStay) reason = 'min_stay';
    else if (r.cta) reason = 'cta';
    else if (r.ctd) reason = 'ctd';
    const nightly = rows.map((x) => x.price);
    const rateOffers = rates.map((rate) => ({ rate, price: priceStay({ nightly, rate, rates: all, room, adults: query.adults, children: query.children, ages: query.ages, groups, promo, hotel }) }));
    return { room, left: r.left, minStay: r.minStay, reason, available: !reason, rates: rateOffers };
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

export function segmentsOf(db, bookingId) {
  return db.prepare('select * from stay_segments where booking_id = ? order by start').all(bookingId);
}

// Creates a booking atomically. Throws BookingError when it cannot be placed.
// staff bookings may sell closed dates, ignore restrictions and pick a specific physical room.
export function createBooking(db, hotel, input) {
  const {
    query, roomId, rateId, extraIds = [], guest, payment = 'hotel', idemKey, source = 'site',
    staff = false, physicalRoomId = null, priceOverride = null, createdBy = null, channelRef = null, autoRoom = false,
  } = input;
  return tx(db, () => {
    if (idemKey) {
      const dup = db.prepare('select * from bookings where idem_key = ?').get(idemKey);
      if (dup) return dup;
    }
    const room = db.prepare('select * from room_types where id = ? and hotel_id = ? and active = 1').get(roomId, hotel.id);
    const rates = ratesMap(db, hotel.id);
    const rate = rates.get(Number(rateId));
    if (!room || !rate || !rate.active) throw new BookingError('not_found', 'Такой номер или тариф больше не продаётся');
    const groups = childGroups(db, hotel.id);
    const ages = query.ages || [];
    const pl = placement(room, query.adults, query.children, ages, groups);
    if (!pl.fits) throw new BookingError('capacity', 'В этот номер столько гостей не поместится, даже с дополнительными местами');
    const nights = nightsOf(query.checkin, query.checkout);
    ensureInventory(db, room, nights);
    const rows = db.prepare('select * from inventory where room_type_id = ? and date >= ? and date < ? order by date').all(room.id, query.checkin, query.checkout);
    if (rows.length !== nights.length || rows.some((r) => r.available <= 0 || (r.closed && !staff))) {
      throw new BookingError('sold_out', staff ? 'На эти даты в категории нет свободных номеров' : 'Пока вы заполняли форму, номера на эти даты закончились');
    }
    if (!staff) {
      const r = restrictionOf(db, room, query, rows);
      if (nights.length < r.minStay) throw new BookingError('min_stay', 'На эти даты действует минимальный срок проживания');
      if (r.cta) throw new BookingError('cta', 'В этот день заезд не принимается');
      if (r.ctd) throw new BookingError('ctd', 'В этот день выезд не принимается');
    }
    let physical = null;
    if (physicalRoomId) {
      physical = db.prepare('select * from rooms where id = ? and hotel_id = ? and room_type_id = ? and active = 1').get(physicalRoomId, hotel.id, room.id);
      if (!physical) throw new BookingError('room', 'Этот номер не относится к выбранной категории');
      if (!roomIsFree(db, physical.id, query.checkin, query.checkout)) throw new BookingError('room_busy', `Номер ${physical.number} на эти даты занят`);
    } else if (hotel.placement_mode !== 'manual' || autoRoom) {
      // "manual" mode leaves new bookings in the "Без номера" row for the front desk to place.
      physical = findFreeRoom(db, room.id, query.checkin, query.checkout);
    }
    const promo = findPromo(db, hotel.id, query.promo);
    const price = priceStay({ nightly: rows.map((r) => r.price), rate, rates, room, adults: query.adults, children: query.children, ages, groups, promo, hotel });
    if (Number.isInteger(priceOverride) && priceOverride >= 0) {
      price.stay = priceOverride;
      price.tax = taxFor(hotel, priceOverride, nights.length);
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
    const r = db.prepare(`insert into bookings (code, idem_key, hotel_id, room_type_id, rate_plan_id, checkin, checkout, adults, children,
      guest_name, guest_email, guest_phone, comment, extras, promo_code, nights_total, extras_total, discount_total, extra_beds_total, tax_total, total,
      payment, paid, paid_amount, source, created_by, channel_ref, children_ages)
      values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, idemKey || null, hotel.id, room.id, rate.id, query.checkin, query.checkout, query.adults, query.children,
      guest.name, guest.email || '', guest.phone, guest.comment || '', JSON.stringify(ex.lines), promo ? promo.code : null,
      price.stay, ex.total, Math.max(0, price.rateDiscount) + price.promoDiscount, price.extraBeds, price.tax, total,
      payment === 'card' ? 'card' : 'hotel', prepaid >= total ? 1 : 0, prepaid, source, createdBy, channelRef, JSON.stringify(ages),
    );
    const id = Number(r.lastInsertRowid);
    db.prepare('insert into stay_segments (booking_id, hotel_id, room_type_id, room_id, start, end) values (?,?,?,?,?,?)')
      .run(id, hotel.id, room.id, physical ? physical.id : null, query.checkin, query.checkout);
    if (prepaid) db.prepare("insert into payments (booking_id, amount, method, note) values (?, ?, 'online', 'Предоплата при бронировании (тест)')").run(id, prepaid);
    logToChannels(db, hotel.id, 'booking', `Бронь ${code}: ${room.name}, ${query.checkin} – ${query.checkout}, наличие обновлено`, source);
    // First line of the change history: who created the booking and from where.
    const ch = db.prepare('select name from channels where hotel_id = ? and code = ?').get(hotel.id, source);
    const staffName = createdBy ? (db.prepare('select name from users where id = ?').get(createdBy) || {}).name : null;
    const author = staffName || (source === 'site' ? 'гость (сайт)' : ch ? `канал ${ch.name}` : 'система');
    db.prepare('insert into booking_events (booking_id, hotel_id, user_id, user_name, what, new_value) values (?,?,?,?,?,?)')
      .run(id, hotel.id, createdBy, author, 'Бронь создана', `${room.name}, ${query.checkin} — ${query.checkout}, ${total.toLocaleString('ru-RU')} ₽`);
    return db.prepare('select * from bookings where id = ?').get(id);
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

// Nights sold per category: "typeId:date" -> count, for a list of segments.
function soldNights(segs) {
  const m = new Map();
  for (const s of segs) for (const d of nightsOf(s.start, s.end)) m.set(`${s.room_type_id}:${d}`, (m.get(`${s.room_type_id}:${d}`) || 0) + 1);
  return m;
}

// Applies the difference between two sets of segments to inventory.
// Nights that are no longer sold come back; new nights must be available.
function shiftInventory(db, before, after, { staff = true } = {}) {
  const a = soldNights(before);
  const b = soldNights(after);
  const inc = db.prepare('update inventory set available = available + ? where room_type_id = ? and date = ?');
  const dec = db.prepare('update inventory set available = available - 1 where room_type_id = ? and date = ? and available > 0' + (staff ? '' : ' and closed = 0'));
  for (const [k, n] of a) {
    const diff = n - (b.get(k) || 0);
    if (diff > 0) { const [t, d] = k.split(':'); inc.run(diff, Number(t), d); }
  }
  for (const [k, n] of b) {
    for (let i = (a.get(k) || 0); i < n; i++) {
      const [t, d] = k.split(':');
      const type = db.prepare('select * from room_types where id = ?').get(Number(t));
      ensureInventory(db, type, [d]);
      if (dec.run(type.id, d).changes !== 1) throw new BookingError('sold_out', `В категории «${type.name}» нет свободных номеров на ${d.split('-').reverse().join('.')}`);
    }
  }
}

function returnInventory(db, b) {
  if (b.start_at) return; // hourly categories have no nightly inventory
  shiftInventory(db, segmentsOf(db, b.id), []);
}

// Joins neighbouring segments that ended up in the same room and category.
function mergeSegments(db, bookingId) {
  const segs = segmentsOf(db, bookingId);
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1], b = segs[i];
    if (a.end === b.start && a.room_id === b.room_id && a.room_type_id === b.room_type_id) {
      db.prepare('update stay_segments set end = ? where id = ?').run(b.end, a.id);
      db.prepare('delete from stay_segments where id = ?').run(b.id);
      b.start = a.start;
      b.id = a.id;
    }
  }
  const first = segmentsOf(db, bookingId)[0];
  if (first) db.prepare('update bookings set room_type_id = ? where id = ?').run(first.room_type_id, bookingId);
}

function liveBooking(db, booking) {
  const b = db.prepare('select * from bookings where id = ?').get(booking.id);
  if (['cancelled', 'no_show', 'checked_out'].includes(b.status)) throw new BookingError('state', 'Закрытую или отменённую бронь менять нельзя');
  if (b.start_at) throw new BookingError('hourly', 'Это почасовая бронь — меняйте её через «Изменить время»');
  return b;
}

function targetRoom(db, b, roomId, start, end) {
  const target = db.prepare('select * from rooms where id = ? and hotel_id = ? and active = 1').get(roomId, b.hotel_id);
  if (!target) throw new BookingError('room', 'Номер не найден');
  if (target.status === 'repair') throw new BookingError('room', `Номер ${target.number} на ремонте`);
  if (!roomIsFree(db, target.id, start, end, b.id)) throw new BookingError('room_busy', `Номер ${target.number} на эти даты занят`);
  const type = db.prepare('select * from room_types where id = ?').get(target.room_type_id);
  if (!placement(type, b.adults, b.children, JSON.parse(b.children_ages || '[]'), childGroups(db, b.hotel_id)).fits) throw new BookingError('capacity', `В номер ${target.number} не поместятся ${b.adults + b.children} гостей`);
  return target;
}

// Moves one part of a stay to another physical room (or takes the room away).
// Moving to another category moves the sold nights too. The price stays as booked.
export function moveSegment(db, booking, segmentId, targetRoomId, { reprice = null } = {}) {
  return tx(db, () => {
    const b = liveBooking(db, booking);
    const seg = db.prepare('select * from stay_segments where id = ? and booking_id = ?').get(segmentId, b.id);
    if (!seg) throw new BookingError('segment', 'Часть проживания не найдена');
    if (!targetRoomId) {
      db.prepare('update stay_segments set room_id = null where id = ?').run(seg.id);
    } else {
      const target = targetRoom(db, b, targetRoomId, seg.start, seg.end);
      if (target.room_type_id !== seg.room_type_id) {
        shiftInventory(db, [seg], [{ ...seg, room_type_id: target.room_type_id }]);
        // reprice = hotel: the moved nights are charged at the new category's price.
        if (reprice) repriceNights(db, reprice, b, seg.start, seg.end, target.room_type_id);
      }
      db.prepare('update stay_segments set room_id = ?, room_type_id = ? where id = ?').run(target.id, target.room_type_id, seg.id);
    }
    mergeSegments(db, b.id);
    return db.prepare('select * from bookings where id = ?').get(b.id);
  });
}

// Replaces the price of nights [start, end) with the rate's price in another category.
function repriceNights(db, hotel, b, start, end, typeId) {
  const fresh = db.prepare('select * from bookings where id = ?').get(b.id);
  const n = diffDays(fresh.checkin, fresh.checkout);
  const moved = nightsOf(start, end);
  const rates = ratesMap(db, fresh.hotel_id);
  const rate = rates.get(fresh.rate_plan_id);
  const room = db.prepare('select * from room_types where id = ?').get(typeId);
  ensureInventory(db, room, moved);
  const nightly = moved.map((d) => db.prepare('select price from inventory where room_type_id = ? and date = ?').get(typeId, d).price);
  const ages = JSON.parse(fresh.children_ages || '[]');
  const groups = childGroups(db, fresh.hotel_id);
  const newPart = priceStay({ nightly, rate, rates, room, adults: fresh.adults, children: fresh.children, ages, groups }).stay;
  const stay = Math.round(fresh.nights_total - (fresh.nights_total / n) * moved.length) + newPart;
  updateMoney(db, hotel, fresh, stay, rate, ages, groups);
}

// Writes a new accommodation price and recalculates tax and total.
export function updateMoney(db, hotel, b, stay, rate, ages, groups) {
  const n = diffDays(b.checkin, b.checkout);
  if (b.start_at) {
    // Hourly stay: no meals by the night; tax counts one day.
    const tax = taxFor(hotel, stay, 1);
    const total = stay + tax + b.extras_total;
    db.prepare('update bookings set nights_total = ?, tax_total = ?, total = ?, paid = ? where id = ?').run(stay, tax, total, b.paid_amount >= total ? 1 : 0, b.id);
    return;
  }
  const meals = priceStay({ nightly: Array(n).fill(0), rate: { ...rate, adjust_value: 0, discount_pct: 0, single_discount: 0 }, room: { capacity: 99, extra_beds: 99 }, adults: b.adults, children: b.children, ages, groups }).meals;
  const tax = taxFor(hotel, Math.max(0, stay - meals), n);
  const total = stay + tax + b.extras_total;
  db.prepare('update bookings set nights_total = ?, tax_total = ?, total = ?, paid = ? where id = ?').run(stay, tax, total, b.paid_amount >= total ? 1 : 0, b.id);
}

// Whole-booking move, kept for single-segment stays (the common case).
export function moveBooking(db, booking, targetRoomId) {
  const segs = segmentsOf(db, booking.id);
  if (segs.length !== 1) throw new BookingError('segment', 'Проживание разбито на части — переселяйте каждую часть отдельно');
  return moveSegment(db, booking, segs[0].id, targetRoomId);
}

// Splits the part of the stay that contains `date` and moves the rest of it,
// from `date` on, to another room: "nights before in 201, from Friday in 305".
export function splitStay(db, booking, date, targetRoomId) {
  return tx(db, () => {
    const b = liveBooking(db, booking);
    const seg = db.prepare('select * from stay_segments where booking_id = ? and start < ? and end > ?').get(b.id, date, date);
    if (!seg) throw new BookingError('split', 'Дата переселения должна быть внутри проживания, не в день заезда и не в день выезда');
    const target = targetRoom(db, b, targetRoomId, date, seg.end);
    if (target.id === seg.room_id) throw new BookingError('split', 'Гость уже живёт в этом номере');
    const tail = { ...seg, start: date, room_type_id: target.room_type_id };
    if (target.room_type_id !== seg.room_type_id) shiftInventory(db, [{ ...seg, start: date }], [tail]);
    db.prepare('update stay_segments set end = ? where id = ?').run(date, seg.id);
    db.prepare('insert into stay_segments (booking_id, hotel_id, room_type_id, room_id, start, end) values (?,?,?,?,?,?)')
      .run(b.id, b.hotel_id, target.room_type_id, target.id, date, seg.end);
    mergeSegments(db, b.id);
    return db.prepare('select * from bookings where id = ?').get(b.id);
  });
}

// Changes the dates of a stay. Kept nights keep their booked price; added nights are
// priced by the booking's rate at today's prices; removed nights come off the bill.
// A guest who is already in house can only change the check-out date.
export function changeDates(db, hotel, booking, checkin, checkout, { keepPrice = false } = {}) {
  return tx(db, () => {
    const b = liveBooking(db, booking);
    if (!isIsoDate(checkin) || !isIsoDate(checkout) || checkout <= checkin) throw new BookingError('dates', 'Выезд должен быть позже заезда');
    if (diffDays(checkin, checkout) > MAX_NIGHTS_STAFF) throw new BookingError('dates', `Не больше ${MAX_NIGHTS_STAFF} ночей`);
    if (b.status === 'checked_in' && checkin !== b.checkin) throw new BookingError('dates', 'Гость уже заселён — можно менять только дату выезда');
    if (checkin === b.checkin && checkout === b.checkout) return b;
    const before = segmentsOf(db, b.id);
    // Clip parts to the new range, stretch the first and last part to its edges.
    let after = before.map((s) => ({ ...s, start: s.start < checkin ? checkin : s.start, end: s.end > checkout ? checkout : s.end })).filter((s) => s.end > s.start);
    if (!after.length) after = [{ ...before[0], start: checkin, end: checkout }];
    after[0].start = checkin;
    after[after.length - 1].end = checkout;
    for (const s of after) {
      if (s.room_id && !roomIsFree(db, s.room_id, s.start, s.end, b.id)) {
        const n = db.prepare('select number from rooms where id = ?').get(s.room_id).number;
        throw new BookingError('room_busy', `Номер ${n} занят на новые даты — сначала переселите соседнюю бронь или выберите другой номер`);
      }
    }
    shiftInventory(db, before, after);
    // Price: old nights at their average booked price, new nights at the rate.
    const oldN = diffDays(b.checkin, b.checkout);
    const kept = nightsOf(checkin, checkout).filter((d) => d >= b.checkin && d < b.checkout);
    const added = after.flatMap((s) => nightsOf(s.start, s.end).filter((d) => d < b.checkin || d >= b.checkout).map((d) => ({ d, type: s.room_type_id })));
    const rates = ratesMap(db, b.hotel_id);
    const rate = rates.get(b.rate_plan_id);
    const groups = childGroups(db, b.hotel_id);
    const ages = JSON.parse(b.children_ages || '[]');
    let addedStay = 0;
    for (const { d, type } of added) {
      const room = db.prepare('select * from room_types where id = ?').get(type);
      const inv = db.prepare('select price from inventory where room_type_id = ? and date = ?').get(type, d);
      addedStay += priceStay({ nightly: [inv.price], rate, rates, room, adults: b.adults, children: b.children, ages, groups }).stay;
    }
    // keepPrice: the guest keeps paying the booked price per night, whatever today's prices are.
    const stay = keepPrice ? Math.round((b.nights_total / oldN) * diffDays(checkin, checkout)) : Math.round((b.nights_total / oldN) * kept.length) + addedStay;
    const n = diffDays(checkin, checkout);
    const meals = priceStay({ nightly: Array(n).fill(0), rate: { ...rate, adjust_value: 0, discount_pct: 0, single_discount: 0 }, room: { capacity: 99, extra_beds: 99 }, adults: b.adults, children: b.children, ages, groups }).meals;
    const tax = taxFor(hotel, Math.max(0, stay - meals), n);
    const lines = JSON.parse(b.extras || '[]').map((l) => {
      const qty = l.per === 'night' ? n : l.per === 'guest_night' ? n * (b.adults + b.children) : l.qty;
      return { ...l, qty, sum: l.price * qty };
    });
    const extrasSum = lines.reduce((s, l) => s + l.sum, 0);
    const total = stay + tax + extrasSum;
    db.prepare(`update bookings set checkin = ?, checkout = ?, nights_total = ?, tax_total = ?, extras = ?, extras_total = ?, total = ?, paid = ?
      where id = ?`).run(checkin, checkout, stay, tax, JSON.stringify(lines), extrasSum, total, b.paid_amount >= total ? 1 : 0, b.id);
    db.prepare('delete from stay_segments where booking_id = ?').run(b.id);
    const ins = db.prepare('insert into stay_segments (booking_id, hotel_id, room_type_id, room_id, start, end) values (?,?,?,?,?,?)');
    for (const s of after) ins.run(b.id, b.hotel_id, s.room_type_id, s.room_id, s.start, s.end);
    mergeSegments(db, b.id);
    logToChannels(db, b.hotel_id, 'update', `Изменены даты ${b.code}: ${checkin} – ${checkout}, наличие обновлено`);
    return db.prepare('select * from bookings where id = ?').get(b.id);
  });
}

class DryRun extends Error {
  constructor(result) {
    super('dry run');
    this.result = result;
  }
}

function summary(db, bookingId) {
  const b = db.prepare('select * from bookings where id = ?').get(bookingId);
  const rooms = db.prepare(`select s.start, s.end, r.number, t.name as type_name from stay_segments s
    left join rooms r on r.id = s.room_id join room_types t on t.id = s.room_type_id where s.booking_id = ? order by s.start`).all(bookingId);
  return { checkin: b.checkin, checkout: b.checkout, total: b.total, nights_total: b.nights_total, rooms };
}

// One drag on the chessboard: a part of the stay goes to another room and/or the whole
// stay shifts in time. Not-yet-arrived guests can move freely; a guest in house can only
// change room, which splits the stay from today. dryRun returns before/after without saving.
export function relocate(db, hotel, booking, { segmentId, roomId, checkin, checkout, keepPrice = true, today, dryRun = false }) {
  try {
    return tx(db, () => {
      const b = liveBooking(db, booking);
      const before = summary(db, b.id);
      const datesChange = (checkin && checkin !== b.checkin) || (checkout && checkout !== b.checkout);
      const segs = segmentsOf(db, b.id);
      const seg = segs.find((x) => x.id === Number(segmentId)) || segs[0];
      if (b.status === 'checked_in') {
        if (datesChange && checkin !== b.checkin) throw new BookingError('state', 'Гость уже заселён — даты переносить нельзя, можно только переселить или продлить');
        if (datesChange) changeDates(db, hotel, b, b.checkin, checkout, { keepPrice });
        if (roomId && roomId !== seg.room_id) {
          if (today > seg.start && today < seg.end) splitStay(db, b, today, roomId);
          else moveSegment(db, b, seg.id, roomId, { reprice: keepPrice ? null : hotel });
        }
      } else {
        if (datesChange) {
          if (segs.length > 1) throw new BookingError('segment', 'Проживание разбито на части — меняйте даты в карточке брони');
          changeDates(db, hotel, b, checkin || b.checkin, checkout || b.checkout, { keepPrice });
        }
        const now = segmentsOf(db, b.id).find((x) => x.start <= (seg.start > (checkin || seg.start) ? seg.start : (checkin || seg.start)) && x.end > (checkin || seg.start)) || segmentsOf(db, b.id)[0];
        if (roomId !== undefined && roomId !== now.room_id) moveSegment(db, b, now.id, roomId || null, { reprice: keepPrice ? null : hotel });
      }
      const result = { before, after: summary(db, b.id) };
      if (dryRun) throw new DryRun(result);
      return result;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.result;
    throw e;
  }
}

// Places bookings from the "Без номера" row of one hotel into free rooms, earliest first.
export function assignUnassigned(db, hotelId) {
  return tx(db, () => {
    const segs = db.prepare(`select s.* from stay_segments s join bookings b on b.id = s.booking_id
      where s.hotel_id = ? and s.room_id is null and b.status in ('confirmed','checked_in') order by s.start, s.id`).all(hotelId);
    let placed = 0;
    for (const seg of segs) {
      const r = findFreeRoom(db, seg.room_type_id, seg.start, seg.end, seg.booking_id);
      if (r) { db.prepare('update stay_segments set room_id = ? where id = ?').run(r.id, seg.id); placed++; }
    }
    return { placed, left: segs.length - placed };
  });
}

export function addPayment(db, booking, amount, method, note = '', userId = null, kind = 'payment', refBookingId = null, invoiceId = null) {
  return tx(db, () => {
    db.prepare('insert into payments (booking_id, amount, method, note, created_by, kind, ref_booking_id, invoice_id) values (?,?,?,?,?,?,?,?)').run(booking.id, amount, method, note, userId, kind, refBookingId, invoiceId);
    return recalcPaid(db, booking.id);
  });
}

// Paid = payments minus refunds and transfers out, voided entries left out.
// A deposit is security money: it is kept apart and never counts as payment.
export const DEPOSIT_KINDS = "('deposit','deposit_return')";
export function recalcPaid(db, bookingId) {
  const sum = db.prepare(`select coalesce(sum(amount),0) s from payments where booking_id = ? and voided = 0 and kind not in ${DEPOSIT_KINDS}`).get(bookingId).s;
  const total = db.prepare('select total from bookings where id = ?').get(bookingId).total;
  db.prepare('update bookings set paid_amount = ?, paid = ? where id = ?').run(sum, sum >= total ? 1 : 0, bookingId);
  return db.prepare('select * from bookings where id = ?').get(bookingId);
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
