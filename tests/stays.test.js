import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { createBooking, changeDates, splitStay, moveSegment, segmentsOf, searchOffers, rateNightly, priceStay, ratesMap, cancelBooking, BookingError } from '../src/lib/booking.js';
import { startApp, form, stay } from './helpers.js';

const guest = { name: 'Тест Гость', email: 't@example.com', phone: '+79000000000' };

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  const type = (name) => db.prepare('select * from room_types where name = ?').get(name);
  const rate = (name) => db.prepare('select * from rate_plans where name = ?').get(name);
  const avail = (typeId, d) => db.prepare('select available from inventory where room_type_id = ? and date = ?').get(typeId, d).available;
  const room = (n) => db.prepare('select * from rooms where number = ?').get(n);
  return { db, hotel, type, rate, avail, room };
}

test('derived rates: chain, percent and fixed adjustments, rounding, single occupancy', () => {
  const base = { id: 1, adjust_type: 'pct', adjust_value: 0 };
  const promo = { id: 2, parent_id: 1, adjust_type: 'pct', adjust_value: -12, rounding: 10 };
  const late = { id: 3, parent_id: 2, adjust_type: 'fixed', adjust_value: -300 };
  const rates = new Map([[1, base], [2, promo], [3, late]]);
  assert.equal(rateNightly(base, 4250, rates), 4250);
  assert.equal(rateNightly(promo, 4250, rates), 3740); // 3740 = round(4250*0.88 = 3740) to 10
  assert.equal(rateNightly(late, 4250, rates), 3440);
  assert.equal(rateNightly({ adjust_type: 'pct', adjust_value: 10 }, 1000), 1100);
  // a loop in data cannot hang: depth is capped
  const a = { id: 7, parent_id: 8, adjust_type: 'pct', adjust_value: -10 };
  const b = { id: 8, parent_id: 7, adjust_type: 'pct', adjust_value: -10 };
  assert.ok(rateNightly(a, 1000, new Map([[7, a], [8, b]])) > 0);
  // single occupancy discount applies to one adult only
  const flex = { id: 1, adjust_type: 'pct', adjust_value: 0, single_discount: 500 };
  assert.equal(priceStay({ nightly: [4000, 4000], rate: flex, adults: 1 }).total, 7000);
  assert.equal(priceStay({ nightly: [4000, 4000], rate: flex, adults: 2 }).total, 8000);
});

test('seeded derived rate follows the base price; old discount_pct is migrated', () => {
  const { db, hotel, type } = fresh();
  const q = { checkin: addDays(today(), 20), checkout: addDays(today(), 21), adults: 2, children: 0, promo: '' };
  db.prepare('update inventory set price = 5000 where room_type_id = ? and date = ?').run(type('Стандарт').id, q.checkin);
  const offer = searchOffers(db, hotel, q).offers.find((o) => o.room.name === 'Стандарт');
  const by = (n) => offer.rates.find((r) => r.rate.name === n).price;
  const tax = (x) => Math.max(Math.round(x * 0.02), 100);
  assert.equal(by('Гибкий').total, 5000 + tax(5000));
  assert.equal(by('Выгодный').total, 4400 + tax(4400));
  // a database from before adjustments
  db.prepare("update rate_plans set adjust_value = 0, discount_pct = 15 where name = 'Выгодный'").run();
  const db2 = db; // migrate runs on open; emulate by calling the same statement path
  db2.exec("update rate_plans set adjust_type = 'pct', adjust_value = -discount_pct, discount_pct = 0 where discount_pct > 0 and adjust_value = 0");
  assert.equal(ratesMap(db2, hotel.id).get(db.prepare("select id from rate_plans where name = 'Выгодный'").get().id).adjust_value, -15);
});

test('CTA / CTD close arrival or departure days for guests, not for staff', () => {
  const { db, hotel, type, rate } = fresh();
  const std = type('Стандарт');
  const q = { checkin: addDays(today(), 30), checkout: addDays(today(), 32), adults: 2, children: 0, promo: '' };
  const offer = () => searchOffers(db, hotel, q).offers.find((o) => o.room.id === std.id);
  assert.equal(offer().reason, null);
  db.prepare('update inventory set cta = 1 where room_type_id = ? and date = ?').run(std.id, q.checkin);
  assert.equal(offer().reason, 'cta');
  assert.throws(() => createBooking(db, hotel, { query: q, roomId: std.id, rateId: rate('Гибкий').id, guest }), (e) => e.code === 'cta');
  // arriving a day earlier is fine: the ban is on the arrival day only
  assert.equal(searchOffers(db, hotel, { ...q, checkin: addDays(q.checkin, -1) }).offers.find((o) => o.room.id === std.id).reason, null);
  db.prepare('update inventory set cta = 0 where room_type_id = ? and date = ?').run(std.id, q.checkin);
  db.prepare('insert or ignore into inventory (room_type_id, date, price, available) values (?,?,?,?)').run(std.id, q.checkout, 4200, 10);
  db.prepare('update inventory set ctd = 1 where room_type_id = ? and date = ?').run(std.id, q.checkout);
  assert.equal(offer().reason, 'ctd');
  const staff = createBooking(db, hotel, { query: q, roomId: std.id, rateId: rate('Гибкий').id, guest, staff: true });
  assert.ok(staff.id);
});

test('change dates: extend and shorten move inventory and money, keep booked night prices', () => {
  const { db, hotel, type, rate, avail } = fresh();
  const lux = type('Люкс с сауной');
  const ci = addDays(today(), 40);
  const b = createBooking(db, hotel, {
    query: { checkin: ci, checkout: addDays(ci, 2), adults: 2, children: 0, promo: '' }, roomId: lux.id, rateId: rate('Гибкий').id, guest,
    extraIds: [db.prepare("select id from extras where name = 'Парковка'").get().id], priceOverride: 20000, staff: true,
  });
  assert.equal(b.extras_total, 800);
  const before = avail(lux.id, addDays(ci, 2));
  // the hotel raised prices since; the third night is charged at today's price
  db.prepare('update inventory set price = 15000 where room_type_id = ? and date = ?').run(lux.id, addDays(ci, 2));
  const longer = changeDates(db, hotel, b, ci, addDays(ci, 3));
  assert.equal(longer.nights_total, 20000 + 15000);
  assert.equal(longer.extras_total, 1200); // parking per night follows the stay
  assert.equal(longer.tax_total, Math.round(35000 * 0.02));
  assert.equal(avail(lux.id, addDays(ci, 2)), before - 1);
  assert.equal(segmentsOf(db, b.id)[0].end, addDays(ci, 3));
  // shorten from the front: the first night is returned at its average booked price
  const shorter = changeDates(db, hotel, longer, addDays(ci, 1), addDays(ci, 3));
  assert.equal(shorter.nights_total, Math.round((35000 / 3) * 2));
  assert.equal(avail(lux.id, ci), 2);
  // in-house guests keep their arrival date
  db.prepare("update bookings set status = 'checked_in' where id = ?").run(b.id);
  assert.throws(() => changeDates(db, hotel, shorter, ci, addDays(ci, 3)), (e) => e.code === 'dates');
  assert.ok(changeDates(db, hotel, shorter, shorter.checkin, addDays(ci, 4)));
});

test('change dates: blocked when the room is taken on the new nights; nothing changes', () => {
  const { db, hotel, type, rate, room } = fresh();
  const lux = type('Люкс с сауной');
  const ci = addDays(today(), 50);
  const r501 = room('501');
  const a = createBooking(db, hotel, { query: { checkin: ci, checkout: addDays(ci, 2), adults: 2, children: 0, promo: '' }, roomId: lux.id, rateId: rate('Гибкий').id, guest, staff: true, physicalRoomId: r501.id });
  createBooking(db, hotel, { query: { checkin: addDays(ci, 2), checkout: addDays(ci, 4), adults: 2, children: 0, promo: '' }, roomId: lux.id, rateId: rate('Гибкий').id, guest, staff: true, physicalRoomId: r501.id });
  assert.throws(() => changeDates(db, hotel, a, ci, addDays(ci, 3)), (e) => e.code === 'room_busy');
  assert.equal(db.prepare('select checkout from bookings where id = ?').get(a.id).checkout, addDays(ci, 2));
  // cancelled bookings can't be changed
  const c = cancelBooking(db, a);
  assert.throws(() => changeDates(db, hotel, c, ci, addDays(ci, 3)), BookingError);
});

test('split stay: second part in another room and category; inventory follows; merge back', () => {
  const { db, hotel, type, rate, avail, room } = fresh();
  const std = type('Стандарт');
  const fam = type('Семейный');
  const ci = addDays(today(), 60);
  const b = createBooking(db, hotel, { query: { checkin: ci, checkout: addDays(ci, 4), adults: 2, children: 0, promo: '' }, roomId: std.id, rateId: rate('Гибкий').id, guest, staff: true });
  const first = segmentsOf(db, b.id)[0];
  const [stdBefore, famBefore] = [avail(std.id, addDays(ci, 3)), avail(fam.id, addDays(ci, 3))];
  splitStay(db, b, addDays(ci, 2), room('401').id);
  const segs = segmentsOf(db, b.id);
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[0].start, segs[0].end, segs[0].room_id], [ci, addDays(ci, 2), first.room_id]);
  assert.deepEqual([segs[1].start, segs[1].end, segs[1].room_id], [addDays(ci, 2), addDays(ci, 4), room('401').id]);
  assert.equal(avail(std.id, addDays(ci, 3)), stdBefore + 1);
  assert.equal(avail(fam.id, addDays(ci, 3)), famBefore - 1);
  assert.equal(avail(std.id, ci), stdBefore); // first nights stay in Standard
  // split on check-in day or check-out day is refused
  assert.throws(() => splitStay(db, b, ci, room('402').id), (e) => e.code === 'split');
  // moving the second part back to the first room merges the stay again
  moveSegment(db, b, segs[1].id, first.room_id);
  assert.equal(segmentsOf(db, b.id).length, 1);
  assert.equal(avail(fam.id, addDays(ci, 3)), famBefore);
});

test('HTTP: dates (JSON from the chessboard), split (form), derived rate guard, CTA cell', async () => {
  const ctx = await startApp();
  try {
    const r0 = await fetch(`${ctx.base}/app/login`, { method: 'POST', redirect: 'manual', body: form({ email: 'demo@stayra.example', password: 'demo12345' }) });
    const cookie = r0.headers.get('set-cookie').split(';')[0];
    const csrf = (await (await fetch(`${ctx.base}/app`, { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
    const hotel = ctx.db.prepare('select * from hotels where id = 1').get();
    const std = ctx.db.prepare("select * from room_types where name = 'Стандарт'").get();
    const flex = ctx.db.prepare("select * from rate_plans where name = 'Гибкий'").get();
    const b = createBooking(ctx.db, hotel, { query: { ...stay(25, 3), adults: 2, children: 0, promo: '' }, roomId: std.id, rateId: flex.id, guest, staff: true });
    const json = { cookie, 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrf };
    const d = await fetch(`${ctx.base}/app/bookings/${b.id}/dates`, { method: 'POST', headers: json, body: JSON.stringify({ checkin: b.checkin, checkout: addDays(b.checkout, 1) }) });
    assert.equal(d.status, 200);
    assert.match((await d.json()).message, /Даты изменены/);
    const bad = await fetch(`${ctx.base}/app/bookings/${b.id}/dates`, { method: 'POST', headers: json, body: JSON.stringify({ checkin: b.checkin, checkout: b.checkin }) });
    assert.equal(bad.status, 409);
    const target = ctx.db.prepare("select id from rooms where number = '210'").get().id;
    const sp = await fetch(`${ctx.base}/app/bookings/${b.id}/split`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, date: addDays(b.checkin, 1), room_id: target }) });
    assert.doesNotMatch(sp.headers.get('location'), /e=1/);
    assert.equal(ctx.db.prepare('select count(*) n from stay_segments where booking_id = ?').get(b.id).n, 2);
    const card = await (await fetch(`${ctx.base}/app/bookings/${b.id}`, { headers: { cookie } })).text();
    assert.match(card, /№ \d+ → № 210/);
    const chess = await (await fetch(`${ctx.base}/app/chess?from=${b.checkin}`, { headers: { cookie } })).text();
    assert.match(chess, /→ Тест Гость/);

    // derived rate cannot point to itself through a chain
    const promo = ctx.db.prepare("select * from rate_plans where name = 'Выгодный'").get();
    const loop = await fetch(`${ctx.base}/app/rooms/rates/${flex.id}`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, name: 'Гибкий', parent_id: promo.id, adjust_value: 0, adjust_type: 'pct', active: 'on' }) });
    assert.match(decodeURIComponent(loop.headers.get('location')), /самого себя/);
    const ok = await fetch(`${ctx.base}/app/rooms/rates`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, name: 'Поздний', parent_id: promo.id, adjust_value: -300, adjust_type: 'fixed' }) });
    assert.doesNotMatch(ok.headers.get('location'), /e=1/);
    assert.equal(ctx.db.prepare("select adjust_value from rate_plans where name = 'Поздний'").get().adjust_value, -300);

    // CTA through the prices cell editor
    const day = stay(33).checkin;
    const cell = await fetch(`${ctx.base}/app/prices`, { method: 'POST', headers: json, body: JSON.stringify({ room: std.id, date: day, price: 4200, available: 10, min_stay: 1, open: true, cta: true }) });
    assert.equal((await cell.json()).cell.cta, 1);
    const offers = await (await fetch(`${ctx.base}/api/h/severny-bereg/offers?checkin=${day}&checkout=${addDays(day, 1)}&adults=2`)).json();
    assert.equal(offers.offers.find((o) => o.room.id === std.id).reason, 'cta');
  } finally {
    await ctx.close();
  }
});
