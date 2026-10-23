import crypto from 'node:crypto';
import { tx } from '../db.js';
import { BookingError, taxFor, recalcPaid, logToChannels } from './booking.js';
import { addDays, isIsoDate, todayIn, timeIn } from './dates.js';
import { logEvent } from './card.js';

// Times are the hotel's local wall clock: "YYYY-MM-DD HH:MM".
const LIVE = "('confirmed','checked_in','checked_out')";
export const toMin = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const abs = (stamp) => Date.parse(`${stamp.replace(' ', 'T')}:00Z`) / 60000;
const stampOf = (minutes) => new Date(minutes * 60000).toISOString().slice(0, 16).replace('T', ' ');
export const hoursLabel = (h) => `${h} ч`;
export const isAllDay = (type) => type.open_from === '00:00' && type.open_to === '24:00';

// Start and length of an hourly stay from a form or a query string.
export function parseHourly(q, hotel = {}, { staff = false, now = new Date() } = {}) {
  const errors = {};
  const date = String(q.date || '');
  const start = String(q.start || '');
  const hours = Number.parseInt(q.hours ?? '', 10);
  const today = todayIn(hotel.timezone, now);
  if (!isIsoDate(date)) errors.date = 'Укажите дату';
  else if (date < (staff ? addDays(today, -7) : today)) errors.date = 'Эта дата уже прошла';
  else if (date > addDays(today, 365)) errors.date = 'Не дальше чем на год вперёд';
  if (!Number.isFinite(toMin(start)) || toMin(start) % 30 || toMin(start) >= 24 * 60) errors.start = 'Время начала — с шагом 30 минут, например 14:00 или 14:30';
  else if (!staff && date === today && toMin(start) < toMin(timeIn(hotel.timezone, now))) errors.start = 'Это время сегодня уже прошло';
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) errors.hours = 'Сколько часов: от 1 до 24';
  if (Object.keys(errors).length) return { ok: false, errors, query: { date, start, hours: Number.isInteger(hours) ? hours : '' } };
  const startAt = `${date} ${start}`;
  return { ok: true, errors, query: { date, start, hours, startAt, endAt: stampOf(abs(startAt) + hours * 60) } };
}

// Rules of the category: open hours, minimum and maximum length.
export function ruleError(type, q) {
  if (!type.hourly) return 'Эта категория продаётся по ночам';
  if (q.hours < type.min_hours) return `Минимум ${hoursLabel(type.min_hours)}`;
  if (q.hours > type.max_hours) return `Максимум ${hoursLabel(type.max_hours)}`;
  if (isAllDay(type)) return null;
  const s = toMin(q.start), e = s + q.hours * 60;
  if (s < toMin(type.open_from) || e > toMin(type.open_to)) return `Почасовые брони — с ${type.open_from} до ${type.open_to}`;
  return null;
}

// Another booking of the room overlaps, counting the cleaning gap after each guest.
export function conflictOf(db, type, roomId, startAt, endAt, exceptId = 0) {
  const s = abs(startAt), e = abs(endAt), gap = type.buffer_min || 0;
  const near = db.prepare(`select b.id, b.code, b.start_at, b.end_at from bookings b join stay_segments g on g.booking_id = b.id
    where g.room_id = ? and b.start_at is not null and b.status in ${LIVE} and b.id != ? and b.checkin between ? and ?`)
    .all(roomId, exceptId, addDays(startAt.slice(0, 10), -2), addDays(endAt.slice(0, 10), 1));
  return near.find((o) => abs(o.start_at) < e + gap && abs(o.end_at) + gap > s) || null;
}

export function roomsOf(db, type) {
  return db.prepare("select * from rooms where room_type_id = ? and active = 1 and status != 'repair' order by sort, number").all(type.id);
}

export function freeRoom(db, type, startAt, endAt) {
  return roomsOf(db, type).find((r) => !conflictOf(db, type, r.id, startAt, endAt)) || null;
}

export const priceOf = (type, hours) => type.hour_price * hours;

// Hourly offers for the booking engine.
export function hourlyOffers(db, hotel, q, guests = 1) {
  const types = db.prepare('select * from room_types where hotel_id = ? and active = 1 and hourly = 1 and total_rooms > 0 order by sort, id').all(hotel.id);
  return types.map((type) => {
    let reason = ruleError(type, q);
    if (!reason && guests > type.capacity + type.extra_beds) reason = 'Столько гостей не поместится';
    if (!reason && !freeRoom(db, type, q.startAt, q.endAt)) reason = 'На это время всё занято';
    return { type, price: priceOf(type, q.hours), available: !reason, reason };
  });
}

function baseRate(db, hotelId) {
  return db.prepare('select * from rate_plans where hotel_id = ? and active = 1 order by parent_id is not null, id').get(hotelId)
    || db.prepare('select * from rate_plans where hotel_id = ? order by id').get(hotelId);
}

export function createHourly(db, hotel, input) {
  const { typeId, roomId = null, q, guest, adults = 1, source = 'site', staff = false, priceOverride = null, createdBy = null, idemKey = null, user = null } = input;
  return tx(db, () => {
    if (idemKey) {
      const dup = db.prepare('select * from bookings where idem_key = ?').get(idemKey);
      if (dup) return dup;
    }
    const type = db.prepare('select * from room_types where id = ? and hotel_id = ? and active = 1').get(typeId, hotel.id);
    if (!type || !type.hourly) throw new BookingError('not_found', 'Эта категория не продаётся по часам');
    const err = ruleError(type, q);
    if (err && !staff) throw new BookingError('rules', err);
    if (q.hours > 24) throw new BookingError('rules', 'Не больше 24 часов');
    if (adults < 1 || adults > type.capacity + type.extra_beds) throw new BookingError('capacity', 'Столько гостей не поместится');
    let room;
    if (roomId) {
      room = db.prepare('select * from rooms where id = ? and room_type_id = ? and active = 1').get(roomId, type.id);
      if (!room) throw new BookingError('room', 'Этот номер не относится к выбранной категории');
      const c = conflictOf(db, type, room.id, q.startAt, q.endAt);
      if (c) throw new BookingError('busy', `Номер ${room.number} занят: бронь ${c.code}, ${c.start_at.slice(11)}–${c.end_at.slice(11)} (с учётом ${type.buffer_min} мин на уборку)`);
    } else {
      room = freeRoom(db, type, q.startAt, q.endAt);
      if (!room) throw new BookingError('busy', staff ? 'На это время свободных номеров категории нет' : 'Пока вы заполняли форму, это время заняли');
    }
    const rate = baseRate(db, hotel.id);
    if (!rate) throw new BookingError('not_found', 'В объекте нет тарифа');
    const stay = Number.isInteger(priceOverride) && priceOverride >= 0 ? priceOverride : priceOf(type, q.hours);
    const tax = taxFor(hotel, stay, 1);
    const code = 'SR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    // checkout is the next day for every hourly stay: the table requires checkout > checkin.
    const checkout = addDays(q.date, 1);
    const r = db.prepare(`insert into bookings (code, idem_key, hotel_id, room_type_id, rate_plan_id, checkin, checkout, adults, children,
      guest_name, guest_email, guest_phone, comment, extras, nights_total, extras_total, tax_total, total, payment, source, created_by, start_at, end_at)
      values (?,?,?,?,?,?,?,?,0,?,?,?,?,'[]',?,0,?,?,'hotel',?,?,?,?)`).run(
      code, idemKey, hotel.id, type.id, rate.id, q.date, checkout, adults,
      guest.name, guest.email || '', guest.phone, guest.comment || '', stay, tax, stay + tax, source, createdBy, q.startAt, q.endAt);
    const id = Number(r.lastInsertRowid);
    // The stay part ties the booking to its room for lists, history and housekeeping.
    db.prepare('insert into stay_segments (booking_id, hotel_id, room_type_id, room_id, start, end) values (?,?,?,?,?,?)').run(id, hotel.id, type.id, room.id, q.date, addDays(q.date, 1));
    const b = db.prepare('select * from bookings where id = ?').get(id);
    logEvent(db, b, user, 'Бронь создана', '', `по часам: ${q.date.split('-').reverse().join('.')} ${q.start}–${q.endAt.slice(11)}, № ${room.number}`);
    logToChannels(db, hotel.id, 'booking', `Почасовая бронь ${code}: ${type.name}, ${q.startAt}–${q.endAt.slice(11)}`, source);
    return b;
  });
}

// New time (and room) for an hourly booking. The price follows the length unless keepPrice.
export function changeTime(db, hotel, booking, { q, roomId = null, keepPrice = false }, user) {
  return tx(db, () => {
    const b = db.prepare('select * from bookings where id = ?').get(booking.id);
    if (!b.start_at) throw new BookingError('hourly', 'Это не почасовая бронь');
    if (!['confirmed', 'checked_in'].includes(b.status)) throw new BookingError('state', 'Закрытую или отменённую бронь менять нельзя');
    if (b.status === 'checked_in' && q.startAt !== b.start_at) throw new BookingError('state', 'Гость уже заехал — можно изменить только длительность');
    const type = db.prepare('select * from room_types where id = ?').get(b.room_type_id);
    const seg = db.prepare('select * from stay_segments where booking_id = ?').get(b.id);
    const room = db.prepare('select * from rooms where id = ? and room_type_id = ? and active = 1').get(roomId || seg.room_id, type.id);
    if (!room) throw new BookingError('room', 'Номер не найден в этой категории');
    if (q.hours > 24) throw new BookingError('rules', 'Не больше 24 часов');
    const c = conflictOf(db, type, room.id, q.startAt, q.endAt, b.id);
    if (c) throw new BookingError('busy', `Номер ${room.number} занят: бронь ${c.code}, ${c.start_at.slice(11)}–${c.end_at.slice(11)} (с учётом ${type.buffer_min} мин на уборку)`);
    const oldText = `${b.start_at.slice(0, 10).split('-').reverse().join('.')} ${b.start_at.slice(11)}–${b.end_at.slice(11)}`;
    db.prepare('update bookings set start_at = ?, end_at = ?, checkin = ?, checkout = ? where id = ?').run(q.startAt, q.endAt, q.date, addDays(q.date, 1), b.id);
    db.prepare('update stay_segments set room_id = ?, start = ?, end = ? where id = ?').run(room.id, q.date, addDays(q.date, 1), seg.id);
    logEvent(db, b, user, 'Время', oldText, `${q.date.split('-').reverse().join('.')} ${q.start}–${q.endAt.slice(11)}`);
    if (room.id !== seg.room_id) {
      const old = db.prepare('select number from rooms where id = ?').get(seg.room_id);
      logEvent(db, b, user, 'Номер', old ? old.number : '', room.number);
    }
    if (!keepPrice) {
      const stay = priceOf(type, q.hours);
      if (stay !== b.nights_total) {
        const tax = taxFor(hotel, stay, 1);
        db.prepare('update bookings set nights_total = ?, tax_total = ?, total = ? where id = ?').run(stay, tax, stay + tax + b.extras_total, b.id);
        logEvent(db, b, user, 'Стоимость проживания', `${b.nights_total.toLocaleString('ru-RU')} ₽`, `${stay.toLocaleString('ru-RU')} ₽`);
      }
    }
    return recalcPaid(db, b.id);
  });
}

// One day of hourly rooms: bookings that touch the day, cut to it, in minutes from midnight.
export function dayBoard(db, hotelId, date) {
  const rooms = db.prepare(`select r.*, t.name as type_name, t.open_from, t.open_to, t.buffer_min from rooms r join room_types t on t.id = r.room_type_id
    where r.hotel_id = ? and r.active = 1 and t.active = 1 and t.hourly = 1 order by t.sort, t.id, r.sort, r.number`).all(hotelId);
  const dayStart = abs(`${date} 00:00`);
  const list = db.prepare(`select b.*, g.room_id from bookings b join stay_segments g on g.booking_id = b.id
    where b.hotel_id = ? and b.start_at is not null and b.status in ('confirmed','checked_in','checked_out') and b.start_at < ? and b.end_at > ? order by b.start_at`)
    .all(hotelId, `${addDays(date, 1)} 00:00`, `${date} 00:00`);
  for (const b of list) {
    b.from = Math.max(0, abs(b.start_at) - dayStart);
    b.to = Math.min(24 * 60, abs(b.end_at) - dayStart);
  }
  const open = rooms.length ? Math.min(...rooms.map((r) => toMin(r.open_from))) : 8 * 60;
  const close = rooms.length ? Math.max(...rooms.map((r) => toMin(r.open_to))) : 23 * 60;
  return { rooms: rooms.map((r) => ({ ...r, bookings: list.filter((b) => b.room_id === r.id) })), open: Math.floor(open / 60) * 60, close: Math.ceil(close / 60) * 60 };
}

export const hoursOf = (b) => Math.round((abs(b.end_at) - abs(b.start_at)) / 60);

// "23.10.2026, 14:00–17:00, 3 ч" for an hourly booking; null for a nightly one.
export function whenOf(b, { short = false } = {}) {
  if (!b.start_at) return null;
  const d = b.start_at.slice(0, 10).split('-').reverse();
  const day = short ? `${d[0]}.${d[1]}` : d.join('.');
  return `${day}, ${b.start_at.slice(11)}–${b.end_at.slice(11)}, ${hoursOf(b)} ч`;
}
