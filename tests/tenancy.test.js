import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stay, form } from './helpers.js';
import { ADMIN } from '../src/seed.js';

let ctx;
test.before(async () => { ctx = await startApp(); });
test.after(() => ctx.close());

async function signIn(email, password) {
  const r = await fetch(`${ctx.base}/app/login`, { method: 'POST', redirect: 'manual', body: form({ email, password }) });
  assert.equal(r.status, 303, `login ${email}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${ctx.base}/app`, { headers: { cookie } })).text();
  return { cookie, csrf: page.match(/name="_csrf" value="([^"]+)"/)[1] };
}

async function signUp(hotel, email) {
  const r = await fetch(`${ctx.base}/signup`, { method: 'POST', redirect: 'manual', body: form({ hotel_name: hotel, city: 'Казань', property_type: 'mini', name: 'Владелец', email, password: 'password123', agree: 'on' }) });
  assert.equal(r.status, 303);
  return signIn(email, 'password123');
}

const post = (url, cookie, body, extra = {}) => fetch(ctx.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, ...extra }, body });

test('sign up creates a separate empty property; another hotel\'s records are invisible and untouchable', async () => {
  const b = await signUp('Мини-отель Казань', 'kazan@example.com');
  const hotelB = ctx.db.prepare("select * from hotels where name = 'Мини-отель Казань'").get();
  assert.ok(hotelB);
  assert.equal(ctx.db.prepare('select count(*) n from room_types where hotel_id = ?').get(hotelB.id).n, 0);
  // empty cabinet still renders everywhere
  for (const p of ['/app', '/app/chess', '/app/bookings', '/app/bookings/new', '/app/prices', '/app/rooms', '/app/reports', '/app/channels']) {
    assert.equal((await fetch(ctx.base + p, { headers: { cookie: b.cookie } })).status, 200, p);
  }
  // booking engine of a hotel without rooms says so
  assert.match(await (await fetch(`${ctx.base}/h/${hotelB.slug}`)).text(), /ещё не открыл онлайн-продажи/);

  // hotel A records, addressed by id from hotel B's session
  const A = 1;
  const roomA = ctx.db.prepare('select id from rooms where hotel_id = ? limit 1').get(A).id;
  const typeA = ctx.db.prepare('select id from room_types where hotel_id = ? limit 1').get(A).id;
  const rateA = ctx.db.prepare('select id from rate_plans where hotel_id = ? limit 1').get(A).id;
  const extraA = ctx.db.prepare('select id from extras where hotel_id = ? limit 1').get(A).id;
  const groupA = ctx.db.prepare('select id from extra_groups where hotel_id = ? limit 1').get(A).id;
  const chanA = ctx.db.prepare('select id from channels where hotel_id = ? limit 1').get(A).id;
  const hotelA = ctx.db.prepare('select * from hotels where id = ?').get(A);
  const { createBooking } = await import('../src/lib/booking.js');
  const bookingA = createBooking(ctx.db, hotelA, { query: { ...stay(15, 2), adults: 1, children: 0, promo: '' }, roomId: typeA, rateId: rateA, guest: { name: 'Секретный Гость', email: 'secret@example.com', phone: '+79000000001' } });

  const c = b.cookie;
  const tok = { _csrf: b.csrf };
  assert.equal((await fetch(`${ctx.base}/app/bookings/${bookingA.id}`, { headers: { cookie: c } })).status, 404);
  assert.doesNotMatch(await (await fetch(`${ctx.base}/app/bookings?q=${encodeURIComponent('Секретный')}`, { headers: { cookie: c } })).text(), new RegExp(bookingA.code));
  assert.doesNotMatch(await (await fetch(`${ctx.base}/app/chess`, { headers: { cookie: c } })).text(), /Секретный/);
  for (const [url, body] of [
    [`/app/bookings/${bookingA.id}/status`, { ...tok, status: 'cancelled' }],
    [`/app/bookings/${bookingA.id}/pay`, { ...tok, amount: 100, method: 'cash' }],
    [`/app/bookings/${bookingA.id}/move`, { ...tok, room_id: roomA }],
    [`/app/rooms/types/${typeA}`, { ...tok, name: 'Взлом', capacity: 2, extra_beds: 0, base_price: 1 }],
    [`/app/rooms/stock/${roomA}`, { ...tok, number: 'X1', floor: 1, sort: 1, status: 'repair' }],
    [`/app/rooms/stock/${roomA}/delete`, tok],
    [`/app/rooms/rates/${rateA}`, { ...tok, name: 'Взлом' }],
    [`/app/rooms/extras/${extraA}/toggle`, tok],
    [`/app/rooms/groups/${groupA}/delete`, tok],
    [`/app/channels/${chanA}/toggle`, tok],
  ]) {
    assert.equal((await post(url, c, form(body))).status, 404, url);
  }
  // hotel B cannot put its own booking into hotel A's room either
  const typeB = Number(ctx.db.prepare("insert into room_types (hotel_id, name, capacity, total_rooms, base_price) values (?, 'Б', 2, 0, 2000)").run(hotelB.id).lastInsertRowid);
  await post('/app/rooms/stock', c, form({ ...tok, room_type_id: typeB, numbers: '1-3', floor: 1 }));
  const rateB = ctx.db.prepare('select id from rate_plans where hotel_id = ?').get(hotelB.id).id;
  const nb = await post('/app/bookings/new', c, form({ ...tok, checkin: stay(5).checkin, checkout: stay(5).checkout, adults: 1, children: 0, type: typeB, rate: rateB, guest_name: 'Гость Б', guest_phone: '+79000000002', room: roomA }));
  assert.equal(nb.status, 409);
  const ownB = ctx.db.prepare("select * from bookings where hotel_id = ?").all(hotelB.id);
  assert.equal(ownB.length, 0);
  const mv = await post(`/app/bookings/${bookingA.id}/move`, c, JSON.stringify({ room_id: roomA }), { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': b.csrf });
  assert.equal(mv.status, 404);
  // nothing changed in hotel A
  const fresh = ctx.db.prepare('select * from bookings where id = ?').get(bookingA.id);
  assert.equal(fresh.status, 'confirmed');
  assert.equal(ctx.db.prepare('select status, number from rooms where id = ?').get(roomA).number, ctx.db.prepare('select number from rooms where id = ?').get(roomA).number);
  assert.notEqual(ctx.db.prepare('select name from room_types where id = ?').get(typeA).name, 'Взлом');
  // same room numbers may exist in different hotels
  assert.equal(ctx.db.prepare("select count(*) n from rooms where hotel_id = ? and number in ('1','2','3')").get(hotelB.id).n, 3);
});

test('duplicate sign up email is refused', async () => {
  const r = await fetch(`${ctx.base}/signup`, { method: 'POST', body: form({ hotel_name: 'Ещё', name: 'X', email: 'demo@stayra.example', password: 'password123', agree: 'on' }) });
  assert.equal(r.status, 422);
});

test('chain: an owner adds a second property and switches; no access to foreign hotels', async () => {
  const a = await signIn('demo@stayra.example', 'demo12345');
  const r = await post('/app/settings/properties', a.cookie, form({ _csrf: a.csrf, name: 'Северный берег — Шале', city: 'Кондопога', property_type: 'resort' }));
  assert.equal(r.status, 303);
  const chalet = ctx.db.prepare("select * from hotels where name = 'Северный берег — Шале'").get();
  // session now opens the new property
  const rooms = await (await fetch(`${ctx.base}/app/rooms`, { headers: { cookie: a.cookie } })).text();
  assert.match(rooms, /Категорий пока нет/);
  assert.match(rooms, /hotel-switch/);
  // switch back home
  await post('/app/switch', a.cookie, form({ _csrf: a.csrf, hotel_id: 1 }));
  assert.match(await (await fetch(`${ctx.base}/app/rooms`, { headers: { cookie: a.cookie } })).text(), /Люкс с сауной/);
  // switching to a hotel without access is refused
  const kazan = ctx.db.prepare("select id from hotels where name = 'Мини-отель Казань'").get().id;
  const sw = await post('/app/switch', a.cookie, form({ _csrf: a.csrf, hotel_id: kazan }));
  assert.match(sw.headers.get('location'), /e=1/);
  assert.match(await (await fetch(`${ctx.base}/app/rooms`, { headers: { cookie: a.cookie } })).text(), /Люкс с сауной/);
  assert.ok(chalet);
});

test('roles: an administrator cannot change settings or staff; owner can add one', async () => {
  const a = await signIn('demo@stayra.example', 'demo12345');
  const add = await post('/app/settings/team', a.cookie, form({ _csrf: a.csrf, name: 'Ольга Ресепшн', email: 'olga@example.com', role: 'manager' }));
  const pw = decodeURIComponent(add.headers.get('location').match(/pw=([^&]+)/)[1]);
  const m = await signIn('olga@example.com', pw);
  assert.equal((await post('/app/settings', m.cookie, form({ _csrf: m.csrf, name: 'Захват' }))).status, 403);
  assert.equal((await post('/app/settings/team', m.cookie, form({ _csrf: m.csrf, name: 'Ещё', email: 'more@example.com' }))).status, 403);
  assert.equal((await fetch(`${ctx.base}/app/chess`, { headers: { cookie: m.cookie } })).status, 200);
  assert.notEqual(ctx.db.prepare('select name from hotels where id = 1').get().name, 'Захват');
});

test('platform admin sees all tenants and leads; hotels do not see leads', async () => {
  await fetch(`${ctx.base}/demo`, { method: 'POST', body: form({ name: 'Лид Тестовый', phone: '+7 900 000 00 00', agree: 'on' }) });
  const owner = await signIn('demo@stayra.example', 'demo12345');
  assert.equal((await fetch(`${ctx.base}/admin`, { headers: { cookie: owner.cookie } })).status, 403);
  assert.doesNotMatch(await (await fetch(`${ctx.base}/app`, { headers: { cookie: owner.cookie } })).text(), /Лид Тестовый/);
  const admin = await signIn(ADMIN.email, ADMIN.password);
  const page = await (await fetch(`${ctx.base}/admin`, { headers: { cookie: admin.cookie } })).text();
  assert.match(page, /Лид Тестовый/);
  assert.match(page, /Мини-отель Казань/);
});

test('chessboard: move by drag (JSON), check-in needs a room, checkout makes the room dirty', async () => {
  const a = await signIn('demo@stayra.example', 'demo12345');
  const { createBooking } = await import('../src/lib/booking.js');
  const hotel = ctx.db.prepare('select * from hotels where id = 1').get();
  const type = ctx.db.prepare("select * from room_types where hotel_id = 1 and name = 'Семейный'").get();
  const rate = ctx.db.prepare('select * from rate_plans where hotel_id = 1 order by id').get();
  const today = new Date().toISOString().slice(0, 10);
  const b = createBooking(ctx.db, hotel, { query: { checkin: today, checkout: stay(1).checkin, adults: 2, children: 0, promo: '' }, roomId: type.id, rateId: rate.id, guest: { name: 'Перенос Тест', email: 'm@example.com', phone: '+79000000003' }, staff: true });
  const target = ctx.db.prepare('select * from rooms where room_type_id = ? and id != ? order by sort desc').get(type.id, b.room_id);
  const json = { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': a.csrf };
  const r = await post(`/app/bookings/${b.id}/move`, a.cookie, JSON.stringify({ room_id: target.id }), json);
  assert.equal(r.status, 200);
  assert.equal(ctx.db.prepare('select room_id from bookings where id = ?').get(b.id).room_id, target.id);
  // unassign, then check-in is refused
  await post(`/app/bookings/${b.id}/move`, a.cookie, JSON.stringify({ room_id: '' }), json);
  const ci = await post(`/app/bookings/${b.id}/status`, a.cookie, form({ _csrf: a.csrf, status: 'checked_in' }));
  assert.match(ci.headers.get('location'), /e=1/);
  await post(`/app/bookings/${b.id}/move`, a.cookie, JSON.stringify({ room_id: target.id }), json);
  await post(`/app/bookings/${b.id}/status`, a.cookie, form({ _csrf: a.csrf, status: 'checked_in' }));
  await post(`/app/bookings/${b.id}/status`, a.cookie, form({ _csrf: a.csrf, status: 'checked_out' }));
  assert.equal(ctx.db.prepare('select status from rooms where id = ?').get(target.id).status, 'dirty');
  // the chessboard shows the guest on the room row
  const chess = await (await fetch(`${ctx.base}/app/chess`, { headers: { cookie: a.cookie } })).text();
  assert.match(chess, /Перенос Тест/);
});

test('reports count future bookings and payments; CSV escapes formulas', async () => {
  const a = await signIn('demo@stayra.example', 'demo12345');
  const occ = await (await fetch(`${ctx.base}/app/reports`, { headers: { cookie: a.cookie } })).text();
  assert.match(occ, /[1-9]\d* из \d+ номеро-ночей/);
  ctx.db.prepare("update bookings set guest_name = '=HYPERLINK(1)' where id = (select max(id) from bookings where hotel_id = 1)").run();
  const csv = await (await fetch(`${ctx.base}/app/reports?tab=tax&from=2020-01-01&to=2030-12-31&format=csv`, { headers: { cookie: a.cookie } })).text();
  assert.doesNotMatch(csv, /;=HYPERLINK/);
});

test('settings: tax and payment rules reach the booking engine', async () => {
  const a = await signIn('demo@stayra.example', 'demo12345');
  await post('/app/settings/booking', a.cookie, form({ _csrf: a.csrf, min_days_ahead: 2, max_days_ahead: 200, cutoff_time: '20:00', child_max_age: 10, pay_at_hotel: 'on', prepay_pct: 0, cancel_policy: 'Отмена за 3 дня', tax_pct: '1,5', tax_min_night: 100 }));
  const h = ctx.db.prepare('select * from hotels where id = 1').get();
  assert.equal(h.tax_bp, 150);
  assert.equal(h.pay_card, 0);
  const tooSoon = await fetch(`${ctx.base}/h/${h.slug}/rooms?checkin=${stay(1).checkin}&checkout=${stay(3).checkin}&adults=2`);
  assert.equal(tooSoon.status, 422);
  const page = await (await fetch(`${ctx.base}/h/${h.slug}`)).text();
  assert.match(page, /Дети до 10 лет/);
  const bad = await post('/app/settings/booking', a.cookie, form({ _csrf: a.csrf, tax_pct: '9' }));
  assert.match(bad.headers.get('location'), /e=1/);
});
