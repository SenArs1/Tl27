import { tx } from '../db.js';
import { BookingError, DEPOSIT_KINDS } from './booking.js';
import { logEvent } from './card.js';

// Bill lines of a booking with stable keys: stay, tax, extra:<index>.
export function billLines(b) {
  const out = [{ key: 'stay', name: 'Проживание', sum: b.nights_total }];
  JSON.parse(b.extras || '[]').forEach((l, i) => out.push({ key: `extra:${i}`, name: `${l.name} × ${l.qty}`, sum: l.sum }));
  if (b.tax_total) out.push({ key: 'tax', name: 'Туристический налог', sum: b.tax_total });
  return out;
}

const paidOn = (db, bookingId, invoiceId) => db.prepare(`select coalesce(sum(amount),0) s from payments
  where booking_id = ? and voided = 0 and kind not in ${DEPOSIT_KINDS} and ${invoiceId ? 'invoice_id = ?' : 'invoice_id is null'}`)
  .get(...(invoiceId ? [bookingId, invoiceId] : [bookingId])).s;

// All invoices of a booking, the main one first. The main invoice holds every line
// no other invoice took and is addressed to the customer (or the guest).
export function invoicesOf(db, b) {
  const lines = billLines(b);
  const extra = db.prepare('select * from invoices where booking_id = ? order by id').all(b.id);
  const taken = new Set();
  const others = extra.map((inv) => {
    const keys = JSON.parse(inv.items || '[]');
    const own = lines.filter((l) => keys.includes(l.key) && !taken.has(l.key));
    own.forEach((l) => taken.add(l.key));
    return { ...inv, main: false, lines: own };
  });
  const main = {
    id: null, main: true, number: `${b.code}-1`,
    payer_name: b.customer_name || b.guest_name, payer_inn: b.customer_inn || '',
    lines: lines.filter((l) => !taken.has(l.key)),
  };
  return [main, ...others].map((inv) => {
    const total = inv.lines.reduce((s, l) => s + l.sum, 0);
    const paid = paidOn(db, b.id, inv.id);
    return { ...inv, total, paid, debt: total - paid };
  });
}

export function findInvoice(db, b, id) {
  if (!id || id === 'main') return invoicesOf(db, b)[0];
  return invoicesOf(db, b).find((i) => i.id === Number(id)) || null;
}

// Moves the chosen lines to a new invoice for another payer.
export function createInvoice(db, b, { payerName, payerInn, keys }, user) {
  return tx(db, () => {
    const name = String(payerName || '').trim().slice(0, 120);
    const inn = String(payerInn || '').replace(/\D/g, '');
    if (name.length < 2) throw new BookingError('payer', 'Укажите плательщика');
    if (inn && ![10, 12].includes(inn.length)) throw new BookingError('inn', 'ИНН — 10 или 12 цифр');
    const main = invoicesOf(db, b)[0];
    const free = new Set(main.lines.map((l) => l.key));
    const chosen = [...new Set(keys)].filter((k) => free.has(k));
    if (!chosen.length) throw new BookingError('items', 'Отметьте строки, которые оплатит этот плательщик');
    if (chosen.length === main.lines.length) throw new BookingError('items', 'На основном счёте должна остаться хотя бы одна строка — или просто укажите заказчика в брони');
    const n = db.prepare('select count(*) n from invoices where booking_id = ?').get(b.id).n + 2;
    const number = `${b.code}-${n}`;
    const r = db.prepare('insert into invoices (booking_id, hotel_id, number, payer_name, payer_inn, items) values (?,?,?,?,?,?)')
      .run(b.id, b.hotel_id, number, name, inn, JSON.stringify(chosen));
    const names = main.lines.filter((l) => chosen.includes(l.key)).map((l) => l.name).join(', ');
    logEvent(db, b, user, 'Выставлен отдельный счёт', '', `${number}, ${name}: ${names}`);
    return Number(r.lastInsertRowid);
  });
}

// Lines go back to the main invoice. Not allowed while the invoice has payments.
export function deleteInvoice(db, b, id, user) {
  return tx(db, () => {
    const inv = db.prepare('select * from invoices where id = ? and booking_id = ?').get(id, b.id);
    if (!inv) throw new BookingError('invoice', 'Счёт не найден');
    if (paidOn(db, b.id, inv.id) !== 0 || db.prepare('select 1 from payments where invoice_id = ? and voided = 0').get(inv.id)) {
      throw new BookingError('invoice', 'По счёту есть платежи — сначала аннулируйте или верните их');
    }
    db.prepare('update payments set invoice_id = null where invoice_id = ?').run(inv.id);
    db.prepare('delete from invoices where id = ?').run(inv.id);
    logEvent(db, b, user, 'Отдельный счёт удалён', `${inv.number}, ${inv.payer_name}`, 'строки вернулись на основной счёт');
  });
}

// After a service line is removed the following extra:<i> keys shift down by one.
export function shiftExtraKeys(db, bookingId, removed) {
  for (const inv of db.prepare('select * from invoices where booking_id = ?').all(bookingId)) {
    const keys = JSON.parse(inv.items || '[]').flatMap((k) => {
      const m = /^extra:(\d+)$/.exec(k);
      if (!m) return [k];
      const i = Number(m[1]);
      return i === removed ? [] : [i > removed ? `extra:${i - 1}` : k];
    });
    db.prepare('update invoices set items = ? where id = ?').run(JSON.stringify(keys), inv.id);
  }
}
