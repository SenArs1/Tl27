import { hashPassword } from './lib/auth.js';
import { addDays, isWeekend, todayIn } from './lib/dates.js';
import { createHotel, addPhysicalRooms } from './lib/hotels.js';

export const DEMO = { email: 'demo@stayra.example', password: 'demo12345', hotel: 'severny-bereg' };
export const ADMIN = { email: 'admin@stayra.example', password: 'admin12345' };

// Fills an empty database with one fictional hotel and a platform admin. Safe to call on every start.
export function seed(db, now = new Date()) {
  if (db.prepare('select count(*) n from hotels').get().n > 0) return false;
  const { hotelId } = createHotel(db, {
    name: 'Северный берег', city: 'Петрозаводск', propertyType: 'hotel',
    owner: { email: DEMO.email, name: 'Анна Демо', password: DEMO.password },
  });
  db.prepare(`update hotels set slug = ?, address = ?, phone = ?, email = ?, description = ?, stars = 3,
    tax_bp = 200, tax_min_night = 100, prepay_pct = 30, notify_email = ? where id = ?`).run(
    DEMO.hotel, 'наб. Онежская, 1 (вымышленный адрес)', '+7 900 000-00-01', 'stay@severny.example',
    'Небольшой отель у воды: 22 номера, завтраки из местных продуктов и сауна с видом на озеро.', 'stay@severny.example', hotelId,
  );
  db.prepare("insert into users (hotel_id, email, name, password_hash, role, is_platform_admin) values (?,?,?,?, 'manager', 1)")
    .run(hotelId, ADMIN.email, 'Команда Stayra', hashPassword(ADMIN.password));

  // [name, description, main places, extra beds, beds, m2, base price, image, floor, numbers]
  const types = [
    ['Стандарт', 'Тихий номер окнами во двор, рабочий стол и душ.', 2, 0, 'Двуспальная или две односпальные', 18, 4200, 'room-1', 2, ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210']],
    ['Стандарт с видом на озеро', 'Тот же стандарт, но с панорамным окном на воду.', 2, 1, 'Двуспальная кровать + кресло-кровать', 20, 5300, 'room-2', 3, ['301', '302', '303', '304', '305', '306']],
    ['Семейный', 'Две комнаты: спальня и гостиная с диваном.', 4, 1, 'Двуспальная + диван', 32, 7400, 'room-3', 4, ['401', '402', '403', '404']],
    ['Люкс с сауной', 'Угловой номер с собственной сауной и террасой.', 2, 1, 'Кровать king-size', 45, 11900, 'room-4', 5, ['501', '502']],
  ];
  const insType = db.prepare(`insert into room_types (hotel_id, name, description, capacity, extra_beds, beds, area_m2, total_rooms, base_price, image, sort)
    values (?,?,?,?,?,?,?,0,?,?,?)`);
  const typeIds = types.map((t, i) => {
    const id = Number(insType.run(hotelId, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], i).lastInsertRowid);
    addPhysicalRooms(db, hotelId, id, t[9], t[8]);
    return id;
  });

  db.prepare("update rate_plans set name = 'Гибкий', description = 'Бесплатная отмена до дня заезда. Оплата при заселении.', extra_adult_price = 1500, extra_child_price = 800 where hotel_id = ?").run(hotelId);
  const insRate = db.prepare('insert into rate_plans (hotel_id, name, description, meal, meal_price, refundable, discount_pct, extra_adult_price, extra_child_price) values (?,?,?,?,?,?,?,?,?)');
  insRate.run(hotelId, 'Гибкий с завтраком', 'Завтрак «шведский стол» и бесплатная отмена.', 'breakfast', 650, 1, 0, 1500, 800);
  insRate.run(hotelId, 'Выгодный', 'Скидка 12%. Отмена без возврата оплаты.', 'none', 0, 0, 12, 1300, 700);

  const insGroup = db.prepare('insert into extra_groups (hotel_id, name, sort) values (?,?,?)');
  const gTransfer = Number(insGroup.run(hotelId, 'Трансфер и парковка', 1).lastInsertRowid);
  const gRest = Number(insGroup.run(hotelId, 'Отдых', 2).lastInsertRowid);
  const gStay = Number(insGroup.run(hotelId, 'Проживание', 3).lastInsertRowid);
  const insExtra = db.prepare('insert into extras (hotel_id, name, description, price, per, group_id) values (?,?,?,?,?,?)');
  insExtra.run(hotelId, 'Трансфер с вокзала', 'Встретим и довезём до отеля.', 900, 'stay', gTransfer);
  insExtra.run(hotelId, 'Парковка', 'Охраняемая парковка во дворе.', 400, 'night', gTransfer);
  insExtra.run(hotelId, 'Сауна, 2 часа', 'Общая сауна на первом этаже.', 2500, 'stay', gRest);
  insExtra.run(hotelId, 'Ранний заезд с 08:00', 'Если номер свободен, заселим с утра.', 1500, 'stay', gStay);

  db.prepare('insert into promo_codes (hotel_id, code, discount_pct) values (?,?,?)').run(hotelId, 'ONEGO10', 10);
  db.prepare("update channels set connected = 1 where hotel_id = ? and code in ('tripgo','nochleg')").run(hotelId);

  // 120 days of inventory: weekends cost 15% more.
  const t = todayIn('Europe/Moscow', now);
  const insInv = db.prepare('insert or replace into inventory (room_type_id, date, price, available) values (?,?,?,?)');
  types.forEach((ty, i) => {
    for (let d = 0; d < 120; d++) {
      const date = addDays(t, d);
      const price = isWeekend(date) ? Math.round((ty[6] * 1.15) / 100) * 100 : ty[6];
      insInv.run(typeIds[i], date, price, ty[9].length);
    }
  });
  return true;
}
