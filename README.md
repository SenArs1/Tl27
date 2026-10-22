# Stayra

A booking engine, channel manager and extranet for small hotels, plus the
product's marketing site. It's a clean-room rebuild of the *functionality*
of hotel SaaS platforms like travelline.ru, made with the
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
- Hotel extranet: `/app` (demo login `demo@stayra.example` / `demo12345`)
- Widget on a third-party site: `/widget-demo`

Requires Node.js 22.5+ (it uses the built-in `node:sqlite`). Env vars: `PORT`, `DB_FILE`,
`SESSION_SECRET` (signs guest booking links), and `SHOW_DEMO_LOGIN=0` to hide the demo hint on the login page.

## What's inside

| area | features |
| --- | --- |
| Marketing | home, products (7), solutions by property type (5), price calculator with live recalculation, demo request → leads, knowledge base with search, contacts, about |
| Booking engine | date/guest search, room types with 3 rates (flexible, with breakfast, non-refundable), promo codes, extras, total price for the stay, atomic booking with no overbooking, double-submit protection, confirmation, guest self-cancel, JS widget |
| Extranet | dashboard (occupancy, arrivals and departures, revenue), bookings with filters and statuses, room grid with price/availability/stop-sale/min-stay editing and bulk changes, room types/rates/extras/promo codes, channels (simulated) with a sync log and per-channel markup, reports, leads, settings + embed code |

## Tests

```bash
npm test                 # unit + HTTP (node:test)
npm run test:e2e         # Playwright: desktop 1440 and mobile 390, axe a11y, no console errors / 5xx
```

If Playwright can't find a browser:
`PW_CHROMIUM=/path/to/chrome npm run test:e2e`.

## Project documents (replica/)

`recon.md` (screen and flow map), `features.csv` (feature matrix),
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
