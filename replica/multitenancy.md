# How hotels are kept apart (multi-tenancy)

## Now

**One database, every record tagged with its hotel.** Every hotel table
(`room_types`, `rooms`, `rate_plans`, `inventory` via the category, `bookings`,
`extras`, `extra_groups`, `promo_codes`, `channels`, `payments` via the booking)
carries `hotel_id`.

**One way into the data.** All of the cabinet's reads go through
`scope(db, hotelId)` (`src/lib/scope.js`), which is bound to the hotel of the
current session. A record from another hotel is "not found" (404), not "forbidden":
the system doesn't even reveal that it exists. Writes check ownership the same way
before changing anything.

**Session → hotel.** On login the user lands in their home hotel. A chain owner or a
manager with access to several properties (`user_hotels` table) switches between them
in the menu. The server checks on every request that the user really has access to the
selected hotel.

**Roles.** Owner: everything, including settings and staff. Administrator: bookings,
chessboard, prices, rooms; no settings, no staff.

**Platform team.** The `/admin` page (`is_platform_admin` flag) shows the list of all
properties and the leads from the website. Hotels can't see leads.

**Public side.** The booking engine `/h/<slug>` only shows its own hotel's data;
a guest's booking page opens with a signed token.

**Isolation tests:** `tests/tenancy.test.js`. Hotel B tries to open, cancel, pay for,
move, rename, delete and switch hotel A's records. It gets 404 everywhere, and the
test also checks that nothing changed in A's data.

## When there are dozens or hundreds of hotels (plan)

1. **PostgreSQL instead of SQLite**, with **Row Level Security**: the database itself
   won't return another hotel's rows, even if a check is forgotten in the code.
   `SET app.hotel_id = …` at the start of every request.
2. **Organization → properties → users**: a separate "organization" entity for
   chains (shared guest base, consolidated reports), with roles across the organization
   and per property. Add roles "Горничная" (housekeeping only, no personal data) and
   "Инвестор" (reports only).
3. **Limits per hotel** (requests, imports) so that one large customer can't slow
   down the others.
4. **Backups and restore per hotel**: export and delete one hotel's data (152-FZ
   personal data law, contract termination).
5. **Large chains on a separate database** (same code, a different connection
   string), if the contract requires it.
6. **Change audit**: who changed what and when (the competitors have this in the booking card).

## Guests' personal data (since v4)

Passport data (`booking_guests`) is stored with `hotel_id` and is only accessible within that hotel; tests check that another hotel gets 404 on the card, the form and the marks, and an empty CSV. In lists the number is masked, the edit form never sends it to the browser, and the printable form and export are served with `no-store`. For production: encrypting these columns at rest, a retention period with automatic deletion, and an access log.
