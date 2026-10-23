// Tenant boundary. Every read in the extranet goes through a scope bound to one
// hotel, so a record of another hotel is simply "not found".
export function scope(db, hotelId) {
  const one = (sql) => (id) => db.prepare(sql).get(Number(id) || 0, hotelId) || null;
  const all = (sql) => () => db.prepare(sql).all(hotelId);
  return {
    hotelId,
    hotel: () => db.prepare('select * from hotels where id = ?').get(hotelId),
    types: all('select * from room_types where hotel_id = ? order by sort, id'),
    activeTypes: all('select * from room_types where hotel_id = ? and active = 1 order by sort, id'),
    type: one('select * from room_types where id = ? and hotel_id = ?'),
    rooms: all(`select r.*, t.name as type_name, t.sort as type_sort from rooms r join room_types t on t.id = r.room_type_id
      where r.hotel_id = ? and r.active = 1 order by t.sort, t.id, r.sort, r.number`),
    room: one('select * from rooms where id = ? and hotel_id = ? and active = 1'),
    rates: all('select * from rate_plans where hotel_id = ? order by id'),
    activeRates: all('select * from rate_plans where hotel_id = ? and active = 1 order by id'),
    rate: one('select * from rate_plans where id = ? and hotel_id = ?'),
    groups: all('select * from extra_groups where hotel_id = ? order by sort, id'),
    group: one('select * from extra_groups where id = ? and hotel_id = ?'),
    extras: all('select * from extras where hotel_id = ? order by id'),
    activeExtras: all('select * from extras where hotel_id = ? and active = 1 order by id'),
    extra: one('select * from extras where id = ? and hotel_id = ?'),
    promos: all('select * from promo_codes where hotel_id = ? order by id'),
    promo: one('select * from promo_codes where id = ? and hotel_id = ?'),
    booking: one('select * from bookings where id = ? and hotel_id = ?'),
    channels: all('select * from channels where hotel_id = ? order by connected desc, id'),
    channel: one('select * from channels where id = ? and hotel_id = ?'),
    users: () => db.prepare(`select id, name, email, role from users where hotel_id = ?
      union select u.id, u.name, u.email, uh.role from user_hotels uh join users u on u.id = uh.user_id where uh.hotel_id = ? order by 2`).all(hotelId, hotelId),
  };
}

// Bookings joined with category and room numbers ("201 → 305" for a split stay) —
// the shape most lists need. unassigned > 0 means some part of the stay has no room.
export const BOOKING_LIST = `select b.*, t.name as room_name,
  (select group_concat(number, ' → ') from (select r.number from stay_segments s join rooms r on r.id = s.room_id where s.booking_id = b.id order by s.start)) as room_number,
  (select count(*) from stay_segments s where s.booking_id = b.id and s.room_id is null) as unassigned
  from bookings b join room_types t on t.id = b.room_type_id where b.hotel_id = ?`;
