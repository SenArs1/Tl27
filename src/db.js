import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
create table if not exists hotels (
  id integer primary key,
  slug text not null unique,
  name text not null,
  city text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  description text not null default '',
  checkin_time text not null default '14:00',
  checkout_time text not null default '12:00',
  created_at text not null default (datetime('now'))
);
create table if not exists users (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner','manager')),
  is_platform_admin integer not null default 0,
  created_at text not null default (datetime('now'))
);
create table if not exists sessions (
  id text primary key,
  user_id integer not null references users(id) on delete cascade,
  csrf text not null,
  expires_at text not null
);
-- Extra properties a user can work with (hotel chains). users.hotel_id is the home property.
create table if not exists user_hotels (
  user_id integer not null references users(id) on delete cascade,
  hotel_id integer not null references hotels(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner','manager')),
  primary key (user_id, hotel_id)
);
-- Physical rooms (101, 102 ...). room_types.total_rooms mirrors the count of active rooms.
create table if not exists rooms (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  room_type_id integer not null references room_types(id) on delete cascade,
  number text not null,
  floor integer not null default 1,
  sort integer not null default 0,
  status text not null default 'clean' check (status in ('clean','dirty','repair')),
  note text not null default '',
  active integer not null default 1,
  unique (hotel_id, number)
);
create index if not exists rooms_type on rooms(room_type_id);
create table if not exists extra_groups (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  name text not null,
  sort integer not null default 0
);
create table if not exists payments (
  id integer primary key,
  booking_id integer not null references bookings(id) on delete cascade,
  amount integer not null,
  method text not null check (method in ('cash','card','transfer','online')),
  note text not null default '',
  created_by integer,
  created_at text not null default (datetime('now'))
);
create index if not exists payments_booking on payments(booking_id);
create table if not exists room_types (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  name text not null,
  description text not null default '',
  capacity integer not null check (capacity between 1 and 12),
  beds text not null default '',
  area_m2 integer not null default 0,
  total_rooms integer not null check (total_rooms >= 0),
  base_price integer not null check (base_price >= 0),
  image text not null default 'room-1',
  sort integer not null default 0,
  active integer not null default 1
);
create index if not exists room_types_hotel on room_types(hotel_id);
create table if not exists rate_plans (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  name text not null,
  description text not null default '',
  meal text not null default 'none' check (meal in ('none','breakfast','half')),
  meal_price integer not null default 0,
  refundable integer not null default 1,
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  active integer not null default 1
);
create index if not exists rate_plans_hotel on rate_plans(hotel_id);
create table if not exists inventory (
  room_type_id integer not null references room_types(id) on delete cascade,
  date text not null,
  price integer not null check (price >= 0),
  available integer not null check (available >= 0),
  closed integer not null default 0,
  min_stay integer not null default 1,
  primary key (room_type_id, date)
);
create table if not exists extras (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  name text not null,
  description text not null default '',
  price integer not null check (price >= 0),
  per text not null check (per in ('stay','night','guest_night')),
  active integer not null default 1
);
create table if not exists promo_codes (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  code text not null,
  discount_pct integer not null check (discount_pct between 1 and 90),
  active integer not null default 1,
  unique (hotel_id, code)
);
create table if not exists bookings (
  id integer primary key,
  code text not null unique,
  idem_key text unique,
  hotel_id integer not null references hotels(id) on delete cascade,
  room_type_id integer not null references room_types(id),
  rate_plan_id integer not null references rate_plans(id),
  checkin text not null,
  checkout text not null,
  adults integer not null,
  children integer not null default 0,
  guest_name text not null,
  guest_email text not null,
  guest_phone text not null,
  comment text not null default '',
  extras text not null default '[]',
  promo_code text,
  nights_total integer not null,
  extras_total integer not null,
  discount_total integer not null default 0,
  total integer not null,
  payment text not null default 'hotel' check (payment in ('hotel','card')),
  paid integer not null default 0,
  status text not null default 'confirmed'
    check (status in ('confirmed','checked_in','checked_out','cancelled','no_show')),
  source text not null default 'site',
  created_at text not null default (datetime('now')),
  check (checkout > checkin)
);
create index if not exists bookings_hotel_dates on bookings(hotel_id, checkin);
create table if not exists channels (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  code text not null,
  name text not null,
  commission_pct integer not null default 15,
  connected integer not null default 0,
  markup_pct integer not null default 0,
  unique (hotel_id, code)
);
create table if not exists channel_log (
  id integer primary key,
  channel_id integer not null references channels(id) on delete cascade,
  at text not null default (datetime('now')),
  kind text not null check (kind in ('full','update','booking','disconnect')),
  summary text not null
);
create index if not exists channel_log_channel on channel_log(channel_id, id);
create table if not exists leads (
  id integer primary key,
  name text not null,
  phone text not null,
  email text not null default '',
  property_type text not null default '',
  rooms integer,
  message text not null default '',
  source_page text not null default '',
  created_at text not null default (datetime('now'))
);
`;

// Columns added after the first release. Each is added only when missing, so an
// existing database upgrades in place on the next start.
const COLUMNS = {
  hotels: {
    property_type: "text not null default 'hotel'",
    stars: 'integer not null default 0',
    timezone: "text not null default 'Europe/Moscow'",
    currency: "text not null default 'RUB'",
    child_max_age: 'integer not null default 12',
    min_days_ahead: 'integer not null default 0',
    max_days_ahead: 'integer not null default 365',
    cutoff_time: "text not null default '23:59'",
    pay_at_hotel: 'integer not null default 1',
    pay_card: 'integer not null default 1',
    prepay_pct: 'integer not null default 0',
    cancel_policy: "text not null default ''",
    tax_bp: 'integer not null default 0',
    tax_min_night: 'integer not null default 0',
    notify_email: "text not null default ''",
    inn: "text not null default ''",
    legal_name: "text not null default ''",
    grid_sort: "text not null default 'category'",
    grid_days: 'integer not null default 14',
  },
  users: { is_platform_admin: 'integer not null default 0' },
  sessions: { hotel_id: 'integer' },
  room_types: { extra_beds: 'integer not null default 0' },
  rate_plans: {
    extra_adult_price: 'integer not null default 0',
    extra_child_price: 'integer not null default 0',
  },
  extras: { group_id: 'integer references extra_groups(id) on delete set null' },
  bookings: {
    room_id: 'integer references rooms(id) on delete set null',
    extra_beds_total: 'integer not null default 0',
    tax_total: 'integer not null default 0',
    paid_amount: 'integer not null default 0',
    created_by: 'integer',
    channel_ref: 'text',
  },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`pragma table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) {
      if (!have.has(col)) db.exec(`alter table ${table} add column ${col} ${def}`);
    }
  }
  db.exec('create index if not exists bookings_room on bookings(room_id, checkin)');
  db.exec('create index if not exists bookings_created on bookings(hotel_id, created_at)');
  // Older databases kept payment state as a flag only.
  db.exec("update bookings set paid_amount = total where paid = 1 and paid_amount = 0");
  syncPhysicalRooms(db);
}

// Gives every room type as many physical rooms as its total_rooms (for databases
// created before rooms existed), then assigns rooms to bookings that have none.
export function syncPhysicalRooms(db) {
  const types = db.prepare('select * from room_types order by hotel_id, sort, id').all();
  const count = db.prepare('select count(*) n from rooms where room_type_id = ? and active = 1');
  const taken = db.prepare('select 1 from rooms where hotel_id = ? and number = ?');
  const ins = db.prepare('insert into rooms (hotel_id, room_type_id, number, floor, sort) values (?,?,?,?,?)');
  for (const t of types) {
    let have = count.get(t.id).n;
    if (have > 0 || t.total_rooms === 0) continue;
    const floor = t.sort + 1;
    for (let i = 1; have < t.total_rooms; i++) {
      const number = String(floor * 100 + i);
      if (taken.get(t.hotel_id, number)) continue;
      ins.run(t.hotel_id, t.id, number, floor, floor * 100 + i);
      have++;
    }
  }
  const unassigned = db.prepare("select * from bookings where room_id is null and status not in ('cancelled','no_show') order by checkin, id").all();
  for (const b of unassigned) {
    const r = findFreeRoom(db, b.room_type_id, b.checkin, b.checkout, b.id);
    if (r) db.prepare('update bookings set room_id = ? where id = ?').run(r.id, b.id);
  }
}

// First room of the type (by sort order) with no overlapping stay. null when none.
export function findFreeRoom(db, roomTypeId, checkin, checkout, ignoreBookingId = 0) {
  return db.prepare(`select r.* from rooms r where r.room_type_id = ? and r.active = 1 and r.status != 'repair'
    and not exists (select 1 from bookings b where b.room_id = r.id and b.id != ? and b.status not in ('cancelled','no_show')
      and b.checkin < ? and b.checkout > ?)
    order by r.sort, r.number limit 1`).get(roomTypeId, ignoreBookingId, checkout, checkin) || null;
}

export function roomIsFree(db, roomId, checkin, checkout, ignoreBookingId = 0) {
  return !db.prepare(`select 1 from bookings where room_id = ? and id != ? and status not in ('cancelled','no_show')
    and checkin < ? and checkout > ?`).get(roomId, ignoreBookingId, checkout, checkin);
}

export function openDb(file = process.env.DB_FILE || 'data/stayra.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Runs fn inside BEGIN IMMEDIATE so concurrent writers are serialised.
export function tx(db, fn) {
  db.exec('begin immediate');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}
