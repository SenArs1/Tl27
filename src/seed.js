import { hashPassword } from './lib/auth.js';
import { addDays, isWeekend, today } from './lib/dates.js';

export const DEMO = { email: 'demo@stayra.example', password: 'demo12345', hotel: 'severny-bereg' };

// Fills an empty database with one fictional hotel. Safe to call on every start.
export function seed(db, now = new Date()) {
  if (db.prepare('select count(*) n from hotels').get().n > 0) return false;
  const h = db.prepare(`insert into hotels (slug, name, city, address, phone, email, description)
    values (?,?,?,?,?,?,?)`).run(
    DEMO.hotel, 'Северный берег', 'Петрозаводск', 'наб. Онежская, 1 (вымышленный адрес)', '+7 900 000-00-01', 'stay@severny.example',
    'Небольшой отель у воды: 24 номера, завтраки из местных продуктов и сауна с видом на озеро.',
  );
  const hotelId = Number(h.lastInsertRowid);
  db.prepare('insert into users (hotel_id, email, name, password_hash) values (?,?,?,?)')
    .run(hotelId, DEMO.email, 'Анна Демо', hashPassword(DEMO.password));

  const rooms = [
    ['Стандарт', 'Тихий номер окнами во двор, рабочий стол и душ.', 2, 'Двуспальная или две односпальные', 18, 10, 4200, 'room-1'],
    ['Стандарт с видом на озеро', 'Тот же стандарт, но с панорамным окном на воду.', 2, 'Двуспальная кровать', 20, 6, 5300, 'room-2'],
    ['Семейный', 'Две комнаты: спальня и гостиная с диваном.', 4, 'Двуспальная + диван', 32, 4, 7400, 'room-3'],
    ['Люкс с сауной', 'Угловой номер с собственной сауной и террасой.', 3, 'Кровать king-size', 45, 2, 11900, 'room-4'],
  ];
  const insRoom = db.prepare(`insert into room_types (hotel_id, name, description, capacity, beds, area_m2, total_rooms, base_price, image, sort)
    values (?,?,?,?,?,?,?,?,?,?)`);
  const roomIds = rooms.map((r, i) => Number(insRoom.run(hotelId, ...r, i).lastInsertRowid));

  const insRate = db.prepare('insert into rate_plans (hotel_id, name, description, meal, meal_price, refundable, discount_pct) values (?,?,?,?,?,?,?)');
  insRate.run(hotelId, 'Гибкий', 'Бесплатная отмена до дня заезда. Оплата при заселении.', 'none', 0, 1, 0);
  insRate.run(hotelId, 'Гибкий с завтраком', 'Завтрак «шведский стол» и бесплатная отмена.', 'breakfast', 650, 1, 0);
  insRate.run(hotelId, 'Выгодный', 'Скидка 12%. Отмена без возврата оплаты.', 'none', 0, 0, 12);

  const insExtra = db.prepare('insert into extras (hotel_id, name, description, price, per) values (?,?,?,?,?)');
  insExtra.run(hotelId, 'Трансфер с вокзала', 'Встретим и довезём до отеля.', 900, 'stay');
  insExtra.run(hotelId, 'Парковка', 'Охраняемая парковка во дворе.', 400, 'night');
  insExtra.run(hotelId, 'Сауна, 2 часа', 'Общая сауна на первом этаже.', 2500, 'stay');
  insExtra.run(hotelId, 'Ранний заезд с 08:00', 'Если номер свободен, заселим с утра.', 1500, 'stay');

  db.prepare('insert into promo_codes (hotel_id, code, discount_pct) values (?,?,?)').run(hotelId, 'ONEGO10', 10);

  const insCh = db.prepare('insert into channels (hotel_id, code, name, commission_pct, connected) values (?,?,?,?,?)');
  // Fictional sales channels: the clone simulates the channel layer.
  [['tripgo', 'TripGo', 15, 1], ['nochleg', 'Ночлег.ру', 12, 1], ['roomhub', 'RoomHub', 17, 0], ['putnik', 'Путник', 10, 0], ['travelmarket', 'Маркет путешествий', 14, 0]]
    .forEach((c) => insCh.run(hotelId, ...c));

  // 120 days of inventory: weekends cost 15% more.
  const t = today(now);
  const insInv = db.prepare('insert into inventory (room_type_id, date, price, available) values (?,?,?,?)');
  rooms.forEach((r, i) => {
    for (let d = 0; d < 120; d++) {
      const date = addDays(t, d);
      const price = isWeekend(date) ? Math.round((r[6] * 1.15) / 100) * 100 : r[6];
      insInv.run(roomIds[i], date, price, r[5]);
    }
  });
  return true;
}
