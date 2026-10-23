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
