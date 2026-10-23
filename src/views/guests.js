import { html, raw, field } from './html.js';
import { whenOf } from '../lib/hourly.js';
import { csrf } from './app.js';
import { DOC_TYPES, COUNTRIES, MVD_STATUS, countryName, docName, maskDoc, isForeign, mvdDeadline } from '../lib/guests.js';
import { fmtDate } from '../lib/dates.js';
import { BRAND } from '../content.js';

const SEX = [['', '—'], ['m', 'мужской'], ['f', 'женский']];

export function statusChip(g, today) {
  if (g.mvd_status === 'sent') return html`<span class="badge badge--confirmed">МВД: отправлено ${g.mvd_sent_at ? fmtDate(g.mvd_sent_at.slice(0, 10)) : ''}</span>`;
  if (g.mvd_status === 'not_required') return html`<span class="badge badge--off">МВД: не требуется</span>`;
  const late = g.deadline && g.deadline < today;
  return html`<span class="badge ${late ? 'badge--cancelled' : 'badge--warn'}">МВД: не отправлено${g.deadline ? `, срок ${fmtDate(g.deadline)}` : ''}</span>`;
}

// Guests & documents block of the booking card.
export function guestsSection({ req, b, guests, today, values, errors = {}, open = false }) {
  const expected = b.adults + b.children;
  return html`<section class="card" id="guests">
    <h2 class="h3">Гости и документы <small class="muted">${guests.length} из ${expected}</small></h2>
    <p class="muted">Нужны для регистрации гостей в МВД. Это персональные данные: доступ только у сотрудников объекта, в списках номер документа скрыт.</p>
    ${guests.length ? html`<ul class="guest-list">${guests.map((g) => html`<li>
      <div><strong>${g.last_name} ${g.first_name} ${g.middle_name}</strong> · ${fmtDate(g.birth_date)} · ${countryName(g.citizenship)}
        <small class="muted">${docName(g.doc_type)} ${maskDoc(g)}${isForeign(g) && g.migration_card ? ` · миграционная карта ${g.migration_card}` : ''}</small></div>
      <div class="actions">${statusChip({ ...g, deadline: mvdDeadline(g, b.checkin) }, today)}
        <form method="post" action="/app/bookings/${b.id}/guests/${g.id}/mvd">${csrf(req)}<input type="hidden" name="status" value="${g.mvd_status === 'sent' ? 'new' : 'sent'}"><button class="linklike" type="submit">${g.mvd_status === 'sent' ? 'Снять отметку' : 'Отметить: отправлено'}</button></form>
        <a href="/app/bookings/${b.id}/guests/${g.id}/card" target="_blank" rel="noopener">Анкета для печати</a>
        <details class="row-edit"><summary>Изменить</summary>${guestForm(req, b, g, `/app/bookings/${b.id}/guests/${g.id}`)}</details>
        <form method="post" action="/app/bookings/${b.id}/guests/${g.id}/delete" data-confirm="Удалить данные гостя ${g.last_name}?">${csrf(req)}<button class="linklike" type="submit">Удалить</button></form>
      </div></li>`)}</ul>` : html`<p class="muted">Документы ещё не внесены.</p>`}
    ${guests.length < expected || open ? html`<details class="add" ${open ? raw('open') : ''}><summary class="btn btn--secondary">Добавить гостя</summary>${guestForm(req, b, values || {}, `/app/bookings/${b.id}/guests`, errors)}</details>` : ''}
  </section>`;
}

function guestForm(req, b, g, action, errors = {}) {
  const pfx = action.replace(/\W+/g, '-').replace(/^-/, '');
  const f = (o) => field({ prefix: pfx, ...o, value: g[o.name] ?? o.value ?? '', error: errors[o.name] });
  return html`<form class="form form--grid" method="post" action="${action}" novalidate>${csrf(req)}
    ${f({ name: 'last_name', label: 'Фамилия', attrs: 'required autocomplete="off"' })}
    ${f({ name: 'first_name', label: 'Имя', attrs: 'required autocomplete="off"' })}
    ${f({ name: 'middle_name', label: 'Отчество (если есть)', attrs: 'autocomplete="off"' })}
    ${f({ name: 'birth_date', label: 'Дата рождения', type: 'date', attrs: 'required' })}
    ${f({ name: 'sex', label: 'Пол', type: 'select', options: SEX })}
    ${f({ name: 'citizenship', label: 'Гражданство', type: 'select', value: 'RUS', options: [...COUNTRIES.map(([k, n]) => [k, `${n} (${k})`]), ...(g.citizenship && !COUNTRIES.some(([k]) => k === g.citizenship) ? [[g.citizenship, g.citizenship]] : [])] })}
    ${f({ name: 'doc_type', label: 'Документ', type: 'select', value: 'passport_rf', options: DOC_TYPES })}
    ${f({ name: 'doc_series', label: 'Серия', attrs: 'autocomplete="off"' })}
    ${g.id
      ? field({ prefix: pfx, name: 'doc_number', label: `Номер (сейчас ${maskDoc(g)})`, value: '', error: errors.doc_number, attrs: 'autocomplete="off"', hint: 'Оставьте пустым, чтобы не менять' })
      : f({ name: 'doc_number', label: 'Номер', attrs: 'required autocomplete="off"' })}
    ${f({ name: 'doc_issued_at', label: 'Дата выдачи', type: 'date' })}
    ${f({ name: 'doc_code', label: 'Код подразделения', attrs: 'placeholder="000-000" autocomplete="off"' })}
    ${f({ name: 'doc_issued_by', label: 'Кем выдан' })}
    ${f({ name: 'reg_address', label: 'Адрес регистрации (постоянный)', type: 'textarea' })}
    ${f({ name: 'migration_card', label: 'Миграционная карта (для иностранцев)', attrs: 'autocomplete="off"' })}
    ${f({ name: 'visa', label: 'Виза (если есть)', attrs: 'autocomplete="off"' })}
    <div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button><a class="btn btn--ghost" href="/app/bookings/${b.id}#guests" data-close-details>Отмена</a></div>
  </form>`;
}

// Printable registration card (анкета гостя) for the guest's signature.
export function registrationCard({ hotel, b, g, rooms }) {
  const row = (k, v) => html`<tr><th scope="row">${k}</th><td>${v || '—'}</td></tr>`;
  return html`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Анкета гостя — ${g.last_name} ${g.first_name}</title><link rel="stylesheet" href="/css/print.css"></head>
<body class="regcard"><main>
  <p class="noprint"><button type="button" onclick="window.print()">Печать</button> <a href="/app/bookings/${b.id}#guests">← К брони</a></p>
  <header><strong>${hotel.legal_name || hotel.name}</strong><span>${hotel.address}${hotel.inn ? ` · ИНН ${hotel.inn}` : ''}</span></header>
  <h1>Анкета гостя</h1>
  <table>
    ${row('Фамилия, имя, отчество', `${g.last_name} ${g.first_name} ${g.middle_name}`)}
    ${row('Дата рождения', fmtDate(g.birth_date))}
    ${row('Пол', { m: 'мужской', f: 'женский' }[g.sex])}
    ${row('Гражданство', `${countryName(g.citizenship)} (${g.citizenship})`)}
    ${row('Документ', `${docName(g.doc_type)}, ${g.doc_series} ${g.doc_number}`)}
    ${row('Выдан', [g.doc_issued_at ? fmtDate(g.doc_issued_at) : '', g.doc_issued_by, g.doc_code ? `код ${g.doc_code}` : ''].filter(Boolean).join(', '))}
    ${row('Адрес регистрации', g.reg_address)}
    ${isForeign(g) ? row('Миграционная карта / виза', [g.migration_card, g.visa].filter(Boolean).join(', ')) : ''}
    ${row('Бронирование', b.code)}
    ${row('Номер', rooms)}
    ${row('Заезд — выезд', b.start_at ? whenOf(b) : `${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}`)}
  </table>
  <p class="consent">Я подтверждаю, что данные указаны верно, и даю согласие ${hotel.legal_name || hotel.name} на обработку моих персональных данных для оказания гостиничных услуг и регистрационного учёта в соответствии с законодательством РФ.</p>
  <p class="sign">Подпись гостя ____________________ &nbsp;&nbsp; Дата ____________ &nbsp;&nbsp; Администратор ____________________</p>
  <footer>Сформировано в ${BRAND.name}</footer>
</main></body></html>`.value;
}
