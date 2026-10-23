# Stayra

A booking engine, channel manager and PMS for hotels, plus the
product's marketing site. It's a clean-room rebuild of the *functionality*
of a well-known Russian hotel SaaS platform (the original is named in
`replica/recon.md`), made with the
[replica skill](https://github.com/Jakeschincariol/replica-skill)
(installed in `.claude/skills/`). The code, copy, icons, palette and
illustrations are all original. Nothing was copied from the original site.

## Quick start

```bash
npm install
npm start            # http://localhost:3000, creates data/stayra.db with a demo hotel
```

- Marketing site: `/`, price calculator `/price`, demo request `/demo`
- Booking engine for the demo hotel: `/h/severny-bereg`
- Hotel cabinet: `/app` (demo login `demo@stayra.example` / `demo12345`)
- Register your own property: `/signup` (a separate, empty cabinet)
- Platform team panel: `/admin` (`admin@stayra.example` / `admin12345`): all properties and the leads from the website
- Widget on a third-party site: `/widget-demo`

Requires Node.js 22.5+ (it uses the built-in `node:sqlite`). A database from the
first version upgrades itself on start: rooms get numbers (201, 202…) and existing
bookings are placed into rooms. Env vars: `PORT`, `DB_FILE`,
`SESSION_SECRET` (signs guest booking links), and `SHOW_DEMO_LOGIN=0` to hide the demo hint on the login page.

## What's inside

| area | features |
| --- | --- |
| Marketing | home, products (7), solutions by property type (5), price calculator with live recalculation, demo request → leads, knowledge base with search, contacts, about |
| Booking engine | date/guest search, room types with 3 rates (flexible, with breakfast, non-refundable), promo codes, extras, total price for the stay, atomic booking with no overbooking, double-submit protection, confirmation, guest self-cancel, JS widget |
| Hotel cabinet | dashboard (occupancy, arrivals/departures, ADR/RevPAR, debts, 14-day forecast, sources, cleaning); **chessboard** by room (bars with guest names, "Без номера" row, drag to move, booking from an empty cell, sorting); booking journal from all sources; manual booking; booking card with payments, room move, check-in/check-out; prices and availability per category; room types (main/extra places), room stock (numbers, floors, cleaning, repair), rates with extra-bed prices and **child age groups**, derived rates, extras in groups, promo codes; simulated channels with an exchange log and test bookings; reports (occupancy, sales, lists, tourist tax, **MVD guest list**, CSV); guest documents and a printable registration form; settings (property, booking and payment rules, tourist tax, staff, my properties, widget) |
| Platform | self-service registration of properties, several properties per user (chains), roles owner/administrator, team panel `/admin`. How hotels are kept apart: `replica/multitenancy.md` |

## Tests

```bash
npm test                 # unit + HTTP (node:test)
npm run test:e2e         # Playwright: desktop 1440 and mobile 390, axe a11y, no console errors / 5xx
```

If Playwright can't find a browser:
`PW_CHROMIUM=/path/to/chrome npm run test:e2e`.

## Project documents (replica/)

`recon.md` (screen and flow map), `features.csv` (feature matrix), `competitors.md` (competitor analysis), `multitenancy.md` (hotel isolation),
`architecture.md`, `design/tokens.json`, `parity.md`, `build-log.md`, `brand.json`.

```bash
python3 .claude/skills/replica-diff/parity.py replica/features.csv
python3 .claude/skills/replica-design/contrast.py replica/design/tokens.json
python3 .claude/skills/replica-brand/sweep.py . --config replica/brand.json
```

## Deliberately not included

Real connections to OTAs (they need contracts and certified APIs), real payment
acquiring (needs your own bank contract; there is a test "card" mode), MVD
guest registration, e-keys, competitor price and review data, and the
original's customers' content.
