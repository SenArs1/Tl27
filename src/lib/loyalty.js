import crypto from 'node:crypto';
import { tx } from '../db.js';
import { BookingError, addPayment } from './booking.js';
import { logEvent } from './card.js';

// Levels used when a hotel turns the program on and has none yet.
export const DEFAULT_LEVELS = [
  ['Базовый', 0, 0, 5],
  ['Серебряный', 50000, 5, 7],
  ['Золотой', 150000, 10, 10],
];

const rubs = (n) => `${Number(n).toLocaleString('ru-RU')}`;

export function levelsOf(db, hotelId) {
  return db.prepare('select * from loyalty_levels where hotel_id = ? order by min_spent, id').all(hotelId);
}

export function ensureLevels(db, hotelId) {
  if (levelsOf(db, hotelId).length) return;
  const ins = db.prepare('insert into loyalty_levels (hotel_id, name, min_spent, discount_pct, earn_pct) values (?,?,?,?,?)');
  for (const l of DEFAULT_LEVELS) ins.run(hotelId, ...l);
}

// The highest level the money spent reaches, and the next one to aim for.
export function levelFor(levels, spent) {
  let current = { name: 'Участник', min_spent: 0, discount_pct: 0, earn_pct: 0 };
  let next = null;
  for (const l of levels) {
    if (spent >= l.min_spent) current = l;
    else { next = l; break; }
  }
  return { level: current, next, toNext: next ? next.min_spent - spent : 0 };
}

export function memberStatus(db, member) {
  return { ...member, ...levelFor(levelsOf(db, member.hotel_id), member.spent) };
}

export const normEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 200);
export const normCard = (v) => String(v || '').replace(/\D/g, '').slice(0, 12);

export function findMember(db, hotelId, { card, email }) {
  const c = normCard(card);
  const e = normEmail(email);
  if (!c || !e) return null;
  return db.prepare('select * from loyalty_members where hotel_id = ? and card_no = ? and email = ?').get(hotelId, c, e) || null;
}

export function memberById(db, hotelId, id) {
  return db.prepare('select * from loyalty_members where id = ? and hotel_id = ?').get(Number(id) || 0, hotelId) || null;
}

// A ledger line and the new balance in one step.
function post(db, member, kind, points, note, { bookingId = null, user = null } = {}) {
  db.prepare('insert into loyalty_tx (hotel_id, member_id, booking_id, kind, points, note, user_name) values (?,?,?,?,?,?,?)')
    .run(member.hotel_id, member.id, bookingId, kind, points, note, user ? user.name : '');
  db.prepare('update loyalty_members set points = points + ? where id = ?').run(points, member.id);
}

export function historyOfMember(db, memberId) {
  return db.prepare(`select t.*, b.code from loyalty_tx t left join bookings b on b.id = t.booking_id where t.member_id = ? order by t.id desc`).all(memberId);
}

export function validateMember(body) {
  const errors = {};
  const m = { name: String(body.name || '').trim().slice(0, 120), email: normEmail(body.email), phone: String(body.phone || '').trim().slice(0, 40) };
  if (m.name.length < 2) errors.name = 'Как к вам обращаться?';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) errors.email = 'Проверьте адрес почты';
  if (m.phone && m.phone.replace(/\D/g, '').length < 10) errors.phone = 'Телефон — хотя бы 10 цифр';
  return { m, errors };
}

// New member with a card number; welcome points if the hotel gives them.
export function enroll(db, hotel, m, user = null) {
  return tx(db, () => {
    if (db.prepare('select 1 from loyalty_members where hotel_id = ? and email = ?').get(hotel.id, m.email)) {
      throw new BookingError('exists', 'Эта почта уже в программе');
    }
    let card;
    do card = String(crypto.randomInt(10000000, 99999999));
    while (db.prepare('select 1 from loyalty_members where hotel_id = ? and card_no = ?').get(hotel.id, card));
    const id = Number(db.prepare('insert into loyalty_members (hotel_id, card_no, name, email, phone) values (?,?,?,?,?)')
      .run(hotel.id, card, m.name, m.email, m.phone || '').lastInsertRowid);
    const member = db.prepare('select * from loyalty_members where id = ?').get(id);
    if (hotel.loyalty_welcome > 0) post(db, member, 'welcome', hotel.loyalty_welcome, 'Приветственные баллы', { user });
    return db.prepare('select * from loyalty_members where id = ?').get(id);
  });
}

// Most points that may go towards a booking now.
export function redeemLimit(hotel, member, b, used = 0) {
  const byShare = Math.floor((b.total * (hotel.loyalty_redeem_pct || 0)) / 100);
  return Math.max(0, Math.min(member.points, byShare - used, b.total - b.paid_amount));
}

const usedOn = (db, bookingId) => db.prepare("select coalesce(sum(amount),0) s from payments where booking_id = ? and kind = 'points' and voided = 0").get(bookingId).s;

// Pays part of the booking with points: 1 point = 1 ₽.
export function redeem(db, hotel, b, member, points, user = null) {
  return tx(db, () => {
    const fresh = db.prepare('select * from bookings where id = ?').get(b.id);
    const m = db.prepare('select * from loyalty_members where id = ?').get(member.id);
    if (!hotel.loyalty_on) throw new BookingError('loyalty', 'Программа лояльности выключена');
    if (fresh.member_id !== m.id) throw new BookingError('loyalty', 'Бронь не привязана к этому участнику');
    if (['cancelled', 'no_show'].includes(fresh.status)) throw new BookingError('state', 'Бронь отменена');
    const limit = redeemLimit(hotel, m, fresh, usedOn(db, fresh.id));
    if (!(points > 0)) throw new BookingError('points', 'Укажите, сколько баллов списать');
    if (points > limit) throw new BookingError('points', `Списать можно до ${rubs(limit)} баллов: баллами оплачивается не больше ${hotel.loyalty_redeem_pct}% брони и не больше долга`);
    post(db, m, 'redeem', -points, `Оплата брони ${fresh.code}`, { bookingId: fresh.id, user });
    addPayment(db, fresh, points, 'online', `Баллы ${hotel.loyalty_name}`, user ? user.id : null, 'points');
    logEvent(db, fresh, user, 'Оплата баллами', '', `${rubs(points)} баллов, карта ${m.card_no}`);
    return db.prepare('select * from bookings where id = ?').get(fresh.id);
  });
}

// Points paid on a booking go back to the member (cancellation or a voided points payment).
export function returnPoints(db, b, amount, why, user = null) {
  if (!b.member_id || !(amount > 0)) return;
  const m = db.prepare('select * from loyalty_members where id = ?').get(b.member_id);
  if (m) post(db, m, 'return', amount, why, { bookingId: b.id, user });
}

// Called inside cancelBooking: points spent on the booking are returned.
export function releaseOnCancel(db, b) {
  const pays = db.prepare("select * from payments where booking_id = ? and kind = 'points' and voided = 0").all(b.id);
  for (const p of pays) {
    db.prepare("update payments set voided = 1, void_reason = 'Бронь отменена, баллы возвращены' where id = ?").run(p.id);
    returnPoints(db, b, p.amount, `Отмена брони ${b.code}`);
  }
}

// Check-out: points for the stay (the part not paid with points) and money spent towards the level.
export function earnOnCheckout(db, hotel, booking, user = null) {
  const b = db.prepare('select * from bookings where id = ?').get(booking.id);
  if (!hotel.loyalty_on || !b.member_id || b.points_earned) return 0;
  const m = db.prepare('select * from loyalty_members where id = ?').get(b.member_id);
  if (!m) return 0;
  const { level } = levelFor(levelsOf(db, hotel.id), m.spent);
  const base = Math.max(0, b.nights_total - usedOn(db, b.id));
  const points = Math.floor((base * (level.earn_pct || 0)) / 100);
  db.prepare('update loyalty_members set spent = spent + ?, stays = stays + 1 where id = ?').run(b.nights_total, m.id);
  if (points > 0) post(db, m, 'earn', points, `Проживание ${b.code}, уровень «${level.name}» ${level.earn_pct}%`, { bookingId: b.id, user });
  // -1: the stay was counted but earned no points (level with 0%).
  db.prepare('update bookings set points_earned = ? where id = ?').run(points > 0 ? points : -1, b.id);
  return points;
}

// Undo of a check-out takes back what it gave.
export function revertEarn(db, booking, user = null) {
  const b = db.prepare('select * from bookings where id = ?').get(booking.id);
  if (!b.member_id || !b.points_earned) return;
  const m = db.prepare('select * from loyalty_members where id = ?').get(b.member_id);
  if (m) {
    db.prepare('update loyalty_members set spent = max(0, spent - ?), stays = max(0, stays - 1) where id = ?').run(b.nights_total, m.id);
    if (b.points_earned > 0) post(db, m, 'revert', -b.points_earned, `Отмена выселения ${b.code}`, { bookingId: b.id, user });
  }
  db.prepare('update bookings set points_earned = 0 where id = ?').run(b.id);
}

export function adjust(db, member, points, reason, user) {
  return tx(db, () => {
    if (!Number.isInteger(points) || points === 0) throw new BookingError('points', 'Укажите количество баллов, например 500 или −300');
    if (String(reason || '').trim().length < 3) throw new BookingError('reason', 'Укажите причину');
    const m = db.prepare('select * from loyalty_members where id = ?').get(member.id);
    if (m.points + points < 0) throw new BookingError('points', `На счёте ${rubs(m.points)} баллов — столько списать нельзя`);
    post(db, m, 'adjust', points, reason, { user });
    return db.prepare('select * from loyalty_members where id = ?').get(m.id);
  });
}

export function linkBooking(db, b, member, user) {
  if (member.hotel_id !== b.hotel_id) throw new BookingError('member', 'Участник не найден');
  if (b.member_id && b.member_id !== member.id && usedOn(db, b.id) > 0) throw new BookingError('member', 'По брони уже списаны баллы другого участника');
  db.prepare('update bookings set member_id = ? where id = ?').run(member.id, b.id);
  logEvent(db, b, user, 'Участник программы лояльности', '', `${member.name}, карта ${member.card_no}`);
}

export function unlinkBooking(db, b, user) {
  if (usedOn(db, b.id) > 0) throw new BookingError('member', 'По брони списаны баллы — сначала аннулируйте оплату баллами');
  if (b.points_earned) throw new BookingError('member', 'Баллы за проживание уже начислены');
  db.prepare('update bookings set member_id = null where id = ?').run(b.id);
  logEvent(db, b, user, 'Участник программы лояльности', 'привязан', 'отвязан');
}

// Leaving the program removes the member's personal data; bookings stay, without the link.
export function removeMember(db, member) {
  return tx(db, () => {
    db.prepare('update bookings set member_id = null where member_id = ?').run(member.id);
    db.prepare('delete from loyalty_members where id = ?').run(member.id);
  });
}

export function pointsUsedOn(db, bookingId) {
  return usedOn(db, bookingId);
}
