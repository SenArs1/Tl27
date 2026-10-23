import { html, raw, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { statusBadge } from './engine.js';
import { csrf, sourceName, PAY_METHODS } from './app.js';
import { fmtDate, nightsLabel, diffDays, addDays } from '../lib/dates.js';
import { PURPOSES, TAG_COLORS } from '../lib/card.js';

export const TABS = [
  ['details', 'Детали'],
  ['stay', 'Проживание и услуги'],
  ['payments', 'Счёт и платежи'],
  ['guests', 'Гости и МВД'],
  ['docs', 'Документы'],
  ['notes', 'Заметки'],
  ['history', 'История'],
];
const KIND = { payment: 'оплата', refund: 'возврат', transfer_in: 'перенос из другой брони', transfer_out: 'перенос в другую бронь' };
const methodName = (m) => (PAY_METHODS.find((x) => x[0] === m) || [m, m === 'transfer' ? 'перевод' : m])[1];

export function tagChips(tags) {
  if (!tags.length) return '';
  return html`<span class="tags">${tags.map((t) => html`<span class="tag tag--${t.color}">${t.name}</span>`)}</span>`;
}

// Booking card: a header with the essentials and quick actions, then tabs.
export function bookingCard(p) {
  const { req, hotel, b, rate, segments, channels, msg, tab, tags } = p;
  const debt = b.total - b.paid_amount;
  const next = { confirmed: [['checked_in', 'Заселить'], ['no_show', 'Незаезд'], ['cancelled', 'Отменить бронь']], checked_in: [['checked_out', 'Выселить']] }[b.status] || [];
  const here = `/app/bookings/${b.id}?tab=${tab}`;
  const openNotes = p.notes.filter((n) => !n.done).length;
  const body = {
    details: () => detailsTab(p, here),
    stay: () => stayTab(p, here),
    payments: () => paymentsTab(p, here),
    guests: () => p.guests,
    docs: () => docsTab(p),
    notes: () => notesTab(p, here),
    history: () => historyTab(p),
  }[tab]();
  return appLayout({
    title: `Бронь ${b.code}`,
    req,
    hotel,
    msg,
    body: html`<p><a href="/app/bookings">← Журнал броней</a> · <a href="/app/chess?from=${addDays(b.checkin, -1)}">Показать на шахматке</a></p>
    <section class="card card-head">
      <div class="card-head__main">
        <h2 class="h3">${b.guest_name} ${statusBadge(b.status)} ${tagChips(tags.filter((t) => p.tagIds.includes(t.id)))}</h2>
        <p class="muted">${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}, ${nightsLabel(diffDays(b.checkin, b.checkout))} ·
          ${segments.map((sg, i) => html`${i ? ' → ' : ''}${sg.number ? `№ ${sg.number}` : html`<span class="badge badge--warn">без номера</span>`}`)} · ${rate ? rate.name : ''} · ${sourceName(b.source, channels)}</p>
      </div>
      <div class="card-head__money"><span>Итого ${rub(b.total)}</span>${debt > 0 ? html`<strong class="debt">к оплате ${rub(debt)}</strong>` : html`<strong class="paid">оплачено</strong>`}</div>
      ${next.length ? html`<div class="actions">${next.map(([s, label]) => html`<form method="post" action="/app/bookings/${b.id}/status" ${s === 'cancelled' ? raw('data-confirm="Отменить бронь и вернуть номера в продажу?"') : s === 'no_show' ? raw('data-confirm="Отметить незаезд? Номера вернутся в продажу."') : ''}>${csrf(req)}<input type="hidden" name="status" value="${s}"><input type="hidden" name="back" value="${here}"><button class="btn ${s === 'cancelled' ? 'btn--danger' : s === 'no_show' ? 'btn--ghost' : 'btn--primary'}" type="submit">${label}</button></form>`)}</div>` : ''}
    </section>
    <nav class="subnav card-tabs" aria-label="Разделы брони">
      ${TABS.map(([k, label]) => html`<a href="/app/bookings/${b.id}?tab=${k}" ${k === tab ? raw('aria-current="page"') : ''}>${label}${k === 'notes' && openNotes ? html` <span class="count">${openNotes}</span>` : ''}${k === 'guests' ? html` <span class="count">${p.guestCount}/${b.adults + b.children}</span>` : ''}</a>`)}
    </nav>
    ${body}`,
  });
}

function detailsTab(p, here) {
  const { req, b, segments, rooms, rate, tags, tagIds } = p;
  const live = !['cancelled', 'no_show', 'checked_out'].includes(b.status);
  return html`<div class="app-cols">
    <section class="card"><h2 class="h3">Гость и заказчик</h2>
      <form class="form form--grid" method="post" action="/app/bookings/${b.id}/details">${csrf(req)}<input type="hidden" name="back" value="${here}">
        ${field({ prefix: 'dl', name: 'guest_name', label: 'ФИО гостя', value: b.guest_name, attrs: 'required maxlength="120"' })}
        ${field({ prefix: 'dl', name: 'guest_phone', label: 'Телефон', type: 'tel', value: b.guest_phone, attrs: 'required' })}
        ${field({ prefix: 'dl', name: 'guest_email', label: 'Почта', type: 'email', value: b.guest_email })}
        ${field({ prefix: 'dl', name: 'customer_name', label: 'Заказчик (если платит не гость)', value: b.customer_name, attrs: 'maxlength="160" placeholder="например, ООО «Ромашка»"' })}
        ${field({ prefix: 'dl', name: 'customer_phone', label: 'Телефон заказчика', type: 'tel', value: b.customer_phone })}
        ${field({ prefix: 'dl', name: 'customer_inn', label: 'ИНН заказчика', value: b.customer_inn, attrs: 'inputmode="numeric" maxlength="12"' })}
        ${field({ prefix: 'dl', name: 'purpose', label: 'Цель поездки', type: 'select', value: b.purpose, options: PURPOSES })}
        ${field({ prefix: 'dl', name: 'arrival_time', label: 'Ожидаемое время заезда', type: 'time', value: b.arrival_time })}
        ${field({ prefix: 'dl', name: 'departure_time', label: 'Ожидаемое время выезда', type: 'time', value: b.departure_time })}
        ${field({ prefix: 'dl', name: 'comment', label: 'Пожелания гостя', type: 'textarea', value: b.comment })}
        <div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button></div>
      </form>
    </section>
    <section class="card"><h2 class="h3">Теги</h2>
      ${tags.length ? html`<form method="post" action="/app/bookings/${b.id}/tags" class="form">${csrf(req)}<input type="hidden" name="back" value="${here}">
        <fieldset class="chips"><legend class="sr-only">Теги брони</legend>${tags.map((t) => html`<label class="chip chip--${t.color}"><input type="checkbox" name="tags" value="${t.id}" ${tagIds.includes(t.id) ? raw('checked') : ''}><span>${t.name}</span></label>`)}</fieldset>
        <div class="actions"><button class="btn btn--secondary" type="submit">Сохранить теги</button><a href="/app/settings/tags">Настроить теги</a></div></form>`
        : html`<p class="muted">Тегов пока нет. <a href="/app/settings/tags">Создайте их в настройках</a> — например «VIP», «Ранний заезд» — и отмечайте брони; на шахматке по ним работает фильтр.</p>`}
      ${live ? html`<h2 class="h3 move-form">Номера и даты</h2>
        <ul class="segments">${segments.map((sg) => html`<li>
          <span><strong>${fmtDate(sg.start)} — ${fmtDate(sg.end)}</strong> · ${sg.type_name} · ${sg.number ? `№ ${sg.number}` : html`<span class="badge badge--warn">без номера</span>`}</span>
          <form class="form form--inline" method="post" action="/app/bookings/${b.id}/move">${csrf(req)}<input type="hidden" name="segment_id" value="${sg.id}"><input type="hidden" name="back" value="${here}">
            ${field({ prefix: `mv${sg.id}`, name: 'room_id', label: segments.length > 1 ? 'Переселить эту часть в номер' : 'Переселить в номер', type: 'select', value: sg.room_id || '', options: [['', '— без номера —'], ...rooms.map((r) => [r.id, `№ ${r.number} — ${r.type_name}`])] })}
            <button class="btn btn--secondary" type="submit">Переселить</button></form></li>`)}</ul>
        ${diffDays(b.checkin, b.checkout) > 1 ? html`<form class="form form--inline" method="post" action="/app/bookings/${b.id}/split">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: 'sp', name: 'date', label: 'Переселить с даты', type: 'date', value: '', attrs: `min="${addDays(b.checkin, 1)}" max="${addDays(b.checkout, -1)}" required`, hint: 'Ночи до этой даты остаются в текущем номере' })}
          ${field({ prefix: 'sp', name: 'room_id', label: 'в номер', type: 'select', options: rooms.map((r) => [r.id, `№ ${r.number} — ${r.type_name}`]) })}
          <button class="btn btn--secondary" type="submit">Разделить проживание</button></form>` : ''}
        <form class="form form--inline" method="post" action="/app/bookings/${b.id}/dates">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: 'dt', name: 'checkin', label: 'Заезд', type: 'date', value: b.checkin, attrs: b.status === 'checked_in' ? 'readonly' : '' })}
          ${field({ prefix: 'dt', name: 'checkout', label: 'Выезд', type: 'date', value: b.checkout })}
          <button class="btn btn--secondary" type="submit">Изменить даты</button>
          <p class="hint span-all">Оплаченные ночи сохраняют свою цену, новые считаются по тарифу «${rate ? rate.name : ''}». Ранний выезд — укажите новую дату выезда.</p></form>` : ''}
    </section>
  </div>`;
}

function stayTab(p, here) {
  const { req, b, extrasCatalog } = p;
  const lines = JSON.parse(b.extras || '[]');
  const live = !['cancelled', 'no_show'].includes(b.status);
  return html`<div class="app-cols">
    <section class="card"><h2 class="h3">Проживание</h2>
      <ul class="quote">
        <li><span>Проживание, ${nightsLabel(diffDays(b.checkin, b.checkout))}${b.extra_beds_total ? ` (в т.ч. доп. места ${rub(b.extra_beds_total)})` : ''}</span><span>${rub(b.nights_total)}</span></li>
        ${b.tax_total ? html`<li><span>Туристический налог</span><span>${rub(b.tax_total)}</span></li>` : ''}
        ${b.discount_total ? html`<li><span>Учтённые скидки${b.promo_code ? ` (в т.ч. ${b.promo_code})` : ''}</span><span>${rub(b.discount_total)}</span></li>` : ''}
      </ul>
      ${live ? html`<details class="add"><summary class="btn btn--secondary">Изменить стоимость</summary>
        <form class="form form--grid" method="post" action="/app/bookings/${b.id}/price">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: 'pr', name: 'stay', label: 'Стоимость проживания, ₽', type: 'number', value: b.nights_total, attrs: 'min="0" required' })}
          ${field({ prefix: 'pr', name: 'reason', label: 'Причина', attrs: 'required minlength="3" placeholder="например, договорённость с гостем"' })}
          <div class="actions span-all"><button class="btn btn--primary" type="submit">Применить</button><a class="btn btn--ghost" href="${here}" data-close-details>Отмена</a></div></form></details>
      <details class="add"><summary class="btn btn--secondary">Скидка</summary>
        <form class="form form--grid" method="post" action="/app/bookings/${b.id}/discount">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: 'ds', name: 'value', label: 'Размер', type: 'number', attrs: 'min="1" required' })}
          ${field({ prefix: 'ds', name: 'unit', label: 'В чём', type: 'select', options: [['pct', '% от проживания'], ['sum', '₽']] })}
          ${field({ prefix: 'ds', name: 'reason', label: 'Причина', attrs: 'required minlength="3" placeholder="например, постоянный гость"' })}
          <div class="actions span-all"><button class="btn btn--primary" type="submit">Применить</button><a class="btn btn--ghost" href="${here}" data-close-details>Отмена</a></div></form></details>` : ''}
    </section>
    <section class="card"><h2 class="h3">Услуги</h2>
      ${lines.length ? html`<ul class="mini-list">${lines.map((l, i) => html`<li><span>${l.name} × ${l.qty} <small class="muted">по ${rub(l.price)}</small></span><span class="actions">${rub(l.sum)}
        ${live ? html`<form method="post" action="/app/bookings/${b.id}/services/${i}/delete" data-confirm="Убрать услугу «${l.name}»?">${csrf(req)}<input type="hidden" name="back" value="${here}"><button class="linklike" type="submit">убрать</button></form>` : ''}</span></li>`)}</ul>`
        : html`<p class="muted">Услуг нет.</p>`}
      ${live ? html`<form class="form form--grid" method="post" action="/app/bookings/${b.id}/services">${csrf(req)}<input type="hidden" name="back" value="${here}">
        ${field({ prefix: 'sv', name: 'extra_id', label: 'Из списка услуг', type: 'select', options: [['', '— своя услуга —'], ...extrasCatalog.map((e) => [e.id, `${e.group_name ? `${e.group_name} / ` : ''}${e.name} — ${rub(e.price)}`])] })}
        ${field({ prefix: 'sv', name: 'qty', label: 'Количество', type: 'number', attrs: 'min="1" max="999"', hint: 'Пусто — по правилу услуги (за ночь, за гостя…)' })}
        ${field({ prefix: 'sv', name: 'name', label: 'Своя услуга: название', attrs: 'maxlength="80" placeholder="например, мини-бар"' })}
        ${field({ prefix: 'sv', name: 'price', label: 'Своя услуга: цена, ₽', type: 'number', attrs: 'min="0"' })}
        <div class="actions span-all"><button class="btn btn--primary" type="submit">Добавить услугу</button></div></form>` : ''}
    </section>
  </div>`;
}

function paymentsTab(p, here) {
  const { req, b, payments } = p;
  const debt = b.total - b.paid_amount;
  const live = !['cancelled', 'no_show'].includes(b.status);
  const lines = JSON.parse(b.extras || '[]');
  return html`<div class="app-cols">
    <section class="card"><h2 class="h3">Счёт</h2>
      <ul class="quote">
        <li><span>Проживание</span><span>${rub(b.nights_total)}</span></li>
        ${lines.map((e) => html`<li><span>${e.name} × ${e.qty}</span><span>${rub(e.sum)}</span></li>`)}
        ${b.tax_total ? html`<li><span>Туристический налог</span><span>${rub(b.tax_total)}</span></li>` : ''}
      </ul>
      <p class="quote__total"><span>Итого</span><strong>${rub(b.total)}</strong></p>
      <p class="quote__total"><span>Оплачено</span><strong>${rub(b.paid_amount)}</strong></p>
      ${debt > 0 ? html`<p class="quote__total quote__debt"><span>К оплате</span><strong>${rub(debt)}</strong></p>`
        : debt < 0 ? html`<p class="quote__total quote__debt"><span>Переплата — оформите возврат или перенос</span><strong>${rub(-debt)}</strong></p>`
        : html`<p class="badge badge--confirmed">Оплачено полностью</p>`}
      ${live && debt > 0 ? html`<form class="form form--inline" method="post" action="/app/bookings/${b.id}/pay">${csrf(req)}<input type="hidden" name="back" value="${here}">
        ${field({ prefix: 'pay', name: 'amount', label: 'Сумма, ₽', type: 'number', value: debt, attrs: `min="1" max="${debt}" required` })}
        ${field({ prefix: 'pay', name: 'method', label: 'Способ', type: 'select', value: 'card', options: PAY_METHODS.filter((m) => m[0] !== 'online') })}
        <button class="btn btn--primary" type="submit">Принять оплату</button></form>` : ''}
    </section>
    <section class="card"><h2 class="h3">Платежи</h2>
      ${payments.length ? html`<ul class="pay-list">${payments.map((x) => html`<li class="${x.voided ? 'is-void' : ''}">
        <span>${x.created_at.slice(0, 16)} · ${KIND[x.kind] || x.kind} · ${methodName(x.method)}${x.note ? ` · ${x.note}` : ''}${x.voided ? html`<small>аннулирован: ${x.void_reason}</small>` : ''}</span>
        <span class="actions"><strong>${x.amount < 0 ? '−' : ''}${rub(Math.abs(x.amount))}</strong>
        ${!x.voided && ['payment', 'refund'].includes(x.kind) ? html`<details class="row-edit"><summary>Аннулировать</summary><form class="form form--inline" method="post" action="/app/bookings/${b.id}/payments/${x.id}/void">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: `vd${x.id}`, name: 'reason', label: 'Причина', attrs: 'required minlength="3" placeholder="ошибочный платёж"' })}<button class="btn btn--danger btn--sm" type="submit">Аннулировать</button></form></details>` : ''}</span></li>`)}</ul>`
        : html`<p class="muted">Платежей ещё не было.</p>`}
      ${b.paid_amount > 0 ? html`<details class="add"><summary class="btn btn--secondary">Возврат</summary>
        <form class="form form--grid" method="post" action="/app/bookings/${b.id}/refund">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: 'rf', name: 'amount', label: 'Сумма возврата, ₽', type: 'number', value: Math.max(0, Math.min(b.paid_amount, -debt)) || '', attrs: `min="1" max="${b.paid_amount}" required` })}
          ${field({ prefix: 'rf', name: 'method', label: 'Как вернуть', type: 'select', value: 'cash', options: PAY_METHODS.filter((m) => m[0] !== 'online') })}
          ${field({ prefix: 'rf', name: 'reason', label: 'Причина', attrs: 'required minlength="3" placeholder="например, ранний выезд"' })}
          <div class="actions span-all"><button class="btn btn--primary" type="submit">Оформить возврат</button><a class="btn btn--ghost" href="${here}" data-close-details>Отмена</a></div></form></details>
      <details class="add"><summary class="btn btn--secondary">Перенести в другую бронь</summary>
        <form class="form form--grid" method="post" action="/app/bookings/${b.id}/transfer">${csrf(req)}<input type="hidden" name="back" value="${here}">
          ${field({ prefix: 'tr', name: 'code', label: 'Номер брони, куда перенести', attrs: 'required placeholder="SR-XXXXXXXX" autocomplete="off"' })}
          ${field({ prefix: 'tr', name: 'amount', label: 'Сумма, ₽', type: 'number', value: Math.max(0, Math.min(b.paid_amount, -debt)) || '', attrs: `min="1" max="${b.paid_amount}" required` })}
          <div class="actions span-all"><button class="btn btn--primary" type="submit">Перенести</button><a class="btn btn--ghost" href="${here}" data-close-details>Отмена</a></div></form></details>` : ''}
    </section>
  </div>`;
}

function docsTab(p) {
  const { b, guestList } = p;
  const doc = (href, title, text) => html`<li><a href="${href}" target="_blank" rel="noopener">${title}</a><small class="muted">${text}</small></li>`;
  return html`<section class="card"><h2 class="h3">Документы для печати</h2>
    <ul class="doc-list">
      ${doc(`/app/bookings/${b.id}/doc/confirmation`, 'Подтверждение бронирования', 'Даты, номер, тариф, сумма и условия — для гостя')}
      ${doc(`/app/bookings/${b.id}/doc/invoice`, 'Счёт на оплату', 'Проживание, услуги, налог; заказчик, если указан')}
      ${doc(`/app/bookings/${b.id}/doc/receipt`, 'Справка об оплате', 'Все принятые платежи и возвраты по брони')}
      ${guestList.map((g) => doc(`/app/bookings/${b.id}/guests/${g.id}/card`, `Анкета гостя: ${g.last_name} ${g.first_name}`, 'Для подписи при заселении'))}
    </ul>
    <p class="muted">Документы открываются в новой вкладке; там же кнопка «Печать». Кассовый чек печатает ваша онлайн-касса — интеграция с кассой подключается отдельно.</p></section>`;
}

function notesTab(p, here) {
  const { req, b, notes, today } = p;
  return html`<section class="card"><h2 class="h3">Заметки и задачи</h2>
    ${notes.length ? html`<ul class="note-list">${notes.map((n) => {
      const late = !n.done && n.due_at && n.due_at.slice(0, 10) < today;
      return html`<li class="${n.done ? 'is-done' : ''}">
        <form method="post" action="/app/bookings/${b.id}/notes/${n.id}/toggle">${csrf(req)}<input type="hidden" name="back" value="${here}">
          <button class="note-check" type="submit" aria-label="${n.done ? 'Вернуть в работу' : 'Отметить выполненной'}: ${n.text}">${n.done ? '✓' : ''}</button></form>
        <div><p>${n.text}</p><small class="muted">${n.created_by}, ${n.created_at.slice(0, 16)}${n.due_at ? html` · срок <span class="${late ? 'late' : ''}">${fmtDate(n.due_at.slice(0, 10))} ${n.due_at.slice(11, 16)}</span>` : ''}</small></div></li>`;
    })}</ul>` : html`<p class="muted">Заметок нет. Запишите пожелание гостя («аллергия на орехи») или задачу со сроком («встретить с вокзала в 9:00»).</p>`}
    <form class="form form--grid" method="post" action="/app/bookings/${b.id}/notes">${csrf(req)}<input type="hidden" name="back" value="${here}">
      ${field({ prefix: 'nt', name: 'text', label: 'Заметка', type: 'textarea', attrs: 'required maxlength="500"' })}
      ${field({ prefix: 'nt', name: 'due_at', label: 'Срок (если это задача)', type: 'datetime-local' })}
      <div class="actions span-all"><button class="btn btn--primary" type="submit">Добавить</button></div>
    </form></section>`;
}

function historyTab(p) {
  const { history } = p;
  return html`<section class="card"><h2 class="h3">История изменений</h2>
    ${history.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="История изменений"><table class="table table--compact">
      <thead><tr><th scope="col">Когда (UTC)</th><th scope="col">Кто</th><th scope="col">Что</th><th scope="col">Было</th><th scope="col">Стало</th></tr></thead>
      <tbody>${history.map((h) => html`<tr><td>${h.at.slice(0, 16)}</td><td>${h.user_name}</td><td>${h.what}</td><td>${h.old_value}</td><td>${h.new_value}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">Изменений пока нет.</p>`}</section>`;
}

export { TAG_COLORS };
