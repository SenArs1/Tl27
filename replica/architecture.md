# Architecture: Stayra

## Stack

| layer | choice | why |
| --- | --- | --- |
| runtime | Node.js 22 | already in the environment, built-in SQLite and test runner |
| web | Express 4, server-rendered HTML from template functions | one process, no build step, fast pages, works without JS |
| client JS | small vanilla modules (`public/js`) | price constructor, guest counter, inline grid edits |
| database | SQLite via `node:sqlite` (file `data/stayra.db`) | zero setup; schema is portable to Postgres |
| auth | email + password (scrypt), signed http-only session cookie | no third-party account needed |
| payments | "pay at hotel" + test card method (no money) | real acquiring needs the owner's contract |
| tests | `node --test` (unit + HTTP), Playwright (e2e + axe) | Chromium is preinstalled |
| hosting | any Node host (Render, Fly, a VPS) with a persistent disk | SQLite file needs a disk |

One process, one database. No microservices.

## Schema

See `src/db.js`. Tables: hotels, users, room_types, rate_plans, inventory,
extras, promo_codes, bookings, channels, channel_log, leads, sessions.

- money as integer roubles (the product sells in RUB only; prices have no kopecks)
- dates as `YYYY-MM-DD` text, the stay is `[checkin, checkout)`
- `inventory (room_type_id, date)` primary key; `available` = rooms left to sell,
  `closed` = stop-sale flag, `price` = base nightly price
- every hotel-owned row carries `hotel_id`; every extranet query filters by the
  signed-in user's `hotel_id` (one authorisation point: `req.user.hotel_id`)

### No overbooking

Booking creation runs in one `BEGIN IMMEDIATE` transaction: re-read inventory for
every night, check `available > 0 and closed = 0`, decrement, insert booking.
SQLite serialises writers, so two guests cannot take the last room. Cancelling
returns the rooms in the same way.

## Routes

### Marketing
| method path | what |
| --- | --- |
| GET / | home |
| GET /products, /products/:slug | catalog, product page |
| GET /solutions/:type | bundle per property type |
| GET /price | price constructor (calc also in `src/lib/pricing.js` for tests) |
| GET /demo, POST /demo | lead form |
| GET /contacts, /about | static |
| GET /support, /support/:slug | knowledge base, `?q=` search |

### Booking engine (public)
| method path | what | flow |
| --- | --- | --- |
| GET /h/:hotel | search form | F01 |
| GET /h/:hotel/rooms?checkin&checkout&adults&children&promo | offers | F01 |
| GET /h/:hotel/checkout?room&rate&... | guest form | F01 |
| POST /h/:hotel/book | create booking (transaction) | F01 |
| GET /h/:hotel/booking/:code?email | confirmation | F01 |
| GET/POST /h/:hotel/manage | find booking | F02 |
| POST /h/:hotel/booking/:code/cancel | cancel | F02 |
| GET /api/h/:hotel/offers | JSON offers for the embeddable widget | F01 |
| GET /widget.js | embed script | — |

### Extranet (signed in)
| method path | what | flow |
| --- | --- | --- |
| GET/POST /app/login, POST /app/logout | auth | F03 |
| GET /app | dashboard | F03 |
| GET /app/bookings, /app/bookings/:id, POST /app/bookings/:id/status | bookings | F03 |
| GET /app/grid, POST /app/grid (JSON), POST /app/grid/bulk | chessboard | F04 |
| GET /app/rooms, POST /app/rooms, POST /app/rooms/:id, POST /app/rates... | room types & rates | F08 |
| GET /app/channels, POST /app/channels/:id/toggle | channel manager | F05 |
| GET /app/leads | leads | F06 |
| GET /app/reports | occupancy & revenue | — |
| GET/POST /app/settings | hotel settings + embed code | — |

All POST forms carry a CSRF token tied to the session.

## Parts that bite

- dates: all stay maths on `YYYY-MM-DD` strings in UTC, never local `Date` hours
- double submit on booking: an idempotency key (hidden form field) is unique per booking
- price changed between results and checkout: price recalculated on the server at book time and shown again on the confirmation
- inventory rows missing for far dates: auto-created from room defaults for the next 365 days

## Build order

1. Shell + DB + seed (one demo hotel "Северный берег" — fictional)
2. Vertical slice F01 (search → rooms → checkout → confirmation)
3. Extranet: login, dashboard, bookings, grid, channels
4. Marketing pages, price constructor, demo form, KB
5. Rooms/rates CRUD, reports, settings, widget
6. Tests, parity, sweep
