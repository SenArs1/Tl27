import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { createBooking, addPayment } from '../src/lib/booking.js';
import { refund, voidPayment, transferPayment, setStayPrice, applyDiscount, addService, removeService, setTags, tagsOf, historyOf, tracked } from '../src/lib/card.js';
import { startApp, form, stay } from './helpers.js';

const guest = { name: 'Тест Карточный', email: 't@example.com', phone: '+79000000000' };
const user = { id: 1, name: 'Анна Демо' };

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  const std = db.prepare("select * from room_types where name = 'Стандарт'").get();
  const rate = db.prepare("select * from rate_plans where name = 'Гибкий'").get();
  const book = (offset = 10, nights = 2) => createBooking(db, hotel, { query: { checkin: addDays(today(), offset), checkout: addDays(today(), offset + nights), adults: 2, children: 0, promo: '' }, roomId: std.id, rateId: rate.id, guest, staff: true, createdBy: 1 });
  const get = (id) => db.prepare('select * from bookings where id = ?').get(id);
  return { db, hotel, book, get };
}

test('creation is the first history line, with the author', () => {
  const { db, book } = fresh();
  const b = book();
  const h = historyOf(db, b.id);
  assert.equal(h.length, 1);
  assert.equal(h[0].what, 'Бронь создана');
  assert.equal(h[0].user_name, 'Анна Демо');
});

test('refund and void: limits, paid amount follows, voided entries do not count', () => {
  const { db, book, get } = fresh();
  const b = book();
  addPayment(db, b, 5000, 'card');
  assert.throws(() => refund(db, b, 6000, 'cash', 'больше чем оплачено', user), /не больше оплаченного/);
  assert.throws(() => refund(db, b, 100, 'cash', '', user), /причину/);
  refund(db, b, 2000, 'cash', 'ранний выезд', user);
  assert.equal(get(b.id).paid_amount, 3000);
  const pay = db.prepare("select * from payments where booking_id = ? and kind = 'payment'").get(b.id);
  // voiding the payment would leave a refund bigger than what is paid
  assert.throws(() => voidPayment(db, b, pay.id, 'ошибка', user), /меньше нуля/);
  const ref = db.prepare("select * from payments where booking_id = ? and kind = 'refund'").get(b.id);
  voidPayment(db, b, ref.id, 'возврат не нужен', user);
  assert.equal(get(b.id).paid_amount, 5000);
  assert.throws(() => voidPayment(db, b, ref.id, 'ещё раз', user), /уже аннулирован/);
});

test('transfer payment to another booking of the same hotel only', () => {
  const { db, book, get } = fresh();
  const a = book(10);
  const c = book(20);
  addPayment(db, a, 4000, 'cash');
  transferPayment(db, a, get(c.id), 1500, user);
  assert.equal(get(a.id).paid_amount, 2500);
  assert.equal(get(c.id).paid_amount, 1500);
  assert.throws(() => transferPayment(db, a, get(c.id), 9999, user), /не больше оплаченного/);
  assert.throws(() => transferPayment(db, a, { ...get(c.id), hotel_id: 999 }, 100, user), /не найдена/);
  assert.match(historyOf(db, c.id)[0].new_value, /←/);
});

test('price, discount, services: totals and tax follow; history records old and new', () => {
  const { db, hotel, book, get } = fresh();
  const b = book(30, 2);
  setStayPrice(db, hotel, b, 9000, 'договорённость', user);
  let x = get(b.id);
  assert.equal(x.nights_total, 9000);
  assert.equal(x.tax_total, Math.max(Math.round(9000 * 0.02), 200));
  applyDiscount(db, hotel, x, { pct: 10 }, 'постоянный гость', user);
  x = get(b.id);
  assert.equal(x.nights_total, 8100);
  assert.throws(() => applyDiscount(db, hotel, x, { sum: 999999 }, 'слишком', user), /не больше стоимости/);
  const parking = db.prepare("select id from extras where name = 'Парковка'").get().id;
  addService(db, x, { extraId: parking }, user);
  x = get(b.id);
  assert.equal(x.extras_total, 800); // 2 nights
  addService(db, x, { name: 'Мини-бар', price: 350, qty: 2 }, user);
  x = get(b.id);
  assert.equal(x.extras_total, 1500);
  assert.equal(x.total, x.nights_total + x.tax_total + 1500);
  removeService(db, x, 0, user);
  assert.equal(get(b.id).extras_total, 700);
  const whats = historyOf(db, b.id).map((h) => h.what);
  assert.ok(whats.some((w) => w.startsWith('Стоимость проживания')));
  assert.ok(whats.some((w) => w.startsWith('Скидка 10%')));
  assert.ok(whats.includes('Удалена услуга'));
});

test('tags: only the hotel\'s active tags; tracked diff logs field changes', () => {
  const { db, book, get } = fresh();
  const b = book();
  const vip = db.prepare("select id from hotel_tags where name = 'VIP'").get().id;
  const other = Number(db.prepare("insert into hotels (slug, name) values ('x', 'X')").run().lastInsertRowid);
  const foreign = Number(db.prepare("insert into hotel_tags (hotel_id, name) values (?, 'Чужой')").run(other).lastInsertRowid);
  setTags(db, b, [vip, foreign], user);
  assert.deepEqual(tagsOf(db, b.id).map((t) => t.name), ['VIP']);
  tracked(db, b.id, user, '', () => db.prepare("update bookings set guest_phone = '+79990000000' where id = ?").run(b.id));
  const h = historyOf(db, b.id)[0];
  assert.deepEqual([h.what, h.old_value, h.new_value], ['Телефон', '+79000000000', '+79990000000']);
  assert.ok(get(b.id));
});

test('HTTP: card tabs, actions, documents, journal CSV, isolation', async () => {
  const ctx = await startApp();
  try {
    const login = async (email, password) => {
      const r = await fetch(`${ctx.base}/app/login`, { method: 'POST', redirect: 'manual', body: form({ email, password }) });
      const cookie = r.headers.get('set-cookie').split(';')[0];
      const csrf = (await (await fetch(`${ctx.base}/app`, { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
      return { cookie, csrf };
    };
    const a = await login('demo@stayra.example', 'demo12345');
    const hotel = ctx.db.prepare('select * from hotels where id = 1').get();
    const std = ctx.db.prepare("select * from room_types where name = 'Стандарт'").get();
    const rate = ctx.db.prepare("select * from rate_plans where name = 'Гибкий'").get();
    const mk = (o) => createBooking(ctx.db, hotel, { query: { ...stay(o, 2), adults: 2, children: 0, promo: '' }, roomId: std.id, rateId: rate.id, guest, staff: true });
    const b = mk(12);
    const c = mk(40);
    const post = (url, body, cookie = a.cookie) => fetch(ctx.base + url, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form(body) });
    for (const t of ['details', 'stay', 'payments', 'guests', 'docs', 'notes', 'history']) {
      assert.equal((await fetch(`${ctx.base}/app/bookings/${b.id}?tab=${t}`, { headers: { cookie: a.cookie } })).status, 200, t);
    }
    // details: validation + save, back to the same tab
    const bad = await post(`/app/bookings/${b.id}/details`, { _csrf: a.csrf, guest_name: 'X', guest_phone: '1', back: `/app/bookings/${b.id}?tab=details` });
    assert.match(bad.headers.get('location'), /tab=details&m=.*&e=1/);
    await post(`/app/bookings/${b.id}/details`, { _csrf: a.csrf, guest_name: 'Тест Карточный', guest_phone: '+79000000000', customer_name: 'ООО Тест', customer_inn: '7700000000', purpose: 'business' });
    assert.equal(ctx.db.prepare('select customer_name, purpose from bookings where id = ?').get(b.id).purpose, 'business');
    // money flow
    await post(`/app/bookings/${b.id}/pay`, { _csrf: a.csrf, amount: 3000, method: 'cash' });
    await post(`/app/bookings/${b.id}/transfer`, { _csrf: a.csrf, code: c.code, amount: 1000 });
    assert.equal(ctx.db.prepare('select paid_amount from bookings where id = ?').get(c.id).paid_amount, 1000);
    await post(`/app/bookings/${b.id}/refund`, { _csrf: a.csrf, amount: 500, method: 'cash', reason: 'ранний выезд' });
    assert.equal(ctx.db.prepare('select paid_amount from bookings where id = ?').get(b.id).paid_amount, 1500);
    // notes with a deadline show on the dashboard
    await post(`/app/bookings/${b.id}/notes`, { _csrf: a.csrf, text: 'Позвонить гостю', due_at: `${today()}T08:00` });
    assert.match(await (await fetch(`${ctx.base}/app`, { headers: { cookie: a.cookie } })).text(), /Позвонить гостю/);
    // documents
    for (const k of ['confirmation', 'invoice', 'receipt']) {
      const r = await fetch(`${ctx.base}/app/bookings/${b.id}/doc/${k}`, { headers: { cookie: a.cookie } });
      assert.equal(r.status, 200, k);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    assert.match(await (await fetch(`${ctx.base}/app/bookings/${b.id}/doc/invoice`, { headers: { cookie: a.cookie } })).text(), /ООО Тест, ИНН 7700000000/);
    // journal export with a tag filter
    const vip = ctx.db.prepare("select id from hotel_tags where hotel_id = 1 and name = 'VIP'").get().id;
    await post(`/app/bookings/${b.id}/tags`, { _csrf: a.csrf, tags: [vip] });
    const csv = await (await fetch(`${ctx.base}/app/bookings?tag=${vip}&format=csv`, { headers: { cookie: a.cookie } })).text();
    assert.match(csv, new RegExp(b.code));
    assert.doesNotMatch(csv, new RegExp(c.code));
    assert.match(csv, /VIP/);
    // history has the whole story
    const hist = await (await fetch(`${ctx.base}/app/bookings/${b.id}?tab=history`, { headers: { cookie: a.cookie } })).text();
    for (const w of ['Бронь создана', 'Цель поездки', 'Оплата перенесена', 'Возврат', 'Задача', 'Теги']) assert.match(hist, new RegExp(w));

    // another hotel: no card, no documents, no transfer into its code, no tag of ours
    await fetch(`${ctx.base}/signup`, { method: 'POST', redirect: 'manual', body: form({ hotel_name: 'Соседний', name: 'Пётр Соседов', email: 'n@example.com', password: 'password123', agree: 'on' }) });
    const o = await login('n@example.com', 'password123');
    assert.equal((await fetch(`${ctx.base}/app/bookings/${b.id}?tab=history`, { headers: { cookie: o.cookie } })).status, 404);
    assert.equal((await fetch(`${ctx.base}/app/bookings/${b.id}/doc/invoice`, { headers: { cookie: o.cookie } })).status, 404);
    assert.equal((await post(`/app/bookings/${b.id}/refund`, { _csrf: o.csrf, amount: 100, method: 'cash', reason: 'взлом' }, o.cookie)).status, 404);
    const ownTag = Number(ctx.db.prepare("insert into hotel_tags (hotel_id, name) values ((select id from hotels where name = 'Соседний'), 'Их тег')").run().lastInsertRowid);
    await post(`/app/bookings/${b.id}/tags`, { _csrf: a.csrf, tags: [ownTag] });
    assert.equal(ctx.db.prepare('select count(*) n from booking_tags where booking_id = ? and tag_id = ?').get(b.id, ownTag).n, 0);
    // transfer to a booking code of another hotel is refused
    const theirs = ctx.db.prepare("select id from hotels where name = 'Соседний'").get().id;
    ctx.db.prepare("insert into room_types (hotel_id, name, capacity, total_rooms, base_price) values (?, 'Т', 2, 1, 100)").run(theirs);
    const tr = await post(`/app/bookings/${b.id}/transfer`, { _csrf: a.csrf, code: 'SR-NOTOURS1', amount: 100 });
    assert.match(tr.headers.get('location'), /e=1/);
  } finally {
    await ctx.close();
  }
});
