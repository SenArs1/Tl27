import { addDays, isIsoDate } from './dates.js';

// Guest identity documents for migration registration (MVD).
export const DOC_TYPES = [
  ['passport_rf', 'Паспорт гражданина РФ'],
  ['birth_cert', 'Свидетельство о рождении'],
  ['passport_intl_rf', 'Заграничный паспорт гражданина РФ'],
  ['passport_foreign', 'Паспорт иностранного гражданина'],
  ['residence_permit', 'Вид на жительство'],
  ['other', 'Другой документ'],
];

export const COUNTRIES = [
  ['RUS', 'Россия'], ['BLR', 'Беларусь'], ['KAZ', 'Казахстан'], ['UZB', 'Узбекистан'], ['TJK', 'Таджикистан'], ['KGZ', 'Киргизия'],
  ['ARM', 'Армения'], ['AZE', 'Азербайджан'], ['GEO', 'Грузия'], ['MDA', 'Молдова'], ['TKM', 'Туркменистан'], ['CHN', 'Китай'],
  ['TUR', 'Турция'], ['IND', 'Индия'], ['IRN', 'Иран'], ['ARE', 'ОАЭ'], ['VNM', 'Вьетнам'], ['THA', 'Таиланд'], ['SRB', 'Сербия'],
  ['DEU', 'Германия'], ['FRA', 'Франция'], ['ITA', 'Италия'], ['ESP', 'Испания'], ['USA', 'США'], ['ISR', 'Израиль'],
];

export const MVD_STATUS = { new: 'не отправлено', sent: 'отправлено', not_required: 'не требуется' };

export function countryName(code) {
  const c = COUNTRIES.find(([k]) => k === code);
  return c ? c[1] : code;
}

export function docName(type) {
  const d = DOC_TYPES.find(([k]) => k === type);
  return d ? d[1] : type;
}

// "45 12 ******" — documents are masked in lists; the full number is only in the guest card.
export function maskDoc(g) {
  const n = String(g.doc_number || '');
  return `${g.doc_series ? `${g.doc_series} ` : ''}${n.length > 2 ? '•'.repeat(n.length - 2) + n.slice(-2) : n}`;
}

const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// Validates a guest card. Returns { ok, errors, guest }.
export function validateGuestDoc(body, { checkin } = {}) {
  const g = {
    last_name: clean(body.last_name, 60),
    first_name: clean(body.first_name, 60),
    middle_name: clean(body.middle_name, 60),
    birth_date: clean(body.birth_date, 10),
    sex: ['m', 'f'].includes(body.sex) ? body.sex : '',
    citizenship: clean(body.citizenship, 3).toUpperCase(),
    doc_type: DOC_TYPES.some(([k]) => k === body.doc_type) ? body.doc_type : '',
    doc_series: clean(body.doc_series, 12).toUpperCase(),
    doc_number: clean(body.doc_number, 20).replace(/\s/g, '').toUpperCase(),
    doc_issued_at: clean(body.doc_issued_at, 10),
    doc_issued_by: clean(body.doc_issued_by, 200),
    doc_code: clean(body.doc_code, 7),
    reg_address: clean(body.reg_address, 300),
    migration_card: clean(body.migration_card, 30),
    visa: clean(body.visa, 30),
  };
  const errors = {};
  const nameRe = /^[\p{L}][\p{L}' -]*$/u;
  if (!nameRe.test(g.last_name)) errors.last_name = 'Фамилия — буквы, дефис, пробел';
  if (!nameRe.test(g.first_name)) errors.first_name = 'Имя — буквы, дефис, пробел';
  if (g.middle_name && !nameRe.test(g.middle_name)) errors.middle_name = 'Отчество — буквы, дефис, пробел';
  if (!isIsoDate(g.birth_date) || g.birth_date < '1900-01-01' || (checkin && g.birth_date > checkin)) errors.birth_date = 'Проверьте дату рождения';
  if (!/^[A-Z]{3}$/.test(g.citizenship)) errors.citizenship = 'Код страны из трёх латинских букв, например RUS';
  if (!g.doc_type) errors.doc_type = 'Выберите документ';
  if (g.doc_type === 'passport_rf') {
    if (!/^\d{4}$/.test(g.doc_series.replace(/\s/g, ''))) errors.doc_series = 'Серия паспорта РФ — 4 цифры';
    if (!/^\d{6}$/.test(g.doc_number)) errors.doc_number = 'Номер паспорта РФ — 6 цифр';
    if (g.doc_code && !/^\d{3}-?\d{3}$/.test(g.doc_code)) errors.doc_code = 'Код подразделения — 6 цифр, например 100-001';
    g.doc_series = g.doc_series.replace(/\s/g, '');
  } else if (g.doc_type === 'passport_intl_rf') {
    if (!/^\d{9}$/.test(g.doc_series + g.doc_number)) errors.doc_number = 'Заграничный паспорт РФ — 9 цифр (серия и номер)';
  } else if (g.doc_number.length < 3) errors.doc_number = 'Укажите номер документа';
  if (g.doc_issued_at && (!isIsoDate(g.doc_issued_at) || g.doc_issued_at < g.birth_date)) errors.doc_issued_at = 'Проверьте дату выдачи';
  if (g.citizenship === 'RUS' && ['passport_foreign', 'residence_permit'].includes(g.doc_type)) errors.doc_type = 'Для гражданина РФ выберите паспорт РФ, загранпаспорт или свидетельство о рождении';
  return { ok: Object.keys(errors).length === 0, errors, guest: g };
}

export const isForeign = (g) => g.citizenship !== 'RUS';

// Default deadline to notify the migration service, counted from the arrival day:
// citizens of Russia — the next day, foreign citizens — the next working day
// (weekends are skipped; public holidays are not tracked here). Check the current
// rules for your region; this is a reminder, not legal advice.
export function mvdDeadline(g, checkin) {
  let d = addDays(checkin, 1);
  if (isForeign(g)) {
    while ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) d = addDays(d, 1);
  }
  return d;
}

// "Иванов Иван" -> { last_name: 'Иванов', first_name: 'Иван' } to prefill the first guest.
export function splitName(full) {
  const p = String(full || '').trim().split(/\s+/);
  return { last_name: p[0] || '', first_name: p[1] || '', middle_name: p.slice(2).join(' ') };
}
