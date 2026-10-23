import { tx } from '../db.js';
import { hashPassword } from './auth.js';

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

export function slugify(name) {
  const s = String(name).toLowerCase().split('').map((c) => TR[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'hotel';
}

export function uniqueSlug(db, name) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; db.prepare('select 1 from hotels where slug = ?').get(slug); i++) slug = `${base}-${i}`;
  return slug;
}

// Fictional sales channels: the channel layer is simulated until real contracts exist.
export const DEFAULT_CHANNELS = [
  ['tripgo', 'TripGo', 15], ['nochleg', 'Ночлег.ру', 12], ['roomhub', 'RoomHub', 17], ['putnik', 'Путник', 10], ['travelmarket', 'Маркет путешествий', 14],
];

export const PROPERTY_TYPES = [
  ['hotel', 'Гостиница'], ['mini', 'Мини-отель'], ['hostel', 'Хостел'], ['apartments', 'Апартаменты'],
  ['resort', 'Загородный отель / база отдыха'], ['glamping', 'Глэмпинг'], ['sanatorium', 'Санаторий'], ['guesthouse', 'Гостевой дом'],
];

// Creates a property with the minimum it needs to start selling: a base rate and the channel list.
export function createHotel(db, { name, city = '', propertyType = 'hotel', owner = null, ownerUserId = null }) {
  return tx(db, () => {
    const slug = uniqueSlug(db, name);
    const h = db.prepare('insert into hotels (slug, name, city, property_type, cancel_policy) values (?,?,?,?,?)').run(
      slug, name, city, propertyType, 'Бесплатная отмена до 14:00 за сутки до заезда. При более поздней отмене удерживается стоимость первой ночи.',
    );
    const hotelId = Number(h.lastInsertRowid);
    db.prepare("insert into rate_plans (hotel_id, name, description) values (?, 'Базовый', 'Оплата при заселении, бесплатная отмена.')").run(hotelId);
    const insCh = db.prepare('insert into channels (hotel_id, code, name, commission_pct) values (?,?,?,?)');
    for (const c of DEFAULT_CHANNELS) insCh.run(hotelId, ...c);
    let userId = ownerUserId;
    if (owner) {
      userId = Number(db.prepare("insert into users (hotel_id, email, name, password_hash, role) values (?,?,?,?, 'owner')")
        .run(hotelId, owner.email, owner.name, hashPassword(owner.password)).lastInsertRowid);
    } else if (ownerUserId) {
      db.prepare("insert into user_hotels (user_id, hotel_id, role) values (?, ?, 'owner')").run(ownerUserId, hotelId);
    }
    return { hotelId, slug, userId };
  });
}

// Adds physical rooms to a category and keeps total_rooms and future availability in step.
export function addPhysicalRooms(db, hotelId, roomTypeId, numbers, floor = 1) {
  return tx(db, () => {
    const type = db.prepare('select * from room_types where id = ? and hotel_id = ?').get(roomTypeId, hotelId);
    if (!type) throw new Error('room type not found');
    const exists = db.prepare('select 1 from rooms where hotel_id = ? and number = ?');
    const ins = db.prepare('insert into rooms (hotel_id, room_type_id, number, floor, sort) values (?,?,?,?,?)');
    const added = [];
    const skipped = [];
    for (const n of numbers) {
      if (exists.get(hotelId, n)) { skipped.push(n); continue; }
      const numeric = Number.parseInt(n, 10);
      ins.run(hotelId, roomTypeId, n, floor, Number.isFinite(numeric) ? numeric : 9999);
      added.push(n);
    }
    if (added.length) recountRooms(db, roomTypeId);
    return { added, skipped };
  });
}

// total_rooms = active rooms; future inventory shifts by the difference.
export function recountRooms(db, roomTypeId) {
  const type = db.prepare('select * from room_types where id = ?').get(roomTypeId);
  const n = db.prepare('select count(*) n from rooms where room_type_id = ? and active = 1').get(roomTypeId).n;
  const delta = n - type.total_rooms;
  if (!delta) return;
  db.prepare('update room_types set total_rooms = ? where id = ?').run(n, roomTypeId);
  db.prepare("update inventory set available = max(0, min(?, available + ?)) where room_type_id = ? and date >= date('now')").run(n, delta, roomTypeId);
}
