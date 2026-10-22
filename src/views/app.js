import { html, raw, rub, field } from './html.js';
import { appLayout, bare } from './layout.js';
import { statusBadge } from './engine.js';
import { fmtDate, weekday, isWeekend, nightsLabel, diffDays } from '../lib/dates.js';
import { LOGO } from './icons.js';
import { BRAND } from '../content.js';

const csrf = (req) => html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
const MEALS = [['none', 'Без питания'], ['breakfast', 'Завтрак'], ['half', 'Завтрак и ужин']];
const SOURCES = { site: 'Сайт', extranet: 'Вручную' };

export function loginPage({ email = '', error, next = '/app', demo }) {
  return bare({
    title: 'Вход',
    body: html`<div class="login">
      <a class="logo" href="/">${LOGO}<span>${BRAND.name}</span></a>
      <form class="card form" method="post" action="/app/login" novalidate>
        <h1 class="h2">Вход в кабинет</h1>
        ${error ? html`<p class="flash flash--error" role="alert">${error}</p>` : ''}
        <input type="hidden" name="next" value="${next}">
        ${field({ name: 'email', label: 'Почта', type: 'email', value: email, attrs: 'autocomplete="username" required' })}
        ${field({ name: 'password', label: 'Пароль', type: 'password', attrs: 'autocomplete="current-password" required' })}
        <button class="btn btn--primary btn--block" type="submit">Войти</button>
        ${demo ? html`<p class="muted">Демо-доступ: ${demo.email} / ${demo.password}</p>` : ''}
      </form></div>`,
  });
}

export function dashboardPage({ req, hotel, stats, arrivals, departures, recent }) {
  return appLayout({
    title: 'Сводка',
    req,
    hotel,
    body: html`<div class="tiles-stat">
      <div class="stat-tile"><span>Загрузка сегодня</span><strong>${stats.occupancy}%</strong><small>${stats.occupied} из ${stats.rooms} номеров</small></div>
      <div class="stat-tile"><span>Заезды сегодня</span><strong>${arrivals.length}</strong></div>
      <div class="stat-tile"><span>Выезды сегодня</span><strong>${departures.length}</strong></div>
      <div class="stat-tile"><span>Выручка броней за 30 дней</span><strong>${rub(stats.revenue30)}</strong><small>${stats.count30} броней</small></div>
    </div>
    <div class="app-cols">
      <section class="card"><h2 class="h3">Заезжают сегодня</h2>${miniList(arrivals, 'Сегодня заездов нет')}</section>
      <section class="card"><h2 class="h3">Выезжают сегодня</h2>${miniList(departures, 'Сегодня выездов нет')}</section>
    </div>
    <section class="card"><h2 class="h3">Новые брони</h2>${bookingsTable(recent, 'Броней пока нет. Откройте модуль бронирования и сделайте тестовую.')}</section>`,
  });
}

function miniList(rows, empty) {
  if (!rows.length) return html`<p class="muted">${empty}</p>`;
  return html`<ul class="mini-list">${rows.map((b) => html`<li><a href="/app/bookings/${b.id}">${b.guest_name}</a><span class="muted">${b.room_name}</span></li>`)}</ul>`;
}

export function bookingsTable(rows, empty) {
  if (!rows.length) return html`<div class="empty"><p>${empty}</p></div>`;
  return html`<div class="table-wrap" tabindex="0" role="region" aria-label="Таблица, прокручивается по горизонтали"><table class="table">
    <thead><tr><th scope="col">Бронь</th><th scope="col">Гость</th><th scope="col">Номер</th><th scope="col">Даты</th><th scope="col">Сумма</th><th scope="col">Статус</th><th scope="col">Источник</th></tr></thead>
    <tbody>${rows.map((b) => html`<tr>
      <td><a href="/app/bookings/${b.id}">${b.code}</a></td><td>${b.guest_name}</td><td>${b.room_name}</td>
      <td>${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}</td><td>${rub(b.total)}</td><td>${statusBadge(b.status)}</td><td>${SOURCES[b.source] || b.source}</td></tr>`)}</tbody>
  </table></div>`;
}

export function bookingsPage({ req, hotel, rows, filters }) {
  return appLayout({
    title: 'Брони',
    req,
    hotel,
    body: html`<form class="filters card" method="get" action="/app/bookings">
      ${field({ name: 'q', label: 'Поиск', value: filters.q, attrs: 'placeholder="Имя, почта или номер брони"' })}
      ${field({ name: 'status', label: 'Статус', type: 'select', value: filters.status, options: [['', 'Все'], ['confirmed', 'Подтверждена'], ['checked_in', 'Заселён'], ['checked_out', 'Выехал'], ['cancelled', 'Отменена'], ['no_show', 'Незаезд']] })}
      ${field({ name: 'from', label: 'Заезд с', type: 'date', value: filters.from })}
      ${field({ name: 'to', label: 'Заезд по', type: 'date', value: filters.to })}
      <button class="btn btn--primary" type="submit">Показать</button>
    </form>
    <section class="card">${bookingsTable(rows, 'По этим условиям броней нет')}</section>`,
  });
}

export function bookingDetailPage({ req, hotel, b, room, rate, msg }) {
  const extras = JSON.parse(b.extras || '[]');
  const next = { confirmed: [['checked_in', 'Заселить'], ['no_show', 'Незаезд'], ['cancelled', 'Отменить']], checked_in: [['checked_out', 'Выселить']] }[b.status] || [];
  return appLayout({
    title: `Бронь ${b.code}`,
    req,
    hotel,
    msg,
    body: html`<p><a href="/app/bookings">← Все брони</a></p>
    <div class="app-cols">
      <section class="card">
        <h2 class="h3">${b.guest_name} ${statusBadge(b.status)}</h2>
        <dl class="kv">
          <dt>Почта</dt><dd><a href="mailto:${b.guest_email}">${b.guest_email}</a></dd>
          <dt>Телефон</dt><dd><a href="tel:${b.guest_phone}">${b.guest_phone}</a></dd>
          <dt>Номер</dt><dd>${room.name}</dd><dt>Тариф</dt><dd>${rate.name}</dd>
          <dt>Даты</dt><dd>${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}, ${nightsLabel(diffDays(b.checkin, b.checkout))}</dd>
          <dt>Гости</dt><dd>${b.adults} взр.${b.children ? `, ${b.children} дет.` : ''}</dd>
          <dt>Пожелания</dt><dd>${b.comment || '—'}</dd>
          <dt>Создана</dt><dd>${b.created_at} UTC, ${SOURCES[b.source] || b.source}</dd>
        </dl>
      </section>
      <section class="card">
        <h2 class="h3">Оплата</h2>
        <ul class="quote">
          <li><span>Проживание</span><span>${rub(b.nights_total)}</span></li>
          ${extras.map((e) => html`<li><span>${e.name} × ${e.qty}</span><span>${rub(e.sum)}</span></li>`)}
          ${b.discount_total ? html`<li><span>Скидки${b.promo_code ? ` (в т.ч. ${b.promo_code})` : ''}</span><span>учтены</span></li>` : ''}
        </ul>
        <p class="quote__total"><span>Итого</span><strong>${rub(b.total)}</strong></p>
        <p class="muted">${b.paid ? 'Оплачено картой (тест)' : 'Оплата при заселении'}</p>
        ${next.length ? html`<h2 class="h3">Действия</h2><div class="actions">${next.map(([s, label]) => html`<form method="post" action="/app/bookings/${b.id}/status" ${s === 'cancelled' ? raw('data-confirm="Отменить бронь и вернуть номера в продажу?"') : ''}>${csrf(req)}<input type="hidden" name="status" value="${s}"><button class="btn ${s === 'cancelled' ? 'btn--danger' : 'btn--secondary'}" type="submit">${label}</button></form>`)}</div>` : ''}
      </section>
    </div>`,
  });
}

export function gridPage({ req, hotel, rooms, dates, cells, from, msg }) {
  const prev = dates.length ? dates[0] : from;
  return appLayout({
    title: 'Шахматка',
    req,
    hotel,
    msg,
    body: html`<div class="grid-toolbar">
      <a class="btn btn--ghost btn--sm" href="/app/grid?from=${shift(prev, -14)}">← 2 недели</a>
      <form method="get" action="/app/grid" class="inline-form"><label for="grid-from" class="sr-only">С даты</label><input id="grid-from" type="date" name="from" value="${from}"><button class="btn btn--secondary btn--sm">Показать</button></form>
      <a class="btn btn--ghost btn--sm" href="/app/grid?from=${shift(prev, 14)}">2 недели →</a>
      <p class="muted grid-hint">Нажмите на ячейку, чтобы изменить цену, число свободных номеров или закрыть продажи.</p>
    </div>
    <div class="grid-wrap" tabindex="0" aria-label="Шахматка цен и наличия">
    <table class="grid" data-grid>
      <thead><tr><th scope="col" class="grid__room">Категория</th>${dates.map((d) => html`<th scope="col" class="${isWeekend(d) ? 'we' : ''}"><span>${weekday(d)}</span>${d.slice(8)}.${d.slice(5, 7)}</th>`)}</tr></thead>
      <tbody>${rooms.map((r) => html`<tr><th scope="row" class="grid__room">${r.name}<small class="muted">${r.total_rooms} ном.</small></th>
        ${dates.map((d) => {
          const c = cells[`${r.id}:${d}`];
          return html`<td class="cell ${c.closed ? 'cell--closed' : c.available === 0 ? 'cell--full' : ''} ${isWeekend(d) ? 'we' : ''}">
            <button type="button" class="cell__btn" data-room="${r.id}" data-room-name="${r.name}" data-date="${d}" data-price="${c.price}" data-available="${c.available}" data-closed="${c.closed}" data-minstay="${c.min_stay}" aria-label="${r.name}, ${fmtDate(d)}: ${c.closed ? 'закрыто' : `свободно ${c.available}`}, ${c.price} ₽">
              <span class="cell__avail">${c.closed ? '✕' : c.available}</span><span class="cell__price">${c.price}</span>
            </button></td>`;
        })}</tr>`)}</tbody>
    </table></div>
    <dialog class="dialog" data-cell-dialog aria-labelledby="cell-title">
      <form method="dialog" class="form" data-cell-form>
        <h2 class="h3" id="cell-title"></h2>
        ${field({ prefix: 'cell', name: 'price', label: 'Цена за ночь, ₽', type: 'number', attrs: 'min="0" max="1000000" required' })}
        ${field({ prefix: 'cell', name: 'available', label: 'Свободно номеров', type: 'number', attrs: 'min="0" required' })}
        ${field({ prefix: 'cell', name: 'min_stay', label: 'Минимум ночей', type: 'number', attrs: 'min="1" max="30" required' })}
        <label class="check"><input type="checkbox" name="open"><span>В продаже</span></label>
        <p class="field-error" data-cell-error hidden></p>
        <div class="actions"><button class="btn btn--primary" value="save" data-cell-save>Сохранить</button><button class="btn btn--ghost" value="cancel" formnovalidate>Отмена</button></div>
      </form>
    </dialog>
    <section class="card">
      <h2 class="h3">Массовое изменение</h2>
      <form class="bulk" method="post" action="/app/grid/bulk">
        ${csrf(req)}
        ${field({ prefix: 'bulk', name: 'room', label: 'Категория', type: 'select', options: [['all', 'Все категории'], ...rooms.map((r) => [r.id, r.name])] })}
        ${field({ prefix: 'bulk', name: 'from', label: 'С', type: 'date', value: from, attrs: 'required' })}
        ${field({ prefix: 'bulk', name: 'to', label: 'По (включительно)', type: 'date', value: shift(from, 6), attrs: 'required' })}
        ${field({ prefix: 'bulk', name: 'days', label: 'Дни', type: 'select', options: [['all', 'Все дни'], ['weekend', 'Только пт и сб'], ['weekday', 'Только вс–чт']] })}
        ${field({ prefix: 'bulk', name: 'action', label: 'Действие', type: 'select', options: [['price', 'Установить цену'], ['percent', 'Изменить цену на %'], ['close', 'Закрыть продажи'], ['open', 'Открыть продажи']] })}
        ${field({ prefix: 'bulk', name: 'value', label: 'Значение (₽ или %)', type: 'number', attrs: 'step="1"' })}
        <button class="btn btn--primary" type="submit">Применить</button>
      </form>
    </section>`,
  });
}

function shift(d, n) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export function roomsPage({ req, hotel, rooms, rates, extras, promos, msg, errors = {} }) {
  return appLayout({
    title: 'Номера и тарифы',
    req,
    hotel,
    msg,
    body: html`<section class="card">
      <h2 class="h3">Категории номеров</h2>
      ${rooms.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Таблица, прокручивается по горизонтали"><table class="table"><thead><tr><th scope="col">Название</th><th scope="col">Мест</th><th scope="col">Номеров</th><th scope="col">Цена по умолчанию</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${rooms.map((r) => html`<tr><td>${r.name}</td><td>${r.capacity}</td><td>${r.total_rooms}</td><td>${rub(r.base_price)}</td><td>${r.active ? 'продаётся' : 'скрыт'}</td>
          <td><details class="row-edit"><summary>Изменить</summary>${roomForm(req, r, `/app/rooms/${r.id}`)}</details></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty"><p>Категорий пока нет — добавьте первую ниже.</p></div>`}
      <details class="add" ${errors.room ? raw('open') : ''}><summary class="btn btn--secondary">Добавить категорию</summary>${roomForm(req, {}, '/app/rooms', errors.room)}</details>
    </section>
    <section class="card">
      <h2 class="h3">Тарифы</h2>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Таблица, прокручивается по горизонтали"><table class="table"><thead><tr><th scope="col">Тариф</th><th scope="col">Питание</th><th scope="col">Отмена</th><th scope="col">Скидка</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${rates.map((r) => html`<tr><td>${r.name}</td><td>${MEALS.find((m) => m[0] === r.meal)[1]}${r.meal_price ? ` (${rub(r.meal_price)}/гость)` : ''}</td><td>${r.refundable ? 'бесплатная' : 'без возврата'}</td><td>${r.discount_pct}%</td><td>${r.active ? 'активен' : 'выключен'}</td>
        <td><details class="row-edit"><summary>Изменить</summary>${rateForm(req, r, `/app/rates/${r.id}`)}</details></td></tr>`)}</tbody></table></div>
      <details class="add"><summary class="btn btn--secondary">Добавить тариф</summary>${rateForm(req, {}, '/app/rates')}</details>
    </section>
    <div class="app-cols">
      <section class="card"><h2 class="h3">Допуслуги</h2>
        <ul class="mini-list">${extras.map((e) => html`<li><span>${e.name} — ${rub(e.price)}</span><form method="post" action="/app/extras/${e.id}/toggle">${csrf(req)}<button class="linklike" type="submit">${e.active ? 'Скрыть' : 'Показать'}</button></form></li>`)}</ul>
        <form class="form form--inline" method="post" action="/app/extras">${csrf(req)}
          ${field({ prefix: 'extra', name: 'name', label: 'Название', attrs: 'required maxlength="80"' })}
          ${field({ prefix: 'extra', name: 'price', label: 'Цена, ₽', type: 'number', attrs: 'min="0" required' })}
          ${field({ prefix: 'extra', name: 'per', label: 'За что', type: 'select', options: [['stay', 'за всё проживание'], ['night', 'за ночь'], ['guest_night', 'за гостя в ночь']] })}
          <button class="btn btn--secondary" type="submit">Добавить</button></form>
      </section>
      <section class="card"><h2 class="h3">Промокоды</h2>
        <ul class="mini-list">${promos.map((p) => html`<li><span><code>${p.code}</code> — ${p.discount_pct}%</span><form method="post" action="/app/promos/${p.id}/toggle">${csrf(req)}<button class="linklike" type="submit">${p.active ? 'Выключить' : 'Включить'}</button></form></li>`)}</ul>
        <form class="form form--inline" method="post" action="/app/promos">${csrf(req)}
          ${field({ prefix: 'promo', name: 'code', label: 'Код', attrs: 'required maxlength="32" pattern="[A-Za-z0-9_-]+"' })}
          ${field({ prefix: 'promo', name: 'discount_pct', label: 'Скидка, %', type: 'number', attrs: 'min="1" max="90" required' })}
          <button class="btn btn--secondary" type="submit">Добавить</button></form>
      </section>
    </div>`,
  });
}

function roomForm(req, r, action, err) {
  const pfx = action.replace(/\W+/g, '-').replace(/^-/, '');
  return html`<form class="form form--grid" method="post" action="${action}">${csrf(req)}
    ${err ? html`<p class="field-error">${err}</p>` : ''}
    ${field({ prefix: pfx, name: 'name', label: 'Название', value: r.name, attrs: 'required maxlength="80"' })}
    ${field({ prefix: pfx, name: 'capacity', label: 'Мест', type: 'number', value: r.capacity ?? 2, attrs: 'min="1" max="12" required' })}
    ${field({ prefix: pfx, name: 'total_rooms', label: 'Номеров', type: 'number', value: r.total_rooms ?? 1, attrs: 'min="0" max="500" required' })}
    ${field({ prefix: pfx, name: 'base_price', label: 'Цена за ночь, ₽', type: 'number', value: r.base_price ?? 3000, attrs: 'min="0" required' })}
    ${field({ prefix: pfx, name: 'area_m2', label: 'Площадь, м²', type: 'number', value: r.area_m2 ?? 18, attrs: 'min="0"' })}
    ${field({ prefix: pfx, name: 'beds', label: 'Кровати', value: r.beds })}
    ${field({ prefix: pfx, name: 'description', label: 'Описание', type: 'textarea', value: r.description })}
    ${r.id ? html`<label class="check"><input type="checkbox" name="active" ${r.active ? raw('checked') : ''}><span>Продаётся</span></label>` : ''}
    <button class="btn btn--primary" type="submit">Сохранить</button></form>`;
}

function rateForm(req, r, action) {
  const pfx = action.replace(/\W+/g, '-').replace(/^-/, '');
  return html`<form class="form form--grid" method="post" action="${action}">${csrf(req)}
    ${field({ prefix: pfx, name: 'name', label: 'Название', value: r.name, attrs: 'required maxlength="80"' })}
    ${field({ prefix: pfx, name: 'meal', label: 'Питание', type: 'select', value: r.meal || 'none', options: MEALS })}
    ${field({ prefix: pfx, name: 'meal_price', label: 'Питание, ₽ за гостя в ночь', type: 'number', value: r.meal_price ?? 0, attrs: 'min="0"' })}
    ${field({ prefix: pfx, name: 'discount_pct', label: 'Скидка, %', type: 'number', value: r.discount_pct ?? 0, attrs: 'min="0" max="90"' })}
    ${field({ prefix: pfx, name: 'description', label: 'Условия', type: 'textarea', value: r.description })}
    <label class="check"><input type="checkbox" name="refundable" ${r.refundable ?? 1 ? raw('checked') : ''}><span>Бесплатная отмена</span></label>
    ${r.id ? html`<label class="check"><input type="checkbox" name="active" ${r.active ? raw('checked') : ''}><span>Активен</span></label>` : ''}
    <button class="btn btn--primary" type="submit">Сохранить</button></form>`;
}

export function channelsPage({ req, hotel, channels, log, msg }) {
  return appLayout({
    title: 'Каналы продаж',
    req,
    hotel,
    msg,
    body: html`<p class="muted">Площадки в демо вымышленные: подключение показывает, как цены и наличие уходят в каналы. Реальные подключения требуют договоров с площадками.</p>
    <section class="card"><div class="table-wrap" tabindex="0" role="region" aria-label="Таблица, прокручивается по горизонтали"><table class="table">
      <thead><tr><th scope="col">Канал</th><th scope="col">Комиссия</th><th scope="col">Наценка</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${channels.map((c) => html`<tr><td>${c.name}</td><td>${c.commission_pct}%</td>
        <td><form class="inline-form" method="post" action="/app/channels/${c.id}/markup">${csrf(req)}<label class="sr-only" for="mk-${c.id}">Наценка для ${c.name}</label><input id="mk-${c.id}" class="input-sm" type="number" name="markup_pct" min="0" max="50" value="${c.markup_pct}"> % <button class="linklike" type="submit">ок</button></form></td>
        <td>${c.connected ? html`<span class="badge badge--confirmed">подключён</span>` : html`<span class="badge badge--off">не подключён</span>`}</td>
        <td><form method="post" action="/app/channels/${c.id}/toggle">${csrf(req)}<button class="btn btn--sm ${c.connected ? 'btn--ghost' : 'btn--primary'}" type="submit">${c.connected ? 'Отключить' : 'Подключить'}</button></form></td></tr>`)}</tbody>
    </table></div></section>
    <section class="card"><h2 class="h3">Журнал отправок</h2>
      ${log.length ? html`<ul class="log">${log.map((l) => html`<li><time>${l.at}</time><strong>${l.channel}</strong><span class="badge badge--${l.kind}">${{ full: 'полная выгрузка', update: 'обновление', booking: 'бронь', disconnect: 'отключение' }[l.kind]}</span><span>${l.summary}</span></li>`)}</ul>`
        : html`<p class="muted">Отправок ещё не было.</p>`}
    </section>`,
  });
}

export function leadsPage({ req, hotel, leads }) {
  return appLayout({
    title: 'Заявки с сайта',
    req,
    hotel,
    body: html`<section class="card">${leads.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Таблица, прокручивается по горизонтали"><table class="table">
      <thead><tr><th scope="col">Когда</th><th scope="col">Имя</th><th scope="col">Телефон</th><th scope="col">Почта</th><th scope="col">Объект</th><th scope="col">Номеров</th><th scope="col">Сообщение</th></tr></thead>
      <tbody>${leads.map((l) => html`<tr><td>${l.created_at}</td><td>${l.name}</td><td>${l.phone}</td><td>${l.email}</td><td>${l.property_type}</td><td>${l.rooms ?? ''}</td><td>${l.message}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty"><p>Заявок пока нет. Они появятся здесь, когда кто-то заполнит форму «Запросить демо».</p></div>`}</section>`,
  });
}

export function reportsPage({ req, hotel, from, to, rows, totals }) {
  return appLayout({
    title: 'Отчёты',
    req,
    hotel,
    body: html`<form class="filters card" method="get" action="/app/reports">
      ${field({ name: 'from', label: 'С', type: 'date', value: from })}
      ${field({ name: 'to', label: 'По', type: 'date', value: to })}
      <button class="btn btn--primary" type="submit">Построить</button></form>
    <div class="tiles-stat">
      <div class="stat-tile"><span>Загрузка</span><strong>${totals.occupancy}%</strong></div>
      <div class="stat-tile"><span>Продано ночей</span><strong>${totals.nights}</strong></div>
      <div class="stat-tile"><span>Выручка за проживание</span><strong>${rub(totals.revenue)}</strong></div>
      <div class="stat-tile"><span>Средняя цена ночи</span><strong>${rub(totals.adr)}</strong></div>
    </div>
    <section class="card"><h2 class="h3">По категориям</h2><div class="table-wrap" tabindex="0" role="region" aria-label="Таблица, прокручивается по горизонтали"><table class="table">
      <thead><tr><th scope="col">Категория</th><th scope="col">Ночей продано</th><th scope="col">Доступно ночей</th><th scope="col">Загрузка</th><th scope="col">Выручка</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${r.name}</td><td>${r.sold}</td><td>${r.capacity}</td><td>
        <span class="bar" style="--w:${r.occupancy}%" aria-hidden="true"></span> ${r.occupancy}%</td><td>${rub(r.revenue)}</td></tr>`)}</tbody></table></div>
      <p class="muted">Считаются брони со статусами «подтверждена», «заселён», «выехал». Выручка распределяется по ночам периода.</p></section>`,
  });
}

export function settingsPage({ req, hotel, origin, msg, errors = {} }) {
  const embed = `<div id="stayra-booking"></div>\n<script src="${origin}/widget.js" data-hotel="${hotel.slug}" async></script>`;
  return appLayout({
    title: 'Настройки',
    req,
    hotel,
    msg,
    body: html`<div class="app-cols">
    <section class="card"><h2 class="h3">Объект</h2>
      <form class="form" method="post" action="/app/settings">${csrf(req)}
        ${field({ name: 'name', label: 'Название', value: hotel.name, error: errors.name, attrs: 'required maxlength="120"' })}
        ${field({ name: 'city', label: 'Город', value: hotel.city })}
        ${field({ name: 'address', label: 'Адрес', value: hotel.address })}
        ${field({ name: 'phone', label: 'Телефон', type: 'tel', value: hotel.phone })}
        ${field({ name: 'email', label: 'Почта', type: 'email', value: hotel.email })}
        ${field({ name: 'checkin_time', label: 'Заезд с', type: 'time', value: hotel.checkin_time, error: errors.checkin_time })}
        ${field({ name: 'checkout_time', label: 'Выезд до', type: 'time', value: hotel.checkout_time, error: errors.checkout_time })}
        ${field({ name: 'description', label: 'Описание для гостей', type: 'textarea', value: hotel.description })}
        <button class="btn btn--primary" type="submit">Сохранить</button>
      </form></section>
    <section class="card"><h2 class="h3">Модуль бронирования на сайт</h2>
      <p>Вставьте этот код на страницу сайта, где должна быть форма поиска номеров:</p>
      <pre class="code" tabindex="0"><code>${embed}</code></pre>
      <button class="btn btn--secondary btn--sm" type="button" data-copy="${embed}">Скопировать код</button>
      <p>Или дайте гостям прямую ссылку: <a href="/h/${hotel.slug}">${origin}/h/${hotel.slug}</a></p>
      <p><a href="/widget-demo">Посмотреть виджет на тестовой странице</a></p>
    </section></div>`,
  });
}
