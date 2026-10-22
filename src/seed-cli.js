import { openDb } from './db.js';
import { seed, DEMO } from './seed.js';

const db = openDb();
console.log(seed(db) ? `Seeded. Sign in at /app/login as ${DEMO.email} / ${DEMO.password}` : 'Database already has data, nothing to do.');
