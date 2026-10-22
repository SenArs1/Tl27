import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stay, login, form } from './helpers.js';
import { createBooking } from '../src/lib/booking.js';
import { PRODUCTS, SOLUTIONS, ARTICLES } from '../src/content.js';

let ctx;
test.before(async () => { ctx = await startApp(); });
test.after(() => ctx.close());

test('every public page answers 200, unknown 404', async () => {
  const pages = ['/', '/products', '/price', '/demo', '/contacts', '/about', '/privacy', '/support', '/support?q=%D0%BF%D1%80%D0%BE%D0%BC%D0%BE', '/h/severny-bereg', '/h/severny-bereg/manage', '/widget-demo', '/widget.js', '/app/login',
    ...PRODUCTS.map((p) => `/products/${p.slug}`), ...SOLUTIONS.map((s) => `/solutions/${s.slug}`), ...ARTICLES.map((a) => `/support/${a.slug}`)];
  for (const p of pages) assert.equal((await fetch(ctx.base + p)).status, 200, p);
  for (const p of ['/nope', '/products/nope', '/h/nope', '/support/nope']) assert.equal((await fetch(ctx.base + p)).status, 404, p);
});

test('F01+F02: guest books, sees confirmation, cancels via manage', async () => {
  const { checkin, checkout } = stay(20, 2);
  const res = await (await fetch(`${ctx.base}/h/severny-bereg/rooms?checkin=${checkin}&checkout=${checkout}&adults=2&children=0`)).text();
  const link = res.match(/href="(\/h\/severny-bereg\/checkout\?[^"]+)"/)[1].replace(/&amp;/g, '&');
  const page = await (await fetch(ctx.base + link)).text();
  const idem = page.match(/name="idem" value="([^"]+)"/)[1];
  const params = Object.fromEntries(new URL(ctx.base + link).searchParams);
  const body = form({ ...params, idem, guest_name: 'Мария Гостева', guest_email: 'maria@example.com', guest_phone: '+79001234567', agree: 'on', extras: ['1', '2'] });
  const r = await fetch(`${ctx.base}/h/severny-bereg/book`, { method: 'POST', body, redirect: 'manual' });
  assert.equal(r.status, 303);
  const loc = r.headers.get('location');
  const conf = await (await fetch(ctx.base + loc)).text();
  assert.match(conf, /Номер забронирован/);
  const code = conf.match(/data-code>([^<]+)</)[1];
  // double submit with the same idem key: same booking
  const r2 = await fetch(`${ctx.base}/h/severny-bereg/book`, { method: 'POST', body, redirect: 'manual' });
  assert.ok(r2.headers.get('location').includes(code));
  assert.equal(ctx.db.prepare('select count(*) n from bookings where guest_email = ?').get('maria@example.com').n, 1);
  // booking page without token is hidden
  assert.equal((await fetch(`${ctx.base}/h/severny-bereg/booking/${code}`)).status, 404);
  // manage with wrong email fails, right email works
  assert.equal((await fetch(`${ctx.base}/h/severny-bereg/manage`, { method: 'POST', body: form({ code, email: 'x@example.com' }), redirect: 'manual' })).status, 404);
  const m = await fetch(`${ctx.base}/h/severny-bereg/manage`, { method: 'POST', body: form({ code, email: 'maria@example.com' }), redirect: 'manual' });
  assert.equal(m.status, 303);
  const c = await fetch(`${ctx.base}/h/severny-bereg/booking/${code}/cancel`, { method: 'POST', body: form({ email: 'maria@example.com' }), redirect: 'manual' });
  assert.equal(c.status, 303);
  assert.equal(ctx.db.prepare('select status from bookings where code = ?').get(code).status, 'cancelled');
});

test('checkout validation errors are shown, nothing is booked', async () => {
  const { checkin, checkout } = stay(30, 1);
  const before = ctx.db.prepare('select count(*) n from bookings').get().n;
  const r = await fetch(`${ctx.base}/h/severny-bereg/book`, { method: 'POST', body: form({ checkin, checkout, adults: 2, children: 0, room: 1, rate: 1, guest_name: '', guest_email: 'bad', guest_phone: '1' }) });
  assert.equal(r.status, 422);
  const t = await r.text();
  assert.match(t, /Проверьте адрес почты/);
  assert.match(t, /Нужно согласие/);
  assert.equal(ctx.db.prepare('select count(*) n from bookings').get().n, before);
});

test('search with invalid dates returns 422 with message', async () => {
  const r = await fetch(`${ctx.base}/h/severny-bereg/rooms?checkin=2020-01-01&checkout=2020-01-02`);
  assert.equal(r.status, 422);
  assert.match(await r.text(), /Дата заезда уже прошла/);
});

test('F06: demo request stored, validation, honeypot', async () => {
  const bad = await fetch(`${ctx.base}/demo`, { method: 'POST', body: form({ name: 'A', phone: '12' }) });
  assert.equal(bad.status, 422);
  const ok = await fetch(`${ctx.base}/demo`, { method: 'POST', body: form({ name: 'Олег', phone: '+7 900 000 00 00', rooms: '12', agree: 'on', property_type: 'mini' }) });
  assert.match(await ok.text(), /Заявка отправлена/);
  await fetch(`${ctx.base}/demo`, { method: 'POST', body: form({ name: 'Bot', phone: '+7 900 000 00 00', agree: 'on', website: 'spam' }) });
  assert.equal(ctx.db.prepare("select count(*) n from leads where name = 'Bot'").get().n, 0);
  assert.equal(ctx.db.prepare("select count(*) n from leads where name = 'Олег'").get().n, 1);
});

test('extranet: auth required, wrong password, csrf, open redirect', async () => {
  const r = await fetch(`${ctx.base}/app/bookings`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/app\/login/);
  const bad = await fetch(`${ctx.base}/app/login`, { method: 'POST', body: form({ email: 'demo@stayra.example', password: 'x' }) });
  assert.equal(bad.status, 401);
  const evil = await fetch(`${ctx.base}/app/login`, { method: 'POST', redirect: 'manual', body: form({ email: 'demo@stayra.example', password: 'demo12345', next: '//evil.example' }) });
  assert.equal(evil.headers.get('location'), '/app');
  const { cookie } = await login(ctx.base);
  const noCsrf = await fetch(`${ctx.base}/app/settings`, { method: 'POST', headers: { cookie }, body: form({ name: 'Hacked' }) });
  assert.equal(noCsrf.status, 403);
});

test('F04: grid cell edit and bulk close reach the booking engine', async () => {
  const { cookie, csrf } = await login(ctx.base);
  const { checkin, checkout } = stay(40, 1);
  const room = ctx.db.prepare("select * from room_types where name = 'Семейный'").get();
  const r = await fetch(`${ctx.base}/app/grid`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ room: room.id, date: checkin, price: 9999, available: 3, min_stay: 1, open: true }) });
  assert.equal(r.status, 200);
  const offers = await (await fetch(`${ctx.base}/api/h/severny-bereg/offers?checkin=${checkin}&checkout=${checkout}&adults=2`)).json();
  assert.equal(offers.offers.find((o) => o.room.id === room.id).rates[0].total, 9999);
  const tooMany = await fetch(`${ctx.base}/app/grid`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ room: room.id, date: checkin, price: 1, available: 99, min_stay: 1, open: true }) });
  assert.equal(tooMany.status, 422);
  await fetch(`${ctx.base}/app/grid/bulk`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, room: room.id, from: checkin, to: checkin, days: 'all', action: 'close', value: '' }) });
  const after = await (await fetch(`${ctx.base}/api/h/severny-bereg/offers?checkin=${checkin}&checkout=${checkout}&adults=2`)).json();
  assert.equal(after.offers.find((o) => o.room.id === room.id).reason, 'sold_out');
  // A connected channel logged the updates
  assert.ok(ctx.db.prepare("select count(*) n from channel_log where kind = 'update'").get().n >= 2);
});

test('F05/F08: channels toggle, room create, booking status flow, other hotel data invisible', async () => {
  const { cookie, csrf } = await login(ctx.base);
  const ch = ctx.db.prepare('select * from channels where connected = 0').get();
  await fetch(`${ctx.base}/app/channels/${ch.id}/toggle`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf }) });
  assert.equal(ctx.db.prepare('select connected from channels where id = ?').get(ch.id).connected, 1);
  assert.equal(ctx.db.prepare("select kind from channel_log where channel_id = ? order by id desc").get(ch.id).kind, 'full');

  await fetch(`${ctx.base}/app/rooms`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, name: 'Домик у воды', capacity: 5, total_rooms: 2, base_price: 9000 }) });
  assert.ok(ctx.db.prepare("select * from room_types where name = 'Домик у воды'").get());

  // second hotel with its own booking: not visible to demo user
  const h2 = ctx.db.prepare("insert into hotels (slug, name) values ('other', 'Чужой')").run().lastInsertRowid;
  const rt = ctx.db.prepare("insert into room_types (hotel_id, name, capacity, total_rooms, base_price) values (?, 'X', 2, 1, 100)").run(h2).lastInsertRowid;
  const rp = ctx.db.prepare("insert into rate_plans (hotel_id, name) values (?, 'Y')").run(h2).lastInsertRowid;
  const bid = ctx.db.prepare("insert into bookings (code, hotel_id, room_type_id, rate_plan_id, checkin, checkout, adults, guest_name, guest_email, guest_phone, nights_total, extras_total, total) values ('SR-OTHER', ?, ?, ?, '2030-01-01', '2030-01-02', 1, 'Secret', 's@x.y', '1', 1, 0, 1)").run(h2, rt, rp).lastInsertRowid;
  assert.equal((await fetch(`${ctx.base}/app/bookings/${bid}`, { headers: { cookie } })).status, 404);
  assert.doesNotMatch(await (await fetch(`${ctx.base}/app/bookings?q=Secret`, { headers: { cookie } })).text(), /SR-OTHER/);
  const cross = await fetch(`${ctx.base}/app/bookings/${bid}/status`, { method: 'POST', headers: { cookie }, body: form({ _csrf: csrf, status: 'cancelled' }) });
  assert.equal(cross.status, 404);

  // status transitions on own booking
  const hotel = ctx.db.prepare('select * from hotels where id = 1').get();
  const q = { ...stay(50, 2), adults: 2, children: 0, promo: '' };
  const own = createBooking(ctx.db, hotel, { query: q, roomId: 1, rateId: 1, guest: { name: 'Пётр', email: 'p@example.com', phone: '+79000000000' } });
  await fetch(`${ctx.base}/app/bookings/${own.id}/status`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, status: 'checked_in' }) });
  assert.equal(ctx.db.prepare('select status from bookings where id = ?').get(own.id).status, 'checked_in');
  const illegal = await fetch(`${ctx.base}/app/bookings/${own.id}/status`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, status: 'confirmed' }) });
  assert.match(illegal.headers.get('location'), /e=1/);
  for (const p of ['/app', '/app/bookings', '/app/grid', '/app/rooms', '/app/channels', '/app/leads', '/app/reports', '/app/settings']) {
    assert.equal((await fetch(ctx.base + p, { headers: { cookie } })).status, 200, p);
  }
});
