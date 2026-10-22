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
  created_at text not null default (datetime('now'))
);
create table if not exists sessions (
  id text primary key,
  user_id integer not null references users(id) on delete cascade,
  csrf text not null,
  expires_at text not null
);
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

export function openDb(file = process.env.DB_FILE || 'data/stayra.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
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
