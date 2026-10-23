import { html, raw, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { csrf } from './app.js';
import { addDays, fmtDate } from '../lib/dates.js';
import { hhmm } from '../lib/hourly.js';

const STATUS = { confirmed: 'подтверждена', checked_in: 'гость в номере', checked_out: 'завершена' };

// Start times every 30 minutes within the widest open hours of the hotel's hourly categories.
function startOptions(open, close) {
  const out = [];
  for (let m = open; m < close; m += 30) out.push([hhmm(m), hhmm(m)]);
  return out;
}

export function hourlyForm({ req, types, rooms, values = {}, open, close, formError }) {
  return html`${formError ? html`<div class="flash flash--error" role="alert">${formError}</div>` : ''}
    <form class="form form--grid" method="post" action="/app/hourly" novalidate>${csrf(req)}
    <input type="hidden" name="idem" value="${values.idem}">
    ${field({ prefix: 'hb', name: 'type', label: 'Категория', type: 'select', value: values.type, options: types.map((t) => [t.id, `${t.name} — ${rub(t.hour_price)}/ч, от ${t.min_hours} ч`]) })}
    ${field({ prefix: 'hb', name: 'room', label: 'Номер', type: 'select', value: values.room, options: [['', 'любой свободный'], ...rooms.map((r) => [r.id, `№ ${r.number} (${r.type_name})`])] })}
    ${field({ prefix: 'hb', name: 'date', label: 'Дата', type: 'date', value: values.date, attrs: 'required' })}
    ${field({ prefix: 'hb', name: 'start', label: 'Начало', type: 'select', value: values.start, options: startOptions(open, close) })}
    ${field({ prefix: 'hb', name: 'hours', label: 'Часов', type: 'number', value: values.hours, attrs: 'min="1" max="24" required' })}
    ${field({ prefix: 'hb', name: 'adults', label: 'Гостей', type: 'number', value: values.adults || 1, attrs: 'min="1" max="12" required' })}
    ${field({ prefix: 'hb', name: 'guest_name', label: 'Имя гостя', value: values.guest_name, attrs: 'required maxlength="120"' })}
    ${field({ prefix: 'hb', name: 'guest_phone', label: 'Телефон', type: 'tel', value: values.guest_phone, attrs: 'required' })}
    ${field({ prefix: 'hb', name: 'price_override', label: 'Своя цена, ₽', type: 'number', value: values.price_override, attrs: 'min="0"', hint: 'Пусто — цена за час × часы' })}
    ${field({ prefix: 'hb', name: 'comment', label: 'Комментарий', value: values.comment, attrs: 'maxlength="500"' })}
    <div class="actions span-all"><button class="btn btn--primary" type="submit">Создать бронь</button><a class="btn btn--ghost" href="/app/hourly?date=${values.date || ''}" data-close-details>Отмена</a></div>
  </form>`;
}

// One day: hourly rooms down, half-hour columns across. A bar is a booking; the hatched tail is the cleaning gap.
export function hourlyPage({ req, hotel, msg, date, today, board, types, rooms, values, formError, open: formOpen = false }) {
  const { open, close } = board;
  const halves = (close - open) / 30;
  const cols = `var(--hb-label) repeat(${halves}, var(--hb-half))`;
  const col = (m) => 2 + Math.round((Math.min(Math.max(m, open), close) - open) / 30);
  const hours = [];
  for (let m = open; m < close; m += 60) hours.push(m);
  const total = board.rooms.reduce((s, r) => s + r.bookings.filter((b) => b.status !== 'checked_out').length, 0);
  return appLayout({
    title: 'Почасовые брони',
    req,
    hotel,
    msg,
    wide: true,
    body: html`<form class="chess-toolbar card" method="get" action="/app/hourly">
      <div class="chess-toolbar__nav">
        <a class="btn btn--ghost btn--sm" href="/app/hourly?date=${addDays(date, -1)}" aria-label="Предыдущий день">←</a>
        <a class="btn btn--ghost btn--sm" href="/app/hourly?date=${today}">Сегодня</a>
        <a class="btn btn--ghost btn--sm" href="/app/hourly?date=${addDays(date, 1)}" aria-label="Следующий день">→</a>
      </div>
      ${field({ prefix: 'hd', name: 'date', label: 'Дата', type: 'date', value: date, attrs: 'data-autosubmit' })}
      <noscript><button class="btn btn--secondary" type="submit">Показать</button></noscript>
      <p class="muted">${fmtDate(date)}: ${total ? `активных броней ${total}` : 'броней нет'}</p>
    </form>
    <details class="add card" ${formOpen ? raw('open') : ''}><summary class="btn btn--primary">+ Почасовая бронь</summary>
      ${hourlyForm({ req, types, rooms, values, open, close, formError })}
    </details>
    ${board.rooms.length ? html`<div class="table-wrap hb-wrap" tabindex="0" role="region" aria-label="Почасовые брони на ${fmtDate(date)}, прокручивается по горизонтали">
      <div class="hb" style="grid-template-columns:${cols}">
        <div class="hb__corner">Номер</div>
        ${hours.map((m) => html`<div class="hb__hour" style="grid-column:${col(m)} / span 2">${hhmm(m)}</div>`)}
        ${board.rooms.map((r) => html`<div class="hb__row" style="grid-template-columns:${cols}">
          <div class="hb__label"><strong>№ ${r.number}</strong><small>${r.type_name}</small></div>
          ${Array.from({ length: halves }, (_, i) => {
            const m = open + i * 30;
            const inside = r.open_to === '24:00' && r.open_from === '00:00' ? true : m >= toMinutes(r.open_from) && m < toMinutes(r.open_to);
            return html`<a class="hb__cell ${inside ? '' : 'is-closed'} ${m % 60 ? '' : 'hb__cell--hour'}" style="grid-column:${2 + i}" tabindex="-1" aria-hidden="true"
              href="/app/hourly?${new URLSearchParams({ date, new: '1', room: r.id, type: r.room_type_id, start: hhmm(m) })}"></a>`;
          })}
          ${r.bookings.map((b) => {
            const s = col(b.from), e = col(b.to);
            const gap = Math.ceil((r.buffer_min || 0) / 30);
            const label = `${b.guest_name}, ${b.start_at.slice(11)}–${b.end_at.slice(11)}${b.start_at.slice(0, 10) !== date ? ` (с ${fmtDate(b.start_at.slice(0, 10))})` : ''}, ${STATUS[b.status]}${b.total > b.paid_amount ? `, к оплате ${rub(b.total - b.paid_amount)}` : ''}`;
            return html`${e > s ? html`<a class="hb__bar hb__bar--${b.status}" style="grid-column:${s} / ${e}" href="/app/bookings/${b.id}" title="${label}" aria-label="${label}">
                <span>${b.guest_name}</span><small>${b.start_at.slice(11)}–${b.end_at.slice(11)}</small></a>` : ''}
              ${gap && b.to < close && b.status !== 'checked_out' ? html`<span class="hb__gap" style="grid-column:${e} / ${Math.min(col(close), e + gap)}" aria-hidden="true" title="Уборка"></span>` : ''}`;
          })}
        </div>`)}
      </div></div>
      <ul class="chess-legend card"><li><span class="hb__key hb__bar--confirmed"></span>подтверждена</li><li><span class="hb__key hb__bar--checked_in"></span>гость в номере</li><li><span class="hb__key hb__bar--checked_out"></span>завершена</li><li><span class="hb__key hb__gap"></span>время на уборку</li><li>Нажмите на пустую клетку, чтобы создать бронь на это время.</li></ul>`
      : html`<div class="empty"><p>Нет номеров, которые продаются по часам. Включите «по часам» у категории в разделе «Номера и тарифы» и добавьте в неё номера.</p></div>`}`,
  });
}

function toMinutes(t) {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}
