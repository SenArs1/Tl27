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

// Local date and HH:MM in the hotel's time zone.
export function todayIn(tz = 'Europe/Moscow', now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return today(now);
  }
}

export function timeIn(tz = 'Europe/Moscow', now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

export function fmtShort(s) {
  return `${s.slice(8)}.${s.slice(5, 7)}`;
}

export function monthBounds(s) {
  const start = s.slice(0, 8) + '01';
  const d = new Date(start + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return [start, d.toISOString().slice(0, 10)];
}
