import { html, raw, rub, field } from './html.js';
import { appLayout } from './layout.js';
import { csrf, MEALS } from './app.js';

const ROOM_STATUS = [['clean', 'Чистый'], ['dirty', 'Нужна уборка'], ['repair', 'Ремонт (не продаётся)']];
const PER = [['stay', 'за всё проживание'], ['night', 'за ночь'], ['guest_night', 'за гостя в ночь']];

// "Add" forms open in a <details>; Cancel closes it (JS) or reloads the page (no JS).
function addBlock(label, form, open = false) {
  return html`<details class="add" ${open ? raw('open') : ''}><summary class="btn btn--secondary">${label}</summary>${form}</details>`;
}
const cancel = html`<a class="btn btn--ghost" href="/app/rooms" data-close-details>Отмена</a>`;

export function roomsPage({ req, hotel, types, rooms, rates, groups, extras, promos, msg }) {
  const byType = (id) => rooms.filter((r) => r.room_type_id === id);
  return appLayout({
    title: 'Номера и тарифы',
    req,
    hotel,
    msg,
    body: html`<nav class="subnav" aria-label="Разделы страницы"><a href="#types">Категории</a><a href="#stock">Номерной фонд</a><a href="#rates">Тарифы</a><a href="#extras">Допуслуги</a><a href="#promos">Промокоды</a></nav>

    <section class="card" id="types">
      <h2 class="h3">Категории номеров</h2>
      <p class="muted">Основные места — кровати, на которые рассчитана базовая цена. Дополнительные — раскладушка, диван, детская кроватка; их цена задаётся в тарифе.</p>
      ${types.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Категории номеров"><table class="table"><thead><tr><th scope="col">Название</th><th scope="col">Основных мест</th><th scope="col">Доп. мест</th><th scope="col">Номеров</th><th scope="col">Цена по умолчанию</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${types.map((t) => html`<tr><td>${t.name}</td><td>${t.capacity}</td><td>${t.extra_beds}</td><td>${t.total_rooms}</td><td>${rub(t.base_price)}</td><td>${t.active ? 'продаётся' : 'скрыта'}</td>
          <td><details class="row-edit"><summary>Изменить</summary>${typeForm(req, t, `/app/rooms/types/${t.id}`)}</details></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty"><p>Категорий пока нет — добавьте первую.</p></div>`}
      ${addBlock('Добавить категорию', typeForm(req, {}, '/app/rooms/types'), !types.length)}
    </section>

    <section class="card" id="stock">
      <h2 class="h3">Номерной фонд</h2>
      <p class="muted">Конкретные номера — они строки шахматки. Порядок задаёт колонка «Сортировка» (меньше — выше). Номер «на ремонте» не продаётся и не попадает в автоподбор.</p>
      ${types.map((t) => html`<h3 class="h3 stock-h">${t.name} <small class="muted">${byType(t.id).length} ном.</small></h3>
        ${byType(t.id).length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Номера категории ${t.name}"><table class="table table--compact"><thead><tr><th scope="col">Номер</th><th scope="col">Этаж</th><th scope="col">Сортировка</th><th scope="col">Состояние</th><th scope="col">Заметка</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
          <tbody>${byType(t.id).map((r) => html`<tr>
            <td colspan="5"><form class="room-row" method="post" action="/app/rooms/stock/${r.id}">${csrf(req)}
              <label class="sr-only" for="rn-${r.id}">Номер</label><input id="rn-${r.id}" name="number" value="${r.number}" maxlength="10" required class="input-sm">
              <label class="sr-only" for="rf-${r.id}">Этаж</label><input id="rf-${r.id}" name="floor" type="number" value="${r.floor}" class="input-sm">
              <label class="sr-only" for="rs-${r.id}">Сортировка</label><input id="rs-${r.id}" name="sort" type="number" value="${r.sort}" class="input-sm">
              <label class="sr-only" for="rst-${r.id}">Состояние</label><select id="rst-${r.id}" name="status">${ROOM_STATUS.map(([v, l]) => html`<option value="${v}" ${r.status === v ? raw('selected') : ''}>${l}</option>`)}</select>
              <label class="sr-only" for="rnote-${r.id}">Заметка</label><input id="rnote-${r.id}" name="note" value="${r.note}" maxlength="120" placeholder="например, вид на двор">
              <button class="btn btn--sm btn--secondary" type="submit">Сохранить</button></form></td>
            <td><form method="post" action="/app/rooms/stock/${r.id}/delete" data-confirm="Убрать номер ${r.number} из продажи?">${csrf(req)}<button class="linklike" type="submit">Убрать</button></form></td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">В этой категории пока нет номеров.</p>`}`)}
      ${types.length ? addBlock('Добавить номера', html`<form class="form form--grid" method="post" action="/app/rooms/stock">${csrf(req)}
        ${field({ prefix: 'st', name: 'room_type_id', label: 'Категория', type: 'select', options: types.map((t) => [t.id, t.name]) })}
        ${field({ prefix: 'st', name: 'numbers', label: 'Номера', attrs: 'required placeholder="101-110, 115, 2A"', hint: 'Через запятую или диапазоном' })}
        ${field({ prefix: 'st', name: 'floor', label: 'Этаж', type: 'number', value: 1 })}
        <div class="actions"><button class="btn btn--primary" type="submit">Добавить</button>${cancel}</div></form>`) : ''}
    </section>

    <section class="card" id="rates">
      <h2 class="h3">Тарифы</h2>
      <p class="muted">Базовый тариф берёт цену за ночь из «Цен и наличия». Производный считается от другого тарифа: например, «−12% от Гибкого, округлить до 10 ₽». Меняете цену в «Ценах и наличии» — пересчитываются все тарифы. Цепочка — не глубже трёх уровней.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Тарифы"><table class="table"><thead><tr><th scope="col">Тариф</th><th scope="col">Цена</th><th scope="col">Питание</th><th scope="col">Доп. место взр. / реб.</th><th scope="col">Отмена</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${rates.map((r) => html`<tr><td>${r.name}</td><td class="rate-derived">${derivation(r, rates)}</td><td>${MEALS.find((m) => m[0] === r.meal)[1]}${r.meal_price ? ` (${rub(r.meal_price)}/гость)` : ''}</td>
        <td>${rub(r.extra_adult_price)} / ${rub(r.extra_child_price)}</td><td>${r.refundable ? 'бесплатная' : 'без возврата'}</td><td>${r.active ? 'активен' : 'выключен'}</td>
        <td><details class="row-edit"><summary>Изменить</summary>${rateForm(req, r, `/app/rooms/rates/${r.id}`, rates)}</details></td></tr>`)}</tbody></table></div>
      ${addBlock('Добавить тариф', rateForm(req, {}, '/app/rooms/rates', rates))}
    </section>

    <section class="card" id="extras">
      <h2 class="h3">Допуслуги</h2>
      ${groups.map((g) => {
        const list = extras.filter((e) => e.group_id === g.id);
        return html`<div class="extra-group"><div class="extra-group__head"><h3 class="h3">📁 ${g.name}</h3>
          <details class="row-edit"><summary>Переименовать</summary><form class="form form--inline" method="post" action="/app/rooms/groups/${g.id}">${csrf(req)}${field({ prefix: `g${g.id}`, name: 'name', label: 'Название группы', value: g.name, attrs: 'required maxlength="60"' })}<button class="btn btn--primary btn--sm" type="submit">Сохранить</button></form></details>
          ${list.length ? '' : html`<form method="post" action="/app/rooms/groups/${g.id}/delete">${csrf(req)}<button class="linklike" type="submit">Удалить пустую группу</button></form>`}</div>
          ${extrasList(req, list, groups)}</div>`;
      })}
      ${extras.some((e) => !e.group_id) ? html`<div class="extra-group"><h3 class="h3">Без группы</h3>${extrasList(req, extras.filter((e) => !e.group_id), groups)}</div>` : ''}
      <div class="actions">
        ${addBlock('Добавить услугу', html`<form class="form form--grid" method="post" action="/app/rooms/extras">${csrf(req)}
          ${field({ prefix: 'ex', name: 'name', label: 'Название', attrs: 'required maxlength="80"' })}
          ${field({ prefix: 'ex', name: 'price', label: 'Цена, ₽', type: 'number', attrs: 'min="0" required' })}
          ${field({ prefix: 'ex', name: 'per', label: 'Цена', type: 'select', options: PER })}
          ${field({ prefix: 'ex', name: 'group_id', label: 'Группа', type: 'select', options: [['', 'Без группы'], ...groups.map((g) => [g.id, g.name])] })}
          ${field({ prefix: 'ex', name: 'description', label: 'Описание для гостя', type: 'textarea' })}
          <div class="actions"><button class="btn btn--primary" type="submit">Добавить</button>${cancel}</div></form>`)}
        ${addBlock('Создать группу', html`<form class="form form--inline" method="post" action="/app/rooms/groups">${csrf(req)}
          ${field({ prefix: 'grp', name: 'name', label: 'Название группы', attrs: 'required maxlength="60" placeholder="Например, Питание"' })}
          <div class="actions"><button class="btn btn--primary" type="submit">Создать</button>${cancel}</div></form>`)}
      </div>
    </section>

    <section class="card" id="promos"><h2 class="h3">Промокоды</h2>
      <ul class="mini-list">${promos.map((p) => html`<li><span><code>${p.code}</code> — ${p.discount_pct}%${p.active ? '' : ' (выключен)'}</span><form method="post" action="/app/rooms/promos/${p.id}/toggle">${csrf(req)}<button class="linklike" type="submit">${p.active ? 'Выключить' : 'Включить'}</button></form></li>`)}</ul>
      ${addBlock('Добавить промокод', html`<form class="form form--inline" method="post" action="/app/rooms/promos">${csrf(req)}
        ${field({ prefix: 'promo', name: 'code', label: 'Код', attrs: 'required maxlength="32" pattern="[A-Za-z0-9_-]+"' })}
        ${field({ prefix: 'promo', name: 'discount_pct', label: 'Скидка, %', type: 'number', attrs: 'min="1" max="90" required' })}
        <div class="actions"><button class="btn btn--primary" type="submit">Добавить</button>${cancel}</div></form>`)}
    </section>`,
  });
}

function extrasList(req, list, groups) {
  if (!list.length) return html`<p class="muted">Пусто</p>`;
  return html`<ul class="mini-list">${list.map((e) => html`<li><span>${e.name} — ${rub(e.price)} ${PER.find((p) => p[0] === e.per)[1]}${e.active ? '' : ' (скрыта)'}</span>
    <span class="actions">
      <form class="inline-form" method="post" action="/app/rooms/extras/${e.id}/group">${csrf(req)}<label class="sr-only" for="eg-${e.id}">Группа для ${e.name}</label>
        <select id="eg-${e.id}" name="group_id" data-autosubmit><option value="">Без группы</option>${groups.map((g) => html`<option value="${g.id}" ${g.id === e.group_id ? raw('selected') : ''}>${g.name}</option>`)}</select>
        <noscript><button type="submit">ок</button></noscript></form>
      <form method="post" action="/app/rooms/extras/${e.id}/toggle">${csrf(req)}<button class="linklike" type="submit">${e.active ? 'Скрыть' : 'Показать'}</button></form>
    </span></li>`)}</ul>`;
}

function typeForm(req, t, action) {
  const pfx = action.replace(/\W+/g, '-').replace(/^-/, '');
  return html`<form class="form form--grid" method="post" action="${action}">${csrf(req)}
    ${field({ prefix: pfx, name: 'name', label: 'Название', value: t.name, attrs: 'required maxlength="80"' })}
    ${field({ prefix: pfx, name: 'capacity', label: 'Основных мест', type: 'number', value: t.capacity ?? 2, attrs: 'min="1" max="12" required' })}
    ${field({ prefix: pfx, name: 'extra_beds', label: 'Дополнительных мест', type: 'number', value: t.extra_beds ?? 0, attrs: 'min="0" max="6" required' })}
    ${field({ prefix: pfx, name: 'base_price', label: 'Цена за ночь, ₽', type: 'number', value: t.base_price ?? 3000, attrs: 'min="0" required' })}
    ${field({ prefix: pfx, name: 'area_m2', label: 'Площадь, м²', type: 'number', value: t.area_m2 ?? 18, attrs: 'min="0"' })}
    ${field({ prefix: pfx, name: 'beds', label: 'Кровати', value: t.beds })}
    ${field({ prefix: pfx, name: 'sort', label: 'Порядок показа', type: 'number', value: t.sort ?? 0 })}
    ${field({ prefix: pfx, name: 'description', label: 'Описание', type: 'textarea', value: t.description })}
    ${t.id ? html`<label class="check"><input type="checkbox" name="active" ${t.active ? raw('checked') : ''}><span>Продаётся</span></label>` : ''}
    <div class="actions"><button class="btn btn--primary" type="submit">Сохранить</button>${cancel}</div></form>`;
}

// "−12% от «Гибкий», округл. до 10 ₽" — how a rate's nightly price is made.
export function derivation(r, rates) {
  const parent = rates.find((x) => x.id === r.parent_id);
  const v = r.adjust_value || 0;
  const adj = v ? `${v > 0 ? '+' : '−'}${r.adjust_type === 'fixed' ? rub(Math.abs(v)) : `${Math.abs(v)}%`}` : '';
  const parts = [parent ? `${adj || '='} от «${parent.name}»` : `базовая цена${adj ? ` ${adj}` : ''}`];
  if (r.rounding) parts.push(`округл. до ${r.rounding} ₽`);
  if (r.single_discount) parts.push(`одному гостю −${rub(r.single_discount)}/ночь`);
  return parts.join(', ');
}

function rateForm(req, r, action, rates = []) {
  const pfx = action.replace(/\W+/g, '-').replace(/^-/, '');
  const parents = rates.filter((x) => x.id !== r.id);
  return html`<form class="form form--grid" method="post" action="${action}">${csrf(req)}
    ${field({ prefix: pfx, name: 'name', label: 'Название', value: r.name, attrs: 'required maxlength="80"' })}
    ${field({ prefix: pfx, name: 'meal', label: 'Питание', type: 'select', value: r.meal || 'none', options: MEALS })}
    ${field({ prefix: pfx, name: 'meal_price', label: 'Питание, ₽ за гостя в ночь', type: 'number', value: r.meal_price ?? 0, attrs: 'min="0"' })}
    ${field({ prefix: pfx, name: 'parent_id', label: 'Считать от', type: 'select', value: r.parent_id || '', options: [['', 'Базовой цены категории'], ...parents.map((x) => [x.id, `тарифа «${x.name}»`])] })}
    ${field({ prefix: pfx, name: 'adjust_value', label: 'Изменение (− скидка, + наценка)', type: 'number', value: r.adjust_value ?? 0, attrs: 'min="-100000" max="100000"' })}
    ${field({ prefix: pfx, name: 'adjust_type', label: 'В чём', type: 'select', value: r.adjust_type || 'pct', options: [['pct', '%'], ['fixed', '₽ за ночь']] })}
    ${field({ prefix: pfx, name: 'rounding', label: 'Округлять до', type: 'select', value: r.rounding ?? 0, options: [[0, 'не округлять'], [10, '10 ₽'], [50, '50 ₽'], [100, '100 ₽']] })}
    ${field({ prefix: pfx, name: 'single_discount', label: 'Скидка одному гостю, ₽/ночь', type: 'number', value: r.single_discount ?? 0, attrs: 'min="0"', hint: 'Одноместное размещение' })}
    ${field({ prefix: pfx, name: 'extra_adult_price', label: 'Доп. место, взрослый, ₽/ночь', type: 'number', value: r.extra_adult_price ?? 0, attrs: 'min="0"' })}
    ${field({ prefix: pfx, name: 'extra_child_price', label: 'Доп. место, ребёнок, ₽/ночь', type: 'number', value: r.extra_child_price ?? 0, attrs: 'min="0"' })}
    ${field({ prefix: pfx, name: 'description', label: 'Условия для гостя', type: 'textarea', value: r.description })}
    <label class="check"><input type="checkbox" name="refundable" ${r.refundable ?? 1 ? raw('checked') : ''}><span>Бесплатная отмена</span></label>
    ${r.id ? html`<label class="check"><input type="checkbox" name="active" ${r.active ? raw('checked') : ''}><span>Активен</span></label>` : ''}
    <div class="actions"><button class="btn btn--primary" type="submit">Сохранить</button>${cancel}</div></form>`;
}
