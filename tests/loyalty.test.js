import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { createBooking, cancelBooking, addPayment } from '../src/lib/booking.js';
import { voidPayment } from '../src/lib/card.js';
import { levelFor, levelsOf, enroll, redeem, earnOnCheckout, revertEarn, adjust, findMember, memberStatus, removeMember, pointsUsedOn } from '../src/lib/loyalty.js';
import { startApp, login, form } from './helpers.js';

const user = { id: 1, name: 'Анна Демо' };
const guest = { name: 'Мария Постоянная', email: 'maria@example.com', phone: '+79001234567' };

function fresh() {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  const std = db.prepare("select * from room_types where name = 'Стандарт'").get();
  const rate = db.prepare("select * from rate_plans where name = 'Гибкий'").get();
  const book = (offset, extra = {}) => createBooking(db, hotel, { query: { checkin: addDays(today(), offset), checkout: addDays(today(), offset + 2), adults: 2, children: 0, promo: '' }, roomId: std.id, rateId: rate.id, guest, staff: true, ...extra });
  const get = (id) => db.prepare('select * from bookings where id = ?').get(id);
  const member = (id) => db.prepare('select * from loyalty_members where id = ?').get(id);
  return { db, hotel, book, get, member };
}

test('levels: the highest level reached and the distance to the next', () => {
  const { db, hotel } = fresh();
  const lv = levelsOf(db, hotel.id);
  assert.deepEqual(lv.map((l) => l.name), ['Базовый', 'Серебряный', 'Золотой']);
  assert.equal(levelFor(lv, 0).level.name, 'Базовый');
  assert.equal(levelFor(lv, 0).toNext, 50000);
  assert.equal(levelFor(lv, 50000).level.name, 'Серебряный');
  assert.equal(levelFor(lv, 200000).next, null);
});

test('enroll gives welcome points; card + email find the member; the email is unique', () => {
  const { db, hotel } = fresh();
  const m = enroll(db, hotel, { name: guest.name, email: guest.email, phone: guest.phone });
  assert.match(m.card_no, /^\d{8}$/);
  assert.equal(m.points, 500);
  assert.equal(findMember(db, hotel.id, { card: m.card_no, email: 'MARIA@example.com ' }).id, m.id);
  assert.equal(findMember(db, hotel.id, { card: m.card_no, email: 'other@example.com' }), null);
  assert.throws(() => enroll(db, hotel, { name: 'Другая', email: guest.email }), /уже в программе/);
});

test('level discount at booking, points payment with limits, cancel returns points', () => {
  const { db, hotel, book, get, member } = fresh();
  const m = enroll(db, hotel, { name: guest.name, email: guest.email, phone: '' });
  const plain = book(20);
  const b = book(20, { memberId: m.id, memberPct: 10 });
  assert.equal(b.loyalty_discount, Math.round(plain.nights_total * 0.1));
  assert.equal(b.nights_total, plain.nights_total - b.loyalty_discount);
  assert.ok(b.tax_total <= plain.tax_total);
  assert.throws(() => redeem(db, hotel, b, m, 501, user), /до 500/);
  redeem(db, hotel, b, m, 400, user);
  assert.equal(get(b.id).paid_amount, 400);
  assert.equal(member(m.id).points, 100);
  cancelBooking(db, get(b.id));
  assert.equal(member(m.id).points, 500, 'points back after cancellation');
  assert.equal(pointsUsedOn(db, b.id), 0);
  assert.equal(get(b.id).paid_amount, 400, 'paid amount keeps its own refund flow');
});

test('share limit: points pay no more than the set share of the booking', () => {
  const { db, hotel, book, member } = fresh();
  const m = enroll(db, hotel, { name: guest.name, email: guest.email });
  adjust(db, m, 100000, 'подарок', user);
  const b = book(30, { memberId: m.id });
  const cap = Math.floor(b.total * 0.3);
  assert.throws(() => redeem(db, hotel, b, member(m.id), cap + 1, user), /30%/);
  redeem(db, hotel, b, member(m.id), cap, user);
  assert.throws(() => redeem(db, hotel, b, member(m.id), 1, user), /до 0/);
  // A voided points payment gives the points back.
  const p = db.prepare("select * from payments where booking_id = ? and kind = 'points'").get(b.id);
  voidPayment(db, b, p.id, 'ошибка', user);
  assert.equal(member(m.id).points, 100500);
});

test('checkout earns points on the part not paid with points; undo takes them back; level grows', () => {
  const { db, hotel, book, get, member } = fresh();
  const m = enroll(db, hotel, { name: guest.name, email: guest.email });
  const b = book(1, { memberId: m.id });
  redeem(db, hotel, b, m, 200, user);
  db.prepare("update bookings set status = 'checked_out' where id = ?").run(b.id);
  const n = earnOnCheckout(db, hotel, b, user);
  assert.equal(n, Math.floor((b.nights_total - 200) * 0.05));
  assert.equal(member(m.id).points, 500 - 200 + n);
  assert.equal(member(m.id).spent, b.nights_total);
  assert.equal(member(m.id).stays, 1);
  assert.equal(earnOnCheckout(db, hotel, b, user), 0, 'only once');
  revertEarn(db, get(b.id), user);
  assert.equal(member(m.id).points, 300);
  assert.equal(member(m.id).stays, 0);
  db.prepare('update loyalty_members set spent = 60000 where id = ?').run(m.id);
  assert.equal(memberStatus(db, member(m.id)).level.name, 'Серебряный');
  assert.throws(() => adjust(db, member(m.id), -1000, 'списание', user), /столько списать нельзя/);
  removeMember(db, member(m.id));
  assert.equal(get(b.id).member_id, null);
});

test('HTTP: guest joins on the site, books with card and points, staff sees it and checks out', async () => {
  const app = await startApp();
  try {
    const slug = app.db.prepare('select slug from hotels').get().slug;
    const post = (path, body, headers = {}) => fetch(`${app.base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body) });
    assert.match(await (await fetch(`${app.base}/h/${slug}`)).text(), /Программа «Друзья Северного берега»/);
    let r = await post(`/h/${slug}/loyalty/join`, { name: 'Мария Постоянная', email: 'maria@example.com', phone: '+7 900 123-45-67' });
    assert.equal(r.status, 422, 'consent required');
    r = await post(`/h/${slug}/loyalty/join`, { name: 'Мария Постоянная', email: 'maria@example.com', phone: '+7 900 123-45-67', agree: 'on' });
    assert.equal(r.status, 303);
    const cardUrl = r.headers.get('location');
    const cardPage = await (await fetch(`${app.base}${cardUrl}`)).text();
    const card = cardPage.match(/data-card>(\d{8})</)[1];
    assert.match(cardPage, /500/);
    assert.equal((await fetch(`${app.base}/h/${slug}/loyalty/card/${card}/wrongtoken`)).status, 404);
    r = await post(`/h/${slug}/loyalty/login`, { card_no: card, email: 'maria@example.com' });
    assert.equal(r.headers.get('location'), cardUrl.split('?')[0]);

    // Booking with the card: level discount 0% on the base level, 300 points paid.
    app.db.prepare("update loyalty_levels set discount_pct = 5 where name = 'Базовый'").run();
    const type = app.db.prepare("select * from room_types where name = 'Стандарт'").get();
    const rate = app.db.prepare("select * from rate_plans where name = 'Гибкий'").get();
    const ci = addDays(today(), 40), co = addDays(today(), 42);
    const body = { checkin: ci, checkout: co, adults: 2, children: 0, room: type.id, rate: rate.id, guest_name: 'Мария Постоянная', guest_email: 'maria@example.com', guest_phone: '+7 900 123-45-67', agree: 'on', payment: 'hotel' };
    r = await post(`/h/${slug}/book`, { ...body, card_no: card, guest_email: 'other@example.com', idem: crypto.randomUUID() });
    assert.equal(r.status, 422);
    r = await post(`/h/${slug}/book`, { ...body, card_no: card, points: 300, idem: crypto.randomUUID() });
    assert.equal(r.status, 303);
    const conf = await (await fetch(`${app.base}${r.headers.get('location')}`)).text();
    assert.match(conf, /Скидка участника/);
    assert.match(conf, /300 ₽ баллами/);
    const b = app.db.prepare("select * from bookings where guest_email = 'maria@example.com'").get();
    assert.ok(b.loyalty_discount > 0);
    assert.equal(b.paid_amount, 300);

    // Staff: card block, check-in and check-out earn points.
    const { cookie, csrf } = await login(app.base);
    const spost = (path, x) => post(path, { _csrf: csrf, ...x }, { cookie });
    const cardTab = await (await fetch(`${app.base}/app/bookings/${b.id}?tab=details`, { headers: { cookie } })).text();
    assert.match(cardTab, new RegExp(`карта ${card}`));
    app.db.prepare("update bookings set checkin = ?, checkout = ? where id = ?").run(addDays(today(), -2), today(), b.id);
    app.db.prepare('update stay_segments set start = ?, end = ? where booking_id = ?').run(addDays(today(), -2), today(), b.id);
    await spost(`/app/bookings/${b.id}/status`, { status: 'checked_in' });
    r = await spost(`/app/bookings/${b.id}/status`, { status: 'checked_out' });
    assert.match(decodeURIComponent(r.headers.get('location')), /Начислено \d+ баллов/);
    const m = app.db.prepare('select * from loyalty_members where card_no = ?').get(card);
    assert.equal(m.stays, 1);
    const list = await (await fetch(`${app.base}/app/loyalty?q=${card}`, { headers: { cookie } })).text();
    assert.match(list, /Мария Постоянная/);
    const mp = await (await fetch(`${app.base}/app/loyalty/${m.id}`, { headers: { cookie } })).text();
    assert.match(mp, /начислено за проживание/);
    r = await spost(`/app/loyalty/${m.id}/adjust`, { points: '-100', reason: 'проверка' });
    assert.match(decodeURIComponent(r.headers.get('location')), /Готово/);

    // Staff enrols the guest of another booking from the card.
    const hotel = app.db.prepare('select * from hotels where slug = ?').get(slug);
    const other = createBooking(app.db, hotel, { query: { checkin: addDays(today(), 50), checkout: addDays(today(), 51), adults: 1, children: 0, promo: '' }, roomId: type.id, rateId: rate.id, guest: { name: 'Олег Новый', email: 'oleg.new@example.com', phone: '+79005554433' }, staff: true });
    r = await spost(`/app/bookings/${other.id}/loyalty`, { op: 'enroll' });
    assert.match(decodeURIComponent(r.headers.get('location')), /номер карты \d{8}/);
    assert.ok(app.db.prepare('select member_id from bookings where id = ?').get(other.id).member_id);
    r = await spost(`/app/bookings/${other.id}/loyalty`, { op: 'redeem', points: 100 });
    assert.match(decodeURIComponent(r.headers.get('location')), /Баллы списаны/);
    // Another hotel cannot see the member.
    const s2 = await fetch(`${app.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hotel_name: 'Чужой отель', name: 'Пётр Чужой', email: 'other-loyal@example.com', password: 'other-pass-123', property_type: 'hotel', rooms: '5', agree: 'on' }) });
    const oc = s2.headers.get('set-cookie')?.split(';')[0];
    assert.ok(oc);
    assert.equal((await fetch(`${app.base}/app/loyalty/${m.id}`, { headers: { cookie: oc } })).status, 404);

    // Leaving the program deletes the member.
    const leaveUrl = `${cardUrl.split('?')[0]}/leave`;
    r = await post(leaveUrl, {});
    assert.equal(r.status, 200);
    assert.equal(app.db.prepare('select count(*) n from loyalty_members where card_no = ?').get(card).n, 0);
  } finally {
    await app.close();
  }
});
