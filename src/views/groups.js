import { html, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { statusBadge } from './engine.js';
import { csrf, PAY_METHODS } from './app.js';
import { fmtDate } from '../lib/dates.js';

const err = (errors, k) => (errors ? errors[k] : undefined);

function groupForm({ req, types, rates, values = {}, errors = {} }) {
  return html`<form class="form form--grid" method="post" action="/app/groups" novalidate>${csrf(req)}
    ${field({ prefix: 'gr', name: 'name', label: 'Название группы', value: values.name, error: err(errors, 'name'), attrs: 'required maxlength="120" placeholder="например, Конференция «Север»"' })}
    ${field({ prefix: 'gr', name: 'contact_name', label: 'Контактное лицо', value: values.contact_name, error: err(errors, 'contact_name'), attrs: 'required maxlength="120"' })}
    ${field({ prefix: 'gr', name: 'phone', label: 'Телефон', type: 'tel', value: values.phone, error: err(errors, 'phone'), attrs: 'required' })}
    ${field({ prefix: 'gr', name: 'email', label: 'Почта', type: 'email', value: values.email, error: err(errors, 'email') })}
    ${field({ prefix: 'gr', name: 'customer_inn', label: 'ИНН заказчика (если платит организация)', value: values.customer_inn, error: err(errors, 'customer_inn'), attrs: 'inputmode="numeric" maxlength="12"' })}
    ${field({ prefix: 'gr', name: 'rate', label: 'Тариф', type: 'select', value: values.rate, options: rates.map((r) => [r.id, r.name]) })}
    ${field({ prefix: 'gr', name: 'checkin', label: 'Заезд', type: 'date', value: values.checkin, error: err(errors, 'checkin'), attrs: 'required' })}
    ${field({ prefix: 'gr', name: 'checkout', label: 'Выезд', type: 'date', value: values.checkout, error: err(errors, 'checkout'), attrs: 'required' })}
    <fieldset class="span-all group-rows"><legend>Номера</legend>
      <p class="hint">Сколько номеров каждой категории и по сколько взрослых в номере. Для каждого номера создастся своя бронь — потом в ней можно вписать имя гостя.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Номера группы"><table class="table table--compact">
        <thead><tr><th scope="col">Категория</th><th scope="col">Номеров</th><th scope="col">Взрослых в номере</th></tr></thead>
        <tbody>${types.map((t) => html`<tr><th scope="row">${t.name} <small class="muted">до ${t.capacity + (t.extra_beds || 0)} гостей</small></th>
          <td><label class="sr-only" for="gr-count-${t.id}">${t.name}: номеров</label><input id="gr-count-${t.id}" name="count_${t.id}" type="number" min="0" max="50" value="${values[`count_${t.id}`] || 0}"></td>
          <td><label class="sr-only" for="gr-adults-${t.id}">${t.name}: взрослых</label><input id="gr-adults-${t.id}" name="adults_${t.id}" type="number" min="1" max="${t.capacity + (t.extra_beds || 0)}" value="${values[`adults_${t.id}`] || Math.min(2, t.capacity)}"></td></tr>`)}</tbody>
      </table></div>
      ${err(errors, 'rows') ? html`<p class="field-error">${errors.rows}</p>` : ''}
    </fieldset>
    ${field({ prefix: 'gr', name: 'comment', label: 'Комментарий', type: 'textarea', value: values.comment, attrs: 'maxlength="1000" placeholder="например, трансфер с вокзала, ужин в первый вечер"' })}
    <div class="actions span-all"><button class="btn btn--primary" type="submit">Создать группу</button><a class="btn btn--ghost" href="/app/groups" data-close-details>Отмена</a></div>
  </form>`;
}

export function groupsPage({ req, hotel, msg, groups, types, rates, values, errors, formError, open = false }) {
  return appLayout({
    title: 'Групповые брони',
    req,
    hotel,
    msg,
    body: html`<div class="page-actions"><p class="muted">Группа — несколько номеров одного заказчика: команда, свадьба, тур. Создаются одной формой, оплачиваются одним платежом, отменяются вместе.</p></div>
    <details class="add card" ${open ? 'open' : ''}><summary class="btn btn--primary">+ Новая группа</summary>
      ${formError ? html`<div class="flash flash--error" role="alert">${formError}</div>` : ''}
      ${types.length && rates.length ? groupForm({ req, types, rates, values, errors }) : html`<p class="muted">Сначала добавьте категории и тарифы.</p>`}
    </details>
    ${groups.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Список групп"><table class="table">
      <thead><tr><th scope="col">Группа</th><th scope="col">Контакт</th><th scope="col">Даты</th><th scope="col">Номеров</th><th scope="col">Сумма</th><th scope="col">Оплачено</th></tr></thead>
      <tbody>${groups.map((g) => html`<tr><td><a href="/app/groups/${g.id}">${g.name}</a><small class="muted">${g.code}</small></td>
        <td>${g.contact_name}<small class="muted">${g.phone}</small></td>
        <td>${g.checkin ? `${fmtDate(g.checkin)} — ${fmtDate(g.checkout)}` : html`<span class="muted">все отменены</span>`}</td>
        <td>${g.rooms}</td><td>${rub(g.total)}</td>
        <td>${g.total && g.paid >= g.total ? html`<span class="badge badge--confirmed">оплачено</span>` : rub(g.paid)}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty"><p>Групп пока нет.</p></div>`}`,
  });
}

export function groupPage({ req, hotel, msg, group, members, totals }) {
  const here = `/app/groups/${group.id}`;
  const confirmed = members.filter((m) => m.status === 'confirmed').length;
  return appLayout({
    title: `Группа «${group.name}»`,
    req,
    hotel,
    msg,
    body: html`<p><a href="/app/groups">← Все группы</a></p>
    <div class="tiles-stat">
      <div class="stat-tile"><span>Номеров</span><strong>${totals.rooms}</strong></div>
      <div class="stat-tile"><span>Гостей</span><strong>${totals.guests}</strong></div>
      <div class="stat-tile"><span>Сумма</span><strong>${rub(totals.total)}</strong></div>
      <div class="stat-tile"><span>Долг</span><strong>${rub(Math.max(0, totals.debt))}</strong></div>
    </div>
    <div class="app-cols">
      <section class="card"><h2 class="h3">Заказчик</h2>
        <dl class="kv">
          <dt>Код группы</dt><dd>${group.code}</dd>
          <dt>Контакт</dt><dd>${group.contact_name}, ${group.phone}${group.email ? `, ${group.email}` : ''}</dd>
          ${group.customer_inn ? html`<dt>ИНН</dt><dd>${group.customer_inn}</dd>` : ''}
          ${totals.from ? html`<dt>Даты</dt><dd>${fmtDate(totals.from)} — ${fmtDate(totals.to)}</dd>` : ''}
          ${group.comment ? html`<dt>Комментарий</dt><dd>${group.comment}</dd>` : ''}
        </dl>
        <p><a class="linklike" href="${here}/invoice" target="_blank" rel="noopener">Сводный счёт группы</a></p>
      </section>
      <section class="card"><h2 class="h3">Оплата группы</h2>
        ${totals.debt > 0 ? html`<p class="muted">Платёж разойдётся по броням группы: сначала закрывается долг ранних заездов.</p>
          <form class="form form--inline" method="post" action="${here}/pay">${csrf(req)}
            ${field({ prefix: 'gp', name: 'amount', label: 'Сумма, ₽', type: 'number', value: totals.debt, attrs: `min="1" max="${totals.debt}" required` })}
            ${field({ prefix: 'gp', name: 'method', label: 'Способ', type: 'select', value: 'transfer', options: PAY_METHODS.filter((m) => m[0] !== 'online') })}
            <button class="btn btn--primary" type="submit">Принять оплату</button></form>`
          : html`<p class="badge badge--confirmed">Группа оплачена</p>`}
        <details class="add"><summary class="btn btn--secondary">Добавить бронь в группу</summary>
          <form class="form form--inline" method="post" action="${here}/attach">${csrf(req)}
            ${field({ prefix: 'ga', name: 'code', label: 'Номер брони', attrs: 'required placeholder="SR-XXXXXXXX" autocomplete="off"' })}
            <button class="btn btn--primary" type="submit">Добавить</button><a class="btn btn--ghost" href="${here}" data-close-details>Отмена</a></form></details>
        ${confirmed ? html`<form method="post" action="${here}/cancel" data-confirm="Отменить все ${confirmed} незаселённые брони группы? Номера вернутся в продажу.">${csrf(req)}
          <button class="btn btn--danger" type="submit">Отменить группу</button></form>` : ''}
      </section>
    </div>
    <section class="card"><h2 class="h3">Брони группы</h2>
      ${members.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Брони группы"><table class="table">
        <thead><tr><th scope="col">Бронь</th><th scope="col">Гость</th><th scope="col">Номер</th><th scope="col">Даты</th><th scope="col">Сумма</th><th scope="col">Оплачено</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${members.map((m) => html`<tr><td><a href="/app/bookings/${m.id}">${m.code}</a></td><td>${m.guest_name}<small class="muted">${m.adults} взр.${m.children ? `, ${m.children} дет.` : ''}</small></td>
          <td>${m.room_number ? `№ ${m.room_number}` : html`<span class="badge badge--warn">без номера</span>`}<small class="muted">${m.room_name}</small></td>
          <td>${fmtDate(m.checkin)} — ${fmtDate(m.checkout)}</td><td>${rub(m.total)}</td><td>${rub(m.paid_amount)}</td><td>${statusBadge(m.status)}</td>
          <td><form method="post" action="${here}/detach" data-confirm="Исключить бронь ${m.code} из группы? Сама бронь останется.">${csrf(req)}<input type="hidden" name="booking" value="${m.id}"><button class="linklike" type="submit">исключить</button></form></td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">В группе нет броней.</p>`}
    </section>`,
  });
}
