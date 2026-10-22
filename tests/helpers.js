import { openDb } from '../src/db.js';
import { seed, DEMO } from '../src/seed.js';
import { createApp } from '../src/server.js';
import { addDays, today } from '../src/lib/dates.js';

export { DEMO };

export async function startApp() {
  const db = openDb(':memory:');
  seed(db);
  const app = createApp(db, { secret: 'test-secret' });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: () => new Promise((r) => server.close(r)) };
}

export function stay(offset = 7, nights = 2) {
  return { checkin: addDays(today(), offset), checkout: addDays(today(), offset + nights) };
}

export async function login(base) {
  const r = await fetch(`${base}/app/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: DEMO.email, password: DEMO.password }),
  });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${base}/app`, { headers: { cookie } })).text();
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  return { cookie, csrf };
}

export function form(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) (Array.isArray(v) ? v : [v]).forEach((x) => p.append(k, String(x)));
  return p;
}
