# Recon map: hotel tech platform (web)

Target: travelline.ru (public marketing site) and the product category it sells:
a SaaS platform for hotels — booking engine for the hotel's own site, channel
manager, web PMS, plus add-ons (rate shopper, reputation, loyalty, site builder).

Scope: clean-room rebuild of
1. the **marketing site** structure (home, products, solutions by property type,
   price constructor, demo request, contacts, knowledge base, about);
2. the **core loop the hotelier pays for**: a guest books a room on the hotel's
   site through the booking engine → the booking lands in the hotelier's
   extranet → availability drops everywhere (site + connected channels).

For: the repo owner, as a working product of their own under a new brand
(see `brand.md`). Nothing of the original's copy, logos, images or code is used.
Date: 2026-10-22

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing home | https://www.travelline.ru/ | nav, sections, positioning |
| 2 | booking engine page | https://www.travelline.ru/products/tl-hotel/ | feature list of the core product |
| 3 | channel manager page | https://www.travelline.ru/products/channel-manager/ | 130+ channels, restrictions, overbooking |
| 4 | web PMS page | https://www.travelline.ru/products/webpms/ | room grid, housekeeping, 27 reports |
| 5 | price page | https://www.travelline.ru/price/ | price constructor by property type and room count |
| 6 | solutions / hotel | https://www.travelline.ru/solutions/hotel/ | bundles per segment |
| 7 | site builder page | https://www.travelline.ru/products/tl-site/ | hotel website in 10 days |
| 8 | rate shopper page | https://www.travelline.ru/products/rate-shopper/ | competitor prices |
| 9 | reputation page | https://www.travelline.ru/products/reputation/ | reviews in one window |

Read at human pace, 10 pages, headings and layout only. Reference screenshots
were kept outside the repo and are not shipped.

## Core loop

A guest picks dates and guests on the hotel's site, sees available room types
with prices, books and pays — and the hotelier sees the booking and up-to-date
availability in one extranet that also feeds the sales channels.

## Screens

### Marketing site
| ID | screen | route | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Home | `/` | positioning, stats, product cards, property types, testimonials, FAQ, CTA | header w/ mega-menu, hero, stat band, cards, tabs, accordion, footer | default, mobile |
| S02 | Products catalog | `/products` | all tools | cards grid | default |
| S03 | Product page | `/products/:slug` | one tool: benefits, features, price, FAQ, CTA | hero, feature grid, price box, accordion | default, 404 |
| S04 | Solutions | `/solutions/:type` | bundle for a property type | hero, product list | default, 404 |
| S05 | Price constructor | `/price` | pick property type, room count, tools → monthly total | select, number, checkboxes, live total | default, invalid count |
| S06 | Demo request | `/demo` (modal + page) | lead form | form, validation, success | empty, error, success |
| S07 | Contacts | `/contacts` | phones, email, offices | list | default |
| S08 | Knowledge base | `/support`, `/support/:slug` | help articles + search | search, list, article | empty search, found |
| S09 | About | `/about` | company story | text | default |

### Booking engine (guest side, embedded on a hotel site)
| ID | screen | route | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S10 | Hotel page with search | `/h/:hotel` | dates + guests search | date inputs, guest counter, promo code | default, invalid dates |
| S11 | Room results | `/h/:hotel/rooms?...` | room types with rates, prices for stay, free count | room card, rate row, badges | filled, sold out, nothing for these dates |
| S12 | Guest details + extras | `/h/:hotel/checkout` | guest form, extras (breakfast, transfer), payment method | form, checkbox list, summary | empty, error, stale price |
| S13 | Confirmation | `/h/:hotel/booking/:code` | booking number, details, cancel link | summary, status badge | confirmed, cancelled |
| S14 | Manage booking | `/h/:hotel/manage` | find booking by code + email, cancel | form | not found, found |

### Extranet (hotelier side)
| ID | screen | route | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S20 | Sign in | `/app/login` | email + password | form | error |
| S21 | Dashboard | `/app` | today's arrivals/departures, occupancy, revenue, recent bookings | stat tiles, table | empty, filled |
| S22 | Bookings list | `/app/bookings` | filter by status/dates, search | table, filters | empty, filled |
| S23 | Booking detail | `/app/bookings/:id` | guest, room, money, status change | summary, actions | confirmed, cancelled, checked-in |
| S24 | Room grid ("chessboard") | `/app/grid` | availability + price per room type per day, edit inline, close sales | grid, inline edit | default, saving, error |
| S25 | Room types & rates | `/app/rooms` | CRUD room types, rate plans | table, form | empty, filled |
| S26 | Channels | `/app/channels` | connect/disconnect sales channels, see sync log | toggle list, log | none connected, connected |
| S27 | Leads | `/app/leads` | demo requests from the marketing site | table | empty, filled |
| S28 | Hotel settings | `/app/settings` | name, address, check-in time, booking widget embed code | form, code block | default |

## Flows

```
F01 Guest books a room
    S10 -> S11 -> S12 -> S13
    happy path clicks: 4 (search, choose rate, fill form, confirm)
    edge: check-out <= check-in, past dates, no rooms left, more guests than capacity,
          room sold out while filling the form, double submit, promo code invalid

F02 Guest cancels a booking
    S14 (or link from S13) -> S13 cancelled; availability returns

F03 Hotelier signs in and sees the new booking
    S20 -> S21 -> S22 -> S23

F04 Hotelier changes price / closes sales for a date
    S24 inline edit -> S11 shows new price / sold out; channel log gets an update

F05 Hotelier connects a channel
    S26 toggle -> sync log shows full push of availability and prices

F06 Prospect requests a demo
    S01/S03 CTA -> S06 -> success; S27 shows the lead

F07 Prospect estimates the price
    S05 choose type, rooms, tools -> total updates live -> CTA to S06

F08 Hotelier manages room types and rates
    S25 add/edit -> S24 grid gets new rows
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, hover, focus, disabled | all |
| Header | marketing (mega-menu), app (sidebar) | open menu, mobile burger | S01–S09, S20–S28 |
| Card | product, solution, room | hover | S01, S02, S04, S11 |
| Stat band | 3 numbers | — | S01 |
| Tabs | property types | active | S01 |
| Accordion | FAQ | open/closed | S01, S03 |
| Form field | text, email, tel, date, number, select, textarea, checkbox | error, disabled | S05, S06, S10, S12, S20, S25, S28 |
| Table | bookings, leads | empty | S21, S22, S27 |
| Grid | availability chessboard | editing, closed | S24 |
| Badge | status | confirmed, cancelled, new | S13, S22, S23 |
| Toast / flash | success, error | — | app |

## Inferred data model

```
Hotel        id, slug, name, city, address, phone, email, checkin_time, checkout_time, currency
             evidence: booking engine page, S28. confidence: high
RoomType     id, hotel_id, name, description, capacity, beds, area_m2, total_rooms
             evidence: room cards, PMS page. confidence: high
RatePlan     id, hotel_id, name, meal (none|breakfast), refundable, discount_pct
             evidence: "любые тарифы", channel manager page. confidence: medium
Inventory    room_type_id, date, price (per night, base rate), available, closed
             evidence: chessboard, channel manager restrictions. confidence: high
Booking      id, code, hotel_id, room_type_id, rate_plan_id, checkin, checkout, adults, children,
             guest_name, guest_email, guest_phone, comment, extras(json), total, status, source
             evidence: booking engine flow, PMS. confidence: high
Extra        id, hotel_id, name, price, per (stay|night|guest)
             evidence: "увеличивает средний чек". confidence: medium
Channel      id, hotel_id, code, name, connected, commission_pct
ChannelLog   id, channel_id, at, kind (full|delta|booking), payload_summary
             evidence: channel manager page. confidence: medium (simulated)
User         id, hotel_id, email, password_hash, name, role
Lead         id, name, phone, email, property_type, rooms, message, created_at, source_page
PromoCode    hotel_id, code, discount_pct, active
```

## Feature matrix

See `features.csv`.

## What cannot be cloned (skip)

- Real connections to 130+ OTAs (Booking, Ostrovok, Яндекс Путешествия …): their
  partner contracts and certified APIs. The clone simulates channels and logs pushes.
- Real payment acquiring: needs the owner's own acquirer contract. Clone has a
  "pay at hotel" and a test "card" method with no money moving.
- MVD guest registration, e-keys, Wi-Fi, iiko integration: regulated / hardware / partners.
- Rate shopper and reputation data: scraping competitor prices and OTA reviews is
  their data pipeline, out of scope. Product pages describe them; tool not built.
- Their customer logos, testimonials, photos, events, community chat.

## Size

~28 screens, 8 flows, 11 entities. Hard parts: availability across date ranges
without overbooking (transaction), the inventory grid, price calculation with
rates/promo/extras. Size: **M**.
