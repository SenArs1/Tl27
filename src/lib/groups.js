import crypto from 'node:crypto';
import { tx } from '../db.js';
import { BookingError, createBooking, cancelBooking, addPayment, recalcPaid } from './booking.js';
import { logEvent } from './card.js';
import { BOOKING_LIST } from './scope.js';

const LIVE = "('confirmed','checked_in','checked_out')";

function newGroupCode(db) {
  for (;;) {
    const code = 'GR-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    if (!db.prepare('select 1 from booking_groups where code = ?').get(code)) return code;
  }
}

export function validateGroup(body) {
  const errors = {};
  const g = {
    name: String(body.name || '').trim().slice(0, 120),
    contact_name: String(body.contact_name || '').trim().slice(0, 120),
    phone: String(body.phone || '').trim().slice(0, 40),
    email: String(body.email || '').trim().toLowerCase().slice(0, 200),
    customer_inn: String(body.customer_inn || '').replace(/\D/g, ''),
    comment: String(body.comment || '').trim().slice(0, 1000),
  };
  if (g.name.length < 2) errors.name = 'Назовите группу, например «Свадьба Ивановых»';
  if (g.contact_name.length < 2) errors.contact_name = 'Укажите контактное лицо';
  if (g.phone.replace(/\D/g, '').length < 10) errors.phone = 'Нужен телефон, хотя бы 10 цифр';
  if (g.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) errors.email = 'Проверьте адрес почты';
  if (g.customer_inn && ![10, 12].includes(g.customer_inn.length)) errors.customer_inn = 'ИНН — 10 или 12 цифр';
  return { g, errors };
}

// Creates the group and one booking per room, all or nothing.
// rows: [{ typeId, count, adults }]
export function createGroup(db, hotel, g, { query, rateId, rows }, user) {
  return tx(db, () => {
    const total = rows.reduce((s, r) => s + r.count, 0);
    if (!total) throw new BookingError('rows', 'Добавьте хотя бы один номер');
    if (total > 50) throw new BookingError('rows', 'Не больше 50 номеров в одной группе');
    const code = newGroupCode(db);
    const id = Number(db.prepare(`insert into booking_groups (hotel_id, code, name, contact_name, phone, email, customer_inn, comment)
      values (?,?,?,?,?,?,?,?)`).run(hotel.id, code, g.name, g.contact_name, g.phone, g.email, g.customer_inn, g.comment).lastInsertRowid);
    let n = 0;
    for (const row of rows) {
      for (let i = 0; i < row.count; i++) {
        n++;
        let b;
        try {
          b = createBooking(db, hotel, {
            query: { ...query, adults: row.adults, children: 0, ages: [] }, roomId: row.typeId, rateId,
            guest: { name: `${g.name} · гость ${n}`, phone: g.phone, email: g.email, comment: '' },
            source: 'extranet', staff: true, createdBy: user ? user.id : null,
          });
        } catch (e) {
          if (e instanceof BookingError) throw new BookingError(e.code, `Номер ${n} из ${total}: ${e.message}`);
          throw e;
        }
        db.prepare('update bookings set group_id = ?, customer_name = ?, customer_phone = ?, customer_inn = ? where id = ?')
          .run(id, g.name, g.phone, g.customer_inn, b.id);
        logEvent(db, b, user, 'Добавлена в группу', '', `${code} «${g.name}»`);
      }
    }
    return id;
  });
}

export function groupMembers(db, group) {
  return db.prepare(`${BOOKING_LIST} and b.group_id = ? order by b.checkin, b.id`).all(group.hotel_id, group.id);
}

export function groupTotals(members) {
  const live = members.filter((m) => !['cancelled', 'no_show'].includes(m.status));
  const total = live.reduce((s, m) => s + m.total, 0);
  const paid = members.reduce((s, m) => s + m.paid_amount, 0);
  const from = live.length ? live.map((m) => m.checkin).sort()[0] : null;
  const to = live.length ? live.map((m) => m.checkout).sort().at(-1) : null;
  return { rooms: live.length, guests: live.reduce((s, m) => s + m.adults + m.children, 0), total, paid, debt: total - paid, from, to };
}

export function listGroups(db, hotelId) {
  return db.prepare(`select g.*,
      (select count(*) from bookings b where b.group_id = g.id and b.status in ${LIVE}) as rooms,
      (select min(checkin) from bookings b where b.group_id = g.id and b.status in ${LIVE}) as checkin,
      (select max(checkout) from bookings b where b.group_id = g.id and b.status in ${LIVE}) as checkout,
      (select coalesce(sum(total),0) from bookings b where b.group_id = g.id and b.status in ${LIVE}) as total,
      (select coalesce(sum(paid_amount),0) from bookings b where b.group_id = g.id) as paid
    from booking_groups g where g.hotel_id = ? order by checkin is null, checkin desc, g.id desc`).all(hotelId);
}

// One payment from the organiser spread over the rooms' debts, earliest first.
export function payGroup(db, group, amount, method, user) {
  return tx(db, () => {
    const members = groupMembers(db, group).filter((m) => !['cancelled', 'no_show'].includes(m.status) && m.total > m.paid_amount);
    const debt = members.reduce((s, m) => s + m.total - m.paid_amount, 0);
    if (!(amount > 0)) throw new BookingError('amount', 'Укажите сумму');
    if (amount > debt) throw new BookingError('amount', `Сумма больше долга группы: ${debt.toLocaleString('ru-RU')} ₽`);
    let left = amount;
    for (const m of members) {
      if (!left) break;
      const part = Math.min(left, m.total - m.paid_amount);
      addPayment(db, m, part, method, `Оплата группы ${group.code}`, user ? user.id : null);
      logEvent(db, m, user, 'Оплата группы', '', `${part.toLocaleString('ru-RU')} ₽ из ${amount.toLocaleString('ru-RU')} ₽`);
      left -= part;
    }
    return amount;
  });
}

// Cancels every room that has not checked in yet.
export function cancelGroup(db, group, user) {
  return tx(db, () => {
    let n = 0;
    for (const m of groupMembers(db, group)) {
      if (m.status !== 'confirmed') continue;
      cancelBooking(db, m);
      logEvent(db, m, user, 'Статус', 'подтверждена', 'отменена (отмена группы)');
      n++;
    }
    return n;
  });
}

export function attachBooking(db, group, b, user) {
  if (!b || b.hotel_id !== group.hotel_id) throw new BookingError('booking', 'Бронь с таким номером не найдена в этом объекте');
  if (b.group_id === group.id) throw new BookingError('booking', 'Бронь уже в этой группе');
  if (b.group_id) throw new BookingError('booking', 'Бронь уже входит в другую группу');
  db.prepare('update bookings set group_id = ? where id = ?').run(group.id, b.id);
  logEvent(db, b, user, 'Добавлена в группу', '', `${group.code} «${group.name}»`);
}

export function detachBooking(db, group, b, user) {
  if (!b || b.group_id !== group.id) throw new BookingError('booking', 'Бронь не входит в группу');
  db.prepare('update bookings set group_id = null where id = ?').run(b.id);
  logEvent(db, b, user, 'Исключена из группы', `${group.code} «${group.name}»`, '');
  recalcPaid(db, b.id);
}
