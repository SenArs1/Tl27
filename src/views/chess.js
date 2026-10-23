import { html, raw, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { addDays, diffDays, fmtDate, fmtShort, isWeekend, weekday, nightsLabel } from '../lib/dates.js';

const STATUS = { confirmed: 'подтверждена', checked_in: 'проживает', checked_out: 'выехал' };
const ROOM_STATUS = { clean: 'чистый', dirty: 'нужна уборка', repair: 'ремонт' };
export const SORTS = [['category', 'По категориям'], ['number', 'По номеру'], ['floor', 'По этажам']];

// site / manual / channel — the bar colour and the source filter use this.
export const sourceKind = (s) => (s === 'site' ? 'site' : s === 'extranet' ? 'manual' : 'channel');
const payKind = (b) => (b.paid_amount >= b.total ? 'paid' : b.paid_amount > 0 ? 'part' : 'none');

// Arrival day passed without check-in, or check-out time passed while still in house.
export function isOverdue(b, today, nowTime, hotel) {
  if (b.status === 'confirmed') return b.checkin < today;
  if (b.status === 'checked_in') return b.checkout < today || (b.checkout === today && nowTime > (hotel.checkout_time || '12:00'));
  return false;
}

// Tape chart: rows are physical rooms, columns are days split in halves so a stay
// starts in the afternoon of check-in and ends in the morning of check-out.
export function chessPage({ req, hotel, from, days, sort, typeFilter, types, rooms, bookings, free, today, nowTime, stats, msg, channels = [], tags = [] }) {
  const chName = new Map(channels.map((c) => [c.code, c.name]));
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const cols = `var(--chess-label) repeat(${days * 2}, var(--chess-half))`;
  const byRoom = new Map();
  const unassigned = new Map();
  // Each entry is one part of a stay (a segment): start/end and seg_room describe the part.
  for (const b of bookings) {
    if (b.seg_room) (byRoom.get(b.seg_room) || byRoom.set(b.seg_room, []).get(b.seg_room)).push(b);
    else (unassigned.get(b.seg_type) || unassigned.set(b.seg_type, []).get(b.seg_type)).push(b);
  }
  const unassignedCount = [...unassigned.values()].reduce((s, l) => s + l.length, 0);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const visibleTypes = types.filter((t) => !typeFilter || t.id === typeFilter);
  const q = (o) => new URLSearchParams({ from, days, sort, ...(typeFilter ? { type: typeFilter } : {}), ...o }).toString();
  const here = `/app/chess?${q({})}`;

  const head = html`<div class="chess__row chess__row--head" style="grid-template-columns:${cols}">
    <div class="chess__label">Номер</div>
    ${dates.map((d, i) => html`<div class="chess__day ${isWeekend(d) ? 'we' : ''} ${d === today ? 'is-today' : ''}" style="grid-column:${2 + i * 2} / span 2"><span>${weekday(d)}</span>${fmtShort(d)}</div>`)}
  </div>`;

  const bar = (b) => {
    const s = diffDays(from, b.start);
    const e = diffDays(from, b.end);
    if (e <= 0 || s >= days) return '';
    const start = s < 0 ? 2 : 3 + s * 2;
    const end = e >= days ? 2 + days * 2 : 3 + e * 2;
    const debt = b.total - b.paid_amount;
    const nights = diffDays(b.checkin, b.checkout);
    const overdue = isOverdue(b, today, nowTime, hotel);
    const src = sourceKind(b.source);
    const part = b.is_first && b.is_last ? '' : `, часть ${fmtDate(b.start)} — ${fmtDate(b.end)}`;
    const btags = b.tags || [];
    const label = `${b.guest_name}, ${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}, ${nightsLabel(nights)}${part}, ${STATUS[b.status] || b.status}, ${sourceShort(b.source, chName)}${debt > 0 ? `, к оплате ${rub(debt)}` : ''}${overdue ? (b.status === 'confirmed' ? ', заезд не оформлен' : ', выезд не оформлен') : ''}${btags.length ? `, теги: ${btags.map((x) => x.name).join(', ')}` : ''}${b.group_code ? `, группа ${b.group_code}` : ''}`;
    // Edges can be dragged to change dates: check-in only before arrival, check-out until departure.
    const left = b.is_first && b.status === 'confirmed' && s >= 0;
    const right = b.is_last && ['confirmed', 'checked_in'].includes(b.status) && e <= days;
    const movable = ['confirmed', 'checked_in'].includes(b.status);
    return html`<a class="chess__bar chess__bar--${b.status} src-${src} ${overdue ? 'is-overdue' : ''} ${s < 0 ? 'cut-l' : ''} ${e > days ? 'cut-r' : ''} ${b.is_first ? '' : 'cont-l'} ${b.is_last ? '' : 'cont-r'}" style="grid-column:${start} / ${end}"
      href="/app/bookings/${b.id}" draggable="${movable ? 'true' : 'false'}" data-booking="${b.id}" data-segment="${b.segment_id}" data-checkin="${b.checkin}" data-checkout="${b.checkout}"
      data-status="${b.status}" data-src="${src}" data-pay="${payKind(b)}" data-tag="${btags.map((x) => x.id).join(' ')}" data-whole="${b.is_first && b.is_last ? '1' : '0'}" data-find="${`${b.guest_name} ${b.code} ${b.guest_phone} ${b.channel_ref || ''} ${b.group_code || ''}`.toLowerCase()}"
      title="${label}" aria-label="${label}">
      ${btags.length ? html`<span class="chess__tagmark tag--${btags[0].color}" aria-hidden="true"></span>` : ''}
      ${left ? html`<span class="chess__handle chess__handle--l" data-edge="checkin" draggable="false" title="Потяните, чтобы изменить дату заезда"></span>` : ''}
      ${debt > 0 ? html`<span class="chess__debt" aria-hidden="true">₽</span>` : ''}<span class="chess__guest">${b.is_first ? '' : '→ '}${b.guest_name}</span><small>${b.group_code ? `${b.group_code} · ` : ''}${b.adults + b.children} г. · ${sourceShort(b.source, chName)}</small>
      ${right ? html`<span class="chess__handle chess__handle--r" data-edge="checkout" draggable="false" title="Потяните, чтобы изменить дату выезда"></span>` : ''}</a>`;
  };

  const cells = (roomId, typeId) => dates.map((d, i) => html`<a class="chess__cell ${isWeekend(d) ? 'we' : ''} ${d === today ? 'is-today' : ''}" style="grid-column:${2 + i * 2} / span 2" data-date="${d}" data-idx="${i}"
      href="/app/bookings/new?${new URLSearchParams({ type: typeId, ...(roomId ? { room: roomId } : {}), checkin: d, checkout: addDays(d, 1) })}" tabindex="-1" aria-hidden="true"></a>`);

  const roomRow = (r, showType) => html`<div class="chess__row ${r.status === 'repair' ? 'is-repair' : ''}" style="grid-template-columns:${cols}" data-room="${r.id}" data-room-number="${r.number}" data-type="${r.room_type_id}">
    <div class="chess__label"><span class="dot dot--${r.status}" title="${ROOM_STATUS[r.status]}"></span><strong>${r.number}</strong>
      <small>${showType ? typeName.get(r.room_type_id) : `${r.floor} этаж`}${r.status !== 'clean' ? ` · ${ROOM_STATUS[r.status]}` : ''}</small></div>
    ${cells(r.id, r.room_type_id)}
    ${(byRoom.get(r.id) || []).map(bar)}
  </div>`;

  // Category row: free rooms to sell per day; the name collapses the category's rooms.
  const freeRow = (t) => html`<div class="chess__row chess__row--type" style="grid-template-columns:${cols}">
    <div class="chess__label"><button type="button" class="chess__toggle" aria-expanded="true" data-collapse="${t.id}"><span class="chess__chev" aria-hidden="true">▾</span><strong>${t.name}</strong></button><small>${t.total_rooms} ном.</small></div>
    ${dates.map((d, i) => {
      const f = free[`${t.id}:${d}`];
      return html`<div class="chess__free ${f && f.closed ? 'is-closed' : ''} ${f && !f.closed && f.available === 0 ? 'is-full' : ''}" style="grid-column:${2 + i * 2} / span 2" title="Свободно для продажи">${f ? (f.closed ? 'стоп' : f.available) : ''}</div>`;
    })}
  </div>`;

  const unassignedRow = (t) => {
    const list = unassigned.get(t.id);
    if (!list || !list.length) return '';
    return html`<div class="chess__row chess__row--unassigned" style="grid-template-columns:${cols}" data-room="0" data-type="${t.id}">
      <div class="chess__label"><strong>Без номера</strong><small>${sort === 'category' ? 'перетащите на номер' : t.name}</small></div>
      ${list.map(bar)}
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

  const chip = (group, value, label) => html`<label class="chip"><input type="checkbox" data-filter="${group}" value="${value}"><span>${label}</span></label>`;
  const st = stats;
  return appLayout({
    title: 'Шахматка',
    req,
    hotel,
    msg,
    wide: true,
    body: html`<details class="chess-stats card" open data-remember="chess-stats">
      <summary>Сегодня, ${fmtDate(today)}</summary>
      <div class="chess-stats__row">
        <div><span>Загрузка</span><strong>${st.pct}%</strong><small>${st.occupied} из ${st.rooms}</small></div>
        <div><span>Заезды</span><strong>${st.arrivals}</strong><small>${st.arrivalsLeft ? `ждём ${st.arrivalsLeft}` : 'все заселены'}</small></div>
        <div><span>Выезды</span><strong>${st.departures}</strong><small>${st.departuresLeft ? `ещё ${st.departuresLeft}` : 'все выехали'}</small></div>
        <div><span>Проживают</span><strong>${st.inhouse}</strong><small>гостей</small></div>
        <div><span>Свободно</span><strong>${st.free}</strong><small>номеров на ночь</small></div>
        <div class="${st.overdue ? 'is-alert' : ''}"><span>Не оформлено</span><strong>${st.overdue}</strong><small>заезды и выезды</small></div>
        <div><span>Номера</span><strong>${st.dirty}</strong><small>к уборке${st.repair ? `, ${st.repair} на ремонте` : ''}</small></div>
        <div class="${st.tasks ? 'is-alert' : ''}"><span>Задачи</span><strong>${st.tasks || 0}</strong><small>на сегодня и просрочено</small></div>
      </div>
    </details>
    <form class="chess-toolbar card" method="get" action="/app/chess">
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
    <div class="chess-tools card" data-chess-tools hidden>
      <div class="field chess-find"><label for="chess-find">Найти бронь</label><input id="chess-find" type="search" placeholder="Фамилия, телефон или номер брони" data-find-input></div>
      <fieldset class="chips"><legend>Статус</legend>${chip('status', 'confirmed', 'ожидается')}${chip('status', 'checked_in', 'проживает')}${chip('status', 'checked_out', 'выехал')}</fieldset>
      <fieldset class="chips"><legend>Источник</legend>${chip('src', 'site', 'сайт')}${chip('src', 'manual', 'вручную')}${chip('src', 'channel', 'каналы')}</fieldset>
      <fieldset class="chips"><legend>Оплата</legend>${chip('pay', 'none', 'не оплачена')}${chip('pay', 'part', 'частично')}${chip('pay', 'paid', 'оплачена')}</fieldset>
      ${tags.length ? html`<fieldset class="chips"><legend>Теги</legend>${tags.map((t) => chip('tag', String(t.id), t.name))}</fieldset>` : ''}
      <button type="button" class="btn btn--ghost btn--sm" data-filter-reset>Сбросить</button>
      <p class="muted chess-tools__count" aria-live="polite" data-filter-count></p>
    </div>
    <div class="chess-view">
      <ul class="chess-legend" aria-label="Обозначения">
        <li><span class="legend-swatch src-site-sw"></span>с сайта / вручную</li>
        <li><span class="legend-swatch src-channel-sw"></span>из каналов</li>
        <li><span class="legend-swatch inhouse-sw"></span>проживает</li>
        <li><span class="legend-swatch out-sw"></span>выехал</li>
        <li><span class="legend-swatch unassigned-sw"></span>без номера</li>
        <li><span class="legend-swatch overdue-sw"></span>заезд/выезд не оформлен</li>
        <li><span class="chess__debt">₽</span>есть долг</li>
        <li><span class="dot dot--dirty"></span>уборка</li><li><span class="dot dot--repair"></span>ремонт</li>
      </ul>
      <form class="chess-placement" method="post" action="/app/chess/placement">
        <input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="back" value="${here}">
        <label for="chess-mode">Новые брони</label>
        <select id="chess-mode" name="mode" data-autosubmit>
          <option value="auto" ${hotel.placement_mode !== 'manual' ? raw('selected') : ''}>сразу в свободный номер</option>
          <option value="manual" ${hotel.placement_mode === 'manual' ? raw('selected') : ''}>в строку «Без номера»</option>
        </select><noscript><button type="submit" class="btn btn--sm btn--ghost">ок</button></noscript>
      </form>
      ${unassignedCount ? html`<form method="post" action="/app/chess/assign"><input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="back" value="${here}">
        <button class="btn btn--secondary btn--sm" type="submit">Распределить «Без номера» (${unassignedCount})</button></form>` : ''}
    </div>
    <p class="muted chess-hint">Клик по брони — карточка с действиями. Клик по пустой клетке — новая бронь. Перетащите бронь на другой номер или дату — перенос с предпросмотром. Потяните за край — новая дата заезда или выезда.</p>
    <div class="chess-wrap" tabindex="0" role="region" aria-label="Шахматка номеров">
      <div class="chess" data-chess data-from="${from}" data-days="${days}">${head}${body}</div>
    </div>
    <dialog class="peek" data-peek aria-label="Бронь"><div data-peek-body></div></dialog>
    <dialog class="dialog move-dialog" data-move-dialog aria-labelledby="move-title">
      <h2 class="h3" id="move-title">Перенести бронь?</h2>
      <div data-move-diff></div>
      <label class="check"><input type="checkbox" data-keep-price checked><span>Не менять цену проживания</span></label>
      <p class="field-error" data-move-error hidden></p>
      <div class="actions"><button type="button" class="btn btn--primary" data-move-apply>Применить</button><button type="button" class="btn btn--ghost" data-move-cancel>Отмена</button></div>
    </dialog>`,
  });
}

function sourceShort(s, names) {
  return { site: 'сайт', extranet: 'вручную' }[s] || names.get(s) || s;
}

// The side panel opened from a bar: the stay at a glance and the everyday actions.
export function peekPanel({ req, b, segs, rate, channels, back, nowLocal, tags = [], notes = [] }) {
  const chName = new Map(channels.map((c) => [c.code, c.name]));
  const debt = b.total - b.paid_amount;
  const now = nowLocal; // the hotel's local date and time, editable in the form
  const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="back" value="${back}">`;
  const ages = JSON.parse(b.children_ages || '[]');
  const payFields = (label) => html`<div class="peek__pay">
      <label class="check"><input type="checkbox" data-pay-toggle><span>${label} ${rub(debt)}</span></label>
      <input type="hidden" name="pay_amount" value="0" data-pay-amount="${debt}">
      <label class="sr-only" for="pk-m-${b.id}">Способ оплаты</label>
      <select id="pk-m-${b.id}" name="pay_method"><option value="card">карта</option><option value="cash">наличные</option><option value="transfer">перевод</option></select></div>`;
  return html`<div class="peek__head">
      <h2 class="h3">${b.guest_name}</h2>
      <button type="button" class="peek__close" data-peek-close aria-label="Закрыть">✕</button>
    </div>
    <p class="peek__status"><span class="badge badge--${b.status}">${STATUS[b.status] || b.status}</span> · ${b.code}</p>
    <dl class="kv">
      <dt>Даты</dt><dd>${fmtDate(b.checkin)} — ${fmtDate(b.checkout)}, ${nightsLabel(diffDays(b.checkin, b.checkout))}</dd>
      <dt>Номер</dt><dd>${segs.map((s, i) => html`${i ? ' → ' : ''}${s.number ? `№ ${s.number}` : 'без номера'}${segs.length > 1 ? ` (с ${fmtShort(s.start)})` : ''}`)}</dd>
      <dt>Гости</dt><dd>${b.adults} взр.${b.children ? `, ${b.children} дет.${ages.length ? ` (${ages.join(', ')})` : ''}` : ''}</dd>
      <dt>Телефон</dt><dd><a href="tel:${b.guest_phone}">${b.guest_phone}</a></dd>
      <dt>Источник</dt><dd>${sourceShort(b.source, chName)}${b.channel_ref ? ` · ${b.channel_ref}` : ''}</dd>
      <dt>Тариф</dt><dd>${rate ? rate.name : '—'}</dd>
      <dt>Сумма</dt><dd>${rub(b.total)}${debt > 0 ? html` · <strong class="debt">к оплате ${rub(debt)}</strong>` : ' · оплачено'}</dd>
      ${b.comment ? html`<dt>Пожелания</dt><dd>${b.comment}</dd>` : ''}
      ${tags.length ? html`<dt>Теги</dt><dd>${tags.map((t) => html`<span class="tag tag--${t.color}">${t.name}</span> `)}</dd>` : ''}
    </dl>
    ${notes.length ? html`<ul class="peek__notes" aria-label="Открытые заметки">${notes.map((n) => html`<li>📝 ${n.text}${n.due_at ? html` <small class="muted">до ${n.due_at.slice(8, 10)}.${n.due_at.slice(5, 7)} ${n.due_at.slice(11, 16)}</small>` : ''}</li>`)}</ul>` : ''}
    <div class="peek__actions">
      ${b.status === 'confirmed' ? html`<form method="post" action="/app/bookings/${b.id}/status" class="peek__form">${hidden}<input type="hidden" name="status" value="checked_in">
          <label for="pk-in-${b.id}">Заселение</label><input id="pk-in-${b.id}" type="datetime-local" name="at" value="${now}">
          ${debt > 0 ? payFields('Принять оплату') : ''}
          <button class="btn btn--primary" type="submit">Заселить</button></form>` : ''}
      ${b.status === 'checked_in' ? html`<form method="post" action="/app/bookings/${b.id}/status" class="peek__form">${hidden}<input type="hidden" name="status" value="checked_out">
          <label for="pk-out-${b.id}">Выезд</label><input id="pk-out-${b.id}" type="datetime-local" name="at" value="${now}">
          ${debt > 0 ? payFields('Получить остаток') : ''}
          <button class="btn btn--primary" type="submit">Выселить</button></form>` : ''}
      ${b.status === 'checked_out' ? html`<form method="post" action="/app/bookings/${b.id}/status" class="peek__form">${hidden}<input type="hidden" name="status" value="checked_in">
          <label for="pk-undo-${b.id}">Причина отмены выселения</label><input id="pk-undo-${b.id}" name="reason" required minlength="3" placeholder="например, выселили по ошибке">
          <button class="btn btn--secondary" type="submit">Отменить выселение</button></form>` : ''}
      ${debt > 0 && b.status !== 'cancelled' ? html`<form method="post" action="/app/bookings/${b.id}/pay" class="peek__form peek__form--inline">${hidden}
          <label for="pk-pay-${b.id}">Оплата, ₽</label><input id="pk-pay-${b.id}" type="number" name="amount" min="1" max="${debt}" value="${debt}">
          <label class="sr-only" for="pk-pm-${b.id}">Способ</label><select id="pk-pm-${b.id}" name="method"><option value="card">карта</option><option value="cash">наличные</option><option value="transfer">перевод</option></select>
          <button class="btn btn--secondary" type="submit">Принять</button></form>` : ''}
      <div class="actions">
        <a class="btn btn--ghost" href="/app/bookings/${b.id}">Открыть карточку</a>
        ${b.status === 'confirmed' ? html`<form method="post" action="/app/bookings/${b.id}/status" data-confirm="Отметить незаезд? Номера вернутся в продажу.">${hidden}<input type="hidden" name="status" value="no_show"><button class="btn btn--ghost" type="submit">Незаезд</button></form>
          <form method="post" action="/app/bookings/${b.id}/status" data-confirm="Отменить бронь и вернуть номера в продажу?">${hidden}<input type="hidden" name="status" value="cancelled"><button class="btn btn--danger" type="submit">Отменить</button></form>` : ''}
      </div>
    </div>`;
}
