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
-- Parts of a stay. A booking covers [checkin, checkout); its segments split that
-- range without gaps, each in one category and (once assigned) one physical room.
create table if not exists stay_segments (
  id integer primary key,
  booking_id integer not null references bookings(id) on delete cascade,
  hotel_id integer not null references hotels(id) on delete cascade,
  room_type_id integer not null references room_types(id),
  room_id integer references rooms(id) on delete set null,
  start text not null,
  end text not null,
  check (end > start)
);
create index if not exists segments_booking on stay_segments(booking_id, start);
create index if not exists segments_room on stay_segments(room_id, start);
-- Child age groups of a hotel. A child belongs to the first group whose max_age is
-- above the child's age (max_age is exclusive: "до 3 лет" = 0, 1, 2).
-- no_bed: the child does not take a place (sleeps with parents or in a cot).
create table if not exists child_age_groups (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  name text not null,
  max_age integer not null check (max_age between 1 and 18),
  no_bed integer not null default 0,
  meal_pct integer not null default 100 check (meal_pct between 0 and 100),
  unique (hotel_id, max_age)
);
-- Price per night of a child of a group under a rate: on an extra place, or without a place.
create table if not exists rate_child_prices (
  rate_id integer not null references rate_plans(id) on delete cascade,
  group_id integer not null references child_age_groups(id) on delete cascade,
  price integer not null check (price >= 0),
  primary key (rate_id, group_id)
);
-- Guests of a booking with identity documents, for registration with the migration
-- service (MVD). Sensitive personal data: shown only inside the hotel's cabinet.
create table if not exists booking_guests (
  id integer primary key,
  booking_id integer not null references bookings(id) on delete cascade,
  hotel_id integer not null references hotels(id) on delete cascade,
  last_name text not null,
  first_name text not null,
  middle_name text not null default '',
  birth_date text not null,
  sex text not null default '' check (sex in ('', 'm', 'f')),
  citizenship text not null default 'RUS',
  doc_type text not null,
  doc_series text not null default '',
  doc_number text not null,
  doc_issued_at text not null default '',
  doc_issued_by text not null default '',
  doc_code text not null default '',
  reg_address text not null default '',
  migration_card text not null default '',
  visa text not null default '',
  mvd_status text not null default 'new' check (mvd_status in ('new','sent','not_required')),
  mvd_sent_at text,
  created_at text not null default (datetime('now'))
);
create index if not exists booking_guests_booking on booking_guests(booking_id);
create index if not exists booking_guests_hotel on booking_guests(hotel_id, mvd_status);
-- Who changed what in a booking, with the old and new value.
create table if not exists booking_events (
  id integer primary key,
  booking_id integer not null references bookings(id) on delete cascade,
  hotel_id integer not null references hotels(id) on delete cascade,
  at text not null default (datetime('now')),
  user_id integer,
  user_name text not null default 'система',
  what text not null,
  old_value text not null default '',
  new_value text not null default ''
);
create index if not exists booking_events_booking on booking_events(booking_id, id);
-- Tags: a hotel's own labels for bookings ("VIP", "ранний заезд" ...).
create table if not exists hotel_tags (
  id integer primary key,
  hotel_id integer not null references hotels(id) on delete cascade,
  name text not null,
  color text not null default 'teal',
  active integer not null default 1,
  unique (hotel_id, name)
);
create table if not exists booking_tags (
  booking_id integer not null references bookings(id) on delete cascade,
  tag_id integer not null references hotel_tags(id) on delete cascade,
  primary key (booking_id, tag_id)
);
-- Notes and tasks on a booking; due_at turns a note into a task with a deadline.
create table if not exists booking_notes (
  id integer primary key,
  booking_id integer not null references bookings(id) on delete cascade,
  hotel_id integer not null references hotels(id) on delete cascade,
  text text not null,
  due_at text,
  done integer not null default 0,
  created_by text not null default '',
  created_at text not null default (datetime('now'))
);
create index if not exists booking_notes_hotel on booking_notes(hotel_id, done, due_at);
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
    placement_mode: "text not null default 'auto'",
  },
  users: { is_platform_admin: 'integer not null default 0' },
  sessions: { hotel_id: 'integer' },
  room_types: { extra_beds: 'integer not null default 0' },
  rate_plans: {
    extra_adult_price: 'integer not null default 0',
    extra_child_price: 'integer not null default 0',
    parent_id: 'integer references rate_plans(id) on delete set null',
    adjust_type: "text not null default 'pct'",
    adjust_value: 'integer not null default 0',
    rounding: 'integer not null default 0',
    single_discount: 'integer not null default 0',
  },
  payments: {
    kind: "text not null default 'payment'",
    voided: 'integer not null default 0',
    void_reason: "text not null default ''",
    ref_booking_id: 'integer',
  },
  inventory: {
    cta: 'integer not null default 0',
    ctd: 'integer not null default 0',
  },
  extras: { group_id: 'integer references extra_groups(id) on delete set null' },
  bookings: {
    room_id: 'integer references rooms(id) on delete set null',
    extra_beds_total: 'integer not null default 0',
    tax_total: 'integer not null default 0',
    paid_amount: 'integer not null default 0',
    created_by: 'integer',
    channel_ref: 'text',
    children_ages: "text not null default '[]'",
    checked_in_at: 'text',
    checked_out_at: 'text',
    customer_name: "text not null default ''",
    customer_phone: "text not null default ''",
    customer_inn: "text not null default ''",
    purpose: "text not null default ''",
    arrival_time: "text not null default ''",
    departure_time: "text not null default ''",
  },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`pragma table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) {
      if (!have.has(col)) db.exec(`alter table ${table} add column ${col} ${def}`);
    }
  }
  db.exec('create index if not exists bookings_created on bookings(hotel_id, created_at)');
  // Older databases kept payment state as a flag only.
  db.exec("update bookings set paid_amount = total where paid = 1 and paid_amount = 0");
  // Rate discounts became adjustments: "-12%" instead of discount_pct = 12.
  db.exec("update rate_plans set adjust_type = 'pct', adjust_value = -discount_pct, discount_pct = 0 where discount_pct > 0 and adjust_value = 0");
  // Hotels without age groups get one group "Дети" that keeps the old single-price behaviour.
  db.exec(`insert into child_age_groups (hotel_id, name, max_age) select h.id, 'Дети', max(1, min(18, h.child_max_age)) from hotels h
    where not exists (select 1 from child_age_groups g where g.hotel_id = h.id)`);
  // Bookings from before segments: one segment with the booking's room.
  db.exec(`insert into stay_segments (booking_id, hotel_id, room_type_id, room_id, start, end)
    select b.id, b.hotel_id, b.room_type_id, b.room_id, b.checkin, b.checkout from bookings b
    where not exists (select 1 from stay_segments s where s.booking_id = b.id)`);
  syncPhysicalRooms(db);
}

const LIVE = "('cancelled','no_show')";

// Gives every room type as many physical rooms as its total_rooms (for databases
// created before rooms existed), then puts unassigned segments into free rooms.
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
  const unassigned = db.prepare(`select s.* from stay_segments s join bookings b on b.id = s.booking_id
    where s.room_id is null and b.status not in ${LIVE} order by s.start, s.id`).all();
  for (const seg of unassigned) {
    const r = findFreeRoom(db, seg.room_type_id, seg.start, seg.end, seg.booking_id);
    if (r) db.prepare('update stay_segments set room_id = ? where id = ?').run(r.id, seg.id);
  }
}

// First room of the type (by sort order) with no overlapping stay. null when none.
export function findFreeRoom(db, roomTypeId, start, end, ignoreBookingId = 0) {
  return db.prepare(`select r.* from rooms r where r.room_type_id = ? and r.active = 1 and r.status != 'repair'
    and not exists (select 1 from stay_segments s join bookings b on b.id = s.booking_id
      where s.room_id = r.id and s.booking_id != ? and b.status not in ${LIVE} and s.start < ? and s.end > ?)
    order by r.sort, r.number limit 1`).get(roomTypeId, ignoreBookingId, end, start) || null;
}

// Whether a room is free for [start, end), not counting the booking being changed.
export function roomIsFree(db, roomId, start, end, ignoreBookingId = 0) {
  return !db.prepare(`select 1 from stay_segments s join bookings b on b.id = s.booking_id
    where s.room_id = ? and s.booking_id != ? and b.status not in ${LIVE} and s.start < ? and s.end > ?`).get(roomId, ignoreBookingId, end, start);
}

export function openDb(file = process.env.DB_FILE || 'data/stayra.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Runs fn inside BEGIN IMMEDIATE so concurrent writers are serialised. Calls nest:
// an inner tx() inside an outer one simply runs in the outer transaction, so
// operations can be combined (move room + change dates) and still commit together.
export function tx(db, fn) {
  if (db._txDepth) {
    db._txDepth++;
    try {
      return fn();
    } finally {
      db._txDepth--;
    }
  }
  db.exec('begin immediate');
  db._txDepth = 1;
  try {
    const out = fn();
    db._txDepth = 0;
    db.exec('commit');
    return out;
  } catch (e) {
    db._txDepth = 0;
    db.exec('rollback');
    throw e;
  }
}
