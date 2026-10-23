import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { createBooking, addPayment } from '../src/lib/booking.js';
import { addService, removeService, refund, depositBalance, takeDeposit, returnDeposit, retainDeposit, voidPayment } from '../src/lib/card.js';
import { invoicesOf, createInvoice, deleteInvoice } from '../src/lib/invoices.js';
import { createGroup, groupMembers, groupTotals, payGroup, cancelGroup, attachBooking } from '../src/lib/groups.js';
import { startApp, login, form, stay, DEMO } from './helpers.js';

const guest = { name: 'Тест Семь', email: 't7@example.com', phone: '+79000000007' };
const user = { id: 1, name: 'Анна Демо' };

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  const std = db.prepare("select * from room_types where name = 'Стандарт'").get();
  const rate = db.prepare("select * from rate_plans where name = 'Гибкий'").get();
  const q = (offset, nights = 2, adults = 2) => ({ checkin: addDays(today(), offset), checkout: addDays(today(), offset + nights), adults, children: 0, promo: '' });
  const book = (offset = 10) => createBooking(db, hotel, { query: q(offset), roomId: std.id, rateId: rate.id, guest, staff: true, createdBy: 1 });
  const get = (id) => db.prepare('select * from bookings where id = ?').get(id);
  return { db, hotel, std, rate, q, book, get };
}

test('deposit is kept apart from paid amount; return and retain', () => {
  const { db, book, get } = fresh();
  const b = book();
  takeDeposit(db, b, 3000, 'cash', user);
  assert.equal(depositBalance(db, b.id), 3000);
  assert.equal(get(b.id).paid_amount, 0, 'deposit does not pay the bill');
  assert.throws(() => returnDeposit(db, b, 5000, 'cash', user), /до 3/);
  retainDeposit(db, get(b.id), 500, 'damage', 'разбит стакан', user);
  const after = get(b.id);
  assert.equal(depositBalance(db, b.id), 2500);
  assert.equal(after.paid_amount, 500);
  assert.match(after.extras, /Возмещение ущерба: разбит стакан/);
  retainDeposit(db, after, 1000, 'debt', 'долг за проживание', user);
  assert.equal(get(b.id).paid_amount, 1500);
  returnDeposit(db, get(b.id), 1500, 'cash', user);
  assert.equal(depositBalance(db, b.id), 0);
  const dep = db.prepare("select * from payments where booking_id = ? and kind = 'deposit'").get(b.id);
  assert.throws(() => voidPayment(db, get(b.id), dep.id, 'ошибка', user), /залога/);
});

test('split invoices: lines move to a payer, payments count per invoice, keys survive service removal', () => {
  const { db, book, get } = fresh();
  const b0 = book();
  addService(db, b0, { name: 'Парковка', price: 500, qty: 2 }, user);
  addService(db, get(b0.id), { name: 'Мини-бар', price: 300, qty: 1 }, user);
  let b = get(b0.id);
  assert.equal(invoicesOf(db, b).length, 1);
  assert.throws(() => createInvoice(db, b, { payerName: 'ООО Ромашка', keys: [] }, user), /Отметьте/);
  assert.throws(() => createInvoice(db, b, { payerName: 'ООО Ромашка', payerInn: '123', keys: ['stay'] }, user), /ИНН/);
  const all = invoicesOf(db, b)[0].lines.map((l) => l.key);
  assert.throws(() => createInvoice(db, b, { payerName: 'ООО Ромашка', keys: all }, user), /хотя бы одна строка/);
  const id = createInvoice(db, b, { payerName: 'ООО Ромашка', payerInn: '7701234567', keys: ['stay', 'extra:1'] }, user);
  let [main, firm] = invoicesOf(db, b);
  assert.equal(firm.id, id);
  assert.equal(firm.number, `${b.code}-2`);
  assert.deepEqual(firm.lines.map((l) => l.key), ['stay', 'extra:1']);
  assert.deepEqual(main.lines.map((l) => l.key).filter((k) => k !== 'tax'), ['extra:0']);
  assert.equal(main.total + firm.total, b.total);
  addPayment(db, b, 1000, 'cash', '', 1, 'payment', null, null);
  addPayment(db, b, 2000, 'transfer', '', 1, 'payment', null, id);
  [main, firm] = invoicesOf(db, get(b.id));
  assert.equal(main.paid, 1000);
  assert.equal(firm.paid, 2000);
  assert.equal(get(b.id).paid_amount, 3000);
  assert.throws(() => deleteInvoice(db, b, id, user), /платежи/);
  assert.throws(() => refund(db, get(b.id), 2500, 'cash', 'возврат фирме', user, id), /оплачено 2/);
  // Removing the parking line shifts the mini-bar to extra:0; it stays on the firm invoice.
  removeService(db, get(b.id), 0, user);
  b = get(b.id);
  [main, firm] = invoicesOf(db, b);
  assert.deepEqual(firm.lines.map((l) => l.name), ['Проживание', 'Мини-бар × 1']);
  assert.equal(main.lines.length, b.tax_total ? 1 : 0);
});

test('group: rooms created all-or-nothing, one payment spread, cancel together', () => {
  const { db, hotel, std, rate, q, book, get } = fresh();
  const g = { name: 'Конференция Север', contact_name: 'Ольга', phone: '+79001112233', email: '', customer_inn: '', comment: '' };
  const free = db.prepare('select count(*) n from rooms where room_type_id = ? and active = 1').get(std.id).n;
  const before = db.prepare('select count(*) n from bookings').get().n;
  assert.throws(() => createGroup(db, hotel, g, { query: q(40), rateId: rate.id, rows: [{ typeId: std.id, count: free + 1, adults: 2 }] }, user), /из/);
  assert.equal(db.prepare('select count(*) n from bookings').get().n, before, 'nothing left behind');
  assert.equal(db.prepare('select count(*) n from booking_groups').get().n, 0);
  const id = createGroup(db, hotel, g, { query: q(40), rateId: rate.id, rows: [{ typeId: std.id, count: 2, adults: 1 }] }, user);
  const group = db.prepare('select * from booking_groups where id = ?').get(id);
  let members = groupMembers(db, group);
  assert.equal(members.length, 2);
  assert.ok(members.every((m) => m.customer_name === g.name && m.adults === 1));
  const t = groupTotals(members);
  payGroup(db, group, members[0].total + 100, 'transfer', user);
  members = groupMembers(db, group);
  assert.equal(members[0].paid_amount, members[0].total);
  assert.equal(members[1].paid_amount, 100);
  assert.throws(() => payGroup(db, group, t.total, 'cash', user), /больше долга/);
  const solo = book(60);
  attachBooking(db, group, get(solo.id), user);
  assert.throws(() => attachBooking(db, group, get(solo.id), user), /уже в этой/);
  assert.throws(() => attachBooking(db, group, { ...get(solo.id), hotel_id: 999 }, user), /не найдена/);
  assert.equal(cancelGroup(db, group, user), 3);
  assert.ok(groupMembers(db, group).every((m) => m.status === 'cancelled'));
});

test('HTTP: housekeeping and investor see only their part; groups and invoices work end to end', async () => {
  const app = await startApp();
  try {
    const { cookie, csrf } = await login(app.base);
    const post = (path, body, c = cookie, k = csrf) => fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie: c, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ _csrf: k, ...body }) });
    // Two staff with limited roles.
    const pw = {};
    for (const [role, email] of [['housekeeping', 'maid@example.com'], ['investor', 'inv@example.com']]) {
      const r = await post('/app/settings/team', { name: role, email, role });
      pw[role] = decodeURIComponent(r.headers.get('location').split('pw=')[1]);
    }
    const as = async (email, password) => {
      const r = await fetch(`${app.base}/app/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }) });
      return r.headers.get('set-cookie').split(';')[0];
    };
    const maid = await as('maid@example.com', pw.housekeeping);
    let r = await fetch(`${app.base}/app/bookings`, { headers: { cookie: maid }, redirect: 'manual' });
    assert.ok([302, 303].includes(r.status));
    assert.equal(r.headers.get('location'), '/app/housekeeping');
    const board = await (await fetch(`${app.base}/app/housekeeping`, { headers: { cookie: maid } })).text();
    assert.match(board, /Уборка/);
    assert.doesNotMatch(board, /\+7|₽|Журнал броней/);
    const inv = await as('inv@example.com', pw.investor);
    assert.equal((await fetch(`${app.base}/app/reports?tab=occupancy`, { headers: { cookie: inv } })).status, 200);
    assert.equal((await fetch(`${app.base}/app/reports?tab=tax`, { headers: { cookie: inv } })).status, 403);
    assert.equal((await fetch(`${app.base}/app/bookings`, { headers: { cookie: inv } })).status, 403);
    assert.equal((await fetch(`${app.base}/app/chess`, { headers: { cookie: inv } })).status, 403);

    // A group of two rooms through the form.
    const type = app.db.prepare("select * from room_types where name = 'Стандарт'").get();
    const rate = app.db.prepare("select * from rate_plans where name = 'Гибкий'").get();
    const s = stay(70, 2);
    r = await post('/app/groups', { name: 'Свадьба Ивановых', contact_name: 'Мария', phone: '+7 900 123-45-67', rate: rate.id, ...s, [`count_${type.id}`]: 2, [`adults_${type.id}`]: 2 });
    assert.equal(r.status, 303);
    const gUrl = r.headers.get('location').split('?')[0];
    const page = await (await fetch(`${app.base}${gUrl}`, { headers: { cookie } })).text();
    assert.match(page, /Свадьба Ивановых/);
    assert.equal((page.match(/href="\/app\/bookings\/\d+"/g) || []).length, 2);
    r = await post('/app/groups', { name: 'Пусто', contact_name: 'Мария', phone: '+7 900 123-45-67', rate: rate.id, ...s });
    assert.equal(r.status, 422);
    const journal = await (await fetch(`${app.base}/app/bookings`, { headers: { cookie } })).text();
    assert.match(journal, /группа <a href="\/app\/groups\/\d+">GR-/);

    // Split the bill of one member and pay the second invoice.
    const member = app.db.prepare('select * from bookings where group_id is not null order by id limit 1').get();
    await post(`/app/bookings/${member.id}/services`, { name: 'Ужин', price: 1500, qty: 1 });
    r = await post(`/app/bookings/${member.id}/invoices`, { payer_name: 'Мария Иванова', items: 'extra:0' });
    assert.equal(r.status, 303);
    const invId = app.db.prepare('select id from invoices where booking_id = ?').get(member.id).id;
    r = await post(`/app/bookings/${member.id}/pay`, { amount: 2000, method: 'cash', invoice: invId });
    assert.match(decodeURIComponent(r.headers.get('location')), /долга по счёту/);
    r = await post(`/app/bookings/${member.id}/pay`, { amount: 1500, method: 'cash', invoice: invId });
    assert.match(decodeURIComponent(r.headers.get('location')), /Оплата принята/);
    const doc = await (await fetch(`${app.base}/app/bookings/${member.id}/doc/invoice?inv=${invId}`, { headers: { cookie } })).text();
    assert.match(doc, /Мария Иванова/);
    assert.match(doc, /Ужин/);
    assert.doesNotMatch(doc, /Проживание/);

    // Another hotel cannot open the group.
    const other = await fetch(`${app.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hotel_name: 'Чужой отель', name: 'Пётр Чужой', email: 'other7@example.com', password: 'other-pass-123', property_type: 'hotel', rooms: '5', agree: 'on' }) });
    const oc = other.headers.get('set-cookie')?.split(';')[0];
    if (oc) assert.equal((await fetch(`${app.base}${gUrl}`, { headers: { cookie: oc } })).status, 404);
    assert.ok(DEMO.email);
  } finally {
    await app.close();
  }
});
