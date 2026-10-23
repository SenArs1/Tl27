# Competitor analysis: PMS for hotels (October 2026)

Public sources only: marketing pages and open knowledge bases of Bnovo, TravelLine,
Shelter, Exely, Mews. Kontur.Hotel, Cloudbeds and Little Hotelier blocked
automated access; for Kontur and Cloudbeds only search snippets were used, nothing for Little Hotelier.
Summary in our own words; links at the bottom.

## What everyone has (and what we've done)

| Area | Market standard | Stayra |
| --- | --- | --- |
| Dashboard | arrivals/departures/in-house, occupancy, free rooms, unassigned bookings, cleaning, debts, ADR/RevPAR | ✅ all, plus a 14-day forecast and booking sources |
| Chessboard | rows = rooms by category, columns = days, guest name on the bar, colours by status, debt mark, "Без номера" row, drag-to-move, booking from an empty cell, cleaning status, repair | ✅ all; ❌ extend by drag, split stay into segments, booking lock |
| Room stock | main and extra places, child ages, price by occupancy | ✅ main/extra places, extra-bed prices for adult/child in the rate, child age limit; ❌ several age groups |
| Rates | meals, cancellation, prepayment, MinLOS, stop sale; derived rates; CTA/CTD | ✅ meals, discount, cancellation, MinLOS, stop sale; ❌ derived rates, CTA/CTD, single occupancy |
| Extras | categories, units (stay/night/guest), shown in the booking engine | ✅ groups ("folders"), units, grouped in the engine; ❌ VAT/54-FZ fields, "included in the rate" |
| Booking journal | search by name/number/OTA number, filters by dates (stay/created), status, channel; Excel export; change history | ✅ search incl. channel number, filters, source; ❌ Excel export of the journal, history |
| Reports | occupancy/revenue/ADR/RevPAR, sources, cancellations, payments, arrival/departure lists, tourist tax, MVD | ✅ occupancy and revenue (by day/category), sales and sources, cancellations, lists, tourist tax, CSV; ❌ MVD, cash report, pick-up |
| Settings | profile, legal entity, check-in/out times, cancellation, prepayment, payment methods, tax, staff/roles, notifications | ✅ all of these; ❌ document templates, online receipts |
| Chains | one account → several properties, access per property | ✅ property switcher, adding a property, access per property |

## Tourist tax (we implement it this way)

Local tax (Tax Code ch. 33.1). The cap is 2% in 2026, rising by 1% a year up to 5%
in 2029; the municipality sets the specific rate. Minimum 100 ₽ per night. The base
is accommodation only: no meals and no services; discounts reduce the base. There are
exemptions for certain categories of guests. Reported quarterly. In Stayra: the rate
and the minimum are set in the settings, tax is shown as a separate line in the
booking engine and the booking, and there's a report with export. Exemptions and a
per-municipality rate table are next.

## Next ideas (from the analysis)

1. Extend/shorten a stay by dragging on the chessboard; split into segments when moving to another room mid-stay.
2. Derived rates (−10% from the base, with rounding), CTA/CTD, single-occupancy price.
3. Child age groups (0–5, 6–12) with their own prices.
4. Guest list for MVD and electronic check-in.
5. Roles "Горничная" (no personal data) and "Инвестор" (reports only).
6. Booking change history; Excel export of the journal.
7. Cancellation and prepayment rules with periods, deadlines and automatic cancellation.

## Sources

help.bnovo.ru (sections: bookings, rates, reports, main settings, extras,
tourist tax, users); travelline.ru/support/knowledge-base (extra places, room
moves), travelline.ru/products/webpms; shelter.ru/knowledge (reports, rates);
exely.com/ru, exely.com/solutions/pms; help.mews.com (timeline).
