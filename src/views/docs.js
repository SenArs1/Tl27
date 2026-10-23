import { html, rub } from './html.js';
import { fmtDate, nightsLabel, diffDays } from '../lib/dates.js';
import { BRAND } from '../content.js';

const KIND = { payment: 'Оплата', refund: 'Возврат', transfer_in: 'Перенос из брони', transfer_out: 'Перенос в бронь' };
const METHOD = { cash: 'наличные', card: 'карта', transfer: 'перевод', online: 'онлайн' };

function page(title, hotel, body) {
  return html`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/css/print.css"></head>
<body class="regcard"><main>
  <p class="noprint"><button type="button" onclick="window.print()">Печать</button></p>
  <header><strong>${hotel.legal_name || hotel.name}</strong><span>${hotel.address}${hotel.inn ? ` · ИНН ${hotel.inn}` : ''}${hotel.phone ? ` · ${hotel.phone}` : ''}</span></header>
  ${body}
  <footer>Сформировано в ${BRAND.name} ${new Date().toISOString().slice(0, 10)}</footer>
</main></body></html>`.value;
}

const row = (k, v) => html`<tr><th scope="row">${k}</th><td>${v || '—'}</td></tr>`;

export function confirmationDoc({ hotel, b, rooms, rate }) {
  return page(`Подтверждение ${b.code}`, hotel, html`<h1>Подтверждение бронирования № ${b.code}</h1>
    <table>
      ${row('Гость', b.guest_name)}
      ${row('Заезд', `${fmtDate(b.checkin)}, с ${hotel.checkin_time}`)}
      ${row('Выезд', `${fmtDate(b.checkout)}, до ${hotel.checkout_time}`)}
      ${row('Срок', nightsLabel(diffDays(b.checkin, b.checkout)))}
      ${row('Номер', rooms)}
      ${row('Гости', `${b.adults} взр.${b.children ? `, ${b.children} дет.` : ''}`)}
      ${row('Тариф', rate ? `${rate.name}${rate.description ? `. ${rate.description}` : ''}` : '')}
      ${row('Стоимость', rub(b.total))}
      ${row('Оплачено', rub(b.paid_amount))}
    </table>
    ${hotel.cancel_policy ? html`<p class="consent"><strong>Условия отмены.</strong> ${hotel.cancel_policy}</p>` : ''}
    <p class="consent">Ждём вас! Вопросы — по телефону ${hotel.phone || hotel.email}.</p>`);
}

// One invoice of the booking: the whole bill, or the lines a given payer covers.
export function invoiceDoc({ hotel, b, inv }) {
  const period = `${nightsLabel(diffDays(b.checkin, b.checkout))} (${fmtDate(b.checkin)} — ${fmtDate(b.checkout)})`;
  const debt = inv.total - inv.paid;
  return page(`Счёт ${inv.number}`, hotel, html`<h1>Счёт на оплату № ${inv.number}</h1>
    <table>${row('Плательщик', `${inv.payer_name}${inv.payer_inn ? `, ИНН ${inv.payer_inn}` : ''}`)}${row('Гость', b.guest_name)}${row('Бронь', `${b.code}, ${period}`)}</table>
    <h2 class="doc-h2">Состав</h2>
    <table><thead><tr><th scope="col">Наименование</th><th scope="col">Сумма</th></tr></thead>
      <tbody>${inv.lines.map((l) => html`<tr><td>${l.key === 'stay' ? `Проживание, ${period}` : l.name}</td><td>${rub(l.sum)}</td></tr>`)}
      <tr><th scope="row">Итого</th><td><strong>${rub(inv.total)}</strong></td></tr>
      <tr><th scope="row">Оплачено</th><td>${rub(inv.paid)}</td></tr>
      <tr><th scope="row">К оплате</th><td><strong>${rub(Math.max(0, debt))}</strong></td></tr></tbody></table>
    <p class="consent">НДС не облагается, если иное не указано в реквизитах организации. Счёт действителен до даты заезда.</p>
    <p class="sign">Администратор ____________________</p>`);
}

export function receiptDoc({ hotel, b, payments }) {
  const valid = payments.filter((p) => !p.voided);
  return page(`Оплаты ${b.code}`, hotel, html`<h1>Справка об оплате по брони № ${b.code}</h1>
    <table>${row('Гость', b.guest_name)}${row('Проживание', `${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}`)}</table>
    <h2 class="doc-h2">Платежи</h2>
    <table><thead><tr><th scope="col">Дата</th><th scope="col">Операция</th><th scope="col">Способ</th><th scope="col">Сумма</th></tr></thead>
      <tbody>${valid.map((p) => html`<tr><td>${p.created_at.slice(0, 16)}</td><td>${KIND[p.kind] || p.kind}${p.note ? ` (${p.note})` : ''}</td><td>${METHOD[p.method] || p.method}</td><td>${p.amount < 0 ? '−' : ''}${rub(Math.abs(p.amount))}</td></tr>`)}
      <tr><th scope="row" colspan="3">Итого оплачено</th><td><strong>${rub(b.paid_amount)}</strong></td></tr>
      <tr><th scope="row" colspan="3">Стоимость брони</th><td>${rub(b.total)}</td></tr></tbody></table>
    <p class="consent">Справка не является кассовым чеком.</p>
    <p class="sign">Администратор ____________________</p>`);
}

// One invoice for a whole group: a line per room booking.
export function groupInvoiceDoc({ hotel, group, members, totals }) {
  const live = members.filter((m) => !['cancelled', 'no_show'].includes(m.status));
  return page(`Счёт ${group.code}`, hotel, html`<h1>Счёт на оплату № ${group.code}</h1>
    <table>${row('Плательщик', `${group.name}${group.customer_inn ? `, ИНН ${group.customer_inn}` : ''}`)}${row('Контакт', `${group.contact_name}, ${group.phone}`)}
      ${row('Даты', totals.from ? `${fmtDate(totals.from)} — ${fmtDate(totals.to)}` : '')}</table>
    <h2 class="doc-h2">Состав</h2>
    <table><thead><tr><th scope="col">Бронь</th><th scope="col">Проживание</th><th scope="col">Сумма</th></tr></thead>
      <tbody>${live.map((m) => html`<tr><td>${m.code}</td><td>${m.room_name}${m.room_number ? `, № ${m.room_number}` : ''}, ${nightsLabel(diffDays(m.checkin, m.checkout))}, ${m.adults} взр.</td><td>${rub(m.total)}</td></tr>`)}
      <tr><th scope="row" colspan="2">Итого</th><td><strong>${rub(totals.total)}</strong></td></tr>
      <tr><th scope="row" colspan="2">Оплачено</th><td>${rub(totals.paid)}</td></tr>
      <tr><th scope="row" colspan="2">К оплате</th><td><strong>${rub(Math.max(0, totals.debt))}</strong></td></tr></tbody></table>
    <p class="consent">НДС не облагается, если иное не указано в реквизитах организации.</p>
    <p class="sign">Администратор ____________________</p>`);
}
