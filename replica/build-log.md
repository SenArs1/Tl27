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
