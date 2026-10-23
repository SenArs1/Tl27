import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { createBooking, relocate, assignUnassigned, segmentsOf, changeDates } from '../src/lib/booking.js';
import { isOverdue } from '../src/views/chess.js';
import { startApp, form, stay } from './helpers.js';

const guest = { name: 'Тест Шахматов', email: 't@example.com', phone: '+79000000000' };

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  const type = (n) => db.prepare('select * from room_types where name = ?').get(n);
  const rate = db.prepare("select * from rate_plans where name = 'Гибкий'").get();
  const room = (n) => db.prepare('select * from rooms where number = ?').get(n);
  const book = (typeName, ci, nights, extra = {}) => createBooking(db, hotel, { query: { checkin: ci, checkout: addDays(ci, nights), adults: 2, children: 0, promo: '' }, roomId: type(typeName).id, rateId: rate.id, guest, staff: true, ...extra });
  return { db, hotel, type, rate, room, book };
}

test('relocate: dry run shows before/after and changes nothing; apply moves room and dates', () => {
  const { db, hotel, room, book } = fresh();
  const ci = addDays(today(), 10);
  const b = book('Стандарт', ci, 2, { physicalRoomId: room('201').id });
  const snapshot = JSON.stringify(db.prepare('select * from bookings where id = ?').get(b.id)) + JSON.stringify(segmentsOf(db, b.id));
  const dry = relocate(db, hotel, b, { roomId: room('205').id, checkin: addDays(ci, 1), checkout: addDays(ci, 3), today: today(), dryRun: true });
  assert.equal(dry.before.rooms[0].number, '201');
  assert.equal(dry.after.rooms[0].number, '205');
  assert.equal(dry.after.checkin, addDays(ci, 1));
  assert.equal(JSON.stringify(db.prepare('select * from bookings where id = ?').get(b.id)) + JSON.stringify(segmentsOf(db, b.id)), snapshot);
  const done = relocate(db, hotel, b, { roomId: room('205').id, checkin: addDays(ci, 1), checkout: addDays(ci, 3), today: today() });
  assert.equal(done.after.rooms[0].number, '205');
  const seg = segmentsOf(db, b.id);
  assert.deepEqual([seg.length, seg[0].start, seg[0].room_id], [1, addDays(ci, 1), room('205').id]);
  // keep price by default: same nights, same total
  assert.equal(db.prepare('select nights_total from bookings where id = ?').get(b.id).nights_total, b.nights_total);
});

test('relocate to another category: keep price or reprice by the new category', () => {
  const { db, hotel, room, book } = fresh();
  const ci = addDays(today(), 20);
  const a = book('Стандарт', ci, 2);
  const kept = relocate(db, hotel, a, { roomId: room('501').id, today: today() });
  assert.equal(kept.after.nights_total, a.nights_total);
  const b = book('Стандарт', addDays(ci, 5), 2);
  const repriced = relocate(db, hotel, b, { roomId: room('502').id, keepPrice: false, today: today() });
  const luxPrice = db.prepare("select sum(price) s from inventory i join room_types t on t.id = i.room_type_id where t.name = 'Люкс с сауной' and date >= ? and date < ?").get(addDays(ci, 5), addDays(ci, 7)).s;
  assert.equal(repriced.after.nights_total, luxPrice);
  assert.ok(repriced.after.total > b.total);
});

test('relocate: in-house guest moves from today (split), dates of arrival cannot move', () => {
  const { db, hotel, room, book } = fresh();
  const t = today();
  const b = book('Стандарт', addDays(t, -1), 3, { physicalRoomId: room('203').id });
  db.prepare("update bookings set status = 'checked_in' where id = ?").run(b.id);
  relocate(db, hotel, b, { roomId: room('204').id, today: t });
  const segs = segmentsOf(db, b.id);
  assert.deepEqual(segs.map((s) => [s.start, s.room_id]), [[addDays(t, -1), room('203').id], [t, room('204').id]]);
  assert.throws(() => relocate(db, hotel, b, { checkin: t, checkout: addDays(t, 3), today: t }), /даты переносить нельзя/);
});

test('placement mode "manual" keeps new bookings in the unassigned row; auto-assign places them', () => {
  const { db, hotel, type, rate } = fresh();
  const manual = { ...hotel, placement_mode: 'manual' };
  const ci = addDays(today(), 30);
  const q = { checkin: ci, checkout: addDays(ci, 2), adults: 2, children: 0, promo: '' };
  const site = createBooking(db, manual, { query: q, roomId: type('Семейный').id, rateId: rate.id, guest });
  assert.equal(segmentsOf(db, site.id)[0].room_id, null);
  // staff can still ask for a room right away
  const staff = createBooking(db, manual, { query: q, roomId: type('Семейный').id, rateId: rate.id, guest, staff: true, autoRoom: true });
  assert.ok(segmentsOf(db, staff.id)[0].room_id);
  const r = assignUnassigned(db, hotel.id);
  assert.equal(r.placed, 1);
  assert.ok(segmentsOf(db, site.id)[0].room_id);
});

test('overdue: arrival day passed, departure time passed', () => {
  const h = { checkout_time: '12:00' };
  const t = '2026-10-23';
  assert.equal(isOverdue({ status: 'confirmed', checkin: '2026-10-22' }, t, '09:00', h), true);
  assert.equal(isOverdue({ status: 'confirmed', checkin: t }, t, '23:00', h), false);
  assert.equal(isOverdue({ status: 'checked_in', checkout: t }, t, '12:30', h), true);
  assert.equal(isOverdue({ status: 'checked_in', checkout: t }, t, '11:00', h), false);
});

test('changeDates keepPrice keeps the per-night price', () => {
  const { db, hotel, book } = fresh();
  const ci = addDays(today(), 40);
  const b = book('Стандарт', ci, 2, { priceOverride: 6000 });
  const longer = changeDates(db, hotel, b, ci, addDays(ci, 3), { keepPrice: true });
  assert.equal(longer.nights_total, 9000);
});

test('HTTP: side panel, relocate dry/apply, check-in with time and payment, undo check-out, placement, isolation', async () => {
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
    const b = createBooking(ctx.db, hotel, { query: { checkin: today(), checkout: stay(2).checkin, adults: 2, children: 0, promo: '' }, roomId: std.id, rateId: rate.id, guest, staff: true });

    const peek = await fetch(`${ctx.base}/app/bookings/${b.id}/peek?back=${encodeURIComponent('/app/chess?days=7')}`, { headers: { cookie: a.cookie } });
    assert.equal(peek.headers.get('cache-control'), 'no-store');
    const html = await peek.text();
    assert.match(html, /Заселить/);
    assert.match(html, /name="back" value="\/app\/chess\?days=7"/);
    // a foreign back URL is not accepted
    assert.match(await (await fetch(`${ctx.base}/app/bookings/${b.id}/peek?back=${encodeURIComponent('https://evil.example')}`, { headers: { cookie: a.cookie } })).text(), /name="back" value="\/app\/chess"/);

    const json = { cookie: a.cookie, 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': a.csrf };
    const target = ctx.db.prepare("select id from rooms where number = '209'").get().id;
    const dry = await (await fetch(`${ctx.base}/app/bookings/${b.id}/relocate?dry=1`, { method: 'POST', headers: json, body: JSON.stringify({ room_id: target }) })).json();
    assert.equal(dry.after.rooms[0].number, '209');
    assert.notEqual(ctx.db.prepare('select room_id from stay_segments where booking_id = ?').get(b.id).room_id, target);
    const applied = await fetch(`${ctx.base}/app/bookings/${b.id}/relocate`, { method: 'POST', headers: json, body: JSON.stringify({ room_id: target }) });
    assert.equal(applied.status, 200);
    assert.equal(ctx.db.prepare('select room_id from stay_segments where booking_id = ?').get(b.id).room_id, target);

    // check in at a given time with payment, back to the chessboard
    const ci = await fetch(`${ctx.base}/app/bookings/${b.id}/status`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, status: 'checked_in', at: `${today()}T15:20`, pay_amount: 1000, pay_method: 'cash', back: '/app/chess?days=7' }) });
    assert.match(ci.headers.get('location'), /^\/app\/chess\?days=7&m=/);
    const after = ctx.db.prepare('select * from bookings where id = ?').get(b.id);
    assert.equal(after.status, 'checked_in');
    assert.equal(after.checked_in_at, `${today()} 15:20:00`);
    assert.equal(after.paid_amount, 1000);
    // overpaying is refused
    const over = await fetch(`${ctx.base}/app/bookings/${b.id}/pay`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, amount: 10000000, method: 'cash' }) });
    assert.match(over.headers.get('location'), /e=1/);
    // check out, then undo with a reason
    await fetch(`${ctx.base}/app/bookings/${b.id}/status`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, status: 'checked_out' }) });
    const noReason = await fetch(`${ctx.base}/app/bookings/${b.id}/status`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, status: 'checked_in' }) });
    assert.match(noReason.headers.get('location'), /e=1/);
    await fetch(`${ctx.base}/app/bookings/${b.id}/status`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, status: 'checked_in', reason: 'выселили по ошибке' }) });
    const undone = ctx.db.prepare('select * from bookings where id = ?').get(b.id);
    assert.equal(undone.status, 'checked_in');
    assert.match(undone.comment, /Отмена выселения: выселили по ошибке/);

    // placement mode and auto-assign
    await fetch(`${ctx.base}/app/chess/placement`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, mode: 'manual' }) });
    assert.equal(ctx.db.prepare('select placement_mode from hotels where id = 1').get().placement_mode, 'manual');
    const chess = await (await fetch(`${ctx.base}/app/chess`, { headers: { cookie: a.cookie } })).text();
    assert.match(chess, /Сегодня, /);
    assert.match(chess, /data-chess-tools/);

    // another hotel cannot peek or relocate
    await fetch(`${ctx.base}/signup`, { method: 'POST', redirect: 'manual', body: form({ hotel_name: 'Чужой', name: 'Иван Чужой', email: 'x2@example.com', password: 'password123', agree: 'on' }) });
    const o = await login('x2@example.com', 'password123');
    assert.equal((await fetch(`${ctx.base}/app/bookings/${b.id}/peek`, { headers: { cookie: o.cookie } })).status, 404);
    const rel = await fetch(`${ctx.base}/app/bookings/${b.id}/relocate`, { method: 'POST', headers: { cookie: o.cookie, 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': o.csrf }, body: JSON.stringify({ room_id: target }) });
    assert.equal(rel.status, 404);
  } finally {
    await ctx.close();
  }
});
