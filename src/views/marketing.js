import { html, raw, rub, field } from './html.js';
import { icon } from './icons.js';
import { siteLayout } from './layout.js';
import { ARTICLES, BRAND, HOME_FAQ, PRODUCTS, SOLUTIONS, STATS } from '../content.js';
import { PROPERTY_TYPES, TOOLS, MAX_ROOMS } from '../lib/pricing.js';

const product = (slug) => PRODUCTS.find((p) => p.slug === slug);

function faq(items) {
  if (!items.length) return '';
  return html`<section class="section section--alt"><div class="container container--narrow">
    <h2 class="section-title">Частые вопросы</h2>
    <div class="faq">${items.map(([q, a], i) => html`<details ${i === 0 ? raw('open') : ''}><summary>${q}</summary><p>${a}</p></details>`)}</div>
  </div></section>`;
}

function ctaBand(text = 'Покажем, как это работает на примере вашего объекта') {
  return html`<section class="cta-band"><div class="container cta-band__row">
    <p>${text}</p>
    <a class="btn btn--accent btn--lg" href="/demo">Запросить демо</a>
  </div></section>`;
}

// Hero illustration: abstract booking card stack, pure CSS/SVG, made for Stayra.
const HERO_ART = raw(`<svg class="hero-art" viewBox="0 0 420 320" role="img" aria-label="Схема: сайт, площадки и кабинет связаны одной шахматкой">
  <rect x="40" y="40" width="250" height="170" rx="18" fill="var(--surface-2)" stroke="var(--border)"/>
  <rect x="60" y="62" width="120" height="12" rx="6" fill="var(--brand)"/>
  <rect x="60" y="88" width="200" height="8" rx="4" fill="var(--border)"/>
  <rect x="60" y="104" width="160" height="8" rx="4" fill="var(--border)"/>
  ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${60 + i * 30}" y="130" width="24" height="24" rx="5" fill="${i === 2 || i === 3 ? 'var(--brand)' : 'var(--bg)'}" stroke="var(--border)"/><rect x="${60 + i * 30}" y="160" width="24" height="24" rx="5" fill="${i === 5 ? 'var(--accent)' : 'var(--bg)'}" stroke="var(--border)"/>`).join('')}
  <rect x="230" y="150" width="160" height="120" rx="18" fill="var(--bg)" stroke="var(--border)" />
  <circle cx="262" cy="182" r="14" fill="var(--accent)"/>
  <path d="M255 182l5 5 9-10" stroke="var(--text)" stroke-width="3" fill="none" stroke-linecap="round"/>
  <rect x="284" y="174" width="86" height="8" rx="4" fill="var(--text)"/>
  <rect x="284" y="188" width="60" height="6" rx="3" fill="var(--border)"/>
  <rect x="250" y="220" width="120" height="28" rx="14" fill="var(--brand)"/>
  <circle cx="345" cy="60" r="26" fill="var(--accent)" opacity=".9"/>
  <path d="M290 72 C320 80 330 100 330 140" stroke="var(--brand)" stroke-width="2" stroke-dasharray="5 6" fill="none"/>
</svg>`);

export function home() {
  const tabs = SOLUTIONS;
  return siteLayout({
    title: `${BRAND.name} — бронирование, каналы продаж и PMS для отелей`,
    body: html`
    <section class="hero"><div class="container hero__row">
      <div class="hero__text">
        <p class="eyebrow">Для отелей, апартаментов и загородных объектов</p>
        <h1>Продавайте номера напрямую и управляйте отелем из одного окна</h1>
        <p class="lead">Модуль бронирования на сайт, менеджер каналов и облачная PMS работают на одной шахматке. Цена изменилась в одном месте — обновилась везде.</p>
        <div class="hero__cta"><a class="btn btn--accent btn--lg" href="/demo">Запросить демо</a><a class="btn btn--secondary btn--lg" href="/h/severny-bereg">Попробовать как гость</a></div>
      </div>
      ${HERO_ART}
    </div></section>

    <section class="container stats" aria-label="Цифры">
      ${STATS.map(([n, t]) => html`<div class="stat"><strong>${n}</strong><span>${t}</span></div>`)}
    </section>

    <section class="section"><div class="container">
      <h2 class="section-title">Три задачи, которые закрывает ${BRAND.name}</h2>
      <div class="cards cards--3">
        ${['booking-engine', 'channel-manager', 'pms'].map((s) => {
          const p = product(s);
          return html`<article class="card card--product">
            <span class="card__icon">${icon(p.icon, 28)}</span>
            <h3><a href="/products/${p.slug}">${p.name}</a></h3>
            <p>${p.short}</p>
            <p class="card__price">${p.price}</p>
          </article>`;
        })}
      </div>
    </div></section>

    <section class="section section--alt"><div class="container split">
      <div>
        <h2 class="section-title section-title--left">Как гость бронирует у вас</h2>
        <ol class="steps">
          <li><strong>Даты и гости.</strong> Форма поиска на вашем сайте.</li>
          <li><strong>Номер и тариф.</strong> Цена сразу за все ночи, с завтраком или без.</li>
          <li><strong>Контакты и допуслуги.</strong> Трансфер, парковка, ранний заезд.</li>
          <li><strong>Подтверждение.</strong> Номер брони на экране, номер списан во всех каналах.</li>
        </ol>
        <a class="btn btn--primary" href="/h/severny-bereg">Открыть демо-отель</a>
      </div>
      <div class="mock-phone" aria-hidden="true">
        <div class="mock-phone__screen">
          <div class="mock-line mock-line--brand"></div>
          <div class="mock-room"><div class="mock-img"></div><div><div class="mock-line"></div><div class="mock-line mock-line--short"></div><div class="mock-btn"></div></div></div>
          <div class="mock-room"><div class="mock-img mock-img--2"></div><div><div class="mock-line"></div><div class="mock-line mock-line--short"></div><div class="mock-btn"></div></div></div>
        </div>
      </div>
    </div></section>

    <section class="section"><div class="container">
      <h2 class="section-title">Ещё инструменты платформы</h2>
      <div class="tiles">
        ${PRODUCTS.filter((p) => !['booking-engine', 'channel-manager', 'pms'].includes(p.slug)).map((p) => html`<a class="tile" href="/products/${p.slug}">${icon(p.icon)}<span>${p.name}</span></a>`)}
      </div>
    </div></section>

    <section class="section section--alt"><div class="container">
      <h2 class="section-title">Под ваш тип объекта</h2>
      <div class="tabs" data-tabs>
        <div class="tabs__list" role="tablist" aria-label="Типы объектов">
          ${tabs.map((s, i) => html`<button role="tab" type="button" id="tab-${s.slug}" aria-controls="panel-${s.slug}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${s.name}</button>`)}
        </div>
        ${tabs.map((s, i) => html`<div class="tabs__panel" role="tabpanel" id="panel-${s.slug}" aria-labelledby="tab-${s.slug}" ${i === 0 ? '' : raw('hidden')}>
          <p class="lead">${s.pitch}</p>
          <ul class="checklist">${s.products.map((slug) => html`<li>${icon('check', 18)} ${product(slug).name}</li>`)}</ul>
          <a class="btn btn--secondary" href="/solutions/${s.slug}">Подробнее</a>
        </div>`)}
      </div>
    </div></section>

    ${faq(HOME_FAQ)}
    ${ctaBand()}`,
  });
}

export function productsIndex() {
  return siteLayout({
    title: `Продукты — ${BRAND.name}`,
    body: html`<section class="page-head"><div class="container"><h1>Продукты</h1><p class="lead">Подключайте по одному или собирайте набор — всё работает на общей шахматке.</p></div></section>
    <section class="section"><div class="container cards cards--3">
      ${PRODUCTS.map((p) => html`<article class="card card--product"><span class="card__icon">${icon(p.icon, 28)}</span><h2 class="h3"><a href="/products/${p.slug}">${p.name}</a></h2><p>${p.short}</p><p class="card__price">${p.price}</p></article>`)}
    </div></section>${ctaBand()}`,
  });
}

export function productPage(p) {
  return siteLayout({
    title: `${p.name} — ${BRAND.name}`,
    description: p.short,
    body: html`<section class="page-head page-head--product"><div class="container">
      <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a> / <a href="/products">Продукты</a> / <span>${p.name}</span></nav>
      <span class="card__icon card__icon--lg">${icon(p.icon, 36)}</span>
      <h1>${p.name}</h1><p class="lead">${p.lead}</p>
      <div class="hero__cta"><a class="btn btn--accent btn--lg" href="/demo?product=${p.slug}">Запросить демо</a><a class="btn btn--secondary btn--lg" href="/price">Рассчитать стоимость</a></div>
    </div></section>
    <section class="section"><div class="container">
      <h2 class="section-title">Что умеет</h2>
      <div class="cards cards--3">${p.features.map(([t, d]) => html`<article class="card"><h3>${t}</h3><p>${d}</p></article>`)}</div>
    </div></section>
    <section class="section section--alt"><div class="container price-box">
      <div><h2 class="section-title section-title--left">Стоимость</h2><p class="price-box__value">${p.price}</p></div>
      <a class="btn btn--primary btn--lg" href="/price">Собрать свой набор</a>
    </div></section>
    ${faq(p.faq)}${ctaBand()}`,
  });
}

export function solutionPage(s) {
  return siteLayout({
    title: `${s.name} — решения ${BRAND.name}`,
    body: html`<section class="page-head"><div class="container">
      <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a> / <span>Решения</span> / <span>${s.name}</span></nav>
      <h1>${s.name}</h1><p class="lead">${s.pitch}</p></div></section>
    <section class="section"><div class="container">
      <h2 class="section-title">Рекомендуемый набор</h2>
      <div class="cards cards--3">${s.products.map((slug) => {
        const p = product(slug);
        return html`<article class="card card--product"><span class="card__icon">${icon(p.icon, 28)}</span><h3><a href="/products/${p.slug}">${p.name}</a></h3><p>${p.short}</p><p class="card__price">${p.price}</p></article>`;
      })}</div>
      <p class="center"><a class="btn btn--primary btn--lg" href="/price?type=${s.slug}">Рассчитать стоимость</a></p>
    </div></section>${ctaBand()}`,
  });
}

export function pricePage({ type = 'hotel', rooms = 20, tools = ['channels', 'pms'], quote }) {
  return siteLayout({
    title: `Цены — ${BRAND.name}`,
    current: 'price',
    body: html`<section class="page-head"><div class="container"><h1>Соберите набор и узнайте цену</h1><p class="lead">Цена зависит от типа объекта и числа номеров. Скидка 10% на абонентскую плату при трёх и более платных инструментах.</p></div></section>
    <section class="section"><div class="container calc">
      <form class="calc__form card" method="get" action="/price" data-calc>
        ${field({ name: 'type', label: 'Тип объекта', type: 'select', value: type, options: PROPERTY_TYPES.map((p) => [p.id, p.name]) })}
        ${field({ name: 'rooms', label: 'Сколько номеров', type: 'number', value: rooms, attrs: `min="1" max="${MAX_ROOMS}" inputmode="numeric" required`, error: quote.ok ? '' : quote.error })}
        <fieldset class="calc__tools"><legend>Инструменты</legend>
          ${TOOLS.map((t) => html`<label class="check">
            <input type="checkbox" name="tools" value="${t.id}" ${t.required || tools.includes(t.id) ? raw('checked') : ''} ${t.required ? raw('disabled') : ''}>
            <span>${t.name}${t.required ? ' — основа' : ''}${t.included ? ' — бесплатно' : ''}</span></label>`)}
        </fieldset>
        <noscript><button class="btn btn--primary" type="submit">Посчитать</button></noscript>
      </form>
      <aside class="calc__result card" aria-live="polite" data-calc-result>${quoteView(quote)}</aside>
    </div></section>${ctaBand('Нужен точный расчёт для сети или санатория? Посчитаем вместе с вами.')}`,
  });
}

export function quoteView(q) {
  if (!q.ok) return html`<p class="field-error">${q.error}</p>`;
  return html`<h2 class="h3">Ваш набор</h2>
    <ul class="quote">${q.lines.map((l) => html`<li><span>${l.name}</span><span>${l.included ? 'входит' : l.commission ? `${String(l.commission).replace('.', ',')}%` : rub(l.monthly) + '/мес.'}</span></li>`)}</ul>
    ${q.discount ? html`<p class="quote__discount">Скидка за набор: −${rub(q.discount)}/мес.</p>` : ''}
    <p class="quote__total"><span>Итого в месяц</span><strong data-total>${rub(q.monthly)}</strong></p>
    <p class="muted">плюс ${String(q.commission).replace('.', ',')}% от броней через модуль${q.setup ? `, разово ${rub(q.setup)} за сайт` : ''}</p>
    <a class="btn btn--accent btn--block" href="/demo">Обсудить подключение</a>`;
}

export function demoPage({ values = {}, errors = {}, done = false }) {
  const body = done
    ? html`<div class="card success-card" role="status"><span class="card__icon">${icon('check', 28)}</span><h2>Заявка отправлена</h2><p>Перезвоним в рабочее время в течение часа и договоримся о показе.</p><a class="btn btn--secondary" href="/">На главную</a></div>`
    : html`<form class="card form" method="post" action="/demo" novalidate>
        ${field({ name: 'name', label: 'Имя', value: values.name, error: errors.name, attrs: 'autocomplete="name" required' })}
        ${field({ name: 'phone', label: 'Телефон', type: 'tel', value: values.phone, error: errors.phone, attrs: 'autocomplete="tel" required' })}
        ${field({ name: 'email', label: 'Почта (необязательно)', type: 'email', value: values.email, error: errors.email, attrs: 'autocomplete="email"' })}
        ${field({ name: 'property_type', label: 'Тип объекта', type: 'select', value: values.property_type || 'hotel', options: PROPERTY_TYPES.map((p) => [p.id, p.name]) })}
        ${field({ name: 'rooms', label: 'Номеров', type: 'number', value: values.rooms, error: errors.rooms, attrs: 'min="1" max="2000" inputmode="numeric"' })}
        ${field({ name: 'message', label: 'Что хотите обсудить', type: 'textarea', value: values.message })}
        <input type="hidden" name="source_page" value="${values.source_page || ''}">
        <div class="hp" aria-hidden="true"><label>Не заполняйте<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <label class="check"><input type="checkbox" name="agree" ${values.agree ? raw('checked') : ''}><span>Согласен на обработку персональных данных по <a href="/privacy">политике</a></span></label>
        ${errors.agree ? html`<p class="field-error">${errors.agree}</p>` : ''}
        <button class="btn btn--accent btn--lg btn--block" type="submit">Отправить заявку</button>
      </form>`;
  return siteLayout({
    title: `Запросить демо — ${BRAND.name}`,
    body: html`<section class="section"><div class="container container--narrow">
      <h1>Запросить демо</h1><p class="lead">Покажем кабинет на тестовом отеле и ответим на вопросы. Займёт 30 минут.</p>${body}
    </div></section>`,
  });
}

export function contactsPage() {
  return siteLayout({
    title: `Контакты — ${BRAND.name}`,
    current: 'contacts',
    body: html`<section class="page-head"><div class="container"><h1>Контакты</h1></div></section>
    <section class="section"><div class="container cards cards--3">
      <article class="card">${icon('phone')}<h2 class="h3">Отдел продаж</h2><p><a href="tel:${BRAND.phone.replace(/\D/g, '')}">${BRAND.phone}</a><br>пн–пт, 9:00–19:00 мск</p></article>
      <article class="card">${icon('mail')}<h2 class="h3">Почта</h2><p><a href="mailto:${BRAND.email}">${BRAND.email}</a><br>Отвечаем в течение рабочего дня</p></article>
      <article class="card">${icon('users')}<h2 class="h3">Поддержка клиентов</h2><p>Круглосуточно из кабинета и по почте support@stayra.example</p></article>
    </div></section>${ctaBand()}`,
  });
}

export function aboutPage() {
  return siteLayout({
    title: `О нас — ${BRAND.name}`,
    current: 'about',
    body: html`<section class="page-head"><div class="container container--narrow"><h1>О ${BRAND.name}</h1>
      <p class="lead">Мы делаем софт для небольших отелей, у которых нет отдела продаж и IT-службы.</p></div></section>
    <section class="section"><div class="container container--narrow prose">
      <p>Владелец мини-отеля сам отвечает на звонки, меняет цены на пяти сайтах и сверяет брони в тетради. Мы хотим, чтобы на это уходило десять минут в день, а не весь день.</p>
      <p>Поэтому у ${BRAND.name} одна шахматка для всего: сайта, площадок и ресепшена. Поменяли цену — она везде. Пришла бронь — номер закрыт везде.</p>
      <h2>Принципы</h2>
      <ul><li>Простые цены без скрытых платежей.</li><li>Отмена подписки — одной кнопкой.</li><li>Поддержка отвечает людьми, а не шаблонами.</li></ul>
    </div></section>${ctaBand()}`,
  });
}

export function privacyPage() {
  return siteLayout({
    title: `Конфиденциальность — ${BRAND.name}`,
    body: html`<section class="section"><div class="container container--narrow prose"><h1>Политика конфиденциальности</h1>
      <p>Это демонстрационный проект. Мы храним только данные, которые вы ввели в формы: имя, телефон, почту и параметры брони. Они нужны, чтобы обработать заявку или бронь, и не передаются третьим лицам.</p>
      <p>Чтобы удалить свои данные, напишите на ${BRAND.email}.</p></div></section>`,
  });
}

export function supportPage({ q, results }) {
  return siteLayout({
    title: `База знаний — ${BRAND.name}`,
    current: 'support',
    body: html`<section class="page-head"><div class="container container--narrow"><h1>База знаний</h1>
      <form class="search" role="search" method="get" action="/support">
        <label class="sr-only" for="kb-q">Поиск по статьям</label>
        <input id="kb-q" name="q" type="search" value="${q}" placeholder="Например: промокод">
        <button class="btn btn--primary" type="submit">Найти</button>
      </form></div></section>
    <section class="section"><div class="container container--narrow">
      ${q ? html`<p class="muted">Найдено: ${results.length}</p>` : ''}
      ${results.length ? html`<ul class="article-list">${results.map((a) => html`<li><a href="/support/${a.slug}">${a.title}</a><span class="muted">${a.body[0].slice(0, 110)}…</span></li>`)}</ul>`
        : html`<div class="empty"><p>По запросу «${q}» ничего нет. Попробуйте другое слово или <a href="/contacts">напишите нам</a>.</p></div>`}
    </div></section>`,
  });
}

export function articlePage(a) {
  return siteLayout({
    title: `${a.title} — ${BRAND.name}`,
    current: 'support',
    body: html`<section class="section"><div class="container container--narrow prose">
      <nav class="crumbs" aria-label="Навигация"><a href="/support">База знаний</a> / <span>${a.title}</span></nav>
      <h1>${a.title}</h1>${a.body.map((p) => html`<p>${p}</p>`)}
      <p class="muted">Теги: ${a.tags.join(', ')}</p></div></section>`,
  });
}

export function searchArticles(q) {
  const s = q.trim().toLowerCase();
  if (!s) return ARTICLES;
  return ARTICLES.filter((a) => [a.title, ...a.body, ...a.tags].join(' ').toLowerCase().includes(s));
}

export function notFound() {
  return siteLayout({
    title: `Страница не найдена — ${BRAND.name}`,
    body: html`<section class="section"><div class="container container--narrow center"><h1>Такой страницы нет</h1><p class="lead">Возможно, ссылка устарела.</p><a class="btn btn--primary" href="/">На главную</a></div></section>`,
  });
}
