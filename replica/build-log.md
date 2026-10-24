# Build log

| step | result | notes |
| --- | --- | --- |
| recon | done | 10 public pages, headings and layout only; screenshots kept outside the repo |
| architect | done | Node 22 + Express + node:sqlite, server-rendered pages, a single process |
| design | done | own tokens: green #0e5e48 + amber #f2b33d; contrast 19 pairs, 0 AA failures |
| S01–S09 marketing | done | all copy written from scratch; illustrations in CSS/SVG |
| S10–S14 booking engine | done | atomic booking in BEGIN IMMEDIATE, idempotency key, signed guest booking link |
| S20–S28 extranet | done | CSRF, scrypt, login rate limit, every query scoped to hotel_id |
| channel manager | partial by design | channels are simulated: sync log, full export on connect, deltas on changes |
| tests | 16 unit/HTTP + 18 e2e | desktop + mobile, axe wcag2a/aa (serious/critical = 0) |
| brand sweep | clean | no trace of the original's name, domain or colours |

## Bugs found by tests and fixed

| id | sev | what | fix |
| --- | --- | --- | --- |
| B1 | S3 | duplicate `id`s in the edit forms on the "Rooms and rates" page: labels pointed to the wrong fields | `prefix` option on `field()`, a unique prefix per form |
| B2 | S2 | on mobile the extranet was 683px wide and buttons in tables were unreachable | `minmax(0,1fr)` in `.app-shell`/`.app-content`, `position:relative` on `.table-wrap` |
| B3 | S3 | scrollable tables weren't keyboard-focusable (axe scrollable-region-focusable) | `tabindex=0`, `role=region`, `aria-label` |
| B4 | S4 | the "Подробнее" button on the property-type tabs sat next to the list instead of below it | checklist became a block with `fit-content` width |
| B5 | S4 | `/favicon.ico` returned 404 on third-party pages | redirect to `/favicon.svg` |

Open S1/S2 bugs: none.

## Version 2 (owner feedback, 2026-10-23)

| request | done |
| --- | --- |
| How hotels are kept apart | single `scope()` gate, registration, chains with a switcher, roles, `/admin`, isolation tests; plan for Postgres + RLS in `multitenancy.md` |
| Dashboard: what to add, without clutter | ADR/RevPAR for the month, debts, in-house guests, 14-day forecast, booking sources, alerts "без номера" and "нужна уборка" |
| The chessboard isn't a chessboard | rebuilt: rows = rooms (201, 202…) by category, guest bars, "Без номера" row, drag-to-move, booking from a cell, sort by category/number/floor, 7/14/30 days, cleaning/repair. The old grid became "Цены и наличие" |
| No Cancel button when adding a category/rate | "Отмена" in every add/edit form |
| Main and extra places | in the category: main + extra places; in the rate: extra-bed price for adult/child; placement logic and a price line |
| Extras groups | groups (folders), moving between groups, grouping in the booking engine |
| Booking journal | separate "Журнал броней": site, channels, manual; source filter, channel number; test booking from a channel; outgoing log renamed "Журнал обмена" |
| Reports are empty | cause: the default period was "the last 30 days" while the bookings were in the future. Now the current month, including future bookings; 4 reports + CSV |
| Leads are unclear | moved to the platform panel `/admin`: these are requests from the Stayra website, not the hotel's |
| Settings are thin | 5 sections: property and legal details, booking and payment (sales window, cut-off, child age, prepayment, cancellation, tourist tax), staff, my properties, widget |

Bugs found by tests in v2 and fixed:

| id | sev | what | fix |
| --- | --- | --- | --- |
| B6 | S3 | after saving on "Номера и тарифы" the message was lost: `#anchor` ended up before `?m=` | `back()` keeps the anchor at the end |
| B7 | S3 | the dashboard and the journal didn't show messages after an action | `msg` passed into those pages |
| B8 | S4 | today's date in the chessboard header was unreadable on weekends | CSS rule order |

Tests: 28 unit/HTTP (incl. 8 for hotel isolation), 23 e2e + 1 deliberate skip (drag-and-drop on a phone).

## Version 3 (first three items from the analysis, 2026-10-23)

| item | how it's done |
| --- | --- |
| Changing dates by dragging | the left/right edge of a bar on the chessboard (arrival — only before check-in, departure — also for in-house guests); a "Заезд/Выезд" form in the card. Booked nights keep their price, new nights are charged by the booking's rate at today's prices, removed nights come off the bill; tourist tax and per-night extras are recalculated; availability is updated; blocked if the room is taken on the new nights |
| Split stay | new model: **stay segments** (`stay_segments`). One booking, one bill, several parts in different rooms/categories. "Переселить с даты" in the card; on the chessboard the continuation is marked "→" with a dotted edge. Moving to another category moves the availability for those nights; moving a part back into the same room merges the parts |
| Derived rates | a rate is calculated from the base price or from another rate: ±% or ±₽ per night, rounding to 10/50/100 ₽, up to 3 levels; cycles and broken chains are refused. Discount for single occupancy. Old discounts converted automatically |
| CTA/CTD | "Запрет заезда" / "Запрет выезда" per category and date: in the cell dialog and in bulk changes (plus "Минимум ночей"). The booking engine explains why it's unavailable; administrators can book regardless of bans |

Bugs found by tests in v3 and fixed:

| id | sev | what | fix |
| --- | --- | --- | --- |
| B9 | S2 | the chessboard's `data-checkout` attribute collided with the booking engine form selector — the script crashed on a chessboard with bookings, and drag stopped working | the form's marker renamed to `data-checkout-form` |
| B10 | S3 | after dragging a bar edge, the click on release opened the booking card and cut off the date change | the click after an edge drag is suppressed |

Tests: 35 unit/HTTP (+7 new: dates, split, rates, CTA/CTD, HTTP routes), 30 e2e + 2 deliberate skips (mouse dragging on a phone).

## Version 4 (child age groups and the MVD list, 2026-10-23)

| item | how it's done |
| --- | --- |
| Child age groups | hotel groups in "Настройки → Бронирование и оплата": "до N лет" (exclusive upper bound), "без места", meal share. The oldest group defines who counts as a child. In each rate — the price of a child of each group on an extra place / without a place; derived rates inherit them. Placement: adults → children with a place (oldest first) onto free main places → the rest onto extra places; "без места" children don't occupy a place. On the website and in manual booking — the children's ages field. Existing hotels got one group "Дети" with the old price |
| Guest documents | "Гости и документы" section in the booking card: full name, date of birth, sex, citizenship, document (passport RF/foreign/residence permit/birth certificate…), issued, registration address, migration card and visa. Validation of RF passport and foreign-passport formats. The first guest is prefilled from the booking name |
| Personal data | in the card and lists the number is masked (`4011 ••••33`); the edit form doesn't send the number to the browser (empty = don't change); the printable form and CSV are full, `Cache-Control: no-store`; data from other hotels is not available (tests) |
| MVD list | "Отчёты → Учёт гостей (МВД)": guests by arrival date, deadline (RF citizens — next day, foreigners — next working day; public holidays not counted, a note to check your region's rules), status "не отправлено / отправлено / не требуется", bulk marking, filters, CSV for upload, list of bookings without complete guest data. On the dashboard: "документы не внесены" and "не отправлены в МВД" |
| Registration form | printable A4 page: guest details, document, dates and room, consent to personal data processing, signature lines |

Not done deliberately: automatic submission to MVD. It needs a connection to government systems (Gosuslugi / MVD services) with the hotel's own access — a separate integration project.

Bugs found by tests in v4 and fixed:

| id | sev | what | fix |
| --- | --- | --- | --- |
| B11 | S2 | the full passport number reached the card page code through the edit form | the number isn't pre-filled; an empty field keeps the stored one |
| B12 | S3 | text on an unavailable room card failed the contrast check (the whole card was faded) | only the picture is faded |
| B13 | S3 | the reports page didn't show messages after an action | `msg` passed into the reports page |

Tests: 41 unit/HTTP (+6: ages, placement, child prices, documents, deadlines, MVD and isolation), 36 e2e + 2 deliberate skips.

## Version 5 (chessboard from the competitor's public knowledge base, 2026-10-23)

Comparison and what was done: `chess-gap.md`.

Bugs found in v5 and fixed:

| id | sev | what | fix |
| --- | --- | --- | --- |
| B14 | S3 | the small text on bars (guests, source) was translucent and failed the contrast check | opacity removed |
| B15 | S4 | the category collapse arrow ended up in the button's name for screen readers | arrow moved to an `aria-hidden` element |
| B16 | — | during development: a batch edit of `db.js` broke the file (insertion with an empty pattern) | caught by tests at once, file restored from git, edit re-applied |

Tests: 48 unit/HTTP (+7: move with preview, price recalculation, in-house move, placement mode, overdue, panel/actions/isolation), 41 e2e + 3 deliberate skips.

## Version 6 (booking card, 2026-10-23)

Comparison: `card-gap.md`. Tabs, history, tags, notes/tasks, price and discount,
services, refund/voiding/transfer, documents, journal CSV export.

Bugs found by tests in v6 and fixed:

| id | sev | what | fix |
| --- | --- | --- | --- |
| B17 | S3 | the counter on the active tab failed the contrast check | white background, brand-colour text |
| B18 | S2 | on a phone the two-column card blocks (payments) widened the page to 474px, buttons were unreachable | `minmax(0, 1fr)` for `.app-cols`, line wrapping |

Tests: 54 unit/HTTP (+6: history, refund/voiding, transfer, price/discount/services, tags, card HTTP and isolation), 43 e2e + 3 deliberate skips.

## Version 7 (roles, deposit, split invoices, group bookings, 2026-10-23)

- **Housekeeping and investor roles.** Stored as `kind` on top of owner/manager, so old databases keep their `role` check. Housekeeping staff see only the cleaning board (`/app/housekeeping`): rooms, today's arrivals and departures, the cleaning status. No names, phones or money. Investors see the summary and the occupancy and sales reports, read-only. The tax report lists guests, so investors don't get it. The menu is filtered per role, and `roleGuard` enforces the same rules on the server.
- **Deposit.** Kept apart from the paid amount and does not reduce the debt. It can be returned, or kept towards the unpaid stay or for damage; damage adds a line to the bill. The checkout message reminds staff about a deposit that hasn't been returned.
- **Several invoices per booking.** Bill lines (stay, each service, tax) move to an invoice for another payer, and whatever no payer takes stays on the main invoice. Payments and refunds can be tied to a specific invoice. Each invoice can be printed on its own. An invoice with payments can't be deleted, and invoice lines stay correct when a service is removed.
- **Group bookings** (`/app/groups`). One form creates N bookings in one transaction: if a single room fails, nothing is created. One payment from the organiser is spread over the rooms' debts, earliest arrival first. Rooms can be added to or removed from a group, all not-yet-arrived rooms can be cancelled at once, and the whole group has one printable invoice. The group code shows on chessboard bars, in chessboard search, in the journal and in the booking card.

Tests: 58 unit/HTTP (+4: deposit, split invoices, groups, roles over HTTP with groups and invoices), 47 e2e + 3 deliberate skips (+2 specs on desktop and mobile with axe).

## Version 8 (hourly bookings, 2026-10-23)

The competitor's public knowledge base turned up no instructions for this mode, so the design follows common day-use practice and was written from scratch.

- **Hourly category.** A category's sale mode can be set to "by the hour", with a price per hour, minimum and maximum hours, a cleaning gap between guests (30 min by default) and the hours bookings are accepted (09:00–22:00; 00:00–00:00 means round the clock). The mode can't be switched while the category has future bookings.
- **Kept apart from nightly sale.** Hourly categories have no nightly inventory: they don't appear on the chessboard, in the price grid, in the nightly search, in channels or in the occupancy report. Cancelling an hourly booking doesn't touch the nightly inventory. Hourly bookings don't show up as departures in the dashboard and chessboard counts.
- **"По часам" board** (`/app/hourly`). Hourly rooms run down the side and the day runs across in half-hour columns. Each booking is a bar with the guest name and time, followed by a hatched block for the cleaning gap; times outside the accepted hours are shaded. Clicking an empty cell opens the form already filled with that room and time. The menu item appears only when the hotel has hourly categories.
- **Booking rules.** Start times go in 30-minute steps and a booking may cross midnight. The room is chosen automatically, or set by hand, and an overlap is refused with the clashing booking and the cleaning gap named. Staff may book outside the accepted hours; guests may not. The price is the hourly price × hours, or a manual price. Tourist tax is counted as for one day.
- **Booking card.** A "Время и номер" block lets staff change the date, start, length and room, with an option to keep the price. Once the guest has checked in, only the length can change. Moving, splitting and date changes from the nightly flow are refused with a hint to use "Изменить время".
- **Everywhere else.** The journal, documents, the registration card and the guest booking page show "date, 14:00–17:00, 3 ч" instead of nights. The housekeeping board lists each hourly room's time slots for the day, with no guest data.
- **Hotel site.** A "По часам" section with a search form (date, start, hours, guests) leads to results with the price for the period, then to the guest form (payment on site). Booking is idempotent, the same as for nightly stays.
- **Demo.** The demo hotel has a "Дневной номер" category with rooms Д1 and Д2.

Bugs found while testing v8 and fixed:

| id | sev | what | fix |
| --- | --- | --- | --- |
| B19 | S2 | on a phone the booking card was 40px wider than the screen. The screen-reader-only legend of the tags block got `width: 100%`, so taps landed on the wrong element | the `.chips legend` rule no longer applies to `.sr-only` |
| B20 | S4 | the hotel page search form was 1px wider than a 390px screen | `minmax(0, 1fr)` columns, inputs with `min-width: 0` |
| B21 | — | during design: the `bookings` table requires checkout > checkin, so an hourly stay can't end the same day | check-out date = next day; the real end is kept in `end_at`, and departure lists skip hourly bookings |

Tests: 63 unit/HTTP (+5: rules, cleaning gap and cancel, time change, isolation from nightly sale, HTTP for staff and guests), 51 e2e + 3 deliberate skips (+2 specs on desktop and mobile with axe). A pass at 390px over all 34 cabinet and site pages finds no horizontal scroll.

## Version 9 (loyalty program, 2026-10-24)

Before v9 the program was described only on the product page. Now it works end to end. Design written from scratch.

- **Program terms** (`/app/loyalty/settings`, owner only):
  - program on/off, its name, welcome points, and the most of a booking that points may pay (30% by default);
  - levels by money spent on completed stays, each with a discount for direct bookings and a share earned as points. Defaults: Базовый 0 ₽ / 0% / 5%, Серебряный 50 000 ₽ / 5% / 7%, Золотой 150 000 ₽ / 10% / 10%.
- **Points.** 1 point = 1 ₽.
  - Earned at check-out on the lodging price minus what was paid with points; services and tax don't count.
  - Undoing a check-out takes the points and the counted stay back.
  - A points payment is a separate payment kind, shown as "баллы" in the payment list and on the payment statement.
  - Cancelling a booking returns spent points automatically; voiding a points payment returns them too.
  - Every operation is a line in the member's history: who, when, which booking, how many.
- **Members** (`/app/loyalty`):
  - search by name, email, phone or card number;
  - the member page shows level, points, progress to the next level, history and bookings;
  - staff can add or deduct points by hand (a reason is required, the balance can't go below zero), edit contacts, or remove the member, which deletes the member's personal data and keeps the bookings.
- **Booking card.** A program block where staff can:
  - link a member by card number, email or phone, or enrol the guest in one click;
  - pay with points up to the allowed limit;
  - apply the level discount;
  - unlink the member.
- **Hotel site.**
  - The hotel page shows a program section with the level table, a join form and a member sign-in.
  - Joining gives an 8-digit card and the welcome points.
  - The member cabinet (link signed with HMAC) shows the card, points, level, progress, history and bookings, and has a button to leave the program.
  - At checkout, a card number with the matching email applies the level discount to the stay, and part of the booking can be paid with points (if more is asked than allowed, the limit is charged and the confirmation says so).
  - Without a card, a booking whose email belongs to a member is still linked for earning points, but gets no discount and can't be paid with points.
- **Demo.** The program is on in the demo hotel with 500 welcome points and the three levels.

Not done on purpose: points expiry and email notifications. Both need a scheduler and outgoing mail, which the project doesn't have yet.

Tests: 69 unit/HTTP (+6: levels, enrolment, discount and limits, cancel/void returns, earning and undo, full HTTP flow on site and in the cabinet with isolation), 53 e2e + 3 deliberate skips (+1 spec on desktop and mobile with axe: join → booking with card and points → member in the cabinet). The new pages show no horizontal scroll at 390px.
