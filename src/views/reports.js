import { html, raw, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { sourceName } from './app.js';
import { statusBadge } from './engine.js';
import { fmtDate, fmtShort, weekday, isWeekend } from '../lib/dates.js';
import { csrf } from './app.js';
import { countryName, docName, maskDoc, MVD_STATUS } from '../lib/guests.js';

const TABS = [['occupancy', 'Загрузка и доход'], ['sales', 'Продажи и источники'], ['lists', 'Заезды и выезды'], ['tax', 'Туристический налог'], ['mvd', 'Учёт гостей (МВД)']];

export function reportsPage({ req, hotel, tab, from, to, data, channels, msg }) {
  const q = (t) => `/app/reports?${new URLSearchParams({ tab: t, from, to })}`;
  const period = html`<form class="filters card" method="get" action="/app/reports">
    <input type="hidden" name="tab" value="${tab}">
    ${tab === 'lists'
      ? field({ prefix: 'rp', name: 'from', label: 'Дата', type: 'date', value: from })
      : html`${field({ prefix: 'rp', name: 'from', label: 'С', type: 'date', value: from })}${field({ prefix: 'rp', name: 'to', label: 'По (включительно)', type: 'date', value: to })}`}
    ${tab === 'mvd' ? field({ prefix: 'rp', name: 'status', label: 'Статус', type: 'select', value: data.status, options: [['', 'Все'], ['new', 'Не отправлено'], ['sent', 'Отправлено'], ['not_required', 'Не требуется']] }) : ''}
    ${tab === 'mvd' ? field({ prefix: 'rp', name: 'who', label: 'Гражданство', type: 'select', value: data.who, options: [['', 'Все'], ['rus', 'Граждане РФ'], ['foreign', 'Иностранцы']] }) : ''}
    <button class="btn btn--primary" type="submit">Построить</button>
    <a class="btn btn--ghost" href="${q(tab)}${tab === 'mvd' ? `&status=${data.status}&who=${data.who}` : ''}&format=csv">Скачать CSV</a>
  </form>`;
  let body;
  if (tab === 'sales') body = sales(data, channels);
  else if (tab === 'lists') body = lists(data, from);
  else if (tab === 'tax') body = tax(data);
  else if (tab === 'mvd') body = mvd(req, data, from, to);
  else body = occupancy(data);
  return appLayout({
    title: 'Отчёты',
    req,
    hotel,
    msg,
    body: html`<nav class="subnav" aria-label="Отчёты">${TABS.map(([k, l]) => html`<a href="${q(k)}" ${k === tab ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>
      ${period}${body}`,
  });
}

function occupancy(d) {
  const t = d.totals;
  return html`<div class="tiles-stat">
      <div class="stat-tile"><span>Загрузка</span><strong>${t.occupancy}%</strong><small>${t.sold} из ${t.available} номеро-ночей</small></div>
      <div class="stat-tile"><span>Доход от проживания</span><strong>${rub(t.revenue)}</strong></div>
      <div class="stat-tile"><span>ADR — средняя цена ночи</span><strong>${rub(t.adr)}</strong></div>
      <div class="stat-tile"><span>RevPAR — доход на номер</span><strong>${rub(t.revpar)}</strong></div>
    </div>
    <p class="muted">Учитываются брони «подтверждена», «проживает», «выехал» — в том числе будущие. Номера на ремонте не входят в доступный фонд. Доход распределяется по ночам периода.</p>
    <section class="card"><h2 class="h3">По категориям</h2><div class="table-wrap" tabindex="0" role="region" aria-label="По категориям"><table class="table">
      <thead><tr><th scope="col">Категория</th><th scope="col">Продано ночей</th><th scope="col">Загрузка</th><th scope="col">ADR</th><th scope="col">Доход</th></tr></thead>
      <tbody>${d.byType.map((r) => html`<tr><td>${r.name}</td><td>${r.sold} / ${r.available}</td><td><span class="bar" style="--w:${r.occupancy}%" aria-hidden="true"></span> ${r.occupancy}%</td><td>${rub(r.adr)}</td><td>${rub(r.revenue)}</td></tr>`)}</tbody></table></div></section>
    <section class="card"><h2 class="h3">По дням</h2><div class="table-wrap" tabindex="0" role="region" aria-label="По дням"><table class="table table--compact">
      <thead><tr><th scope="col">Дата</th><th scope="col">Занято</th><th scope="col">Загрузка</th><th scope="col">Заезды</th><th scope="col">Выезды</th><th scope="col">Доход</th></tr></thead>
      <tbody>${d.byDay.map((r) => html`<tr class="${isWeekend(r.date) ? 'we' : ''}"><td>${weekday(r.date)} ${fmtShort(r.date)}</td><td>${r.sold} / ${r.available}</td><td><span class="bar" style="--w:${r.occupancy}%" aria-hidden="true"></span> ${r.occupancy}%</td><td>${r.arrivals}</td><td>${r.departures}</td><td>${rub(r.revenue)}</td></tr>`)}</tbody></table></div></section>`;
}

function sales(d, channels) {
  const t = d.totals;
  return html`<div class="tiles-stat">
      <div class="stat-tile"><span>Создано броней</span><strong>${t.count}</strong><small>на ${rub(t.sum)}</small></div>
      <div class="stat-tile"><span>Отменено</span><strong>${t.cancelled}</strong><small>${t.cancelRate}% от созданных</small></div>
      <div class="stat-tile"><span>Средний чек</span><strong>${rub(t.avg)}</strong></div>
      <div class="stat-tile"><span>Получено оплат</span><strong>${rub(t.paid)}</strong></div>
    </div>
    <p class="muted">По дате создания брони — сколько вы продали за период, независимо от дат проживания.</p>
    <section class="card"><h2 class="h3">По источникам</h2><div class="table-wrap" tabindex="0" role="region" aria-label="По источникам"><table class="table">
      <thead><tr><th scope="col">Источник</th><th scope="col">Броней</th><th scope="col">Отмен</th><th scope="col">Сумма (без отмен)</th><th scope="col">Доля</th></tr></thead>
      <tbody>${d.bySource.map((r) => html`<tr><td>${sourceName(r.source, channels)}</td><td>${r.n}</td><td>${r.cancelled}</td><td>${rub(r.sum)}</td><td><span class="bar" style="--w:${r.pct}%" aria-hidden="true"></span> ${r.pct}%</td></tr>`)}</tbody></table></div>
      ${d.bySource.length ? '' : html`<p class="muted">За период броней не создавалось.</p>`}</section>`;
}

function listTable(rows, empty) {
  if (!rows.length) return html`<p class="muted">${empty}</p>`;
  return html`<div class="table-wrap" tabindex="0" role="region" aria-label="Список гостей"><table class="table table--compact"><thead><tr><th scope="col">Номер</th><th scope="col">Гость</th><th scope="col">Телефон</th><th scope="col">Гостей</th><th scope="col">Даты</th><th scope="col">Долг</th><th scope="col">Статус</th></tr></thead>
    <tbody>${rows.map((b) => html`<tr><td>${b.room_number || '—'}</td><td><a href="/app/bookings/${b.id}">${b.guest_name}</a></td><td>${b.guest_phone}</td><td>${b.adults + b.children}</td><td>${fmtShort(b.checkin)}–${fmtShort(b.checkout)}</td><td>${b.total > b.paid_amount ? rub(b.total - b.paid_amount) : '—'}</td><td>${statusBadge(b.status)}</td></tr>`)}</tbody></table></div>`;
}

function lists(d, date) {
  return html`<div class="app-cols">
    <section class="card"><h2 class="h3">Заезды ${fmtDate(date)}</h2>${listTable(d.arrivals, 'Заездов нет')}</section>
    <section class="card"><h2 class="h3">Выезды ${fmtDate(date)}</h2>${listTable(d.departures, 'Выездов нет')}</section></div>
    <section class="card"><h2 class="h3">Проживают в ночь на ${fmtDate(date)}</h2>${listTable(d.inhouse, 'Никто не проживает')}</section>`;
}

function tax(d) {
  return html`<div class="tiles-stat">
      <div class="stat-tile"><span>Начислено налога</span><strong>${rub(d.totals.tax)}</strong></div>
      <div class="stat-tile"><span>База (проживание)</span><strong>${rub(d.totals.base)}</strong></div>
      <div class="stat-tile"><span>Броней</span><strong>${d.rows.length}</strong></div>
    </div>
    <p class="muted">Брони с выездом в выбранном периоде, кроме отменённых и незаездов. Для декларации сверяйте с бухгалтерией: льготы гостей учитываются вручную.</p>
    <section class="card"><div class="table-wrap" tabindex="0" role="region" aria-label="Туристический налог"><table class="table table--compact">
      <thead><tr><th scope="col">Бронь</th><th scope="col">Гость</th><th scope="col">Выезд</th><th scope="col">Проживание</th><th scope="col">Налог</th></tr></thead>
      <tbody>${d.rows.map((b) => html`<tr><td><a href="/app/bookings/${b.id}">${b.code}</a></td><td>${b.guest_name}</td><td>${fmtDate(b.checkout)}</td><td>${rub(b.nights_total)}</td><td>${rub(b.tax_total)}</td></tr>`)}</tbody></table></div>
      ${d.rows.length ? '' : html`<p class="muted">За период выездов не было.</p>`}</section>`;
}

function mvd(req, d, from, to) {
  const t = d.totals;
  return html`<div class="tiles-stat">
      <div class="stat-tile"><span>Гостей в списке</span><strong>${d.rows.length}</strong><small>заезды ${fmtDate(from)} — ${fmtDate(to)}</small></div>
      <div class="stat-tile"><span>Не отправлено</span><strong>${t.pending}</strong><small>из них просрочено ${t.late}</small></div>
      <div class="stat-tile"><span>Иностранцев</span><strong>${t.foreign}</strong></div>
      <div class="stat-tile"><span>Без документов</span><strong>${t.missing}</strong><small>гостей в бронях без анкеты</small></div>
    </div>
    <p class="muted">Срок по умолчанию: граждане РФ — на следующий день после заезда, иностранцы — на следующий рабочий день (праздники не учитываются). Проверьте действующие правила своего региона. Отправка в МВД — через ваш личный кабинет на портале госуслуг или МВД; здесь отмечается, что сведения переданы. CSV содержит полные паспортные данные — храните его как персональные данные.</p>
    ${d.missingBookings.length ? html`<section class="card"><h2 class="h3">Брони без полного списка гостей</h2><ul class="mini-list">${d.missingBookings.map((b) => html`<li><a href="/app/bookings/${b.id}#guests">${b.code} — ${b.guest_name}</a><span class="muted">внесено ${b.have} из ${b.adults + b.children}, заезд ${fmtDate(b.checkin)}</span></li>`)}</ul></section>` : ''}
    <section class="card"><form method="post" action="/app/reports/mvd/mark">${csrf(req)}
      <input type="hidden" name="back" value="/app/reports?tab=mvd&from=${from}&to=${to}">
      <div class="table-wrap" tabindex="0" role="region" aria-label="Список гостей для МВД"><table class="table table--compact">
      <thead><tr><th scope="col"><span class="sr-only">Выбрать</span></th><th scope="col">Гость</th><th scope="col">Дата рождения</th><th scope="col">Гражданство</th><th scope="col">Документ</th><th scope="col">Номер</th><th scope="col">Заезд — выезд</th><th scope="col">Срок</th><th scope="col">Статус</th></tr></thead>
      <tbody>${d.rows.map((g) => html`<tr>
        <td>${g.mvd_status === 'new' ? html`<label class="sr-only" for="mvd-${g.id}">Выбрать ${g.last_name}</label><input id="mvd-${g.id}" type="checkbox" name="ids" value="${g.id}">` : ''}</td>
        <td><a href="/app/bookings/${g.booking_id}#guests">${g.last_name} ${g.first_name} ${g.middle_name}</a></td><td>${fmtDate(g.birth_date)}</td>
        <td>${countryName(g.citizenship)}</td><td>${docName(g.doc_type)}<small>${maskDoc(g)}</small></td><td>${g.room_number || '—'}</td>
        <td>${fmtShort(g.checkin)}–${fmtShort(g.checkout)}</td><td class="${g.mvd_status === 'new' && g.deadline < d.today ? 'late' : ''}">${fmtDate(g.deadline)}</td>
        <td>${MVD_STATUS[g.mvd_status]}${g.mvd_sent_at ? html`<small>${g.mvd_sent_at.slice(0, 16)}</small>` : ''}</td></tr>`)}</tbody></table></div>
      ${d.rows.length ? '' : html`<p class="muted">Гостей с документами и заездом в этот период нет.</p>`}
      ${d.rows.some((g) => g.mvd_status === 'new') ? html`<div class="mvd-bulk"><button class="btn btn--primary" type="submit" name="status" value="sent">Отметить выбранных: отправлено</button><button class="btn btn--ghost" type="submit" name="status" value="not_required">Не требуется</button></div>` : ''}
    </form></section>`;
}
