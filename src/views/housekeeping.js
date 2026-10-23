import { html, raw } from './html.js';
import { appLayout } from './layout.js';
import { csrf } from './app.js';

const STATUS = { clean: 'чистый', dirty: 'нужна уборка', repair: 'ремонт' };
const TODAY = {
  departure: ['Выезд сегодня', 'после выезда — уборка'],
  turnover: ['Выезд и заезд', 'убрать до заезда'],
  arrival: ['Заезд сегодня', 'подготовить номер'],
  stay: ['Гости проживают', 'текущая уборка по запросу'],
  free: ['Свободен', ''],
  hourly: ['Почасовые гости сегодня', 'уборка после каждого гостя'],
};

// Housekeeping board: rooms and what happens in them today — no guest names, phones or money.
export function housekeepingPage({ req, hotel, floors, counts, filter, msg }) {
  const staff = ['owner', 'manager'].includes(req.user.role);
  return appLayout({
    title: 'Уборка',
    req,
    hotel,
    msg,
    body: html`<div class="tiles-stat">
      <div class="stat-tile"><span>Нужна уборка</span><strong>${counts.dirty}</strong></div>
      <div class="stat-tile"><span>Выезды сегодня</span><strong>${counts.departures}</strong></div>
      <div class="stat-tile"><span>Заезды сегодня</span><strong>${counts.arrivals}</strong></div>
      <div class="stat-tile"><span>На ремонте</span><strong>${counts.repair}</strong></div>
    </div>
    <nav class="subnav" aria-label="Фильтр номеров">
      ${[['all', 'Все номера'], ['dirty', 'Нужна уборка'], ['today', 'Выезды и заезды сегодня']].map(([k, l]) => html`<a href="/app/housekeeping?show=${k}" ${filter === k ? raw('aria-current="page"') : ''}>${l}</a>`)}
    </nav>
    ${floors.length ? floors.map(([floor, rooms]) => html`<section class="card"><h2 class="h3">${floor} этаж</h2>
      <ul class="hk-list">${rooms.map((r) => html`<li class="hk hk--${r.status}">
        <div class="hk__room"><strong>${r.number}</strong><small>${r.type_name}</small></div>
        <div class="hk__state"><span class="badge badge--${r.status === 'clean' ? 'confirmed' : r.status === 'dirty' ? 'warn' : 'cancelled'}">${STATUS[r.status]}</span>
          <span>${TODAY[r.today][0]}</span>${TODAY[r.today][1] ? html`<small class="muted">${TODAY[r.today][1]}</small>` : ''}${r.slots ? html`<small class="muted">${r.slots}</small>` : ''}${r.note ? html`<small class="muted">${r.note}</small>` : ''}</div>
        <div class="actions">
          ${r.status !== 'clean' && r.status !== 'repair' ? html`<form method="post" action="/app/housekeeping/${r.id}">${csrf(req)}<input type="hidden" name="status" value="clean"><input type="hidden" name="show" value="${filter}"><button class="btn btn--primary btn--sm" type="submit">Убрано</button></form>` : ''}
          ${r.status === 'clean' ? html`<form method="post" action="/app/housekeeping/${r.id}">${csrf(req)}<input type="hidden" name="status" value="dirty"><input type="hidden" name="show" value="${filter}"><button class="btn btn--ghost btn--sm" type="submit">Нужна уборка</button></form>` : ''}
          ${staff ? html`<form method="post" action="/app/housekeeping/${r.id}">${csrf(req)}<input type="hidden" name="status" value="${r.status === 'repair' ? 'dirty' : 'repair'}"><input type="hidden" name="show" value="${filter}"><button class="linklike" type="submit">${r.status === 'repair' ? 'Снять с ремонта' : 'На ремонт'}</button></form>` : ''}
        </div></li>`)}</ul></section>`)
      : html`<div class="card empty"><p>${filter === 'dirty' ? 'Все номера чистые.' : 'Номеров по этому фильтру нет.'}</p></div>`}`,
  });
}
