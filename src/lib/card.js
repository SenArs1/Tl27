import { tx } from '../db.js';
import { shiftExtraKeys, findInvoice } from './invoices.js';
import { returnPoints } from './loyalty.js';
import { BookingError, recalcPaid, addPayment, updateMoney, ratesMap, childGroups, extrasTotal, DEPOSIT_KINDS } from './booking.js';

export const PURPOSES = [['', 'не указана'], ['tourism', 'отдых и туризм'], ['business', 'командировка'], ['treatment', 'лечение'], ['event', 'мероприятие'], ['transit', 'транзит'], ['other', 'другое']];
export const TAG_COLORS = [['teal', 'бирюзовый'], ['violet', 'фиолетовый'], ['amber', 'янтарный'], ['rose', 'розовый'], ['blue', 'синий'], ['slate', 'серый']];

// One line of the change history.
export function logEvent(db, b, user, what, oldValue = '', newValue = '') {
  db.prepare('insert into booking_events (booking_id, hotel_id, user_id, user_name, what, old_value, new_value) values (?,?,?,?,?,?,?)')
    .run(b.id, b.hotel_id, user ? user.id : null, user ? user.name : 'система', what, String(oldValue ?? ''), String(newValue ?? ''));
}

export function historyOf(db, bookingId) {
  return db.prepare('select * from booking_events where booking_id = ? order by id desc').all(bookingId);
}

const reload = (db, id) => db.prepare('select * from bookings where id = ?').get(id);

// Money returned to the guest; never more than was paid.
export function refund(db, b, amount, method, reason, user, invoiceId = null) {
  return tx(db, () => {
    const fresh = reload(db, b.id);
    if (!(amount > 0)) throw new BookingError('amount', 'Укажите сумму возврата');
    if (amount > fresh.paid_amount) throw new BookingError('amount', `Вернуть можно не больше оплаченного: ${fresh.paid_amount.toLocaleString('ru-RU')} ₽`);
    const inv = invoiceId ? findInvoice(db, fresh, invoiceId) : null;
    if (invoiceId && !inv) throw new BookingError('invoice', 'Счёт не найден');
    if (inv && amount > inv.paid) throw new BookingError('amount', `По счёту ${inv.number} оплачено ${inv.paid.toLocaleString('ru-RU')} ₽`);
    if (String(reason || '').trim().length < 3) throw new BookingError('reason', 'Укажите причину возврата');
    addPayment(db, fresh, -amount, method, reason, user ? user.id : null, 'refund', null, inv ? inv.id : null);
    logEvent(db, fresh, user, 'Возврат', '', `${amount.toLocaleString('ru-RU')} ₽, ${reason}`);
    return reload(db, b.id);
  });
}

// A payment entered by mistake: kept in the list, crossed out, not counted.
export function voidPayment(db, b, paymentId, reason, user) {
  return tx(db, () => {
    const p = db.prepare('select * from payments where id = ? and booking_id = ?').get(paymentId, b.id);
    if (!p) throw new BookingError('payment', 'Платёж не найден');
    if (p.voided) throw new BookingError('payment', 'Платёж уже аннулирован');
    if (p.kind === 'transfer_in' || p.kind === 'transfer_out') throw new BookingError('payment', 'Перенос оплаты отменяется обратным переносом');
    if (p.kind === 'deposit_return') throw new BookingError('payment', 'Возврат залога не аннулируется — примите залог заново');
    if (String(reason || '').trim().length < 3) throw new BookingError('reason', 'Укажите причину');
    db.prepare('update payments set voided = 1, void_reason = ? where id = ?').run(reason, p.id);
    const after = recalcPaid(db, b.id);
    if (after.paid_amount < 0) throw new BookingError('payment', 'После аннулирования оплачено станет меньше нуля — сначала отмените возврат');
    if (depositBalance(db, b.id) < 0) throw new BookingError('payment', 'Часть залога уже возвращена или удержана — аннулировать нельзя');
    if (p.kind === 'points') returnPoints(db, b, p.amount, `Аннулирована оплата баллами: ${reason}`, user);
    logEvent(db, b, user, 'Платёж аннулирован', `${p.amount.toLocaleString('ru-RU')} ₽`, reason);
    return after;
  });
}

// Moves paid money to another booking of the same hotel (e.g. early departure → future stay).
export function transferPayment(db, b, target, amount, user) {
  return tx(db, () => {
    const from = reload(db, b.id);
    if (!target || target.hotel_id !== from.hotel_id) throw new BookingError('target', 'Бронь для переноса не найдена');
    if (target.id === from.id) throw new BookingError('target', 'Выберите другую бронь');
    if (!(amount > 0)) throw new BookingError('amount', 'Укажите сумму');
    if (amount > from.paid_amount) throw new BookingError('amount', `Перенести можно не больше оплаченного: ${from.paid_amount.toLocaleString('ru-RU')} ₽`);
    addPayment(db, from, -amount, 'transfer', `Перенос в бронь ${target.code}`, user ? user.id : null, 'transfer_out', target.id);
    addPayment(db, target, amount, 'transfer', `Перенос из брони ${from.code}`, user ? user.id : null, 'transfer_in', from.id);
    logEvent(db, from, user, 'Оплата перенесена', '', `${amount.toLocaleString('ru-RU')} ₽ → ${target.code}`);
    logEvent(db, target, user, 'Оплата перенесена', '', `${amount.toLocaleString('ru-RU')} ₽ ← ${from.code}`);
    return reload(db, b.id);
  });
}

function moneyContext(db, b) {
  const rates = ratesMap(db, b.hotel_id);
  return { rate: rates.get(b.rate_plan_id), ages: JSON.parse(b.children_ages || '[]'), groups: childGroups(db, b.hotel_id) };
}

// New accommodation price set by staff; tax and total follow.
export function setStayPrice(db, hotel, b, stay, reason, user) {
  return tx(db, () => {
    const fresh = reload(db, b.id);
    if (!Number.isInteger(stay) || stay < 0) throw new BookingError('price', 'Укажите стоимость проживания');
    if (String(reason || '').trim().length < 3) throw new BookingError('reason', 'Укажите причину изменения цены');
    const c = moneyContext(db, fresh);
    updateMoney(db, hotel, fresh, stay, c.rate, c.ages, c.groups);
    logEvent(db, fresh, user, `Стоимость проживания (${reason})`, `${fresh.nights_total.toLocaleString('ru-RU')} ₽`, `${stay.toLocaleString('ru-RU')} ₽`);
    return recalcPaid(db, b.id);
  });
}

// Discount on accommodation in percent or roubles.
export function applyDiscount(db, hotel, b, { pct = 0, sum = 0 }, reason, user) {
  return tx(db, () => {
    const fresh = reload(db, b.id);
    const d = pct ? Math.round((fresh.nights_total * pct) / 100) : sum;
    if (!(d > 0) || d > fresh.nights_total || pct > 100) throw new BookingError('discount', 'Скидка должна быть больше нуля и не больше стоимости проживания');
    if (String(reason || '').trim().length < 3) throw new BookingError('reason', 'Укажите причину скидки');
    const c = moneyContext(db, fresh);
    updateMoney(db, hotel, fresh, fresh.nights_total - d, c.rate, c.ages, c.groups);
    db.prepare('update bookings set discount_total = discount_total + ? where id = ?').run(d, b.id);
    logEvent(db, fresh, user, `Скидка${pct ? ` ${pct}%` : ''} (${reason})`, `${fresh.nights_total.toLocaleString('ru-RU')} ₽`, `${(fresh.nights_total - d).toLocaleString('ru-RU')} ₽`);
    return recalcPaid(db, b.id);
  });
}

function writeExtras(db, b, lines) {
  const sum = lines.reduce((s, l) => s + l.sum, 0);
  const total = b.nights_total + b.tax_total + sum;
  db.prepare('update bookings set extras = ?, extras_total = ?, total = ? where id = ?').run(JSON.stringify(lines), sum, total, b.id);
  return recalcPaid(db, b.id);
}

// Adds a service: from the hotel's list (its price and unit) or a one-off line.
export function addService(db, b, { extraId, name, price, qty }, user) {
  return tx(db, () => {
    const fresh = reload(db, b.id);
    const lines = JSON.parse(fresh.extras || '[]');
    let line;
    if (extraId) {
      const e = db.prepare('select * from extras where id = ? and hotel_id = ?').get(extraId, fresh.hotel_id);
      if (!e) throw new BookingError('service', 'Услуга не найдена');
      const nights = Math.round((Date.parse(fresh.checkout) - Date.parse(fresh.checkin)) / 86400000);
      line = extrasTotal([e], [e.id], nights, fresh.adults + fresh.children).lines[0];
      if (qty > 0) line = { ...line, qty, sum: line.price * qty };
    } else {
      const n = String(name || '').trim().slice(0, 80);
      if (n.length < 2 || !(price >= 0) || !(qty > 0)) throw new BookingError('service', 'Укажите название, цену и количество');
      line = { id: null, name: n, price, qty, per: 'stay', sum: price * qty };
    }
    lines.push(line);
    logEvent(db, fresh, user, 'Добавлена услуга', '', `${line.name} × ${line.qty} = ${line.sum.toLocaleString('ru-RU')} ₽`);
    return writeExtras(db, fresh, lines);
  });
}

export function removeService(db, b, index, user) {
  return tx(db, () => {
    const fresh = reload(db, b.id);
    const lines = JSON.parse(fresh.extras || '[]');
    if (!lines[index]) throw new BookingError('service', 'Услуга не найдена');
    const [gone] = lines.splice(index, 1);
    shiftExtraKeys(db, fresh.id, index);
    logEvent(db, fresh, user, 'Удалена услуга', `${gone.name} × ${gone.qty}`, '');
    return writeExtras(db, fresh, lines);
  });
}

export function tagsOf(db, bookingId) {
  return db.prepare('select t.* from booking_tags bt join hotel_tags t on t.id = bt.tag_id where bt.booking_id = ? order by t.name').all(bookingId);
}

export function setTags(db, b, tagIds, user) {
  return tx(db, () => {
    const before = tagsOf(db, b.id).map((t) => t.name).join(', ');
    const valid = db.prepare('select id from hotel_tags where hotel_id = ? and active = 1').all(b.hotel_id).map((t) => t.id);
    db.prepare('delete from booking_tags where booking_id = ?').run(b.id);
    for (const id of new Set(tagIds)) if (valid.includes(id)) db.prepare('insert into booking_tags (booking_id, tag_id) values (?, ?)').run(b.id, id);
    const after = tagsOf(db, b.id).map((t) => t.name).join(', ');
    if (before !== after) logEvent(db, b, user, 'Теги', before, after);
  });
}

export function notesOf(db, bookingId) {
  return db.prepare('select * from booking_notes where booking_id = ? order by done, coalesce(due_at, created_at)').all(bookingId);
}

const STATUS_RU = { confirmed: 'подтверждена', checked_in: 'проживает', checked_out: 'выехал', cancelled: 'отменена', no_show: 'незаезд' };

// Fields worth tracking, by their label in the history.
export function snapshot(db, bookingId) {
  const b = reload(db, bookingId);
  if (!b) return null;
  const rooms = db.prepare(`select group_concat(x, ' → ') r from (select coalesce(r.number, 'без номера') || ' (' || t.name || ')' x from stay_segments s
    left join rooms r on r.id = s.room_id join room_types t on t.id = s.room_type_id where s.booking_id = ? order by s.start)`).get(bookingId).r || '';
  const rub = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;
  return {
    b,
    fields: {
      'Статус': STATUS_RU[b.status] || b.status,
      'Даты': `${b.checkin.split('-').reverse().join('.')} — ${b.checkout.split('-').reverse().join('.')}`,
      'Номер': rooms,
      'Гости': `${b.adults} взр.${b.children ? `, ${b.children} дет.` : ''}`,
      'Проживание': rub(b.nights_total),
      'Услуги': rub(b.extras_total),
      'Итого': rub(b.total),
      'Оплачено': rub(b.paid_amount),
      'Гость': b.guest_name,
      'Телефон': b.guest_phone,
      'Почта': b.guest_email,
      'Заказчик': [b.customer_name, b.customer_phone, b.customer_inn ? `ИНН ${b.customer_inn}` : ''].filter(Boolean).join(', '),
      'Цель поездки': (PURPOSES.find(([k]) => k === b.purpose) || ['', b.purpose])[1],
      'Время заезда': b.arrival_time,
      'Время выезда': b.departure_time,
      'Заметка': b.comment,
    },
  };
}

// Writes one history line per changed field between two snapshots.
export function logDiff(db, before, after, user, prefix = '') {
  if (!before || !after) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(after.fields)) {
    if (before.fields[k] !== v) {
      logEvent(db, after.b, user, prefix ? `${prefix}: ${k}` : k, before.fields[k], v);
      n++;
    }
  }
  return n;
}

// Runs fn and records what it changed. Returns fn's result.
export function tracked(db, bookingId, user, prefix, fn) {
  const before = snapshot(db, bookingId);
  const out = fn();
  logDiff(db, before, snapshot(db, bookingId), user, prefix);
  return out;
}

// ---------- deposit ----------
export function depositBalance(db, bookingId) {
  return db.prepare(`select coalesce(sum(amount),0) s from payments where booking_id = ? and voided = 0 and kind in ${DEPOSIT_KINDS}`).get(bookingId).s;
}

export function takeDeposit(db, b, amount, method, user) {
  return tx(db, () => {
    if (!(amount > 0)) throw new BookingError('amount', 'Укажите сумму залога');
    addPayment(db, b, amount, method, 'Залог', user ? user.id : null, 'deposit');
    logEvent(db, b, user, 'Принят залог', '', `${amount.toLocaleString('ru-RU')} ₽`);
    return reload(db, b.id);
  });
}

export function returnDeposit(db, b, amount, method, user) {
  return tx(db, () => {
    const bal = depositBalance(db, b.id);
    if (!(amount > 0) || amount > bal) throw new BookingError('amount', `Вернуть можно до ${bal.toLocaleString('ru-RU')} ₽ залога`);
    addPayment(db, b, -amount, method, 'Возврат залога', user ? user.id : null, 'deposit_return');
    logEvent(db, b, user, 'Залог возвращён', '', `${amount.toLocaleString('ru-RU')} ₽`);
    return reload(db, b.id);
  });
}

// Keeps part of the deposit: towards the unpaid stay, or for damage (adds a charge to the bill).
export function retainDeposit(db, b, amount, purpose, reason, user) {
  return tx(db, () => {
    const bal = depositBalance(db, b.id);
    const fresh = reload(db, b.id);
    if (!(amount > 0) || amount > bal) throw new BookingError('amount', `Удержать можно до ${bal.toLocaleString('ru-RU')} ₽ залога`);
    if (String(reason || '').trim().length < 3) throw new BookingError('reason', 'Укажите причину удержания');
    if (purpose === 'damage') addService(db, fresh, { name: `Возмещение ущерба: ${reason}`.slice(0, 80), price: amount, qty: 1 }, user);
    else if (amount > fresh.total - fresh.paid_amount) throw new BookingError('amount', 'В счёт проживания можно удержать не больше долга по брони');
    addPayment(db, fresh, -amount, 'cash', `Удержано из залога: ${reason}`, user ? user.id : null, 'deposit_return');
    addPayment(db, fresh, amount, 'cash', `Из залога: ${reason}`, user ? user.id : null, 'payment');
    logEvent(db, fresh, user, 'Удержано из залога', '', `${amount.toLocaleString('ru-RU')} ₽, ${reason}`);
    return reload(db, b.id);
  });
}
