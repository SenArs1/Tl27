import { html, raw } from './html.js';
import { icon, LOGO } from './icons.js';
import { BRAND, PRODUCTS, SOLUTIONS } from '../content.js';

function head(title, description) {
  return html`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description || BRAND.tagline}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/app.css">
<script src="/js/site.js" defer></script>
</head>`;
}

function flash(msg) {
  if (!msg) return '';
  return html`<div class="flash flash--${msg.type}" role="status">${msg.text}</div>`;
}

export function siteLayout({ title, description, body, current = '' }) {
  const nav = html`
  <header class="site-header">
    <div class="container site-header__row">
      <a class="logo" href="/">${LOGO}<span>${BRAND.name}</span></a>
      <button class="burger" type="button" aria-expanded="false" aria-controls="site-nav" data-toggle="site-nav">${icon('menu')}<span class="sr-only">Меню</span></button>
      <nav id="site-nav" class="site-nav" aria-label="Основное меню">
        <div class="menu">
          <button type="button" class="menu__btn" aria-expanded="false" data-menu>Продукты</button>
          <div class="menu__panel">
            <div class="menu__grid">
              ${PRODUCTS.map((p) => html`<a class="menu__item" href="/products/${p.slug}">${icon(p.icon)}<span><strong>${p.name}</strong><small>${p.short}</small></span></a>`)}
            </div>
            <a class="menu__all" href="/products">Все продукты →</a>
          </div>
        </div>
        <div class="menu">
          <button type="button" class="menu__btn" aria-expanded="false" data-menu>Решения</button>
          <div class="menu__panel menu__panel--narrow">
            ${SOLUTIONS.map((s) => html`<a class="menu__link" href="/solutions/${s.slug}">${s.name}</a>`)}
          </div>
        </div>
        <a href="/price" ${current === 'price' ? raw('aria-current="page"') : ''}>Цены</a>
        <a href="/support" ${current === 'support' ? raw('aria-current="page"') : ''}>Помощь</a>
        <a href="/about" ${current === 'about' ? raw('aria-current="page"') : ''}>О нас</a>
        <a href="/contacts" ${current === 'contacts' ? raw('aria-current="page"') : ''}>Контакты</a>
        <span class="site-nav__end">
          <a class="phone" href="tel:${BRAND.phone.replace(/\D/g, '')}">${BRAND.phone}</a>
          <a class="btn btn--ghost btn--sm" href="/app">Войти</a>
        </span>
      </nav>
    </div>
  </header>`;
  const footer = html`
  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <a class="logo logo--light" href="/">${LOGO}<span>${BRAND.name}</span></a>
        <p class="muted-light">${BRAND.tagline}</p>
        <p><a href="tel:${BRAND.phone.replace(/\D/g, '')}">${BRAND.phone}</a><br><a href="mailto:${BRAND.email}">${BRAND.email}</a></p>
      </div>
      <div><h2 class="footer-h">Продукты</h2>${PRODUCTS.map((p) => html`<a href="/products/${p.slug}">${p.name}</a>`)}</div>
      <div><h2 class="footer-h">Решения</h2>${SOLUTIONS.map((s) => html`<a href="/solutions/${s.slug}">${s.name}</a>`)}</div>
      <div><h2 class="footer-h">Компания</h2><a href="/about">О нас</a><a href="/price">Цены</a><a href="/support">База знаний</a><a href="/contacts">Контакты</a><a href="/demo">Запросить демо</a><a href="/privacy">Конфиденциальность</a></div>
    </div>
    <div class="container footer-bottom">© ${new Date().getFullYear()} ${BRAND.name}. Демонстрационный проект.</div>
  </footer>`;
  return html`${head(title, description)}
<body>
<a class="skip" href="#main">К содержанию</a>
${nav}
<main id="main">${body}</main>
${footer}
</body></html>`.value;
}

export function engineLayout({ title, hotel, body }) {
  return html`${head(`${title} — ${hotel.name}`)}
<body class="engine">
<a class="skip" href="#main">К содержанию</a>
<header class="engine-header">
  <div class="container engine-header__row">
    <a class="engine-hotel" href="/h/${hotel.slug}"><span class="engine-hotel__mark" aria-hidden="true">${hotel.name.slice(0, 1)}</span>${hotel.name}</a>
    <a href="/h/${hotel.slug}/manage">Моё бронирование</a>
  </div>
</header>
<main id="main" class="container engine-main">${body}</main>
<footer class="engine-footer container">${hotel.address} · ${hotel.phone} · Бронирование работает на ${BRAND.name}</footer>
</body></html>`.value;
}

// [href, icon, label, roles that see it]
const STAFF = ['owner', 'manager'];
const APP_NAV = [
  ['/app', 'home', 'Сводка', [...STAFF, 'investor']],
  ['/app/chess', 'grid', 'Шахматка', STAFF],
  ['/app/bookings', 'list', 'Журнал броней', STAFF],
  ['/app/groups', 'users', 'Группы', STAFF],
  ['/app/housekeeping', 'check', 'Уборка', [...STAFF, 'housekeeping']],
  ['/app/prices', 'calendar', 'Цены и наличие', STAFF],
  ['/app/rooms', 'bed', 'Номера и тарифы', STAFF],
  ['/app/channels', 'share', 'Каналы продаж', STAFF],
  ['/app/reports', 'report', 'Отчёты', [...STAFF, 'investor']],
  ['/app/settings', 'settings', 'Настройки', STAFF],
];
export const ROLE_NAMES = { owner: 'владелец', manager: 'администратор', housekeeping: 'горничная', investor: 'инвестор' };

export function appLayout({ title, req, hotel, body, msg, wide = false }) {
  const path = req.path === '/' ? req.baseUrl : req.baseUrl + req.path;
  const hotels = req.hotels || [];
  return html`${head(`${title} — ${BRAND.name}`)}
<body class="app">
<a class="skip" href="#main">К содержанию</a>
<div class="app-shell">
  <aside class="app-side" id="app-side">
    <a class="logo logo--light" href="/app">${LOGO}<span>${BRAND.name}</span></a>
    ${hotels.length > 1
      ? html`<form method="post" action="/app/switch" class="app-switch">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <label for="hotel-switch" class="sr-only">Объект</label>
          <select id="hotel-switch" name="hotel_id" data-autosubmit>${hotels.map((h) => html`<option value="${h.id}" ${h.id === hotel.id ? raw('selected') : ''}>${h.name}</option>`)}</select>
          <noscript><button type="submit">Открыть</button></noscript>
        </form>`
      : html`<p class="app-hotel">${hotel.name}</p>`}
    <nav aria-label="Разделы кабинета">
      ${APP_NAV.filter((x) => x[3].includes(req.user.role)).map(([href, ic, label]) => {
        const active = href === '/app' ? path === '/app' || path === '/app/' : path.startsWith(href);
        return html`<a href="${href}" ${active ? raw('aria-current="page"') : ''}>${icon(ic, 20)}<span>${label}</span></a>`;
      })}
      ${req.user.platform ? html`<a href="/admin">${icon('inbox', 20)}<span>Платформа</span></a>` : ''}
    </nav>
    <form method="post" action="/app/logout" class="app-logout">
      <input type="hidden" name="_csrf" value="${req.session.csrf}">
      <button type="submit" class="linklike">${icon('logout', 18)} Выйти</button>
    </form>
  </aside>
  <div class="app-main">
    <header class="app-top">
      <button class="burger burger--app" type="button" aria-expanded="false" aria-controls="app-side" data-toggle="app-side">${icon('menu')}<span class="sr-only">Меню</span></button>
      <h1>${title}</h1>
      <span class="app-user">${req.user.name} · ${ROLE_NAMES[req.user.role] || req.user.role}</span>
    </header>
    <main id="main" class="app-content${wide ? ' app-content--wide' : ''}" data-csrf="${req.session.csrf}">${flash(msg)}${body}</main>
  </div>
</div>
</body></html>`.value;
}

export function bare({ title, body }) {
  return html`${head(`${title} — ${BRAND.name}`)}
<body class="bare"><main id="main">${body}</main></body></html>`.value;
}
