import { openDb } from './db.js';
import { seed } from './seed.js';
import { createApp } from './server.js';

const db = openDb();
seed(db);
const port = Number(process.env.PORT) || 3000;
createApp(db, { showDemo: process.env.SHOW_DEMO_LOGIN !== '0' }).listen(port, () => {
  console.log(`Stayra on http://localhost:${port}`);
});
