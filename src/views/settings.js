import { html, raw, field } from './html.js';
import { appLayout } from './layout.js';
import { csrf } from './app.js';
import { PROPERTY_TYPES } from '../lib/hotels.js';

const TABS = [
  ['/app/settings', 'Объект'],
  ['/app/settings/booking', 'Бронирование и оплата'],
  ['/app/settings/team', 'Сотрудники'],
  ['/app/settings/properties', 'Мои объекты'],
  ['/app/settings/widget', 'Модуль на сайт'],
];
const TIMEZONES = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk',
  'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
];

function tabs(req) {
  const path = req.baseUrl + req.path;
  return html`<nav class="subnav" aria-label="Разделы настроек">${TABS.map(([href, label]) => html`<a href="${href}" ${path.replace(/\/$/, '') === href ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}

function page(req, hotel, msg, title, body) {
  return appLayout({ title: `Настройки · ${title}`, req, hotel, msg, body: html`${tabs(req)}${body}` });
}

export function settingsObject({ req, hotel, msg }) {
  const ro = req.user.role !== 'owner';
  return page(req, hotel, msg, 'Объект', html`<form class="card form form--grid" method="post" action="/app/settings">${csrf(req)}
    ${ro ? html`<p class="flash flash--error">Менять настройки может только владелец.</p>` : ''}
    <h2 class="h3 span-all">Профиль</h2>
    ${field({ prefix: 'so', name: 'name', label: 'Название', value: hotel.name, attrs: 'required maxlength="120"' })}
    ${field({ prefix: 'so', name: 'property_type', label: 'Тип объекта', type: 'select', value: hotel.property_type, options: PROPERTY_TYPES })}
    ${field({ prefix: 'so', name: 'stars', label: 'Звёзды (классификация)', type: 'select', value: hotel.stars, options: [[0, 'Без звёзд'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] })}
    ${field({ prefix: 'so', name: 'city', label: 'Город', value: hotel.city })}
    ${field({ prefix: 'so', name: 'address', label: 'Адрес', value: hotel.address })}
    ${field({ prefix: 'so', name: 'timezone', label: 'Часовой пояс', type: 'select', value: hotel.timezone, options: TIMEZONES.map((t) => [t, t]) })}
    ${field({ prefix: 'so', name: 'phone', label: 'Телефон для гостей', type: 'tel', value: hotel.phone })}
    ${field({ prefix: 'so', name: 'email', label: 'Почта для гостей', type: 'email', value: hotel.email })}
    ${field({ prefix: 'so', name: 'notify_email', label: 'Почта для уведомлений о бронях', type: 'email', value: hotel.notify_email })}
    ${field({ prefix: 'so', name: 'checkin_time', label: 'Заезд с', type: 'time', value: hotel.checkin_time })}
    ${field({ prefix: 'so', name: 'checkout_time', label: 'Выезд до', type: 'time', value: hotel.checkout_time })}
    ${field({ prefix: 'so', name: 'description', label: 'Описание для гостей', type: 'textarea', value: hotel.description })}
    <h2 class="h3 span-all">Реквизиты</h2>
    ${field({ prefix: 'so', name: 'legal_name', label: 'Юрлицо или ИП', value: hotel.legal_name })}
    ${field({ prefix: 'so', name: 'inn', label: 'ИНН', value: hotel.inn, attrs: 'inputmode="numeric" maxlength="12"' })}
    ${ro ? '' : html`<div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button></div>`}
  </form>`);
}

export function settingsBooking({ req, hotel, msg, groups = [] }) {
  const ro = req.user.role !== 'owner';
  const pct = (bp) => (bp / 100).toString().replace('.', ',');
  return page(req, hotel, msg, 'Бронирование и оплата', html`<form class="card form form--grid" method="post" action="/app/settings/booking">${csrf(req)}
    ${ro ? html`<p class="flash flash--error">Менять настройки может только владелец.</p>` : ''}
    <h2 class="h3 span-all">Окно продаж в модуле бронирования</h2>
    ${field({ prefix: 'sb', name: 'min_days_ahead', label: 'Бронировать не позже чем за, дней', type: 'number', value: hotel.min_days_ahead, attrs: 'min="0" max="60"', hint: '0 — можно бронировать в день заезда' })}
    ${field({ prefix: 'sb', name: 'max_days_ahead', label: 'Открыто дней вперёд', type: 'number', value: hotel.max_days_ahead, attrs: 'min="1" max="730"' })}
    ${field({ prefix: 'sb', name: 'cutoff_time', label: 'Брони на сегодня принимать до', type: 'time', value: hotel.cutoff_time })}
    <h2 class="h3 span-all">Оплата</h2>
    <label class="check"><input type="checkbox" name="pay_at_hotel" ${hotel.pay_at_hotel ? raw('checked') : ''}><span>Оплата при заселении</span></label>
    <label class="check"><input type="checkbox" name="pay_card" ${hotel.pay_card ? raw('checked') : ''}><span>Онлайн-оплата картой (сейчас тестовый режим)</span></label>
    ${field({ prefix: 'sb', name: 'prepay_pct', label: 'Предоплата при оплате онлайн, %', type: 'number', value: hotel.prepay_pct, attrs: 'min="0" max="100"', hint: '0 или 100 — полная оплата' })}
    ${field({ prefix: 'sb', name: 'cancel_policy', label: 'Условия отмены (показываем гостю)', type: 'textarea', value: hotel.cancel_policy })}
    <h2 class="h3 span-all">Туристический налог</h2>
    <p class="muted span-all">Ставку устанавливает муниципалитет: в 2026 году — не выше 2%, но не меньше 100 ₽ за сутки. Налог считается только от проживания — без питания и услуг. Уточните ставку для своего города.</p>
    ${field({ prefix: 'sb', name: 'tax_pct', label: 'Ставка, %', value: pct(hotel.tax_bp), attrs: 'inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?"', hint: '0 — налог не взимается' })}
    ${field({ prefix: 'sb', name: 'tax_min_night', label: 'Минимум за сутки, ₽', type: 'number', value: hotel.tax_min_night, attrs: 'min="0"' })}
    ${ro ? '' : html`<div class="actions span-all"><button class="btn btn--primary" type="submit">Сохранить</button></div>`}
  </form>
  <section class="card" id="ages"><h2 class="h3">Детские возрастные группы</h2>
    <p class="muted">Ребёнок попадает в первую группу, где «до … лет» больше его возраста: группа «до 3 лет» — это 0, 1 и 2 года. Гости старше последней группы (сейчас ${hotel.child_max_age} лет и старше) считаются взрослыми. «Без места» — ребёнок не занимает кровать (спит с родителями или в детской кроватке). Цены детей по группам задаются в каждом тарифе.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Возрастные группы"><table class="table"><thead><tr><th scope="col">Группа</th><th scope="col">Возраст</th><th scope="col">Место</th><th scope="col">Питание</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${groups.map((g, i) => html`<tr><td>${g.name}</td><td>${i ? groups[i - 1].max_age : 0}–${g.max_age - 1} лет</td><td>${g.no_bed ? 'без места' : 'основное или доп. место'}</td><td>${g.meal_pct}% от взрослого</td>
        <td>${ro ? '' : html`<details class="row-edit"><summary>Изменить</summary>${groupForm(req, g, `/app/settings/child-groups/${g.id}`)}</details>
          ${groups.length > 1 ? html`<form method="post" action="/app/settings/child-groups/${g.id}/delete" data-confirm="Удалить группу «${g.name}»? Цены этой группы в тарифах тоже удалятся.">${csrf(req)}<button class="linklike" type="submit">Удалить</button></form>` : ''}`}</td></tr>`)}</tbody></table></div>
    ${ro ? '' : html`<details class="add"><summary class="btn btn--secondary">Добавить группу</summary>${groupForm(req, {}, '/app/settings/child-groups')}</details>`}
  </section>`);
}

function groupForm(req, g, action) {
  const pfx = action.replace(/\W+/g, '-').replace(/^-/, '');
  return html`<form class="form form--grid" method="post" action="${action}">${csrf(req)}
    ${field({ prefix: pfx, name: 'name', label: 'Название', value: g.name, attrs: 'required maxlength="40" placeholder="Например, Малыши"' })}
    ${field({ prefix: pfx, name: 'max_age', label: 'До, лет (не включая)', type: 'number', value: g.max_age, attrs: 'required min="1" max="18"' })}
    ${field({ prefix: pfx, name: 'meal_pct', label: 'Питание, % от взрослого', type: 'number', value: g.meal_pct ?? 100, attrs: 'min="0" max="100"' })}
    <label class="check"><input type="checkbox" name="no_bed" ${g.no_bed ? raw('checked') : ''}><span>Без места</span></label>
    <div class="actions"><button class="btn btn--primary" type="submit">Сохранить</button><a class="btn btn--ghost" href="/app/settings/booking#ages" data-close-details>Отмена</a></div></form>`;
}

export function settingsTeam({ req, hotel, users, msg, created }) {
  const owner = req.user.role === 'owner';
  return page(req, hotel, msg, 'Сотрудники', html`
    ${created ? html`<div class="flash flash--success" role="status">Сотрудник добавлен. Временный пароль: <code>${created}</code> — передайте его сотруднику, он больше не будет показан.</div>` : ''}
    <section class="card"><h2 class="h3">Доступ к объекту «${hotel.name}»</h2>
      <p class="muted">Владелец видит всё и меняет настройки. Администратор работает с бронями, шахматкой, ценами и номерами, но не меняет настройки и сотрудников.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Сотрудники"><table class="table"><thead><tr><th scope="col">Имя</th><th scope="col">Почта</th><th scope="col">Роль</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${users.map((u) => html`<tr><td>${u.name}${u.id === req.user.id ? ' (вы)' : ''}</td><td>${u.email}</td><td>${u.role === 'owner' ? 'Владелец' : 'Администратор'}</td>
        <td>${owner && u.id !== req.user.id ? html`<form method="post" action="/app/settings/team/${u.id}/remove" data-confirm="Закрыть доступ сотруднику ${u.name}?">${csrf(req)}<button class="linklike" type="submit">Закрыть доступ</button></form>` : ''}</td></tr>`)}</tbody></table></div>
    </section>
    ${owner ? html`<section class="card"><h2 class="h3">Добавить сотрудника</h2>
      <form class="form form--grid" method="post" action="/app/settings/team">${csrf(req)}
        ${field({ prefix: 'tm', name: 'name', label: 'Имя', attrs: 'required maxlength="80"' })}
        ${field({ prefix: 'tm', name: 'email', label: 'Почта для входа', type: 'email', attrs: 'required' })}
        ${field({ prefix: 'tm', name: 'role', label: 'Роль', type: 'select', options: [['manager', 'Администратор'], ['owner', 'Владелец']] })}
        <div class="actions"><button class="btn btn--primary" type="submit">Добавить</button></div>
        <p class="muted span-all">Если у человека уже есть кабинет в ${'Stayra'}, он получит доступ к этому объекту в своём кабинете.</p>
      </form></section>` : ''}
    <section class="card"><h2 class="h3">Сменить свой пароль</h2>
      <form class="form form--grid" method="post" action="/app/settings/password">${csrf(req)}
        ${field({ prefix: 'pw', name: 'current', label: 'Текущий пароль', type: 'password', attrs: 'required autocomplete="current-password"' })}
        ${field({ prefix: 'pw', name: 'password', label: 'Новый пароль (от 8 символов)', type: 'password', attrs: 'required minlength="8" autocomplete="new-password"' })}
        <div class="actions"><button class="btn btn--secondary" type="submit">Сменить пароль</button></div>
      </form></section>`);
}

export function settingsProperties({ req, hotel, hotels, msg }) {
  return page(req, hotel, msg, 'Мои объекты', html`<section class="card"><h2 class="h3">Объекты, к которым у вас есть доступ</h2>
      <p class="muted">Каждый объект — отдельный кабинет со своими номерами, ценами, бронями и сотрудниками. Переключайтесь между ними в меню слева.</p>
      <ul class="mini-list">${hotels.map((h) => html`<li><span><strong>${h.name}</strong> <small class="muted">${h.role === 'owner' ? 'владелец' : 'администратор'} · /h/${h.slug}</small></span>
        ${h.id === hotel.id ? html`<span class="badge badge--confirmed">открыт</span>` : html`<form method="post" action="/app/switch">${csrf(req)}<input type="hidden" name="hotel_id" value="${h.id}"><button class="btn btn--sm btn--secondary" type="submit">Открыть</button></form>`}</li>`)}</ul>
    </section>
    <section class="card"><h2 class="h3">Добавить объект</h2>
      <form class="form form--grid" method="post" action="/app/settings/properties">${csrf(req)}
        ${field({ prefix: 'pr', name: 'name', label: 'Название', attrs: 'required maxlength="120"' })}
        ${field({ prefix: 'pr', name: 'city', label: 'Город' })}
        ${field({ prefix: 'pr', name: 'property_type', label: 'Тип', type: 'select', options: PROPERTY_TYPES })}
        <div class="actions"><button class="btn btn--primary" type="submit">Создать объект</button></div>
      </form></section>`);
}

export function settingsWidget({ req, hotel, origin, msg }) {
  const embed = `<div id="stayra-booking"></div>\n<script src="${origin}/widget.js" data-hotel="${hotel.slug}" async></script>`;
  return page(req, hotel, msg, 'Модуль на сайт', html`<section class="card"><h2 class="h3">Модуль бронирования на сайт</h2>
      <p>Вставьте этот код на страницу сайта, где должна быть форма поиска номеров:</p>
      <pre class="code" tabindex="0"><code>${embed}</code></pre>
      <button class="btn btn--secondary btn--sm" type="button" data-copy="${embed}">Скопировать код</button>
      <p>Или дайте гостям прямую ссылку: <a href="/h/${hotel.slug}">${origin}/h/${hotel.slug}</a></p>
      <p><a href="/widget-demo?hotel=${hotel.slug}">Посмотреть виджет на тестовой странице</a></p>
    </section>`);
}
