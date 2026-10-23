import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, diffDays, isIsoDate, nightsOf, plural, today } from '../src/lib/dates.js';
import { parseSearch, priceStay, placement, extrasTotal, searchOffers, createBooking, cancelBooking, moveBooking, addPayment, BookingError } from '../src/lib/booking.js';
import { parseNumbers } from '../src/routes/app.js';
import { createHotel, addPhysicalRooms, slugify } from '../src/lib/hotels.js';
import { quote } from '../src/lib/pricing.js';
import { hashPassword, verifyPassword } from '../src/lib/auth.js';
import { html, raw } from '../src/views/html.js';

const guest = { name: 'Иван Тестов', email: 'ivan@example.com', phone: '+7 900 111-22-33', comment: '' };

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  return { db, hotel };
}

test('dates: iso validation, arithmetic, plural', () => {
  assert.ok(isIsoDate('2026-02-28'));
  assert.ok(!isIsoDate('2026-02-30'));
  assert.ok(!isIsoDate('28.02.2026'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.deepEqual(nightsOf('2026-01-01', '2026-01-03'), ['2026-01-01', '2026-01-02']);
  assert.equal(plural(1, 'ночь', 'ночи', 'ночей'), 'ночь');
  assert.equal(plural(3, 'ночь', 'ночи', 'ночей'), 'ночи');
  assert.equal(plural(11, 'ночь', 'ночи', 'ночей'), 'ночей');
  assert.equal(plural(22, 'ночь', 'ночи', 'ночей'), 'ночи');
});

test('search validation: past, reversed, too long, guests', () => {
  const t = today();
  assert.ok(parseSearch({ checkin: addDays(t, 1), checkout: addDays(t, 3) }).ok);
  assert.ok(parseSearch({ checkin: addDays(t, -1), checkout: addDays(t, 3) }).errors.checkin);
  assert.ok(parseSearch({ checkin: addDays(t, 3), checkout: addDays(t, 3) }).errors.checkout);
  assert.ok(parseSearch({ checkin: addDays(t, 1), checkout: addDays(t, 40) }).errors.checkout);
  assert.ok(parseSearch({ checkin: addDays(t, 1), checkout: addDays(t, 2), adults: '0' }).errors.adults);
  assert.ok(parseSearch({ checkin: 'abc', checkout: addDays(t, 2) }).errors.checkin);
});

test('price: rate discount, meals, promo, extra beds, tourist tax', () => {
  const room = { capacity: 2, extra_beds: 1 };
  const p = priceStay({ nightly: [1000, 2000], rate: { discount_pct: 10, meal_price: 100 }, room, adults: 2, promo: { discount_pct: 10 } });
  assert.equal(p.base, 3000);
  assert.equal(p.rateDiscount, 300);
  assert.equal(p.meals, 400);
  assert.equal(p.promoDiscount, 270 + 40);
  assert.equal(p.total, 2430 + 360);
  // third adult sleeps on the extra bed
  const e = priceStay({ nightly: [1000, 1000], rate: { extra_adult_price: 500, extra_child_price: 200 }, room, adults: 3 });
  assert.equal(e.extraAdults, 1);
  assert.equal(e.extraBeds, 1000);
  assert.equal(e.total, 3000);
  // a child uses a free main place first, then an extra bed
  assert.equal(priceStay({ nightly: [1000], rate: { extra_child_price: 200 }, room, adults: 1, children: 1 }).extraBeds, 0);
  assert.equal(priceStay({ nightly: [1000], rate: { extra_child_price: 200 }, room, adults: 2, children: 1 }).extraBeds, 200);
  assert.equal(placement(room, 2, 2).fits, false);
  // tax 2% on lodging only, but not less than 100 per night
  const t = priceStay({ nightly: [3000, 3000], rate: { meal_price: 500 }, room, adults: 2, hotel: { tax_bp: 200, tax_min_night: 100 } });
  assert.equal(t.tax, 200);
  assert.equal(t.total, 6000 + 2000 + 200);
  const big = priceStay({ nightly: [20000], rate: {}, room, adults: 1, hotel: { tax_bp: 200, tax_min_night: 100 } });
  assert.equal(big.tax, 400);
  const ex = extrasTotal([{ id: 1, name: 'a', price: 100, per: 'stay' }, { id: 2, name: 'b', price: 50, per: 'night' }, { id: 3, name: 'c', price: 10, per: 'guest_night' }], [1, 2, 3], 3, 2);
  assert.equal(ex.total, 100 + 150 + 60);
});

test('offers: capacity and sold out reasons', () => {
  const { db, hotel } = fresh();
  const q = { checkin: addDays(today(), 5), checkout: addDays(today(), 7), adults: 4, children: 0, promo: '' };
  const r = searchOffers(db, hotel, q);
  assert.equal(r.nights, 2);
  const std = r.offers.find((o) => o.room.name === 'Стандарт');
  assert.equal(std.reason, 'capacity');
  const fam = r.offers.find((o) => o.room.name === 'Семейный');
  assert.ok(fam.available);
  db.prepare('update inventory set closed = 1 where room_type_id = ? and date = ?').run(fam.room.id, q.checkin);
  assert.equal(searchOffers(db, hotel, q).offers.find((o) => o.room.id === fam.room.id).reason, 'sold_out');
});

test('booking decrements every night, cancel restores, no overbooking', () => {
  const { db, hotel } = fresh();
  const lux = db.prepare("select * from room_types where name = 'Люкс с сауной'").get();
  const rate = db.prepare('select * from rate_plans order by id').get();
  const q = { checkin: addDays(today(), 10), checkout: addDays(today(), 13), adults: 2, children: 0, promo: '' };
  const avail = () => db.prepare('select available from inventory where room_type_id = ? and date >= ? and date < ? order by date').all(lux.id, q.checkin, q.checkout).map((r) => r.available);
  assert.deepEqual(avail(), [2, 2, 2]);
  const b1 = createBooking(db, hotel, { query: q, roomId: lux.id, rateId: rate.id, guest });
  createBooking(db, hotel, { query: q, roomId: lux.id, rateId: rate.id, guest });
  assert.deepEqual(avail(), [0, 0, 0]);
  assert.throws(() => createBooking(db, hotel, { query: q, roomId: lux.id, rateId: rate.id, guest }), (e) => e instanceof BookingError && e.code === 'sold_out');
  // Overlapping stay that touches one sold-out night also fails, and changes nothing.
  const q2 = { ...q, checkin: addDays(q.checkout, -1), checkout: addDays(q.checkout, 1) };
  assert.throws(() => createBooking(db, hotel, { query: q2, roomId: lux.id, rateId: rate.id, guest }));
  assert.equal(db.prepare('select available from inventory where room_type_id = ? and date = ?').get(lux.id, q.checkout).available, 2);
  cancelBooking(db, b1);
  assert.deepEqual(avail(), [1, 1, 1]);
  assert.equal(cancelBooking(db, b1).status, 'cancelled'); // idempotent
  assert.deepEqual(avail(), [1, 1, 1]);
});

test('booking: idempotency key returns the same booking', () => {
  const { db, hotel } = fresh();
  const room = db.prepare('select * from room_types order by id').get();
  const rate = db.prepare('select * from rate_plans order by id').get();
  const q = { checkin: addDays(today(), 3), checkout: addDays(today(), 4), adults: 1, children: 0, promo: 'ONEGO10' };
  const a = createBooking(db, hotel, { query: q, roomId: room.id, rateId: rate.id, guest, idemKey: 'k1' });
  const b = createBooking(db, hotel, { query: q, roomId: room.id, rateId: rate.id, guest, idemKey: 'k1' });
  assert.equal(a.id, b.id);
  assert.equal(a.promo_code, 'ONEGO10');
  assert.ok(a.discount_total > 0);
  assert.equal(db.prepare('select count(*) n from bookings').get().n, 1);
});

test('pricing constructor', () => {
  const q = quote({ type: 'hotel', rooms: 20, tools: ['channels', 'pms'] });
  assert.ok(q.ok);
  assert.equal(q.monthly, 1900 + 25 * 20 + 2900 + 45 * 20);
  assert.equal(q.commission, 3.5);
  const bundle = quote({ type: 'hotel', rooms: 20, tools: ['channels', 'pms', 'reviews'] });
  assert.ok(bundle.discount > 0);
  assert.ok(!quote({ type: 'hotel', rooms: 0, tools: [] }).ok);
  assert.ok(!quote({ type: 'castle', rooms: 5, tools: [] }).ok);
});

test('passwords and html escaping', () => {
  const h = hashPassword('secret');
  assert.ok(verifyPassword('secret', h));
  assert.ok(!verifyPassword('nope', h));
  assert.equal(html`<p>${'<script>'}</p>`.value, '<p>&lt;script&gt;</p>');
  assert.equal(html`<p>${raw('<b>')}</p>`.value, '<p><b></p>');
});

test('rooms: booking gets a physical room, move checks conflicts and categories', () => {
  const { db, hotel } = fresh();
  const std = db.prepare("select * from room_types where name = 'Стандарт'").get();
  const lux = db.prepare("select * from room_types where name = 'Люкс с сауной'").get();
  const rate = db.prepare('select * from rate_plans order by id').get();
  const q = { checkin: addDays(today(), 10), checkout: addDays(today(), 12), adults: 2, children: 0, promo: '' };
  const a = createBooking(db, hotel, { query: q, roomId: std.id, rateId: rate.id, guest });
  const b = createBooking(db, hotel, { query: q, roomId: std.id, rateId: rate.id, guest });
  const roomIdOf = (x) => db.prepare('select room_id from stay_segments where booking_id = ? order by start').get(x.id).room_id;
  const roomOf = (x) => db.prepare('select number from rooms where id = ?').get(roomIdOf(x)).number;
  assert.equal(roomOf(a), '201');
  assert.equal(roomOf(b), '202');
  // b cannot move into a's room
  assert.throws(() => moveBooking(db, b, roomIdOf(a)), (e) => e.code === 'room_busy');
  // move to the suite: availability shifts from Standard to Suite
  const suiteRoom = db.prepare('select * from rooms where room_type_id = ? order by sort').get(lux.id);
  const avail = (t) => db.prepare('select available from inventory where room_type_id = ? and date = ?').get(t, q.checkin).available;
  const [stdBefore, luxBefore] = [avail(std.id), avail(lux.id)];
  const moved = moveBooking(db, b, suiteRoom.id);
  assert.equal(moved.room_type_id, lux.id);
  assert.equal(avail(std.id), stdBefore + 1);
  assert.equal(avail(lux.id), luxBefore - 1);
  // a specific busy room is refused at creation
  assert.throws(() => createBooking(db, hotel, { query: q, roomId: std.id, rateId: rate.id, guest, staff: true, physicalRoomId: roomIdOf(a) }), (e) => e.code === 'room_busy');
});

test('payments add up and mark a booking paid', () => {
  const { db, hotel } = fresh();
  const room = db.prepare('select * from room_types order by id').get();
  const rate = db.prepare('select * from rate_plans order by id').get();
  const b = createBooking(db, hotel, { query: { checkin: addDays(today(), 5), checkout: addDays(today(), 6), adults: 1, children: 0, promo: '' }, roomId: room.id, rateId: rate.id, guest });
  const half = addPayment(db, b, 1000, 'cash');
  assert.equal(half.paid_amount, 1000);
  assert.equal(half.paid, 0);
  const full = addPayment(db, half, b.total - 1000, 'card');
  assert.equal(full.paid, 1);
});

test('online prepayment takes the hotel prepay percent', () => {
  const { db, hotel } = fresh();
  const room = db.prepare('select * from room_types order by id').get();
  const rate = db.prepare('select * from rate_plans order by id').get();
  const b = createBooking(db, { ...hotel, prepay_pct: 30 }, { query: { checkin: addDays(today(), 5), checkout: addDays(today(), 6), adults: 1, children: 0, promo: '' }, roomId: room.id, rateId: rate.id, guest, payment: 'card' });
  assert.equal(b.paid_amount, Math.round(b.total * 0.3));
});

test('room numbers parser, slugs and new properties', () => {
  assert.deepEqual(parseNumbers('101-103, 2A'), ['101', '102', '103', '2A']);
  assert.equal(parseNumbers('1-900'), null);
  assert.equal(parseNumbers('bad!'), null);
  assert.equal(slugify('Северный берег'), 'severnyy-bereg');
  const { db } = fresh();
  const h = createHotel(db, { name: 'Северный берег', owner: { email: 'x@example.com', name: 'X', password: 'password1' } });
  assert.equal(h.slug, 'severnyy-bereg');
  const t = db.prepare("insert into room_types (hotel_id, name, capacity, total_rooms, base_price) values (?, 'A', 2, 0, 1000)").run(h.hotelId).lastInsertRowid;
  const r = addPhysicalRooms(db, h.hotelId, Number(t), ['101', '102']);
  assert.deepEqual(r.added, ['101', '102']);
  // the same numbers in another hotel are fine; a duplicate inside one hotel is skipped
  assert.deepEqual(addPhysicalRooms(db, h.hotelId, Number(t), ['102', '103']).skipped, ['102']);
  assert.equal(db.prepare('select total_rooms from room_types where id = ?').get(t).total_rooms, 3);
});
