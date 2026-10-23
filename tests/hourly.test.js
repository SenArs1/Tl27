import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { searchOffers, cancelBooking, parseSearch, createBooking } from '../src/lib/booking.js';
import { parseHourly, ruleError, createHourly, changeTime, hourlyOffers, dayBoard, whenOf } from '../src/lib/hourly.js';
import { startApp, login, form } from './helpers.js';
import { occupancyReport } from '../src/routes/app.js';

const guest = { name: 'Часовой Тест', email: 'h@example.com', phone: '+79000000011' };
const user = { id: 1, name: 'Анна Демо' };
const day = addDays(today(), 5);

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  const type = db.prepare("select * from room_types where hourly = 1").get();
  const q = (start, hours, date = day) => parseHourly({ date, start, hours }, hotel, { staff: true }).query;
  const book = (start, hours, extra = {}) => createHourly(db, hotel, { typeId: type.id, q: q(start, hours), guest, source: 'site', ...extra });
  return { db, hotel, type, q, book };
}

test('parse and rules: 30-minute steps, length limits, open hours', () => {
  const { hotel, type, q } = fresh();
  assert.equal(parseHourly({ date: day, start: '14:15', hours: 2 }, hotel).ok, false);
  assert.equal(parseHourly({ date: addDays(today(), -1), start: '14:00', hours: 2 }, hotel).ok, false);
  const p = parseHourly({ date: day, start: '22:30', hours: 3 }, hotel);
  assert.equal(p.query.endAt, `${addDays(day, 1)} 01:30`, 'crosses midnight');
  assert.match(ruleError(type, q('12:00', 1)), /Минимум 2/);
  assert.match(ruleError(type, q('12:00', 9)), /Максимум 8/);
  assert.match(ruleError(type, q('21:00', 2)), /с 09:00 до 22:00/);
  assert.equal(ruleError(type, q('20:00', 2)), null);
});

test('two rooms, cleaning gap, third guest refused; cancel frees the time and leaves nightly stock alone', () => {
  const { db, hotel, type, book } = fresh();
  const stock = db.prepare('select coalesce(sum(available),0) s from inventory').get().s;
  const a = book('12:00', 3);
  const b = book('12:00', 2);
  assert.notEqual(db.prepare('select room_id from stay_segments where booking_id = ?').get(a.id).room_id, db.prepare('select room_id from stay_segments where booking_id = ?').get(b.id).room_id);
  // Room of b is busy till 14:00 + 30 min cleaning; room of a till 15:00 + 30.
  assert.throws(() => book('14:00', 2), /заняли/);
  const c = book('14:30', 2);
  assert.ok(c.code);
  assert.equal(whenOf(c), `${day.split('-').reverse().join('.')}, 14:30–16:30, 2 ч`);
  assert.equal(c.nights_total, 1800);
  assert.equal(c.tax_total, Math.max(Math.round(1800 * 0.02), 100));
  assert.equal(c.checkout, addDays(day, 1));
  cancelBooking(db, a);
  assert.equal(db.prepare('select coalesce(sum(available),0) s from inventory').get().s, stock, 'nightly stock untouched');
  assert.ok(book('15:00', 2), 'cancelled time is free again');
  // Staff may book outside the open hours; guests may not.
  assert.throws(() => book('21:00', 2), /с 09:00 до 22:00/);
  assert.ok(book('21:00', 2, { staff: true }));
  // The day board puts each booking on its room.
  const board = dayBoard(db, hotel.id, day);
  assert.equal(board.rooms.length, 2);
  assert.equal(board.rooms.reduce((n, r) => n + r.bookings.length, 0), 4);
  assert.equal(board.open, 9 * 60);
});

test('change time: conflicts with the gap, price follows hours unless kept, history written', () => {
  const { db, hotel, type, q, book } = fresh();
  const a = book('10:00', 2);
  const roomA = db.prepare('select room_id from stay_segments where booking_id = ?').get(a.id).room_id;
  const b = book('13:00', 2, {});
  const roomB = db.prepare('select room_id from stay_segments where booking_id = ?').get(b.id).room_id;
  assert.equal(roomA, roomB, 'second booking fits after the gap in the same room');
  assert.throws(() => changeTime(db, hotel, a, { q: q('10:00', 3) }, user), /занят/);
  let x = changeTime(db, hotel, a, { q: q('09:00', 3) }, user);
  assert.equal(x.nights_total, 2700);
  x = changeTime(db, hotel, a, { q: q('09:00', 2), keepPrice: true }, user);
  assert.equal(x.nights_total, 2700);
  const h = db.prepare("select * from booking_events where booking_id = ? and what = 'Время'").all(a.id);
  assert.equal(h.length, 2);
  const std = db.prepare("select * from room_types where name = 'Стандарт'").get();
  const rate = db.prepare("select * from rate_plans where name = 'Гибкий'").get();
  const night = createBooking(db, hotel, { query: { checkin: day, checkout: addDays(day, 1), adults: 1, children: 0, promo: '' }, roomId: std.id, rateId: rate.id, guest, staff: true });
  assert.throws(() => changeTime(db, hotel, night, { q: q('09:00', 2) }, user), /не почасовая/);
});

test('nightly search, occupancy and the price grid ignore hourly rooms', () => {
  const { db, hotel, book } = fresh();
  book('12:00', 3);
  const s = parseSearch({ checkin: day, checkout: addDays(day, 1), adults: 1, children: 0 }, hotel);
  assert.ok(searchOffers(db, hotel, s.query).offers.every((o) => !o.room.hourly));
  const occ = occupancyReport(db, hotel.id, day, day);
  assert.equal(occ.byDay[0].sold, 0);
  assert.equal(occ.byDay[0].available, 22);
  const offers = hourlyOffers(db, hotel, parseHourly({ date: day, start: '12:00', hours: 2 }, hotel).query, 2);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].available, true);
  assert.equal(offers[0].price, 1800);
});

test('HTTP: staff board and form, card time change, guest booking on the site', async () => {
  const app = await startApp();
  try {
    const { cookie, csrf } = await login(app.base);
    const post = (path, body) => fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ _csrf: csrf, ...body }) });
    const type = app.db.prepare('select * from room_types where hourly = 1').get();
    let page = await (await fetch(`${app.base}/app/hourly?date=${day}`, { headers: { cookie } })).text();
    assert.match(page, /№ Д1/);
    assert.match(page, /href="\/app\/hourly"/, 'menu item shown when the hotel has hourly rooms');
    let r = await post('/app/hourly', { type: type.id, date: day, start: '10:00', hours: 3, adults: 1, guest_name: 'Ирина Дневная', guest_phone: '+7 900 111-22-33' });
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get('location')), /10:00–13:00/);
    r = await post('/app/hourly', { type: type.id, date: day, start: '10:15', hours: 3, guest_name: 'Ирина', guest_phone: '+7 900 111-22-33' });
    assert.equal(r.status, 422);
    page = await (await fetch(`${app.base}/app/hourly?date=${day}`, { headers: { cookie } })).text();
    assert.match(page, /Ирина Дневная, 10:00–13:00/);
    const b = app.db.prepare("select * from bookings where guest_name = 'Ирина Дневная'").get();
    const card = await (await fetch(`${app.base}/app/bookings/${b.id}?tab=details`, { headers: { cookie } })).text();
    assert.match(card, /Время и номер/);
    assert.doesNotMatch(card, /Разделить проживание/);
    r = await post(`/app/bookings/${b.id}/time`, { date: day, start: '11:00', hours: 4 });
    assert.match(decodeURIComponent(r.headers.get('location')), /11:00–15:00/);
    assert.equal(app.db.prepare('select nights_total from bookings where id = ?').get(b.id).nights_total, 3600);
    const seg = app.db.prepare('select id from stay_segments where booking_id = ?').get(b.id).id;
    r = await post(`/app/bookings/${b.id}/move`, { segment_id: seg, room_id: 1 });
    assert.match(decodeURIComponent(r.headers.get('location')), /Изменить время/);
    const journal = await (await fetch(`${app.base}/app/bookings`, { headers: { cookie } })).text();
    assert.match(journal, /11:00–15:00, 4 ч/);
    const chess = await (await fetch(`${app.base}/app/chess`, { headers: { cookie } })).text();
    assert.doesNotMatch(chess, /Ирина Дневная/);

    // Guest side: search, choose, book, see the time on the booking page.
    const slug = app.db.prepare('select slug from hotels').get().slug;
    const home = await (await fetch(`${app.base}/h/${slug}`)).text();
    assert.match(home, /По часам/);
    const res = await (await fetch(`${app.base}/h/${slug}/hourly?date=${day}&start=16:00&hours=2&adults=1`)).text();
    assert.match(res, /Дневной номер/);
    assert.match(res, /1 800/);
    assert.equal((await fetch(`${app.base}/h/${slug}/hourly?date=${day}&start=16:10&hours=2`)).status, 422);
    const co = await (await fetch(`${app.base}/h/${slug}/hourly/checkout?date=${day}&start=16:00&hours=2&adults=1&type=${type.id}`)).text();
    const idem = co.match(/name="idem" value="([^"]+)"/)[1];
    const body = { date: day, start: '16:00', hours: 2, adults: 1, type: type.id, idem, guest_name: 'Олег Гость', guest_email: 'oleg@example.com', guest_phone: '+7 900 999-88-77', agree: 'on' };
    r = await fetch(`${app.base}/h/${slug}/hourly/book`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
    assert.equal(r.status, 303);
    const conf = await (await fetch(`${app.base}${r.headers.get('location')}`)).text();
    assert.match(conf, /16:00–18:00, 2 ч/);
    // Same idempotency key: no second booking.
    await fetch(`${app.base}/h/${slug}/hourly/book`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
    assert.equal(app.db.prepare("select count(*) n from bookings where guest_name = 'Олег Гость'").get().n, 1);
  } finally {
    await app.close();
  }
});
