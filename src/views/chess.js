import { html, raw, field } from './html.js';
import { appLayout } from './layout.js';
import { addDays, diffDays, fmtDate, fmtShort, isWeekend, weekday, nightsLabel } from '../lib/dates.js';

const STATUS = { confirmed: 'подтверждена', checked_in: 'проживает', checked_out: 'выехал' };
const ROOM_STATUS = { clean: 'чистый', dirty: 'нужна уборка', repair: 'ремонт' };
export const SORTS = [['category', 'По категориям'], ['number', 'По номеру'], ['floor', 'По этажам']];

// Tape chart: rows are physical rooms, columns are days split in halves so a stay
// starts in the afternoon of check-in and ends in the morning of check-out.
export function chessPage({ req, hotel, from, days, sort, typeFilter, types, rooms, bookings, free, today, msg, channels = [] }) {
  const chName = new Map(channels.map((c) => [c.code, c.name]));
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const cols = `var(--chess-label) repeat(${days * 2}, var(--chess-half))`;
  const byRoom = new Map();
  const unassigned = new Map();
  for (const b of bookings) {
    if (b.room_id) (byRoom.get(b.room_id) || byRoom.set(b.room_id, []).get(b.room_id)).push(b);
    else (unassigned.get(b.room_type_id) || unassigned.set(b.room_type_id, []).get(b.room_type_id)).push(b);
  }
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const visibleTypes = types.filter((t) => !typeFilter || t.id === typeFilter);
  const q = (o) => new URLSearchParams({ from, days, sort, ...(typeFilter ? { type: typeFilter } : {}), ...o }).toString();

  const head = html`<div class="chess__row chess__row--head" style="grid-template-columns:${cols}">
    <div class="chess__label">Номер</div>
    ${dates.map((d, i) => html`<div class="chess__day ${isWeekend(d) ? 'we' : ''} ${d === today ? 'is-today' : ''}" style="grid-column:${2 + i * 2} / span 2"><span>${weekday(d)}</span>${fmtShort(d)}</div>`)}
  </div>`;

  const bar = (b) => {
    const s = diffDays(from, b.checkin);
    const e = diffDays(from, b.checkout);
    if (e <= 0 || s >= days) return '';
    const start = s < 0 ? 2 : 3 + s * 2;
    const end = e >= days ? 2 + days * 2 : 3 + e * 2;
    const unpaid = b.paid_amount < b.total;
    const nights = diffDays(b.checkin, b.checkout);
    const label = `${b.guest_name}, ${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}, ${nightsLabel(nights)}, ${STATUS[b.status] || b.status}${unpaid ? ', есть долг' : ''}`;
    return html`<a class="chess__bar chess__bar--${b.status} ${s < 0 ? 'cut-l' : ''} ${e > days ? 'cut-r' : ''}" style="grid-column:${start} / ${end}"
      href="/app/bookings/${b.id}" draggable="true" data-booking="${b.id}" title="${label}" aria-label="${label}">
      ${unpaid ? html`<span class="chess__debt" aria-hidden="true">₽</span>` : ''}<span class="chess__guest">${b.guest_name}</span><small>${b.adults + b.children} г. · ${sourceShort(b.source, chName)}</small></a>`;
  };

  const cells = (roomId, typeId) => dates.map((d, i) => html`<a class="chess__cell ${isWeekend(d) ? 'we' : ''} ${d === today ? 'is-today' : ''}" style="grid-column:${2 + i * 2} / span 2"
      href="/app/bookings/new?${new URLSearchParams({ type: typeId, ...(roomId ? { room: roomId } : {}), checkin: d, checkout: addDays(d, 1) })}" tabindex="-1" aria-hidden="true"></a>`);

  const roomRow = (r, showType) => html`<div class="chess__row" style="grid-template-columns:${cols}" data-room="${r.id}" data-room-number="${r.number}">
    <div class="chess__label"><span class="dot dot--${r.status}" title="${ROOM_STATUS[r.status]}"></span><strong>${r.number}</strong>
      <small>${showType ? typeName.get(r.room_type_id) : `${r.floor} этаж`}${r.status !== 'clean' ? ` · ${ROOM_STATUS[r.status]}` : ''}</small></div>
    ${cells(r.id, r.room_type_id)}
    ${(byRoom.get(r.id) || []).map(bar)}
  </div>`;

  const freeRow = (t) => html`<div class="chess__row chess__row--type" style="grid-template-columns:${cols}">
    <div class="chess__label"><strong>${t.name}</strong><small>${t.total_rooms} ном.</small></div>
    ${dates.map((d, i) => {
      const f = free[`${t.id}:${d}`];
      return html`<div class="chess__free ${f && f.closed ? 'is-closed' : ''} ${f && !f.closed && f.available === 0 ? 'is-full' : ''}" style="grid-column:${2 + i * 2} / span 2" title="Свободно для продажи">${f ? (f.closed ? 'стоп' : f.available) : ''}</div>`;
    })}
  </div>`;

  const unassignedRow = (t) => {
    const list = unassigned.get(t.id);
    if (!list || !list.length) return '';
    return html`<div class="chess__row chess__row--unassigned" style="grid-template-columns:${cols}" data-room="0">
      <div class="chess__label"><strong>Без номера</strong><small>перетащите на свободный номер</small></div>
      ${(list).map(bar)}
    </div>`;
  };

  let body;
  if (!rooms.length) {
    body = html`<div class="card empty"><h2 class="h3">Номеров пока нет</h2><p>Добавьте категории и номера (101, 102…) в разделе «Номера и тарифы» — после этого здесь появится шахматка.</p><a class="btn btn--primary" href="/app/rooms#stock">Добавить номера</a></div>`;
  } else if (sort === 'category') {
    body = visibleTypes.map((t) => html`${freeRow(t)}${unassignedRow(t)}${rooms.filter((r) => r.room_type_id === t.id).map((r) => roomRow(r, false))}`);
  } else {
    body = html`${visibleTypes.map(unassignedRow)}${rooms.filter((r) => !typeFilter || r.room_type_id === typeFilter).map((r) => roomRow(r, true))}`;
  }

  return appLayout({
    title: 'Шахматка',
    req,
    hotel,
    msg,
    wide: true,
    body: html`<form class="chess-toolbar card" method="get" action="/app/chess">
      <div class="chess-toolbar__nav">
        <a class="btn btn--ghost btn--sm" href="/app/chess?${q({ from: addDays(from, -days) })}" aria-label="Предыдущий период">←</a>
        <a class="btn btn--ghost btn--sm" href="/app/chess?${q({ from: addDays(today, -1) })}">Сегодня</a>
        <a class="btn btn--ghost btn--sm" href="/app/chess?${q({ from: addDays(from, days) })}" aria-label="Следующий период">→</a>
      </div>
      ${field({ prefix: 'chess', name: 'from', label: 'С даты', type: 'date', value: from })}
      ${field({ prefix: 'chess', name: 'days', label: 'Период', type: 'select', value: days, options: [[7, '7 дней'], [14, '14 дней'], [30, '30 дней']], attrs: 'data-autosubmit' })}
      ${field({ prefix: 'chess', name: 'sort', label: 'Порядок номеров', type: 'select', value: sort, options: SORTS, attrs: 'data-autosubmit' })}
      ${field({ prefix: 'chess', name: 'type', label: 'Категория', type: 'select', value: typeFilter || '', options: [['', 'Все'], ...types.map((t) => [t.id, t.name])], attrs: 'data-autosubmit' })}
      <noscript><button class="btn btn--secondary btn--sm" type="submit">Показать</button></noscript>
      <a class="btn btn--primary" href="/app/bookings/new">+ Новая бронь</a>
    </form>
    <ul class="chess-legend" aria-label="Обозначения">
      <li><span class="chess__bar chess__bar--confirmed legend-swatch"></span>подтверждена</li>
      <li><span class="chess__bar chess__bar--checked_in legend-swatch"></span>проживает</li>
      <li><span class="chess__bar chess__bar--checked_out legend-swatch"></span>выехал</li>
      <li><span class="chess__debt">₽</span>не оплачена полностью</li>
      <li><span class="dot dot--dirty"></span>нужна уборка</li><li><span class="dot dot--repair"></span>ремонт</li>
      <li class="muted">Клик по пустой клетке — новая бронь. Перетащите бронь на другой номер, чтобы переселить.</li>
    </ul>
    <div class="chess-wrap" tabindex="0" role="region" aria-label="Шахматка номеров">
      <div class="chess" data-chess>${head}${body}</div>
    </div>`,
  });
}

function sourceShort(s, names) {
  return { site: 'сайт', extranet: 'вручную' }[s] || names.get(s) || s;
}
