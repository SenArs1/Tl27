import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays, today } from '../src/lib/dates.js';
import { parseSearch, placement, priceStay, searchOffers, createBooking, childGroups, ratesMap, changeDates } from '../src/lib/booking.js';
import { validateGuestDoc, mvdDeadline, maskDoc } from '../src/lib/guests.js';
import { startApp, form, stay } from './helpers.js';

const guest = { name: 'Семья Тестовых', email: 'f@example.com', phone: '+79000000000' };
const GROUPS = [
  { id: 1, name: 'Малыши', max_age: 3, no_bed: 1, meal_pct: 0 },
  { id: 2, name: 'Дети', max_age: 7, no_bed: 0, meal_pct: 50 },
  { id: 3, name: 'Школьники', max_age: 14, no_bed: 0, meal_pct: 100 },
];

test('ages: required with children, within the oldest group', () => {
  const h = { child_max_age: 14 };
  const base = { checkin: addDays(today(), 3), checkout: addDays(today(), 5), adults: 2 };
  assert.ok(parseSearch({ ...base, children: 2, ages: '4, 9' }, h).ok);
  assert.deepEqual(parseSearch({ ...base, children: 2, ages: '4,9' }, h).query.ages, [4, 9]);
  assert.match(parseSearch({ ...base, children: 2, ages: '4' }, h).errors.ages, /каждого ребёнка/);
  assert.match(parseSearch({ ...base, children: 1, ages: '14' }, h).errors.ages, /от 0 до 13/);
  assert.ok(parseSearch({ ...base, children: 0 }, h).ok);
});

test('placement: infants take no place, older kids take free main places first', () => {
  const room = { capacity: 2, extra_beds: 1 };
  // 2 adults + 1 baby (no place) + 1 kid of 5 on the extra bed
  const p = placement(room, 2, 2, [1, 5], GROUPS);
  assert.equal(p.noBed.length, 1);
  assert.equal(p.extraChildren, 1);
  assert.ok(p.fits);
  // 1 adult + kids 12 and 5: the 12-year-old takes the free main place, the 5-year-old the extra bed
  const q = placement(room, 1, 2, [5, 12], GROUPS);
  assert.equal(q.kidsExtra[0].age, 5);
  // 2 adults + two kids with a place do not fit one extra bed
  assert.equal(placement(room, 2, 2, [5, 9], GROUPS).fits, false);
});

test('price by age group, meals share, inheritance by derived rates', () => {
  const room = { capacity: 2, extra_beds: 1 };
  const flex = { id: 10, adjust_type: 'pct', adjust_value: 0, extra_child_price: 900, meal_price: 600, childPrices: { 1: 0, 2: 500, 3: 1000 } };
  const promo = { id: 11, parent_id: 10, adjust_type: 'pct', adjust_value: -10, meal_price: 600, childPrices: {} };
  const rates = new Map([[10, flex], [11, promo]]);
  // 2 adults, baby 1 (no place, free, no meal), kid 5 (extra bed 500, meal 50%)
  const p = priceStay({ nightly: [5000, 5000], rate: flex, rates, room, adults: 2, children: 2, ages: [1, 5], groups: GROUPS });
  assert.equal(p.extraBeds, 500 * 2);
  assert.equal(p.meals, Math.round(600 * 2.5 * 2));
  // the 13-year-old would cost 1000 on the extra bed
  assert.equal(priceStay({ nightly: [5000], rate: flex, rates, room, adults: 2, children: 1, ages: [13], groups: GROUPS }).extraBeds, 1000);
  // a derived rate without own child prices inherits the parent's
  assert.equal(priceStay({ nightly: [5000], rate: promo, rates, room, adults: 2, children: 1, ages: [5], groups: GROUPS }).extraBeds, 500);
  // without groups/ages, old behaviour: generic child price
  assert.equal(priceStay({ nightly: [5000], rate: flex, rates, room, adults: 2, children: 1 }).extraBeds, 900);
});

test('seeded hotel: search and booking store ages; date change keeps child prices', () => {
  const db = openDb(':memory:');
  seed(db);
  const hotel = db.prepare('select * from hotels').get();
  assert.equal(childGroups(db, hotel.id).length, 3);
  const q = { checkin: addDays(today(), 20), checkout: addDays(today(), 22), adults: 2, children: 2, ages: [1, 5], promo: '' };
  const lake = searchOffers(db, hotel, q).offers.find((o) => o.room.name === 'Стандарт с видом на озеро');
  assert.ok(lake.available);
  const flex = lake.rates.find((r) => r.rate.name === 'Гибкий').price;
  assert.equal(flex.extraBeds, 600 * 2);
  const std = searchOffers(db, hotel, q).offers.find((o) => o.room.name === 'Стандарт');
  assert.equal(std.reason, 'capacity'); // no extra bed in Standard
  const b = createBooking(db, hotel, { query: q, roomId: lake.room.id, rateId: lake.rates[0].rate.id, guest });
  assert.deepEqual(JSON.parse(b.children_ages), [1, 5]);
  const longer = changeDates(db, hotel, b, q.checkin, addDays(q.checkout, 1));
  const inv = db.prepare('select price from inventory where room_type_id = ? and date = ?').get(lake.room.id, q.checkout).price;
  assert.equal(longer.nights_total - b.nights_total, inv + 600); // + room night + child extra bed
  assert.ok(ratesMap(db, hotel.id).size >= 3);
});

test('guest documents: validation, masking, deadlines', () => {
  const ok = validateGuestDoc({ last_name: 'Иванова', first_name: 'Мария', birth_date: '1990-05-01', citizenship: 'rus', doc_type: 'passport_rf', doc_series: '45 12', doc_number: '123456', doc_code: '770-001' }, { checkin: '2026-11-01' });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.guest.doc_series, '4512');
  assert.equal(ok.guest.citizenship, 'RUS');
  assert.equal(maskDoc(ok.guest), '4512 ••••56');
  const bad = validateGuestDoc({ last_name: 'X1', first_name: '', birth_date: '2030-01-01', citizenship: 'R', doc_type: 'passport_rf', doc_series: '45', doc_number: '12' }, { checkin: '2026-11-01' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['birth_date', 'citizenship', 'doc_number', 'doc_series', 'first_name', 'last_name']);
  const mixed = validateGuestDoc({ last_name: 'Ли', first_name: 'Вэй', birth_date: '1985-01-01', citizenship: 'RUS', doc_type: 'passport_foreign', doc_number: 'E1234567' });
  assert.ok(mixed.errors.doc_type);
  // Friday arrival: Russian citizen — Saturday; foreign citizen — next working day, Monday
  assert.equal(mvdDeadline({ citizenship: 'RUS' }, '2026-10-30'), '2026-10-31');
  assert.equal(mvdDeadline({ citizenship: 'CHN' }, '2026-10-30'), '2026-11-02');
});

test('HTTP: guests and MVD list — add, validate, mark, print, CSV; other hotels see nothing', async () => {
  const ctx = await startApp();
  const login = async (email, password) => {
    const r = await fetch(`${ctx.base}/app/login`, { method: 'POST', redirect: 'manual', body: form({ email, password }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const csrf = (await (await fetch(`${ctx.base}/app`, { headers: { cookie } })).text()).match(/name="_csrf" value="([^"]+)"/)[1];
    return { cookie, csrf };
  };
  try {
    const a = await login('demo@stayra.example', 'demo12345');
    const hotel = ctx.db.prepare('select * from hotels where id = 1').get();
    const type = ctx.db.prepare("select * from room_types where name = 'Семейный'").get();
    const rate = ctx.db.prepare("select * from rate_plans where name = 'Гибкий'").get();
    const b = createBooking(ctx.db, hotel, { query: { checkin: today(), checkout: stay(2).checkin, adults: 2, children: 1, ages: [8], promo: '' }, roomId: type.id, rateId: rate.id, guest: { ...guest, name: 'Петров Пётр' }, staff: true });
    // the card prefills the first guest from the booking name
    const card = await (await fetch(`${ctx.base}/app/bookings/${b.id}?tab=guests`, { headers: { cookie: a.cookie } })).text();
    assert.match(card, /Гости и документы/);
    assert.match(card, /value="Петров"/);
    // invalid data: 422 with messages, nothing stored
    const bad = await fetch(`${ctx.base}/app/bookings/${b.id}/guests`, { method: 'POST', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, last_name: 'Петров', first_name: 'Пётр', birth_date: '1980-02-02', citizenship: 'RUS', doc_type: 'passport_rf', doc_series: '12', doc_number: '1' }) });
    assert.equal(bad.status, 422);
    assert.match(await bad.text(), /Серия паспорта РФ — 4 цифры/);
    const add = (o) => fetch(`${ctx.base}/app/bookings/${b.id}/guests`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, ...o }) });
    await add({ last_name: 'Петров', first_name: 'Пётр', birth_date: '1980-02-02', citizenship: 'RUS', doc_type: 'passport_rf', doc_series: '4010', doc_number: '654321', reg_address: 'г. Тестовск, ул. Примерная, 1' });
    await add({ last_name: 'Ван', first_name: 'Мин', birth_date: '1982-03-03', citizenship: 'CHN', doc_type: 'passport_foreign', doc_number: 'E7654321', migration_card: '4519 1234567' });
    const guests = ctx.db.prepare('select * from booking_guests where booking_id = ?').all(b.id);
    assert.equal(guests.length, 2);
    // the card shows masked numbers only
    const card2 = await (await fetch(`${ctx.base}/app/bookings/${b.id}?tab=guests`, { headers: { cookie: a.cookie } })).text();
    assert.doesNotMatch(card2, /654321/);
    assert.match(card2, /••••21/);
    // editing without a number keeps it
    await fetch(`${ctx.base}/app/bookings/${b.id}/guests/${guests[0].id}`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, last_name: 'Петров', first_name: 'Пётр', middle_name: 'Ильич', birth_date: '1980-02-02', citizenship: 'RUS', doc_type: 'passport_rf', doc_series: '4010', doc_number: '' }) });
    const edited = ctx.db.prepare('select * from booking_guests where id = ?').get(guests[0].id);
    assert.equal(edited.doc_number, '654321');
    assert.equal(edited.middle_name, 'Ильич');
    // printable registration card has the full data
    const print = await fetch(`${ctx.base}/app/bookings/${b.id}/guests/${guests[0].id}/card`, { headers: { cookie: a.cookie } });
    assert.equal(print.headers.get('cache-control'), 'no-store');
    assert.match(await print.text(), /4010 654321/);
    // report lists both as not sent; CSV carries full numbers; bulk mark
    const rep = await (await fetch(`${ctx.base}/app/reports?tab=mvd`, { headers: { cookie: a.cookie } })).text();
    assert.match(rep, /Ван Мин/);
    assert.match(rep, /Брони без полного списка гостей/); // 3 guests booked, 2 documented
    const csv = await (await fetch(`${ctx.base}/app/reports?tab=mvd&format=csv`, { headers: { cookie: a.cookie } })).text();
    assert.match(csv, /654321/);
    await fetch(`${ctx.base}/app/reports/mvd/mark`, { method: 'POST', redirect: 'manual', headers: { cookie: a.cookie }, body: form({ _csrf: a.csrf, ids: guests.map((g) => g.id), status: 'sent' }) });
    assert.deepEqual(ctx.db.prepare('select distinct mvd_status s from booking_guests where booking_id = ?').all(b.id).map((x) => x.s), ['sent']);

    // another hotel: no access to the guests, the card or the list
    await fetch(`${ctx.base}/signup`, { method: 'POST', redirect: 'manual', body: form({ hotel_name: 'Другой отель', name: 'Владелец', email: 'other@example.com', password: 'password123', agree: 'on' }) });
    const o = await login('other@example.com', 'password123');
    assert.equal((await fetch(`${ctx.base}/app/bookings/${b.id}/guests/${guests[0].id}/card`, { headers: { cookie: o.cookie } })).status, 404);
    assert.equal((await fetch(`${ctx.base}/app/bookings/${b.id}/guests`, { method: 'POST', headers: { cookie: o.cookie }, body: form({ _csrf: o.csrf, last_name: 'Взлом', first_name: 'Х', birth_date: '1990-01-01', citizenship: 'RUS', doc_type: 'other', doc_number: '123' }) })).status, 404);
    const mark = await fetch(`${ctx.base}/app/reports/mvd/mark`, { method: 'POST', redirect: 'manual', headers: { cookie: o.cookie }, body: form({ _csrf: o.csrf, ids: guests.map((g) => g.id), status: 'not_required' }) });
    assert.match(decodeURIComponent(mark.headers.get('location')), /Отмечено гостей: 0/);
    const otherCsv = await (await fetch(`${ctx.base}/app/reports?tab=mvd&from=2020-01-01&to=2030-12-31&format=csv`, { headers: { cookie: o.cookie } })).text();
    assert.doesNotMatch(otherCsv, /654321/);

    // engine: ages in the search, error without them
    const noAges = await fetch(`${ctx.base}/h/severny-bereg/rooms?checkin=${stay(30).checkin}&checkout=${stay(32).checkin}&adults=2&children=1`);
    assert.equal(noAges.status, 422);
    assert.match(await noAges.text(), /Укажите возраст каждого ребёнка/);
    const withAges = await (await fetch(`${ctx.base}/h/severny-bereg/rooms?checkin=${stay(30).checkin}&checkout=${stay(32).checkin}&adults=2&children=1&ages=5`)).text();
    assert.match(withAges, /дети: 5/);
    assert.match(withAges, /ages=5/); // carried to the checkout link
  } finally {
    await ctx.close();
  }
});
