import { html, raw, rub, field } from './html.js';
import { appLayout, bare } from './layout.js';
import { statusBadge } from './engine.js';
import { fmtDate, fmtShort, weekday, isWeekend, nightsLabel, diffDays, addDays as addDaysV } from '../lib/dates.js';
import { LOGO } from './icons.js';
import { BRAND } from '../content.js';
import { PROPERTY_TYPES } from '../lib/hotels.js';

export const csrf = (req) => html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
export const MEALS = [['none', 'Без питания'], ['breakfast', 'Завтрак'], ['half', 'Завтрак и ужин']];
export const PAY_METHODS = [['cash', 'Наличные'], ['card', 'Карта на стойке'], ['transfer', 'Перевод / счёт'], ['online', 'Онлайн']];

export function sourceName(source, channels = []) {
  if (source === 'site') return 'Сайт отеля';
  if (source === 'extranet') return 'Вручную';
  const c = channels.find((x) => x.code === source);
  return c ? c.name : source;
}

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
        <p>Нет кабинета? <a href="/signup">Зарегистрируйте объект</a></p>
        ${demo ? html`<p class="muted">Демо-доступ: ${demo.email} / ${demo.password}</p>` : ''}
      </form></div>`,
  });
}

export function signupPage({ values = {}, errors = {} }) {
  return bare({
    title: 'Регистрация объекта',
    body: html`<div class="login login--wide">
      <a class="logo" href="/">${LOGO}<span>${BRAND.name}</span></a>
      <form class="card form" method="post" action="/signup" novalidate>
        <h1 class="h2">Регистрация объекта</h1>
        <p class="muted">Создадим отдельный кабинет для вашего объекта. Данные разных объектов никогда не смешиваются.</p>
        ${field({ prefix: 'su', name: 'hotel_name', label: 'Название объекта', value: values.hotel_name, error: errors.hotel_name, attrs: 'required maxlength="120"' })}
        ${field({ prefix: 'su', name: 'city', label: 'Город', value: values.city, attrs: 'maxlength="80"' })}
        ${field({ prefix: 'su', name: 'property_type', label: 'Тип объекта', type: 'select', value: values.property_type || 'hotel', options: PROPERTY_TYPES })}
        ${field({ prefix: 'su', name: 'name', label: 'Ваше имя', value: values.name, error: errors.name, attrs: 'required autocomplete="name"' })}
        ${field({ prefix: 'su', name: 'email', label: 'Почта для входа', type: 'email', value: values.email, error: errors.email, attrs: 'required autocomplete="email"' })}
        ${field({ prefix: 'su', name: 'password', label: 'Пароль (не короче 8 символов)', type: 'password', error: errors.password, attrs: 'required autocomplete="new-password" minlength="8"' })}
        <label class="check"><input type="checkbox" name="agree" ${values.agree ? raw('checked') : ''}><span>Принимаю условия сервиса и <a href="/privacy">политику конфиденциальности</a></span></label>
        ${errors.agree ? html`<p class="field-error">${errors.agree}</p>` : ''}
        <button class="btn btn--accent btn--block btn--lg" type="submit">Создать кабинет</button>
        <p>Уже есть кабинет? <a href="/app/login">Войти</a></p>
      </form></div>`,
  });
}

function spark(points, max) {
  return html`<div class="spark" role="img" aria-label="${points.map((p) => `${fmtShort(p.date)}: ${p.value}%`).join(', ')}">
    ${points.map((p) => html`<div class="spark__col ${isWeekend(p.date) ? 'we' : ''}" title="${fmtShort(p.date)}: ${p.value}%"><span style="height:${max ? Math.max(3, Math.round((p.value / max) * 100)) : 3}%"></span><small>${p.date.slice(8)}</small></div>`)}
  </div>`;
}

export function dashboardPage({ req, hotel, msg, s, arrivals, departures, inhouse, forecast, sources, unassigned, dirty, debtors, channels }) {
  const empty = s.rooms === 0;
  return appLayout({
    title: 'Сводка',
    req,
    hotel,
    msg,
    body: html`${empty ? html`<div class="card onboarding"><h2 class="h3">С чего начать</h2><ol>
        <li><a href="/app/rooms">Добавьте категории номеров и сами номера</a> (101, 102…)</li>
        <li><a href="/app/rooms#rates">Проверьте тарифы</a> и цены в разделе <a href="/app/prices">«Цены и наличие»</a></li>
        <li><a href="/app/settings/widget">Поставьте модуль бронирования на сайт</a></li></ol></div>` : ''}
    <div class="tiles-stat">
      <div class="stat-tile"><span>Загрузка сегодня</span><strong>${s.occupancy}%</strong><small>занято ${s.occupied} из ${s.rooms}, свободно ${s.rooms - s.occupied}</small></div>
      <div class="stat-tile"><span>Заезды / выезды</span><strong>${arrivals.length} / ${departures.length}</strong><small>проживают ${inhouse} гостей</small></div>
      <div class="stat-tile"><span>Доход за месяц (ADR / RevPAR)</span><strong>${rub(s.monthRevenue)}</strong><small>${rub(s.adr)} / ${rub(s.revpar)}</small></div>
      <div class="stat-tile"><span>Ждут оплаты</span><strong>${rub(s.debt)}</strong><small>${debtors} ${debtors === 1 ? 'бронь' : 'броней'} заезжают в ближайшие 7 дней</small></div>
    </div>
    ${unassigned || dirty ? html`<div class="alerts">
      ${unassigned ? html`<a class="alert" href="/app/chess">⚠ ${unassigned} бронь(и) без номера — распределите на шахматке</a>` : ''}
      ${dirty ? html`<a class="alert" href="/app/rooms#stock">🧹 ${dirty} номер(ов) ждут уборки</a>` : ''}
    </div>` : ''}
    <div class="app-cols">
      <section class="card"><h2 class="h3">Заезжают сегодня</h2>${miniList(arrivals, 'Сегодня заездов нет', 'checked_in', 'Заселить', req)}</section>
      <section class="card"><h2 class="h3">Выезжают сегодня</h2>${miniList(departures, 'Сегодня выездов нет', 'checked_out', 'Выселить', req)}</section>
    </div>
    <div class="app-cols">
      <section class="card"><h2 class="h3">Загрузка на 14 дней вперёд</h2>${spark(forecast, 100)}</section>
      <section class="card"><h2 class="h3">Откуда брони за 30 дней</h2>
        ${sources.length ? html`<ul class="bars">${sources.map((x) => html`<li><span>${sourceName(x.source, channels)}</span><span class="bar" style="--w:${x.pct}%" aria-hidden="true"></span><span>${x.n} · ${rub(x.sum)}</span></li>`)}</ul>
          <p class="muted">Отмен за 30 дней: ${s.cancelled30}</p>` : html`<p class="muted">Броней за последние 30 дней не было.</p>`}
      </section>
    </div>`,
  });
}

function miniList(rows, empty, action, label, req) {
  if (!rows.length) return html`<p class="muted">${empty}</p>`;
  return html`<ul class="mini-list">${rows.map((b) => html`<li><span><a href="/app/bookings/${b.id}">${b.guest_name}</a><small class="muted">№ ${b.room_number || '—'} · ${b.room_name}${b.paid_amount < b.total ? ` · долг ${rub(b.total - b.paid_amount)}` : ''}</small></span>
    ${(action === 'checked_in' && b.status === 'confirmed') || (action === 'checked_out' && b.status === 'checked_in')
      ? html`<form method="post" action="/app/bookings/${b.id}/status">${csrf(req)}<input type="hidden" name="status" value="${action}"><input type="hidden" name="back" value="/app"><button class="btn btn--secondary btn--sm" type="submit">${label}</button></form>`
      : statusBadge(b.status)}</li>`)}</ul>`;
}

export function bookingsTable(rows, empty, channels = []) {
  if (!rows.length) return html`<div class="empty"><p>${empty}</p></div>`;
  return html`<div class="table-wrap" tabindex="0" role="region" aria-label="Таблица броней, прокручивается по горизонтали"><table class="table">
    <thead><tr><th scope="col">Бронь</th><th scope="col">Создана</th><th scope="col">Источник</th><th scope="col">Гость</th><th scope="col">Номер</th><th scope="col">Даты</th><th scope="col">Сумма</th><th scope="col">Оплачено</th><th scope="col">Статус</th></tr></thead>
    <tbody>${rows.map((b) => html`<tr>
      <td><a href="/app/bookings/${b.id}">${b.code}</a></td><td>${b.created_at.slice(0, 16)}</td><td>${sourceName(b.source, channels)}</td>
      <td>${b.guest_name}<small class="muted">${b.guest_phone}</small></td><td>${b.room_number ? `№ ${b.room_number}` : html`<span class="badge badge--warn">без номера</span>`}<small class="muted">${b.room_name}</small></td>
      <td>${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}</td><td>${rub(b.total)}</td>
      <td>${b.paid_amount >= b.total ? html`<span class="badge badge--confirmed">оплачено</span>` : b.paid_amount ? rub(b.paid_amount) : html`<span class="muted">нет</span>`}</td>
      <td>${statusBadge(b.status)}</td></tr>`)}</tbody>
  </table></div>`;
}

export function bookingsPage({ req, hotel, msg, rows, filters, channels, counts }) {
  return appLayout({
    title: 'Журнал броней',
    req,
    hotel,
    msg,
    body: html`<div class="page-actions"><a class="btn btn--primary" href="/app/bookings/new">+ Новая бронь</a>
      <p class="muted">Все брони объекта в одном списке: с сайта, из каналов продаж и созданные вручную.</p></div>
    <form class="filters card" method="get" action="/app/bookings">
      ${field({ name: 'q', label: 'Поиск', value: filters.q, attrs: 'placeholder="Имя, телефон, почта или номер брони"' })}
      ${field({ name: 'source', label: 'Источник', type: 'select', value: filters.source, options: [['', 'Все'], ['site', 'Сайт отеля'], ['extranet', 'Вручную'], ...channels.map((c) => [c.code, c.name])] })}
      ${field({ name: 'status', label: 'Статус', type: 'select', value: filters.status, options: [['', 'Все'], ['confirmed', 'Подтверждена'], ['checked_in', 'Проживает'], ['checked_out', 'Выехал'], ['cancelled', 'Отменена'], ['no_show', 'Незаезд']] })}
      ${field({ name: 'by', label: 'Даты', type: 'select', value: filters.by, options: [['created', 'по дате создания'], ['checkin', 'по дате заезда']] })}
      ${field({ name: 'from', label: 'С', type: 'date', value: filters.from })}
      ${field({ name: 'to', label: 'По', type: 'date', value: filters.to })}
      <button class="btn btn--primary" type="submit">Показать</button>
    </form>
    <p class="muted">Найдено: ${rows.length}${counts ? ` · на сумму ${rub(counts.sum)}` : ''}</p>
    <section class="card">${bookingsTable(rows, 'По этим условиям броней нет', channels)}</section>`,
  });
}

export function newBookingPage({ req, hotel, types, rooms, rates, extras, values = {}, errors = {}, formError }) {
  const v = values;
  return appLayout({
    title: 'Новая бронь',
    req,
    hotel,
    body: html`<p><a href="/app/chess">← Шахматка</a></p>
    ${formError ? html`<div class="flash flash--error" role="alert">${formError}</div>` : ''}
    <form class="card form form--grid" method="post" action="/app/bookings/new" novalidate>
      ${csrf(req)}
      <input type="hidden" name="idem" value="${v.idem}">
      ${field({ prefix: 'nb', name: 'checkin', label: 'Заезд', type: 'date', value: v.checkin, error: errors.checkin, attrs: 'required' })}
      ${field({ prefix: 'nb', name: 'checkout', label: 'Выезд', type: 'date', value: v.checkout, error: errors.checkout, attrs: 'required' })}
      ${field({ prefix: 'nb', name: 'adults', label: 'Взрослые', type: 'number', value: v.adults ?? 2, error: errors.adults, attrs: 'min="1" max="12"' })}
      ${field({ prefix: 'nb', name: 'children', label: 'Дети', type: 'number', value: v.children ?? 0, error: errors.children, attrs: 'min="0" max="8"' })}
      ${field({ prefix: 'nb', name: 'type', label: 'Категория', type: 'select', value: v.type, options: types.map((t) => [t.id, `${t.name} (до ${t.capacity}${t.extra_beds ? ` + ${t.extra_beds} доп.` : ''})`]) })}
      ${field({ prefix: 'nb', name: 'room', label: 'Номер', type: 'select', value: v.room || '', options: [['', 'Подобрать свободный автоматически'], ...rooms.map((r) => [r.id, `№ ${r.number} — ${r.type_name}`])], hint: 'Номер должен относиться к выбранной категории' })}
      ${field({ prefix: 'nb', name: 'rate', label: 'Тариф', type: 'select', value: v.rate, options: rates.map((r) => [r.id, r.name]) })}
      ${field({ prefix: 'nb', name: 'price_override', label: 'Своя цена за проживание, ₽', type: 'number', value: v.price_override, attrs: 'min="0"', hint: 'Оставьте пустым — посчитаем по тарифу' })}
      ${field({ prefix: 'nb', name: 'guest_name', label: 'ФИО гостя', value: v.guest_name, error: errors.guest_name, attrs: 'required' })}
      ${field({ prefix: 'nb', name: 'guest_phone', label: 'Телефон', type: 'tel', value: v.guest_phone, error: errors.guest_phone, attrs: 'required' })}
      ${field({ prefix: 'nb', name: 'guest_email', label: 'Почта (необязательно)', type: 'email', value: v.guest_email, error: errors.guest_email })}
      ${field({ prefix: 'nb', name: 'source_note', label: 'Откуда бронь', type: 'select', value: v.source_note, options: [['phone', 'Звонок'], ['walkin', 'Пришёл на стойку'], ['email', 'Письмо'], ['messenger', 'Мессенджер'], ['other', 'Другое']] })}
      ${extras.length ? html`<fieldset class="extras-inline"><legend>Допуслуги</legend>${extras.map((e) => html`<label class="check"><input type="checkbox" name="extras" value="${e.id}" ${[].concat(v.extras || []).map(String).includes(String(e.id)) ? raw('checked') : ''}><span>${e.name} — ${rub(e.price)}</span></label>`)}</fieldset>` : ''}
      ${field({ prefix: 'nb', name: 'comment', label: 'Комментарий', type: 'textarea', value: v.comment })}
      <div class="actions"><button class="btn btn--primary" type="submit">Создать бронь</button><a class="btn btn--ghost" href="/app/chess">Отмена</a></div>
    </form>`,
  });
}

export function bookingDetailPage({ req, hotel, b, room, rate, segments, rooms, payments, channels, msg }) {
  const extras = JSON.parse(b.extras || '[]');
  const next = { confirmed: [['checked_in', 'Заселить'], ['no_show', 'Незаезд'], ['cancelled', 'Отменить бронь']], checked_in: [['checked_out', 'Выселить']] }[b.status] || [];
  const debt = b.total - b.paid_amount;
  const live = !['cancelled', 'no_show'].includes(b.status);
  return appLayout({
    title: `Бронь ${b.code}`,
    req,
    hotel,
    msg,
    body: html`<p><a href="/app/bookings">← Журнал броней</a> · <a href="/app/chess?from=${b.checkin}">Показать на шахматке</a></p>
    <div class="app-cols">
      <section class="card">
        <h2 class="h3">${b.guest_name} ${statusBadge(b.status)}</h2>
        <dl class="kv">
          <dt>Телефон</dt><dd><a href="tel:${b.guest_phone}">${b.guest_phone}</a></dd>
          <dt>Почта</dt><dd>${b.guest_email ? html`<a href="mailto:${b.guest_email}">${b.guest_email}</a>` : '—'}</dd>
          <dt>Категория</dt><dd>${room.name}</dd>
          <dt>Номер</dt><dd>${segments.map((sg, i) => html`${i ? ' → ' : ''}${sg.number ? `№ ${sg.number}` : html`<span class="badge badge--warn">не назначен</span>`}`)}</dd>
          <dt>Тариф</dt><dd>${rate.name}</dd>
          <dt>Даты</dt><dd>${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}, ${nightsLabel(diffDays(b.checkin, b.checkout))}</dd>
          <dt>Гости</dt><dd>${b.adults} взр.${b.children ? `, ${b.children} дет.` : ''}</dd>
          <dt>Пожелания</dt><dd>${b.comment || '—'}</dd>
          <dt>Источник</dt><dd>${sourceName(b.source, channels)}${b.channel_ref ? ` (${b.channel_ref})` : ''}</dd>
          <dt>Создана</dt><dd>${b.created_at} UTC</dd>
        </dl>
        ${next.length ? html`<div class="actions">${next.map(([s, label]) => html`<form method="post" action="/app/bookings/${b.id}/status" ${s === 'cancelled' ? raw('data-confirm="Отменить бронь и вернуть номера в продажу?"') : ''}>${csrf(req)}<input type="hidden" name="status" value="${s}"><button class="btn ${s === 'cancelled' ? 'btn--danger' : s === 'no_show' ? 'btn--ghost' : 'btn--primary'}" type="submit">${label}</button></form>`)}</div>` : ''}
        ${live ? html`<h3 class="h3 move-form">Проживание</h3>
          <ul class="segments">${segments.map((sg) => html`<li>
            <span><strong>${fmtDate(sg.start)} — ${fmtDate(sg.end)}</strong> · ${sg.type_name} · ${sg.number ? `№ ${sg.number}` : html`<span class="badge badge--warn">без номера</span>`}</span>
            <form class="form form--inline" method="post" action="/app/bookings/${b.id}/move">${csrf(req)}<input type="hidden" name="segment_id" value="${sg.id}">
              ${field({ prefix: `mv${sg.id}`, name: 'room_id', label: segments.length > 1 ? 'Переселить эту часть в номер' : 'Переселить в номер', type: 'select', value: sg.room_id || '', options: [['', '— без номера —'], ...rooms.map((r) => [r.id, `№ ${r.number} — ${r.type_name}`])] })}
              <button class="btn btn--secondary" type="submit">Переселить</button></form></li>`)}</ul>
          ${diffDays(b.checkin, b.checkout) > 1 ? html`<form class="form form--inline" method="post" action="/app/bookings/${b.id}/split">${csrf(req)}
            ${field({ prefix: 'sp', name: 'date', label: 'Переселить с даты', type: 'date', value: '', attrs: `min="${addDaysV(b.checkin, 1)}" max="${addDaysV(b.checkout, -1)}" required`, hint: 'Ночи до этой даты остаются в текущем номере' })}
            ${field({ prefix: 'sp', name: 'room_id', label: 'в номер', type: 'select', options: rooms.map((r) => [r.id, `№ ${r.number} — ${r.type_name}`]) })}
            <button class="btn btn--secondary" type="submit">Разделить проживание</button></form>` : ''}
          <form class="form form--inline" method="post" action="/app/bookings/${b.id}/dates">${csrf(req)}
            ${field({ prefix: 'dt', name: 'checkin', label: 'Заезд', type: 'date', value: b.checkin, attrs: b.status === 'checked_in' ? 'readonly' : '' })}
            ${field({ prefix: 'dt', name: 'checkout', label: 'Выезд', type: 'date', value: b.checkout })}
            <button class="btn btn--secondary" type="submit">Изменить даты</button>
            <p class="hint span-all">Оплаченные ночи сохраняют свою цену, новые считаются по тарифу «${rate.name}». Можно и на шахматке — потяните за край брони.</p></form>` : ''}
      </section>
      <section class="card">
        <h2 class="h3">Счёт</h2>
        <ul class="quote">
          <li><span>Проживание${b.extra_beds_total ? ` (в т.ч. доп. места ${rub(b.extra_beds_total)})` : ''}</span><span>${rub(b.nights_total)}</span></li>
          ${extras.map((e) => html`<li><span>${e.name} × ${e.qty}</span><span>${rub(e.sum)}</span></li>`)}
          ${b.tax_total ? html`<li><span>Туристический налог</span><span>${rub(b.tax_total)}</span></li>` : ''}
          ${b.discount_total ? html`<li><span>Скидки${b.promo_code ? ` (в т.ч. ${b.promo_code})` : ''}</span><span>−${rub(b.discount_total)} учтено</span></li>` : ''}
        </ul>
        <p class="quote__total"><span>Итого</span><strong>${rub(b.total)}</strong></p>
        <p class="quote__total"><span>Оплачено</span><strong>${rub(b.paid_amount)}</strong></p>
        ${debt > 0 ? html`<p class="quote__total quote__debt"><span>К оплате</span><strong>${rub(debt)}</strong></p>` : html`<p class="badge badge--confirmed">Оплачено полностью</p>`}
        ${payments.length ? html`<h3 class="h3">Платежи</h3><ul class="mini-list">${payments.map((p) => html`<li><span>${p.created_at.slice(0, 16)} · ${PAY_METHODS.find((m) => m[0] === p.method)[1]}${p.note ? ` · ${p.note}` : ''}</span><span>${rub(p.amount)}</span></li>`)}</ul>` : ''}
        ${live && debt > 0 ? html`<form class="form form--inline" method="post" action="/app/bookings/${b.id}/pay">${csrf(req)}
          ${field({ prefix: 'pay', name: 'amount', label: 'Сумма, ₽', type: 'number', value: debt, attrs: `min="1" max="${debt}" required` })}
          ${field({ prefix: 'pay', name: 'method', label: 'Способ', type: 'select', value: 'card', options: PAY_METHODS.filter((m) => m[0] !== 'online') })}
          <button class="btn btn--primary" type="submit">Принять оплату</button></form>` : ''}
      </section>
    </div>`,
  });
}
export function pricesPage({ req, hotel, rooms, dates, cells, from, msg }) {
  const prev = dates.length ? dates[0] : from;
  return appLayout({
    title: 'Цены и наличие',
    req,
    hotel,
    msg,
    body: html`<div class="grid-toolbar">
      <a class="btn btn--ghost btn--sm" href="/app/prices?from=${shift(prev, -14)}">← 2 недели</a>
      <form method="get" action="/app/prices" class="inline-form"><label for="grid-from" class="sr-only">С даты</label><input id="grid-from" type="date" name="from" value="${from}"><button class="btn btn--secondary btn--sm">Показать</button></form>
      <a class="btn btn--ghost btn--sm" href="/app/prices?from=${shift(prev, 14)}">2 недели →</a>
      <p class="muted grid-hint">Цены и остатки для продажи по категориям — то, что видят гости на сайте и каналы. Нажмите на ячейку, чтобы изменить цену, остаток, минимальный срок, закрыть продажи или запретить заезд/выезд. Пометки: «нз» — нет заезда, «нв» — нет выезда, «м3» — минимум 3 ночи.</p>
    </div>
    <div class="grid-wrap" tabindex="0" aria-label="Таблица цен и наличия по категориям">
    <table class="grid" data-grid>
      <thead><tr><th scope="col" class="grid__room">Категория</th>${dates.map((d) => html`<th scope="col" class="${isWeekend(d) ? 'we' : ''}"><span>${weekday(d)}</span>${d.slice(8)}.${d.slice(5, 7)}</th>`)}</tr></thead>
      <tbody>${rooms.map((r) => html`<tr><th scope="row" class="grid__room">${r.name}<small class="muted">${r.total_rooms} ном.</small></th>
        ${dates.map((d) => {
          const c = cells[`${r.id}:${d}`];
          return html`<td class="cell ${c.closed ? 'cell--closed' : c.available === 0 ? 'cell--full' : ''} ${isWeekend(d) ? 'we' : ''}">
            <button type="button" class="cell__btn" data-room="${r.id}" data-room-name="${r.name}" data-date="${d}" data-price="${c.price}" data-available="${c.available}" data-closed="${c.closed}" data-minstay="${c.min_stay}" data-cta="${c.cta}" data-ctd="${c.ctd}" aria-label="${r.name}, ${fmtDate(d)}: ${c.closed ? 'закрыто' : `свободно ${c.available}`}, ${c.price} ₽">
              <span class="cell__avail">${c.closed ? '✕' : c.available}</span><span class="cell__price">${c.price}</span>${c.cta || c.ctd || c.min_stay > 1 ? html`<span class="inv-flags">${[c.cta ? 'нз' : '', c.ctd ? 'нв' : '', c.min_stay > 1 ? `м${c.min_stay}` : ''].filter(Boolean).join(' ')}</span>` : ''}
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
        <label class="check"><input type="checkbox" name="cta"><span>Запрет заезда в этот день</span></label>
        <label class="check"><input type="checkbox" name="ctd"><span>Запрет выезда в этот день</span></label>
        <p class="field-error" data-cell-error hidden></p>
        <div class="actions"><button class="btn btn--primary" value="save" data-cell-save>Сохранить</button><button class="btn btn--ghost" value="cancel" formnovalidate>Отмена</button></div>
      </form>
    </dialog>
    <section class="card">
      <h2 class="h3">Массовое изменение</h2>
      <form class="bulk" method="post" action="/app/prices/bulk">
        ${csrf(req)}
        ${field({ prefix: 'bulk', name: 'room', label: 'Категория', type: 'select', options: [['all', 'Все категории'], ...rooms.map((r) => [r.id, r.name])] })}
        ${field({ prefix: 'bulk', name: 'from', label: 'С', type: 'date', value: from, attrs: 'required' })}
        ${field({ prefix: 'bulk', name: 'to', label: 'По (включительно)', type: 'date', value: shift(from, 6), attrs: 'required' })}
        ${field({ prefix: 'bulk', name: 'days', label: 'Дни', type: 'select', options: [['all', 'Все дни'], ['weekend', 'Только пт и сб'], ['weekday', 'Только вс–чт']] })}
        ${field({ prefix: 'bulk', name: 'action', label: 'Действие', type: 'select', options: [['price', 'Установить цену'], ['percent', 'Изменить цену на %'], ['minstay', 'Минимум ночей'], ['close', 'Закрыть продажи'], ['open', 'Открыть продажи'], ['cta_on', 'Запретить заезд'], ['cta_off', 'Разрешить заезд'], ['ctd_on', 'Запретить выезд'], ['ctd_off', 'Разрешить выезд']] })}
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


export function channelsPage({ req, hotel, channels, log, msg }) {
  return appLayout({
    title: 'Каналы продаж',
    req,
    hotel,
    msg,
    body: html`<p class="muted">Площадки в демо вымышленные: подключение показывает, как цены и наличие уходят в каналы. Реальные подключения требуют договоров с площадками.</p>
    <section class="card"><div class="table-wrap" tabindex="0" role="region" aria-label="Каналы продаж"><table class="table">
      <thead><tr><th scope="col">Канал</th><th scope="col">Комиссия</th><th scope="col">Наценка</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${channels.map((c) => html`<tr><td>${c.name}</td><td>${c.commission_pct}%</td>
        <td><form class="inline-form" method="post" action="/app/channels/${c.id}/markup">${csrf(req)}<label class="sr-only" for="mk-${c.id}">Наценка для ${c.name}</label><input id="mk-${c.id}" class="input-sm" type="number" name="markup_pct" min="0" max="50" value="${c.markup_pct}"> % <button class="linklike" type="submit">ок</button></form></td>
        <td>${c.connected ? html`<span class="badge badge--confirmed">подключён</span>` : html`<span class="badge badge--off">не подключён</span>`}</td>
        <td class="actions"><form method="post" action="/app/channels/${c.id}/toggle">${csrf(req)}<button class="btn btn--sm ${c.connected ? 'btn--ghost' : 'btn--primary'}" type="submit">${c.connected ? 'Отключить' : 'Подключить'}</button></form>
          ${c.connected ? html`<form method="post" action="/app/channels/${c.id}/test-booking">${csrf(req)}<button class="btn btn--sm btn--secondary" type="submit">Тестовая бронь</button></form>` : ''}</td></tr>`)}</tbody>
    </table></div></section>
    <section class="card"><h2 class="h3">Журнал обмена с каналами</h2><p class="muted">Что и когда мы отправили в каналы: выгрузки цен и наличия, обновления после броней и отмен. Сами брони — в <a href="/app/bookings">журнале броней</a>.</p>
      ${log.length ? html`<ul class="log">${log.map((l) => html`<li><time>${l.at}</time><strong>${l.channel}</strong><span class="badge badge--${l.kind}">${{ full: 'полная выгрузка', update: 'обновление', booking: 'бронь', disconnect: 'отключение' }[l.kind]}</span><span>${l.summary}</span></li>`)}</ul>`
        : html`<p class="muted">Отправок ещё не было.</p>`}
    </section>`,
  });
}

