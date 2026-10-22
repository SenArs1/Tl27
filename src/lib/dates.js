// Stay dates are plain YYYY-MM-DD strings; all arithmetic happens in UTC.
const RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s) {
  if (typeof s !== 'string' || !RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Nights of a stay: [checkin, checkout)
export function nightsOf(checkin, checkout) {
  const out = [];
  for (let d = checkin; d < checkout; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function fmtDate(s) {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function weekday(s) {
  return WD[new Date(s + 'T00:00:00Z').getUTCDay()];
}

export function isWeekend(s) {
  const w = new Date(s + 'T00:00:00Z').getUTCDay();
  return w === 5 || w === 6;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function nightsLabel(n) {
  return `${n} ${plural(n, 'ночь', 'ночи', 'ночей')}`;
}
